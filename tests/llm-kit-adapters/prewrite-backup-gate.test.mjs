/**
 * issue #1246 —— 批量写脚本的**写前备份前置闸**（`lib/llm-kit-adapters/transcript-backup.js`）
 *
 * 这一组用例要钉住的是"**顺序**"与"**范围**"两件事，不是"跑得出一个备份文件"：
 *
 *   1. 备份先于首条写（假 sequelize 记录调用序）：所有备份 SELECT 都排在第一条写 SQL 之前，
 *      且写回调里能当场读到盘上的备份文件（不是内存里那份）。
 *   2. 备份失败 ⇒ **零写** + 退出码非零：目录不可写 / 回读校验不过 / 子进程退出码三种都钉。
 *   3. 回滚 SQL 首行是 `SET NAMES utf8mb4;`，且 `UPDATE` 条数 == 备份行数。
 *      （缺首行会在 `utf8mb3` 客户端上静默部分回滚——演练里实证过的缺陷。）
 *   4. 备份覆盖**整张表**：dump 行数 == 假表总行数，且**多于**计划写入行数
 *      （防止"只备份计划行"的实现混过）。
 *   5. `--dry-run` 不建目录、不写备份、零写调用。
 *   6. 备份文件里不出现 provider key 之类的密钥（本清单里的四张表没有 api_key 列）。
 *
 * 全部用假 sequelize（不连库），所以可以 `node --test` 单跑，也不受 `llm_kit_test` 状态影响。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  BACKUP_ERROR_CODES,
  BACKUP_ROOT,
  BACKUP_TABLE_SPECS,
  ROLLBACK_SQL_FIRST_LINE,
  backupArtifactPaths,
  backupDirectoryName,
  defaultFsOps,
  hashRows,
  normalizeCellValue,
  planBackupTables,
  sqlColumnProjection,
  quoteSqlString,
  runWithPreWriteBackup,
  verifyBackupArtifacts,
} from "../../lib/llm-kit-adapters/transcript-backup.js";

import { describeFailure } from "../../scripts/verify-transcript-projection.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const WRITE_SQL_PATTERN = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE)\b/i;

/** 五行的假 canonical 表（计划只写 2 行 ⇒ 整表备份必须是 5 行）。 */
const CANONICAL_SCHEMA = [
  { name: "id", data_type: "varchar", extra: "" },
  { name: "request_id", data_type: "varchar", extra: "" },
  { name: "round_no", data_type: "int", extra: "" },
  { name: "dedup_key", data_type: "varchar", extra: "" },
  { name: "record_json", data_type: "longtext", extra: "" },
  { name: "created_at", data_type: "datetime", extra: "" },
  { name: "updated_at", data_type: "datetime", extra: "" },
];

/** 刻意塞进"回放时最容易炸"的字节：4 字节 emoji、单引号、反斜杠、换行、制表符。 */
const NASTY_RECORD = "{\"text\":\"🎯 4字节 emoji\",\"quote\":\"it's\",\"bs\":\"a\\b\",\"nl\":\"line1\\nline2\",\"tab\":\"a\\tb\"}";

function canonicalRowsFixture() {
  return [
    {
      id: "atr_1", request_id: "req_1", round_no: 0, dedup_key: "req_1:engine:round:0:seed",
      record_json: "{\"kind\":null}", created_at: "2026-11-01 18:00:00.000000", updated_at: null,
    },
    {
      id: "atr_2", request_id: "req_1", round_no: 1, dedup_key: "req_1:engine:round:1:seed",
      record_json: NASTY_RECORD, created_at: "2026-11-01 18:00:01.000000", updated_at: null,
    },
    {
      id: "atr_3", request_id: "req_2", round_no: 0, dedup_key: "req_2:engine:round:0:seed",
      record_json: "{\"kind\":\"message\",\"seq\":0}", created_at: "2026-11-01 18:00:02.000000", updated_at: null,
    },
    {
      id: "atr_4", request_id: "req_2", round_no: 1, dedup_key: "req_2:engine:round:1:seed",
      record_json: "{\"kind\":\"message\",\"seq\":1}", created_at: "2026-11-01 18:00:03.000000", updated_at: null,
    },
    {
      id: "atr_5", request_id: "req_3", round_no: 0, dedup_key: "req_3:engine:round:0:seed",
      record_json: "{\"kind\":null}", created_at: "2026-11-01 18:00:04.000000", updated_at: null,
    },
  ];
}

/**
 * 假 sequelize：`query()` 记录**调用序**（`kind: "read" | "write"`），并按表返回假数据。
 *
 * `countOverrides` 用来模拟"dump 之后表里多了一行"（回读校验必须当场发现）。
 */
function createFakeSequelize({ tables, countOverrides = [] }) {
  const calls = [];
  let countReads = 0;
  const sequelize = {
    calls,
    query: async (sql, options = {}) => {
      const text = typeof sql === "string" ? sql : String(sql?.query ?? "");
      const flat = text.replace(/\s+/g, " ").trim();
      if (WRITE_SQL_PATTERN.test(flat)) {
        calls.push({ kind: "write", sql: flat });
        return [{ affectedRows: 1 }, 1];
      }
      calls.push({ kind: "read", sql: flat });
      if (flat.includes("information_schema.COLUMNS")) {
        const table = options.replacements?.table;
        const schema = tables[table]?.schema ?? [];
        return [schema.map((column) => ({ ...column })), []];
      }
      const selectAll = /^SELECT .+ FROM `([^`]+)` ORDER BY `[^`]+`$/.exec(flat);
      if (selectAll) {
        const table = selectAll[1];
        const columns = tables[table]?.schema ?? [];
        // 时间列必须走 DATE_FORMAT 投影（时区安全的唯一实现方式）
        for (const column of columns) {
          if (column.data_type !== "datetime" && column.data_type !== "timestamp") continue;
          assert.ok(
            flat.includes(`DATE_FORMAT(\`${column.name}\``),
            `时间列 ${column.name} 必须用 DATE_FORMAT 投影（否则时区会把墙钟写偏）：${flat.slice(0, 120)}`,
          );
        }
        return [(tables[table]?.rows ?? []).map((row) => ({ ...row })), []];
      }
      const countMatch = /^SELECT COUNT\(\*\) AS total FROM `([^`]+)`$/.exec(flat);
      if (countMatch) {
        const table = countMatch[1];
        const rows = tables[table]?.rows ?? [];
        const override = countOverrides[countReads];
        countReads += 1;
        return [[{ total: override === undefined ? rows.length : override }], []];
      }
      throw new Error(`假 sequelize 不认识的 SQL：${flat}`);
    },
  };
  return sequelize;
}

function writeCallsOf(sequelize) {
  return sequelize.calls.filter((call) => call.kind === "write");
}

async function makeRoot(prefix = "backup-gate-") {
  return mkdtemp(join(tmpdir(), prefix));
}

const NOW = new Date(2026, 10, 2, 1, 30, 0); // 2026-11-02 01:30 本地 ⇒ 目录后缀 261102

test("备份先于首条写：假 sequelize 的调用序里所有备份 SELECT 都在第一条写 SQL 之前", async () => {
  const root = await makeRoot();
  const rows = canonicalRowsFixture();
  const sequelize = createFakeSequelize({
    tables: { agent_transcript_rounds: { schema: CANONICAL_SCHEMA, rows } },
  });
  let writesInsideCallback = 0;
  let sqlSeenInsideCallback = null;
  let jsonSeenInsideCallback = null;

  const run = await runWithPreWriteBackup({
    sequelize,
    database: "llm_kit_test",
    tables: [{ table: "agent_transcript_rounds", reasons: ["canonicalCleanup"] }],
    scriptName: "verify-transcript-projection",
    planRowsByTable: { agent_transcript_rounds: 2 },
    root,
    now: NOW,
  }, async (backup) => {
    // ① 回调里必须**还没有**任何写 SQL
    assert.deepEqual(
      writeCallsOf(sequelize).map((call) => call.sql),
      [],
      "写回调被调用时不允许已经发过写 SQL（顺序反了）",
    );
    // ② 回调里必须能当场读到盘上的备份（不是内存里那份）
    const entry = backup.tables[0];
    sqlSeenInsideCallback = await readFile(entry.sql_path, "utf8");
    jsonSeenInsideCallback = JSON.parse(await readFile(entry.json_path, "utf8"));
    writesInsideCallback += 1;
    await sequelize.query(
      "UPDATE `agent_transcript_rounds` SET record_json = :recordJson WHERE dedup_key = :dedupKey",
      { replacements: { recordJson: "{}", dedupKey: "req_1:engine:round:0:seed" } },
    );
  });

  assert.equal(writesInsideCallback, 1, "写回调只应被调用一次");
  assert.ok(run.backup, "runWithPreWriteBackup 必须返回备份清单");
  assert.equal(run.skipped, false, "真写不得被当成 dry-run 跳过");

  // 顺序判据：第一条写 SQL 的下标 > 最后一个备份读取的下标
  const firstWriteIndex = sequelize.calls.findIndex((call) => call.kind === "write");
  const lastBackupReadIndex = sequelize.calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.kind === "read")
    .map(({ index }) => index)
    .filter((index) => index < firstWriteIndex)
    .pop();
  assert.ok(firstWriteIndex > 0, "必须真的发过写 SQL（否则这条用例是空跑）");
  assert.equal(
    sequelize.calls.slice(0, firstWriteIndex).filter((call) => call.kind === "write").length,
    0,
    "第一条写 SQL 之前不允许出现任何写 SQL",
  );
  assert.ok(
    sequelize.calls.slice(0, firstWriteIndex).filter((call) => call.kind === "read").length >= 4,
    `备份读取（information_schema + SELECT * + COUNT(*) + 复核 COUNT(*)）必须全部在写之前，实际 ${lastBackupReadIndex}`,
  );
  assert.equal(
    sqlSeenInsideCallback.split("\n")[0],
    ROLLBACK_SQL_FIRST_LINE,
    "回调里读到的回滚 SQL 首行必须已经是 SET NAMES utf8mb4;",
  );
  assert.equal(jsonSeenInsideCallback.row_count, rows.length, "回调里读到的 JSON 必须是整表行数");
});

test("备份失败 ⇒ 零写 + 退出码非零：目录不可写时写回调一次都不调用", async () => {
  const parent = await makeRoot("backup-gate-readonly-");
  chmodSync(parent, 0o500); // 只读目录 ⇒ mkdir 子目录 EACCES
  const sequelize = createFakeSequelize({
    tables: { agent_transcript_rounds: { schema: CANONICAL_SCHEMA, rows: canonicalRowsFixture() } },
  });
  let writeCallbackCalls = 0;
  let caught = null;
  try {
    await runWithPreWriteBackup({
      sequelize,
      database: "llm_kit_test",
      tables: [{ table: "agent_transcript_rounds", reasons: ["canonicalCleanup"] }],
      scriptName: "verify-transcript-projection",
      planRowsByTable: { agent_transcript_rounds: 2 },
      root: join(parent, "nested"),
      now: NOW,
    }, async () => {
      writeCallbackCalls += 1;
    });
  } catch (error) {
    caught = error;
  } finally {
    chmodSync(parent, 0o700);
  }

  assert.ok(caught, "备份目录不可写必须抛错（不许静默继续写）");
  assert.equal(caught.code, BACKUP_ERROR_CODES.DIR_UNWRITABLE, `错误码必须是目录不可写，实际 ${caught.code}`);
  assert.match(caught.message, /处置：/, "错误文案必须给出可操作处置（不是只说 failed）");
  assert.match(caught.message, /零写入/, "错误文案必须写明本次零写入");
  assert.equal(writeCallbackCalls, 0, "备份失败时写回调一次都不许调用（零写）");
  assert.deepEqual(writeCallsOf(sequelize).map((call) => call.sql), [], "备份失败时不许发出任何写 SQL");

  const failure = describeFailure(caught);
  assert.equal(failure.exitCode, 1, "备份失败必须映射成非零退出码");
  assert.equal(failure.code, BACKUP_ERROR_CODES.DIR_UNWRITABLE, "stderr 里必须打出错误码");
  assert.match(failure.message, /ERR_BACKUP_DIR_UNWRITABLE/);
});

test("备份失败 ⇒ 零写 + 退出码非零：回读行数不符（dump 期间并发写）时中止", async () => {
  const root = await makeRoot();
  const rows = canonicalRowsFixture();
  // 第 0 次 COUNT（dump 时）= 5；第 1 次 COUNT（回读校验时）= 6 ⇒ 备份不可信
  const sequelize = createFakeSequelize({
    tables: { agent_transcript_rounds: { schema: CANONICAL_SCHEMA, rows } },
    countOverrides: [rows.length, rows.length + 1],
  });
  let writeCallbackCalls = 0;
  let caught = null;
  try {
    await runWithPreWriteBackup({
      sequelize,
      database: "llm_kit_test",
      tables: [{ table: "agent_transcript_rounds", reasons: ["canonicalCleanup"] }],
      scriptName: "verify-transcript-projection",
      planRowsByTable: { agent_transcript_rounds: 2 },
      root,
      now: NOW,
    }, async () => {
      writeCallbackCalls += 1;
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "行数不符必须抛错");
  assert.equal(caught.code, BACKUP_ERROR_CODES.VERIFY_FAILED, `错误码必须是回读校验失败，实际 ${caught.code}`);
  assert.ok(
    caught.problems.some((problem) => problem.startsWith("row_count_vs_table:")),
    `问题清单必须点名行数不符，实际：${JSON.stringify(caught.problems)}`,
  );
  assert.equal(writeCallbackCalls, 0, "校验不过时写回调一次都不许调用（零写）");
  assert.deepEqual(writeCallsOf(sequelize).map((call) => call.sql), []);
  assert.equal(describeFailure(caught).exitCode, 1);
});

test("回滚 SQL 首行是 SET NAMES utf8mb4; 且 UPDATE 条数 == 备份行数", async () => {
  const root = await makeRoot();
  const rows = canonicalRowsFixture();
  const sequelize = createFakeSequelize({
    tables: { agent_transcript_rounds: { schema: CANONICAL_SCHEMA, rows } },
  });
  const run = await runWithPreWriteBackup({
    sequelize,
    database: "llm_kit_test",
    tables: [{ table: "agent_transcript_rounds", reasons: ["canonicalCleanup"] }],
    scriptName: "verify-transcript-projection",
    planRowsByTable: { agent_transcript_rounds: 2 },
    root,
    now: NOW,
  }, async () => {});

  const entry = run.backup.tables[0];
  const sqlText = await readFile(entry.sql_path, "utf8");
  const sqlLines = sqlText.split("\n");
  assert.equal(sqlLines[0], "SET NAMES utf8mb4;", "回滚 SQL 的**首行**必须是 SET NAMES utf8mb4;");
  const updates = sqlLines.filter((line) => line.startsWith("UPDATE "));
  assert.equal(updates.length, rows.length, `UPDATE 条数必须 == 备份行数（${rows.length}）`);
  assert.equal(entry.update_count, rows.length, "清单里的 update_count 必须 == 行数");
  // 每条 UPDATE 必须带主键定位（不是全表覆盖）
  for (const statement of updates) {
    assert.match(statement, /WHERE `id` = '/, `每条回滚语句必须按主键定位：${statement.slice(0, 80)}`);
  }
  // 4 字节字符 / 引号 / 反斜杠 / 换行都要被安全转义：整条语句必须留在**一行**里
  const nastyLine = updates.find((line) => line.includes("atr_2"));
  assert.ok(nastyLine, "必须找到含 4 字节字符的那一行");
  assert.ok(nastyLine.includes("🎯"), "4 字节字符必须原样保留（不是替换成 ?）");
  assert.ok(nastyLine.includes("it\\'s"), "单引号必须转义成 \\'");
  assert.ok(nastyLine.includes("a\\\\b"), "反斜杠必须转义成 \\\\");
  assert.ok(!nastyLine.includes("\n"), "转义后不许有真换行（否则一条语句会被拆成多行）");

  // 校验器自己也得认这条首行判据（缺首行 ⇒ VERIFY_FAILED）
  const oneRow = [{ id: "atr_1" }];
  assert.throws(
    () => verifyBackupArtifacts({
      table: "agent_transcript_rounds",
      spec: BACKUP_TABLE_SPECS.agent_transcript_rounds,
      jsonText: JSON.stringify({
        table: "agent_transcript_rounds",
        row_count: 1,
        sha256_of_rows_json: hashRows(oneRow),
        rows: oneRow,
        columns: ["id"],
      }),
      sqlText: "UPDATE `agent_transcript_rounds` SET `id` = 'atr_1' WHERE `id` = 'atr_1';\n",
      actualRowCount: 1,
    }),
    (error) => error.code === BACKUP_ERROR_CODES.VERIFY_FAILED
      && error.problems.some((problem) => problem.startsWith("sql_first_line:")),
    "缺 SET NAMES 首行的 SQL 必须被校验器判死",
  );
});

test("备份覆盖整表：dump 行数 == 假表总行数，且多于计划写入行数", async () => {
  const root = await makeRoot();
  const rows = canonicalRowsFixture();
  const sequelize = createFakeSequelize({
    tables: { agent_transcript_rounds: { schema: CANONICAL_SCHEMA, rows } },
  });
  const plannedRows = 2;
  const run = await runWithPreWriteBackup({
    sequelize,
    database: "llm_kit_test",
    tables: [{ table: "agent_transcript_rounds", reasons: ["canonicalCleanup"] }],
    scriptName: "verify-transcript-projection",
    planRowsByTable: { agent_transcript_rounds: plannedRows },
    root,
    now: NOW,
  }, async () => {});

  const entry = run.backup.tables[0];
  const payload = JSON.parse(await readFile(entry.json_path, "utf8"));
  assert.equal(payload.scope, "whole-table", "备份口径必须显式标成整表");
  assert.equal(payload.rows.length, rows.length, "JSON 里的行数必须 == 假表总行数");
  assert.equal(payload.table_total_rows, rows.length, "table_total_rows 必须 == 假表总行数");
  assert.equal(entry.row_count, rows.length);
  assert.ok(
    payload.rows.length > plannedRows,
    `整表备份必须多于计划行（否则"只备份计划行"的实现会混过）：${payload.rows.length} vs plan ${plannedRows}`,
  );
  assert.equal(payload.plan_rows, plannedRows, "plan_rows 只作为信息记录，不参与裁剪");
  // 计划外的行也必须在备份里（req_2 / req_3 这两条本来不在计划里）
  const ids = payload.rows.map((row) => row.id);
  assert.deepEqual(ids, ["atr_1", "atr_2", "atr_3", "atr_4", "atr_5"], "计划外的行一行都不能少");
  // 备份文件里不许出现密钥类字段（本清单的四张表没有 api_key 列）
  const jsonText = await readFile(entry.json_path, "utf8");
  for (const needle of ["api_key", "apiKey", "secret", "password"]) {
    assert.ok(!jsonText.includes(needle), `备份里不许出现密钥字段：${needle}`);
  }
});

test("--dry-run 不写备份、零写调用（不建目录、不产生文件）", async () => {
  const root = await makeRoot();
  const sequelize = createFakeSequelize({
    tables: { agent_transcript_rounds: { schema: CANONICAL_SCHEMA, rows: canonicalRowsFixture() } },
  });
  let writeCallbackCalls = 0;
  const run = await runWithPreWriteBackup({
    sequelize,
    database: "llm_kit_test",
    tables: [{ table: "agent_transcript_rounds", reasons: ["canonicalCleanup"] }],
    scriptName: "verify-transcript-projection",
    planRowsByTable: { agent_transcript_rounds: 2 },
    root,
    now: NOW,
    dryRun: true,
  }, async () => {
    writeCallbackCalls += 1;
  });

  assert.equal(run.skipped, true, "dry-run 必须被显式标成跳过");
  assert.equal(run.reason, "dry-run");
  assert.equal(run.backup, null, "dry-run 不产生备份清单");
  assert.equal(writeCallbackCalls, 1, "dry-run 的写分支（空实现）照旧被调用一次，保持代码路径单一");
  assert.deepEqual(sequelize.calls, [], "dry-run 连备份读取都不该发（更不该发写 SQL）");
  assert.deepEqual(await readdir(root), [], "dry-run 不许在备份根下产生任何文件或目录");
});

test("备份目录名固定为 <脚本名>-<YYMMDD>，且同名旧产物被归档而不是覆盖", async () => {
  const root = await makeRoot();
  const rows = canonicalRowsFixture();
  const sequelize = createFakeSequelize({
    tables: { agent_transcript_rounds: { schema: CANONICAL_SCHEMA, rows } },
  });
  assert.equal(
    backupDirectoryName({ scriptName: "verify-transcript-projection", now: NOW }),
    "verify-transcript-projection-261102",
  );
  const params = {
    sequelize,
    database: "llm_kit_test",
    tables: [{ table: "agent_transcript_rounds", reasons: ["canonicalCleanup"] }],
    scriptName: "verify-transcript-projection",
    planRowsByTable: { agent_transcript_rounds: 2 },
    root,
    now: NOW,
  };
  const first = await runWithPreWriteBackup(params, async () => {});
  const second = await runWithPreWriteBackup(params, async () => {});
  assert.equal(first.backup.directory, second.backup.directory, "同一天同一脚本必须落同一个固定目录");
  assert.equal(
    first.backup.directory,
    join(root, "verify-transcript-projection-261102"),
    "目录形态必须可预测（操作者不用猜）",
  );
  const files = (await readdir(first.backup.directory)).sort();
  const archived = files.filter((name) => /^agent_transcript_rounds\.\d{8}T\d{6}\.json$/.test(name));
  assert.equal(archived.length, 1, `第二份备份必须把第一份归档而不是覆盖，实际目录：${files.join(",")}`);
  const archivedPath = join(first.backup.directory, archived[0]);
  assert.ok((await stat(archivedPath)).size > 0, "归档文件必须真的还在盘上");
  const current = JSON.parse(await readFile(backupArtifactPaths({
    directory: first.backup.directory, table: "agent_transcript_rounds",
  }).json, "utf8"));
  assert.equal(current.row_count, rows.length, "当前那份仍然必须是整表备份");
});

test("退出码非零在**子进程**里成立：备份失败 ⇒ exit 1（真进程退出码，不是断言出来的）", async () => {
  const root = await makeRoot("backup-gate-cli-");
  const readonlyParent = join(root, "ro");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(readonlyParent, { recursive: true });
  chmodSync(readonlyParent, 0o500);
  const fixturePath = join(root, "backup-fail-cli.mjs");
  const fixture = `
import { runWithPreWriteBackup } from ${JSON.stringify(join(REPO_ROOT, "lib/llm-kit-adapters/transcript-backup.js"))};
import { describeFailure } from ${JSON.stringify(join(REPO_ROOT, "scripts/verify-transcript-projection.mjs"))};

const sequelize = {
  calls: [],
  query: async (sql) => {
    const flat = String(sql).replace(/\\s+/g, " ").trim();
    if (/^\\s*(INSERT|UPDATE|DELETE|REPLACE)\\b/i.test(flat)) {
      sequelize.calls.push(flat);
      return [{ affectedRows: 1 }, 1];
    }
    if (flat.includes("information_schema.COLUMNS")) {
      return [[{ name: "id", data_type: "varchar", extra: "" }, { name: "record_json", data_type: "longtext", extra: "" }], []];
    }
    if (flat.startsWith("SELECT COUNT(*)")) return [[{ total: 1 }], []];
    if (flat.startsWith("SELECT ") && flat.includes(" FROM ")) return [[{ id: "atr_1", record_json: "{}" }], []];
    throw new Error("unexpected: " + flat);
  },
};

let writes = 0;
try {
  await runWithPreWriteBackup({
    sequelize,
    database: "llm_kit_test",
    tables: [{ table: "agent_transcript_rounds", reasons: ["canonicalCleanup"] }],
    scriptName: "verify-transcript-projection",
    planRowsByTable: { agent_transcript_rounds: 1 },
    root: ${JSON.stringify(join(readonlyParent, "nested"))},
    now: new Date(2026, 10, 2),
  }, async () => {
    writes += 1;
    await sequelize.query("UPDATE \`agent_transcript_rounds\` SET record_json = '{}' WHERE id = 'atr_1'");
  });
  console.log("UNEXPECTED_OK");
} catch (error) {
  const failure = describeFailure(error);
  console.error(failure.message);
  console.log(JSON.stringify({ writes, code: failure.code, exitCode: failure.exitCode }));
  process.exitCode = failure.exitCode;
}
`;
  await writeFile(fixturePath, fixture, "utf8");
  const child = spawn(process.execPath, [fixturePath], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  const errChunks = [];
  child.stderr.on("data", (chunk) => errChunks.push(chunk));
  const status = await new Promise((resolve) => child.on("close", resolve));
  chmodSync(readonlyParent, 0o700);

  const stdout = Buffer.concat(chunks).toString("utf8");
  const stderr = Buffer.concat(errChunks).toString("utf8");
  assert.equal(status, 1, `备份失败的进程退出码必须是 1，实际 ${status}；stdout=${stdout} stderr=${stderr}`);
  const parsed = JSON.parse(stdout.trim().split("\n").pop());
  assert.equal(parsed.writes, 0, "子进程里写回调一次都不许调用（零写）");
  assert.equal(parsed.code, BACKUP_ERROR_CODES.DIR_UNWRITABLE);
  assert.match(stderr, /code=ERR_BACKUP_DIR_UNWRITABLE/, "stderr 必须打出错误码");
});

test("时间列按服务端墙钟原样备份：DATE_FORMAT 投影，回滚字面量不做任何时区偏移（Date 值 fail-closed）", async () => {
  // 缺陷形态（本单演练实证）：Sequelize 的 MySQL 方言默认 timezone="+00:00"，mysql2 把 DATETIME
  // 墙钟当 UTC 解析成 Date，再用本地 getter 格式化 ⇒ 回滚字面量偏移 +8h（CST），
  // 回滚后 `messages.created_at` 的最大值比克隆时点晚了 8 小时——"回滚看起来跑完了"。
  assert.equal(
    sqlColumnProjection("created_at", "datetime"),
    "DATE_FORMAT(`created_at`, '%Y-%m-%d %H:%i:%s.%f') AS `created_at`",
    "datetime 列必须交给服务端 DATE_FORMAT 渲染墙钟（不经驱动时区）",
  );
  assert.equal(sqlColumnProjection("name", "varchar"), "`name`", "非时间列原样投影");
  assert.equal(
    normalizeCellValue("2026-11-01 18:00:00.000000", "datetime"),
    "2026-11-01 18:00:00.000000",
    "墙钟字符串必须原样保留（不做任何加减）",
  );
  assert.throws(
    () => normalizeCellValue(new Date("2026-11-01T10:00:00.000Z"), "datetime"),
    (error) => error.code === BACKUP_ERROR_CODES.UNSUPPORTED_VALUE && /偏移 8 小时/.test(error.message),
    "驱动若返回 Date（说明 DATE_FORMAT 投影没生效）必须 fail-closed，不许按 Date 猜时区",
  );

  const root = await makeRoot();
  const rows = canonicalRowsFixture();
  const sequelize = createFakeSequelize({
    tables: { agent_transcript_rounds: { schema: CANONICAL_SCHEMA, rows } },
  });
  const run = await runWithPreWriteBackup({
    sequelize,
    database: "llm_kit_test",
    tables: [{ table: "agent_transcript_rounds", reasons: ["canonicalCleanup"] }],
    scriptName: "verify-transcript-projection",
    planRowsByTable: { agent_transcript_rounds: 2 },
    root,
    now: NOW,
  }, async () => {});
  const sqlText = await readFile(run.backup.tables[0].sql_path, "utf8");
  const first = sqlText.split("\n").find((line) => line.startsWith("UPDATE ") && line.includes("atr_1'"));
  assert.ok(first, "必须找到 atr_1 的回滚语句");
  assert.ok(
    first.includes("'2026-11-01 18:00:00.000000'"),
    `created_at 必须按服务端墙钟原样写回（不许偏移）：${first.slice(-160)}`,
  );
  // 备份 SELECT 里必须带 DATE_FORMAT（假 sequelize 自己也断言了一遍）
  const dumpCall = sequelize.calls.find((call) => call.kind === "read" && call.sql.includes(" FROM `agent_transcript_rounds`"));
  assert.ok(dumpCall.sql.includes("DATE_FORMAT(`created_at`"), `备份 SELECT 必须用 DATE_FORMAT 投影：${dumpCall.sql}`);
  assert.ok(dumpCall.sql.endsWith("ORDER BY `id`"), "整表 dump 必须按主键排序（两次备份同一份文件）");
});

test("备份不可用必须在**有限步**内退出：fs 挂死不返回 ⇒ 有限步退出 + 零写 + 非零退出码", {
  // 这一格的 timeout 是**判据的一部分**：实现若丢掉 deadline（变异④），这里会在 5s 后变红，
  // 而不是把整个 `npm run test:llm-kit` 拖成"永远跑不完"。
  timeout: 5000,
}, async () => {
  // 演练实证的形态：`fs.promises.mkdir(dir, { recursive: true })` 在 /proc 上**一直转**
  // （进程 114% CPU、socket 0、4 分钟不返回、没有退出码）。这里用"永远不返回的 mkdir"
  // 复刻同一个故障面：备份不可用 ⇒ 必须有限步退出，不许把进程拖成没有退出码。
  const root = await makeRoot();
  const sequelize = createFakeSequelize({
    tables: { agent_transcript_rounds: { schema: CANONICAL_SCHEMA, rows: canonicalRowsFixture() } },
  });
  const fsOps = {
    ...defaultFsOps,
    mkdir: () => new Promise(() => {}), // 永不 settle
  };
  let writeCallbackCalls = 0;
  const startedAt = Date.now();
  let caught = null;
  try {
    await runWithPreWriteBackup({
      sequelize,
      database: "llm_kit_test",
      tables: [{ table: "agent_transcript_rounds", reasons: ["canonicalCleanup"] }],
      scriptName: "verify-transcript-projection",
      planRowsByTable: { agent_transcript_rounds: 2 },
      root: join(root, "uncreatable"),
      now: NOW,
      fsOps,
      fsTimeoutMs: 50,
    }, async () => {
      writeCallbackCalls += 1;
    });
  } catch (error) {
    caught = error;
  }
  const elapsed = Date.now() - startedAt;
  assert.ok(caught, "目录创建挂死必须在有限步内变成异常（不是挂住进程）");
  assert.equal(caught.code, BACKUP_ERROR_CODES.DIR_UNWRITABLE, `错误码必须是目录不可写，实际 ${caught.code}`);
  assert.match(caught.message, /没有返回/, "错误文案必须点明「超时没返回」这个真实原因");
  assert.ok(elapsed < 3000, `必须在有限步内退出（实测 ${elapsed}ms）`);
  assert.equal(writeCallbackCalls, 0, "零次写调用");
  assert.deepEqual(writeCallsOf(sequelize).map((call) => call.sql), [], "零条写 SQL（execute 调用数 == 0）");
  assert.equal(describeFailure(caught).exitCode, 1, "退出码必须非零");
});

test("备份不可用必须在**有限步**内退出：真实 /proc 路径（回归 `mkdir recursive` 空转）", {
  timeout: 30000,
}, async () => {
  // 这一格钉的是**真实**故障面：`mkdir({recursive:true})` 在 /proc 上无限空转。
  // 用子进程跑，父进程用 spawn 的 timeout 兜底——即使子进程把事件循环转死也能被杀掉。
  const root = await makeRoot("backup-gate-proc-");
  const fixturePath = join(root, "proc-root.mjs");
  const fixture = `
import { runWithPreWriteBackup } from ${JSON.stringify(join(REPO_ROOT, "lib/llm-kit-adapters/transcript-backup.js"))};
const sequelize = {
  calls: [],
  query: async (sql) => {
    const flat = String(sql).replace(/\\s+/g, " ").trim();
    if (/^\\s*(INSERT|UPDATE|DELETE|REPLACE)\\b/i.test(flat)) { sequelize.calls.push(flat); return [{ affectedRows: 1 }, 1]; }
    if (flat.includes("information_schema.COLUMNS")) return [[{ name: "id", data_type: "varchar", extra: "" }], []];
    if (flat.startsWith("SELECT COUNT(*)")) return [[{ total: 1 }], []];
    if (flat.startsWith("SELECT ") && flat.includes(" FROM ")) return [[{ id: "atr_1" }], []];
    throw new Error("unexpected: " + flat);
  },
};
let writes = 0;
try {
  await runWithPreWriteBackup({
    sequelize,
    database: "llm_kit_test",
    tables: [{ table: "agent_transcript_rounds", reasons: ["canonicalCleanup"] }],
    scriptName: "verify-transcript-projection",
    planRowsByTable: { agent_transcript_rounds: 1 },
    root: "/proc/nonexistent-backup-root",
    now: new Date(2026, 10, 2),
  }, async () => { writes += 1; });
  console.log(JSON.stringify({ writes, code: null }));
} catch (error) {
  console.log(JSON.stringify({ writes, code: error.code ?? null }));
  process.exitCode = 1;
}
`;
  await writeFile(fixturePath, fixture, "utf8");
  const child = spawn(process.execPath, [fixturePath], {
    cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], timeout: 20000,
  });
  const out = [];
  child.stdout.on("data", (chunk) => out.push(chunk));
  const status = await new Promise((resolve) => child.on("close", resolve));
  const stdout = Buffer.concat(out).toString("utf8").trim();
  assert.equal(
    status,
    1,
    `真实 /proc 路径上必须有限步退出（exit 1）。实际 status=${status}（null=被 spawn timeout 杀掉 ⇒ 空转回归）stdout=${stdout}`,
  );
  const parsed = JSON.parse(stdout.split("\n").pop());
  assert.equal(parsed.writes, 0, "零次写调用");
  assert.equal(parsed.code, BACKUP_ERROR_CODES.DIR_UNWRITABLE, `错误码必须是目录不可写，实际 ${parsed.code}`);
});

test("备份清单只覆盖实际会写的表：canonical 清洗 / reasoning / record_json / --apply 各按写面取", () => {
  assert.deepEqual(
    planBackupTables({ fixIsError: true }).map((entry) => entry.table),
    ["agent_transcript_rounds"],
    "canonical 清洗（--fix-is-error）只写 agent_transcript_rounds",
  );
  assert.deepEqual(
    planBackupTables({ fixFolded: true }).map((entry) => entry.table),
    ["agent_transcript_rounds"],
    "--fix-folded 同写一张表",
  );
  assert.deepEqual(
    planBackupTables({ fixReasoning: true }).map((entry) => entry.table),
    ["messages"],
    "--fix-reasoning 只写 messages",
  );
  assert.deepEqual(
    planBackupTables({ rewriteRecordJson: true }).map((entry) => entry.table),
    ["agent_rounds"],
    "--rewrite-record-json 只写 agent_rounds",
  );
  assert.deepEqual(
    planBackupTables({ apply: true }).map((entry) => entry.table),
    ["agent_rounds", "messages", "chat_tool_calls"],
    "--apply 写三张表（agent_rounds / messages / chat_tool_calls）",
  );
  assert.deepEqual(
    planBackupTables({ fixIsError: true, fixFolded: true, fixReasoning: true }).map((entry) => entry.table),
    ["agent_transcript_rounds", "messages"],
    "多开关合并去重，顺序固定（不随参数书写顺序漂移）",
  );
  assert.deepEqual(planBackupTables({}).map((entry) => entry.table), [], "无写开关 ⇒ 不需要备份");
  // 含 provider key 的表永不进清单
  const all = planBackupTables({ apply: true, fixIsError: true, fixReasoning: true, rewriteRecordJson: true })
    .map((entry) => entry.table);
  assert.ok(!all.includes("ai_model"), "ai_model 这类含 provider key 的表永不进备份清单");
  assert.equal(BACKUP_ROOT, "/docker/touwaka-backups", "默认备份根固定");
  assert.equal(quoteSqlString("a'b"), "'a\\'b'", "单引号转义");
});

/* ------------------------------------------------------------------------------------------
 * issue #1246 剩余项：**生成列**（`agent_rounds.kind / seq / part_of`）
 *
 * 缺口实证（本单开工前做的变异）：把 `transcript-backup.js` 里那行
 *   `if (extra.includes("GENERATED")) { generated.push(name); continue; }`
 * 改成 `if (false && extra.includes("GENERATED"))`，本文件原有 12 格**全绿**——
 * 因为上面所有夹具（`CANONICAL_SCHEMA`）都**没有生成列**，`generated` 永远是空数组，
 * 这条排除分支一次都没被走到。拦它的只有运行时错误（真库上
 * `UPDATE agent_rounds SET kind = ...` 直接 ER_...），测试拦不住。
 *
 * 下面两格把这件事变成可判定的：
 *   A. 端到端（`runWithPreWriteBackup`）：生成列**不进**回滚 SQL 的 `UPDATE ... SET`，
 *      而普通列**逐列都在**（逐列点名，不是只数个数）。
 *   B. 单元（`loadTableSchema`）：`information_schema.COLUMNS.EXTRA` 含 `GENERATED`
 *      （VIRTUAL / STORED 两种、大小写不敏感）的列进 `generated`，不进 `columns`/`columnTypes`。
 *
 * 为什么 JSON 快照也排除生成列（本格同时钉住，避免下一个人把它当"漏了"顺手补回来）：
 * `kind / seq / part_of` 是 `GENERATED ALWAYS AS (JSON_EXTRACT(record_json, ...)) VIRTUAL`
 * （见 `scripts/init-database.js:629-631`），值完全由 `record_json` 推导，备份它们**没有独立
 * 信息量**；而 dump 的列清单与回滚 SQL 的列清单是**同一份**（`dumpTableRows` 的
 * `schema.columns`），要"只在 SQL 里排除、只在 JSON 里保留"就得维护第二份清单——那正是
 * 本模块刻意避免的 DDL 漂移源。所以这是**取舍**（JSON 少三列冗余，换一份清单），不是遗漏：
 * 回滚时 `record_json` 写回去，生成列由服务端重新算出来。
 * ---------------------------------------------------------------------------------------- */

/** `agent_rounds` 的真实形状（`models/agent_round.js`）：12 个可还原列 + 3 个 VIRTUAL 生成列。 */
const AGENT_ROUNDS_SCHEMA = [
  { name: "id", data_type: "varchar", extra: "" },
  { name: "request_id", data_type: "varchar", extra: "" },
  { name: "round_no", data_type: "int", extra: "" },
  { name: "dedup_key", data_type: "varchar", extra: "" },
  { name: "stop_reason", data_type: "varchar", extra: "" },
  { name: "usage", data_type: "text", extra: "" },
  { name: "latency_ms", data_type: "int", extra: "" },
  { name: "folded", data_type: "bit", extra: "" },
  { name: "folded_range", data_type: "text", extra: "" },
  { name: "record_json", data_type: "longtext", extra: "" },
  // ↓ 生成列：`GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.kind'))) VIRTUAL`
  { name: "kind", data_type: "varchar", extra: "VIRTUAL GENERATED" },
  { name: "seq", data_type: "int", extra: "VIRTUAL GENERATED" },
  { name: "part_of", data_type: "varchar", extra: "VIRTUAL GENERATED" },
  { name: "ts", data_type: "varchar", extra: "" },
  { name: "created_at", data_type: "datetime", extra: "" },
];

const AGENT_ROUNDS_GENERATED_COLUMNS = ["kind", "seq", "part_of"];

/** 可还原列 = information_schema 顺序去掉生成列；回滚 SQL 的 SET 子句必须**恰好**是它（减主键）。 */
const AGENT_ROUNDS_NORMAL_COLUMNS = AGENT_ROUNDS_SCHEMA
  .filter((column) => !column.extra.toUpperCase().includes("GENERATED"))
  .map((column) => column.name);

/**
 * 两行假 `agent_rounds`。**行里刻意带着生成列的键**（`kind`/`seq`/`part_of`）：
 * 真驱动只要 SELECT 到它们就会回传，所以"实现有没有把它们放进投影"这件事，
 * 在行数据上必须能看出来——实现排除正确时它们会被 `normalizeCellValue` 的列循环丢掉。
 *
 * 值里刻意不含 `", "`（逗号+空格）：这样 `SET` 子句可以按 `", "` 无歧义地切成逐列赋值，
 * 断言才能做到"逐列点名 + 顺序一致"，而不是只数个数。
 */
function agentRoundsRowsFixture() {
  return [
    {
      id: "ar_1",
      request_id: "req_1",
      round_no: 0,
      dedup_key: "req_1:engine:round:0:seed",
      stop_reason: null,
      usage: "{\"input\":10,\"output\":5}",
      latency_ms: 120,
      folded: 0,
      folded_range: null,
      record_json: "{\"kind\":\"message\",\"seq\":0,\"partOf\":\"req_1:engine:round:0:seed\"}",
      // ↓ 生成列（VIRTUAL）：SELECT 到就会回传，但**不许**进备份列清单
      kind: "message",
      seq: 0,
      part_of: "req_1:engine:round:0:seed",
      ts: "2026-11-02T01:30:00.000Z",
      created_at: "2026-11-02 01:30:00.000000",
    },
    {
      id: "ar_2",
      request_id: "req_1",
      round_no: 1,
      dedup_key: "req_1:engine:round:1:seed",
      stop_reason: "end_turn",
      usage: "{\"input\":20,\"output\":8}",
      latency_ms: 240,
      folded: 1,
      folded_range: "0-0",
      record_json: "{\"kind\":null,\"seq\":null,\"partOf\":null}",
      kind: null,
      seq: null,
      part_of: null,
      ts: "2026-11-02T01:30:05.000Z",
      created_at: "2026-11-02 01:30:05.000000",
    },
  ];
}

/**
 * 假 sequelize（生成列两格专用）：按表回 `information_schema` 行与整表行。
 *
 * 刻意**不复用**上面的 `createFakeSequelize`：那个夹具把"时间列必须 DATE_FORMAT 投影"的断言
 * 绑进了 dump 路径，做"只留主键"反向变异时它会先炸，掩盖本格真正要钉的列清单判据。
 */
function createSchemaEchoSequelize({ tables }) {
  const calls = [];
  const sequelize = {
    calls,
    query: async (sql, options = {}) => {
      const text = typeof sql === "string" ? sql : String(sql?.query ?? "");
      const flat = text.replace(/\s+/g, " ").trim();
      if (WRITE_SQL_PATTERN.test(flat)) {
        calls.push({ kind: "write", sql: flat });
        return [{ affectedRows: 1 }, 1];
      }
      calls.push({ kind: "read", sql: flat });
      if (flat.includes("information_schema.COLUMNS")) {
        const table = options.replacements?.table;
        return [(tables[table]?.schema ?? []).map((column) => ({ ...column })), []];
      }
      const countMatch = /^SELECT COUNT\(\*\) AS total FROM `([^`]+)`$/.exec(flat);
      if (countMatch) {
        return [[{ total: (tables[countMatch[1]]?.rows ?? []).length }], []];
      }
      const selectAll = /^SELECT .+ FROM `([^`]+)` ORDER BY `[^`]+`$/.exec(flat);
      if (selectAll) {
        return [(tables[selectAll[1]]?.rows ?? []).map((row) => ({ ...row })), []];
      }
      throw new Error(`假 sequelize 不认识的 SQL：${flat}`);
    },
  };
  return sequelize;
}

test("生成列不进回滚 SQL 的 UPDATE ... SET，且普通列逐列都在（agent_rounds 形状的假表）", async () => {
  const root = await makeRoot("backup-gate-generated-");
  const rows = agentRoundsRowsFixture();
  const sequelize = createSchemaEchoSequelize({
    tables: { agent_rounds: { schema: AGENT_ROUNDS_SCHEMA, rows } },
  });

  const run = await runWithPreWriteBackup({
    sequelize,
    database: "llm_kit_test",
    tables: [{ table: "agent_rounds", reasons: ["recordJsonRewrite"] }],
    scriptName: "verify-transcript-projection",
    planRowsByTable: { agent_rounds: 1 },
    root,
    now: NOW,
  }, async () => {});

  const entry = run.backup.tables[0];
  assert.equal(entry.table, "agent_rounds");

  // ① 清单里的列 == information_schema 顺序去掉生成列（顺序也是判据：`ORDER BY id` 之外的可比性靠它）
  assert.deepEqual(
    entry.columns,
    AGENT_ROUNDS_NORMAL_COLUMNS,
    `备份列清单必须 = 可还原列（生成列被排除），实际：${JSON.stringify(entry.columns)}`,
  );

  // ② dump 的 SELECT 投影里不许出现生成列
  const dumpCall = sequelize.calls.find((call) => call.kind === "read"
    && call.sql.startsWith("SELECT ") && call.sql.includes(" FROM `agent_rounds`")
    && call.sql.includes("ORDER BY `id`"));
  assert.ok(dumpCall, "必须找到整表 dump 的 SELECT");
  for (const column of AGENT_ROUNDS_GENERATED_COLUMNS) {
    assert.ok(
      !dumpCall.sql.includes(`\`${column}\``),
      `生成列 ${column} 不许出现在 dump 的 SELECT 投影里：${dumpCall.sql.slice(0, 200)}`,
    );
  }

  // ③ 回滚 SQL：生成列不进 SET，普通列逐列都在（这一格的两条主判据）
  const sqlText = await readFile(entry.sql_path, "utf8");
  const updates = sqlText.split("\n").filter((line) => line.startsWith("UPDATE "));
  assert.equal(updates.length, rows.length, `UPDATE 条数必须 == 备份行数（${rows.length}）`);

  const expectedAssignments = AGENT_ROUNDS_NORMAL_COLUMNS.filter((column) => column !== "id");
  for (const statement of updates) {
    const setStart = statement.indexOf(" SET ");
    const whereStart = statement.indexOf(" WHERE ");
    assert.ok(setStart > 0 && whereStart > setStart, `回滚语句必须形如 UPDATE <表> SET ... WHERE <主键>：${statement.slice(0, 120)}`);
    const setClause = statement.slice(setStart + " SET ".length, whereStart);
    const assigned = setClause.split(", ").map((part) => {
      const matched = /^`([^`]+)` = /.exec(part);
      return matched ? matched[1] : `<<无法解析的赋值片段：${part.slice(0, 60)}>>`;
    });

    // 主判据 A：生成列一个都不许被赋值（真库上写它会直接报错，回滚会半途而废）
    for (const column of AGENT_ROUNDS_GENERATED_COLUMNS) {
      assert.ok(
        !assigned.includes(column),
        `生成列 ${column} 不许出现在 UPDATE ... SET 子句里（写它会报错）：${setClause.slice(0, 200)}`,
      );
      assert.ok(
        !statement.includes(`\`${column}\` = `),
        `生成列 ${column} 不许以赋值形式出现在回滚语句里：${statement.slice(0, 200)}`,
      );
    }

    // 主判据 B：普通列**逐列点名**都在（防止"干脆把所有列都排除"这种糊弄），且顺序与清单一致
    for (const column of expectedAssignments) {
      assert.ok(
        assigned.includes(column),
        `普通列 ${column} 必须出现在 UPDATE ... SET 子句里（排除生成列不许连带排除普通列）：${setClause.slice(0, 200)}`,
      );
    }
    assert.deepEqual(
      assigned,
      expectedAssignments,
      `SET 子句必须恰好是全部可还原列（按 information_schema 顺序，主键除外）：${setClause.slice(0, 200)}`,
    );
  }

  // ④ JSON 快照同样排除生成列——**取舍不是遗漏**（理由见本节顶部注释：
  //    kind/seq/part_of 由 record_json 推导，备份它们没有独立信息量；列清单只有一份）
  const payload = JSON.parse(await readFile(entry.json_path, "utf8"));
  assert.deepEqual(
    payload.columns,
    AGENT_ROUNDS_NORMAL_COLUMNS,
    "JSON 的列清单同样排除生成列（与回滚 SQL 共用同一份清单，避免 DDL 漂移）",
  );
  for (const row of payload.rows) {
    assert.deepEqual(
      Object.keys(row),
      AGENT_ROUNDS_NORMAL_COLUMNS,
      `JSON 每行的键必须 = 可还原列（生成列可由 record_json 推导，不备份）：${JSON.stringify(Object.keys(row))}`,
    );
    for (const column of AGENT_ROUNDS_GENERATED_COLUMNS) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(row, column),
        `JSON 行里不许有生成列 ${column}（否则就是同一事实存两份，回放时还会与 record_json 打架）`,
      );
    }
  }
  for (const column of AGENT_ROUNDS_GENERATED_COLUMNS) {
    assert.equal(
      payload.column_types[column],
      undefined,
      `生成列 ${column} 不许进 column_types（否则字面量渲染会按它走）`,
    );
  }
  // record_json 仍然是唯一真相：生成列的值可以从它推导出来（这就是排除它们不丢信息的依据）
  assert.equal(payload.rows[0].record_json, rows[0].record_json);
  assert.equal(JSON.parse(payload.rows[0].record_json).kind, rows[0].kind, "kind 必须能从 record_json 推导出来");
  assert.equal(JSON.parse(payload.rows[0].record_json).seq, rows[0].seq, "seq 必须能从 record_json 推导出来");
  assert.equal(JSON.parse(payload.rows[0].record_json).partOf, rows[0].part_of, "part_of 必须能从 record_json 推导出来");
});

test("loadTableSchema 按 information_schema.EXTRA 排除生成列：VIRTUAL / STORED 都排除，普通列顺序不动", async () => {
  // 这一格钉的是"列清单从哪来"这层契约（回滚 SQL 与 JSON 都吃它）：
  // 只认 `EXTRA` 里有没有 `GENERATED`，不认列名、不认位置。
  const { loadTableSchema } = await import("../../lib/llm-kit-adapters/transcript-backup.js");

  const sequelize = createSchemaEchoSequelize({
    tables: { agent_rounds: { schema: AGENT_ROUNDS_SCHEMA, rows: [] } },
  });
  const schema = await loadTableSchema({ sequelize, database: "llm_kit_test", table: "agent_rounds" });

  assert.deepEqual(
    schema.generated,
    AGENT_ROUNDS_GENERATED_COLUMNS,
    `EXTRA 含 GENERATED 的列必须被识别成生成列并单列出来，实际：${JSON.stringify(schema.generated)}`,
  );
  assert.deepEqual(
    schema.columns,
    AGENT_ROUNDS_NORMAL_COLUMNS,
    `可还原列清单 = information_schema 顺序去掉生成列，实际：${JSON.stringify(schema.columns)}`,
  );
  assert.equal(schema.columnTypes.seq, undefined, "生成列不许进 columnTypes（否则回滚 SQL 会按它渲染字面量）");
  assert.equal(schema.columnTypes.kind, undefined, "生成列不许进 columnTypes");
  assert.equal(schema.columnTypes.part_of, undefined, "生成列不许进 columnTypes");
  assert.equal(schema.columnTypes.created_at, "datetime", "普通列的类型必须照旧保留");

  // STORED GENERATED 与 VIRTUAL 一样不许写。真实例子：`mini_app_rows._status`
  // （`scripts/upgrade-database.js:866`，`GENERATED ALWAYS AS (...) STORED`）。
  // 这里 EXTRA 用小写，顺带钉住"大小写不敏感"（MariaDB 版本间 EXTRA 文本大小写不一致）。
  const stored = createSchemaEchoSequelize({
    tables: {
      messages: {
        schema: [
          { name: "id", data_type: "varchar", extra: "" },
          { name: "data", data_type: "longtext", extra: "" },
          { name: "_status", data_type: "varchar", extra: "stored generated" },
        ],
        rows: [],
      },
    },
  });
  const storedSchema = await loadTableSchema({ sequelize: stored, database: "llm_kit_test", table: "messages" });
  assert.deepEqual(storedSchema.columns, ["id", "data"], "STORED 生成列同样不许进可还原列清单");
  assert.deepEqual(storedSchema.generated, ["_status"], "STORED 生成列必须被单独列出来");
});
