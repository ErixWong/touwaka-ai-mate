/**
 * issue #1246 —— **回放回滚备份**（`scripts/replay-transcript-backup.mjs`）的格子
 *
 * 这一组钉住的不是"脚本能跑"，而是"**退出码 0 不等于回滚成功**"这件事被机器判定了：
 *
 *   1. `--expect-database` 与实际库不一致 ⇒ abort、零写、非零退出（防打错库）。
 *   2. 某行主键不存在（`affectedRows = 0`）⇒ **点名主键 + 表名**、失败、非零退出。
 *      这正是"匹配 0 行的 UPDATE 也算成功"的闸门——只靠退出码永远看不见它。
 *   3. 累计受影响行数 != 备份行数 ⇒ 失败（含"一条语句匹配到多行"：主键口径错了）。
 *   4. `--dry-run` ⇒ **零 `UPDATE` 调用**，且报告里有"主键不存在的行数"。
 *   5. `.sql` 与 `.json` 条数不一致 ⇒ abort（产物被人动过 / 生成侧有 bug）。
 *   6. `SET` 里出现的列集合 == `.json` 的 `columns` 去掉主键（脚本不许自己补列/漏列；
 *      生成列写进去在 `sql_mode=''` 下只是 warning、值被静默忽略，所以只能靠结构判据）。
 *   7. **子进程真退出码**（spawn 断 exit 非零，不在断言里模拟）。
 *
 * 全部用假 sequelize（不连库）+ 临时目录里的真产物（用生成侧同一份 `buildBackupJson` /
 * `buildRollbackSql` 造，格式不会自己发明一套）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REPLAY_ERROR_CODES,
  affectedRowsOf,
  buildUpdateStatement,
  describeFailure,
  formatReport,
  loadBackupBundle,
  parseArgs,
  probeExistingPrimaryKeys,
  replayBundle,
  resolveLatestBackupDirectory,
  statementColumns,
} from "../../scripts/replay-transcript-backup.mjs";
import {
  ROLLBACK_SQL_FIRST_LINE,
  buildBackupJson,
  buildRollbackSql,
  hashRows,
} from "../../lib/llm-kit-adapters/transcript-backup.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT_PATH = fileURLToPath(new URL("../../scripts/replay-transcript-backup.mjs", import.meta.url));
const NOW = new Date(Date.UTC(2026, 10, 2, 3, 0, 0));

/** 回放最怕的字节：4 字节 emoji、分号、单引号、反斜杠、换行。 */
const NASTY = "{\"text\":\"🎯 4字节; it's a\\b\",\"nl\":\"l1\\nl2\"}";

const SPEC = { primaryKey: "id", label: "假 canonical 表" };
const COLUMNS = ["id", "request_id", "record_json", "created_at", "updated_at"];
const COLUMN_TYPES = {
  id: "varchar",
  request_id: "varchar",
  record_json: "longtext",
  created_at: "datetime",
  updated_at: "datetime",
};

function rowsFixture() {
  return [
    {
      id: "atr_1", request_id: "req_1", record_json: "{\"kind\":null}",
      created_at: "2026-11-01 18:00:00.000000", updated_at: "2026-11-01 18:00:00.000000",
    },
    {
      id: "atr_2", request_id: "req_1", record_json: NASTY,
      created_at: "2026-11-01 18:00:01.000000", updated_at: null,
    },
    {
      id: "atr_3", request_id: "req_2", record_json: "{\"kind\":\"message\"}",
      created_at: "2026-11-01 18:00:02.000000", updated_at: "2026-11-01 18:00:03.000000",
    },
  ];
}

async function makeTempDirectory() {
  return mkdtemp(join(tmpdir(), "replay-1246-"));
}

/**
 * 造一份**格式真实**的备份目录：`<表>.json` + `<表>.rollback.sql` + `backup-manifest.json`。
 *
 * 用生成侧同一份纯函数（`buildBackupJson` / `buildRollbackSql`）而不是手写 JSON：
 * 手写就等于"我自己发明一种产物格式"，回放脚本的校验也就跟着自说自话。
 */
async function writeBackupFixture({
  database = "touwaka_drill_261102",
  table = "agent_transcript_rounds",
  rows = rowsFixture(),
  columns = COLUMNS,
  columnTypes = COLUMN_TYPES,
  sqlTransform = (text) => text,
  jsonTransform = (payload) => payload,
  manifestTransform = (manifest) => manifest,
  resignHash = false,
} = {}) {
  const directory = await makeTempDirectory();
  const signed = buildBackupJson({
    table,
    spec: SPEC,
    columns,
    columnTypes,
    rows,
    totalRows: rows.length,
    database,
    scriptName: "verify-transcript-projection",
    planRows: rows.length,
    generatedAt: NOW,
  });
  const payload = jsonTransform(signed);
  // ③④⑤ 要隔离出各自的判据（主键缺失/重复、row_count 撒谎），必须让 sha256 重新自洽，
  // 否则会先撞上 ① 的 hash 判据——那格由「故意不重新签名」的用例单独钉。
  if (resignHash) payload.sha256_of_rows_json = hashRows(payload.rows);
  const sqlText = sqlTransform(buildRollbackSql({
    table,
    spec: SPEC,
    columns,
    columnTypes,
    rows,
    database,
    scriptName: "verify-transcript-projection",
    generatedAt: NOW,
  }));
  await writeFile(join(directory, `${table}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(join(directory, `${table}.rollback.sql`), sqlText, "utf8");
  const manifest = manifestTransform({
    issue: "#1246",
    script: "verify-transcript-projection",
    database,
    generated_at: NOW.toISOString(),
    directory,
    scope: "whole-table",
    tables: [{
      table,
      reasons: ["canonicalCleanup"],
      json_path: join(directory, `${table}.json`),
      sql_path: join(directory, `${table}.rollback.sql`),
      row_count: rows.length,
      update_count: rows.length,
      table_total_rows: rows.length,
      plan_rows: rows.length,
      columns,
      primary_key: SPEC.primaryKey,
      sha256: payload.sha256_of_rows_json,
      verified: true,
    }],
  });
  await writeFile(join(directory, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { directory, payload, manifest };
}

/**
 * 假 sequelize：认三种 SQL（`SELECT DATABASE()` / 主键存在性预检 / 参数化 `UPDATE`）。
 *
 * `affectedFor` 让每一格都能精确制造"某一行受影响行数不对"的形态：
 *   - 默认：主键在 `existingKeys` 里 ⇒ 1，否则 0（= 真库上 CLIENT_FOUND_ROWS 的语义）
 *   - 覆盖：返回 2 模拟"一条语句匹配到多行"（主键口径错）
 */
function createFakeSequelize({
  database = "touwaka_drill_261102",
  existingKeys = null,
  affectedFor = null,
  changedRowsFor = null,
  databaseRows = null,
} = {}) {
  const calls = [];
  const keys = existingKeys === null ? rowsFixture().map((row) => String(row.id)) : [...existingKeys];
  const sequelize = {
    calls,
    query: async (sql, options = {}) => {
      const flat = String(sql).replace(/\s+/g, " ").trim();
      if (/^SELECT DATABASE\(\) AS db$/i.test(flat)) {
        calls.push({ kind: "read", sql: flat });
        const actual = databaseRows === null ? database : databaseRows;
        return [[{ db: actual }], []];
      }
      const probe = /^SELECT `([^`]+)` AS pk FROM `([^`]+)` WHERE `[^`]+` IN \((.+)\)$/.exec(flat);
      if (probe) {
        calls.push({ kind: "read", sql: flat, replacements: options.replacements });
        const wanted = new Set((options.replacements ?? []).map((value) => String(value)));
        return [keys.filter((key) => wanted.has(key)).map((key) => ({ pk: key })), []];
      }
      if (/^UPDATE `[^`]+` SET /.test(flat)) {
        calls.push({ kind: "write", sql: flat, replacements: options.replacements });
        const primaryKeyValue = String((options.replacements ?? []).at(-1));
        const exists = keys.includes(primaryKeyValue);
        const affected = affectedFor === null
          ? (exists ? 1 : 0)
          : affectedFor({ key: primaryKeyValue, exists, replacements: options.replacements });
        const changedRows = changedRowsFor === null
          ? affected
          : changedRowsFor({ key: primaryKeyValue, exists, affected, replacements: options.replacements });
        return [{ affectedRows: affected, changedRows }, 1];
      }
      throw new Error(`假 sequelize 不认识的 SQL：${flat}`);
    },
  };
  return sequelize;
}

function writeCalls(sequelize) {
  return sequelize.calls.filter((call) => call.kind === "write");
}

// ==================== 1. 库名闸门 ====================

test("--expect-database 与实际库不一致 ⇒ abort、零写、非零退出", async () => {
  const { directory } = await writeBackupFixture();
  const bundle = await loadBackupBundle({ directory });
  const sequelize = createFakeSequelize({ database: "touwaka_drill_261102" });

  await assert.rejects(
    () => replayBundle({
      sequelize,
      bundle,
      expectDatabase: "touwaka_mate",
      dryRun: false,
    }),
    (error) => {
      assert.equal(error.code, REPLAY_ERROR_CODES.DATABASE_MISMATCH);
      assert.match(error.message, /本次零写/);
      assert.match(error.message, /touwaka_mate/);
      assert.match(error.message, /touwaka_drill_261102/);
      return true;
    },
    "库名不符必须抛 ERR_REPLAY_DATABASE_MISMATCH（不是「警告一下继续写」）",
  );
  assert.equal(writeCalls(sequelize).length, 0, "库名不符时一条 UPDATE 都不许发（零写）");
  // 退出码口径：任何失败都是 1，绝不降级成 0。
  const failure = describeFailure(new Error("x"));
  assert.equal(failure.exitCode, 1);

  // 清单记录的库与实际库不一致也要拦（备份来自别的库 ⇒ 不许回放）。
  const foreign = await writeBackupFixture({ database: "touwaka_mate" });
  const foreignBundle = await loadBackupBundle({ directory: foreign.directory });
  const sequelize2 = createFakeSequelize({ database: "touwaka_drill_261102" });
  await assert.rejects(
    () => replayBundle({ sequelize: sequelize2, bundle: foreignBundle, expectDatabase: "touwaka_drill_261102" }),
    (error) => error.code === REPLAY_ERROR_CODES.MANIFEST_DATABASE_MISMATCH,
  );
  assert.equal(writeCalls(sequelize2).length, 0, "跨库回放必须零写");
});

test("--expect-database 是必填项（没有默认值，默认值会把「打错库」变回沉默事故）", () => {
  assert.throws(
    () => parseArgs(["--backup-dir", "/tmp/x"]),
    (error) => error.code === REPLAY_ERROR_CODES.USAGE && /--expect-database/.test(error.message),
  );
  assert.equal(parseArgs(["--expect-database", "touwaka_drill_261102"]).expectDatabase, "touwaka_drill_261102");
  assert.equal(parseArgs(["--expect-database", "d", "--dry-run"]).dryRun, true);
  assert.equal(parseArgs(["--expect-database", "d"]).dryRun, false, "默认就是真写（--dry-run 才是只读）");
});

// ==================== 2. affectedRows = 0 的点名闸门 ====================

test("某行主键不存在（假 sequelize 回 affectedRows=0）⇒ 点名该主键与表名、失败、非零退出", async () => {
  const { directory } = await writeBackupFixture();
  const bundle = await loadBackupBundle({ directory });
  // atr_2 在"表"里不存在：预检看不到它，UPDATE 也会返回 affectedRows=0。
  const sequelize = createFakeSequelize({ existingKeys: ["atr_1", "atr_3"] });

  await assert.rejects(
    () => replayBundle({ sequelize, bundle, expectDatabase: "touwaka_drill_261102" }),
    (error) => {
      assert.equal(error.code, REPLAY_ERROR_CODES.ROW_NOT_FOUND);
      assert.match(error.message, /atr_2/, "必须**点名**那个主键值");
      assert.match(error.message, /agent_transcript_rounds/, "必须点名表名");
      assert.match(error.message, /本次已写 \d+ 行/, "失败文案必须带「本次已写 N 行」");
      assert.equal(error.writtenRows, 2, "atr_1 / atr_3 已写进去 ⇒ 人要知道写了一半多少行");
      return true;
    },
    "匹配 0 行的 UPDATE 必须判失败（客户端会照样返回成功）",
  );
  assert.equal(writeCalls(sequelize).length, 3, "每一行都发过一次语句（不静默跳过）");
  const failure = describeFailure(new Error("x"));
  assert.equal(failure.exitCode, 1);
});

test("行在、affectedRows 却是 0（CLIENT_FOUND_ROWS 未生效）⇒ 点名并判失败，不冒充成功", async () => {
  const { directory } = await writeBackupFixture();
  const bundle = await loadBackupBundle({ directory });
  // 三行都在表里，但驱动报 affectedRows=0（Sequelize 默认 flags: "-FOUND_ROWS" 的形态：
  // 把一行写成它已有的值就是 0）——此时 affectedRows 无法区分"值没变"与"行不存在"。
  const sequelize = createFakeSequelize({ affectedFor: () => 0 });

  await assert.rejects(
    () => replayBundle({ sequelize, bundle, expectDatabase: "touwaka_drill_261102" }),
    (error) => {
      assert.equal(error.code, REPLAY_ERROR_CODES.ZERO_AFFECTED_ROWS);
      assert.match(error.message, /atr_1/);
      assert.match(error.message, /FOUND_ROWS/);
      return true;
    },
  );
});

// ==================== 3. 累计受影响行数 ====================

test("累计受影响行数 != 备份行数 ⇒ 失败（一条语句匹配到多行 = 主键口径错）", async () => {
  const { directory } = await writeBackupFixture();
  const bundle = await loadBackupBundle({ directory });
  // atr_2 那条语句匹配到 2 行：累计受影响行数 = 4 ≠ 备份 3 行。
  const sequelize = createFakeSequelize({
    affectedFor: ({ key }) => (key === "atr_2" ? 2 : 1),
  });

  await assert.rejects(
    () => replayBundle({ sequelize, bundle, expectDatabase: "touwaka_drill_261102" }),
    (error) => {
      assert.equal(error.code, REPLAY_ERROR_CODES.AFFECTED_ROWS_MISMATCH);
      assert.match(error.message, /匹配到\*\*多行\*\*|匹配到多行/);
      assert.match(error.message, /atr_2/);
      return true;
    },
  );

  // 反向：affectedRows 全对但某行被"少写一次"——用缺一行的假表模拟累计不足。
  const shortBundle = await loadBackupBundle({ directory: (await writeBackupFixture()).directory });
  const underSequenced = createFakeSequelize({ affectedFor: ({ key }) => (key === "atr_3" ? 0 : 1), existingKeys: ["atr_1", "atr_2"] });
  await assert.rejects(
    () => replayBundle({ sequelize: underSequenced, bundle: shortBundle, expectDatabase: "touwaka_drill_261102" }),
    (error) => error.code === REPLAY_ERROR_CODES.ROW_NOT_FOUND,
  );
});

// ==================== 4. dry-run ====================

test("--dry-run ⇒ 零 UPDATE 调用，且报告里有「会被更新的行数 / 主键不存在的行数」", async () => {
  const { directory } = await writeBackupFixture();
  const bundle = await loadBackupBundle({ directory });
  const sequelize = createFakeSequelize({ existingKeys: ["atr_1", "atr_2"] }); // atr_3 不在表里

  const report = await replayBundle({
    sequelize,
    bundle,
    expectDatabase: "touwaka_drill_261102",
    dryRun: true,
  });

  assert.equal(writeCalls(sequelize).length, 0, "--dry-run 必须零写（一条 UPDATE 都不许发）");
  assert.equal(sequelize.calls.filter((call) => /^SELECT DATABASE/.test(call.sql)).length, 1, "库名闸门照旧要跑");
  assert.ok(
    sequelize.calls.some((call) => /^SELECT `id` AS pk FROM/.test(call.sql)),
    "--dry-run 的存在性必须靠一次 SELECT 查出来，不许猜",
  );
  const text = formatReport(report);
  assert.match(text, /主键不存在的行数：1/, "报告必须写出主键不存在的行数");
  assert.match(text, /会被更新的行数：2/, "报告必须写出会被更新的行数");
  assert.equal(report.tables[0].primary_keys_missing_before_write.length, 1);
  assert.equal(report.tables[0].would_update, 2);
  assert.equal(report.ok, false, "预演发现主键缺失 ⇒ 报告 ok=false（真跑会失败）");
  assert.equal(report.written_rows, 0);
});

// ==================== 5. 产物交叉核对 ====================

test(".sql 与 .json 条数不一致 ⇒ abort（产物被人动过 / 生成侧有 bug）", async () => {
  const { directory } = await writeBackupFixture({
    sqlTransform: (text) => text.split("\n").filter((line, index, lines) => (
      line.startsWith("UPDATE ") && lines.slice(0, index).filter((prev) => prev.startsWith("UPDATE ")).length === 1
        ? false // 删掉第二条 UPDATE
        : true
    )).join("\n"),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory }),
    (error) => {
      assert.equal(error.code, REPLAY_ERROR_CODES.ARTIFACT_ROW_COUNT_MISMATCH);
      assert.match(error.message, /UPDATE 2 条 ≠ \.json 的 3 行/);
      return true;
    },
    "条数不一致必须在**连库之前**就 abort",
  );
});

test(".sql 首行不是 SET NAMES utf8mb4; ⇒ abort（缺这行会在 utf8mb3 客户端上静默部分回滚）", async () => {
  const { directory } = await writeBackupFixture({
    sqlTransform: (text) => text.split("\n").filter((line) => line !== ROLLBACK_SQL_FIRST_LINE).join("\n"),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory }),
    (error) => error.code === REPLAY_ERROR_CODES.ARTIFACT_SET_NAMES_MISSING,
  );
});

test("产物缺字段 / sha256 不自洽 / 主键缺失 / 主键重复 ⇒ 各自不同错误码", async () => {
  // ① sha256 与 rows 不自洽（文件被改过）
  const tampered = await writeBackupFixture({
    jsonTransform: (payload) => ({ ...payload, rows: payload.rows.map((row, index) => (index === 0 ? { ...row, record_json: "{\"forged\":true}" } : row)) }),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory: tampered.directory }),
    (error) => error.code === REPLAY_ERROR_CODES.ARTIFACT_HASH_MISMATCH,
  );

  // ② 缺字段（columns 没了）
  const missingField = await writeBackupFixture({
    jsonTransform: (payload) => {
      const clone = { ...payload };
      delete clone.columns;
      return clone;
    },
  });
  await assert.rejects(
    () => loadBackupBundle({ directory: missingField.directory }),
    (error) => error.code === REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
  );

  // ③ 某行缺主键
  const missingKey = await writeBackupFixture({
    resignHash: true,
    jsonTransform: (payload) => ({ ...payload, rows: payload.rows.map((row, index) => (index === 1 ? { ...row, id: null } : row)) }),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory: missingKey.directory }),
    (error) => error.code === REPLAY_ERROR_CODES.ARTIFACT_PRIMARY_KEY_MISSING,
  );

  // ④ 主键重复（按主键回放会有一条覆盖另一条，行数核对随之失去意义）
  const duplicateKey = await writeBackupFixture({
    resignHash: true,
    jsonTransform: (payload) => ({ ...payload, rows: payload.rows.map((row, index) => (index === 2 ? { ...row, id: "atr_1" } : row)) }),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory: duplicateKey.directory }),
    (error) => error.code === REPLAY_ERROR_CODES.ARTIFACT_PRIMARY_KEY_MISSING && /两次/.test(error.message),
  );

  // ⑤ row_count 与 rows.length 不自洽
  const rowCountLie = await writeBackupFixture({
    resignHash: true,
    jsonTransform: (payload) => ({ ...payload, row_count: payload.rows.length + 1 }),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory: rowCountLie.directory }),
    (error) => error.code === REPLAY_ERROR_CODES.ARTIFACT_ROW_COUNT_MISMATCH,
  );
});

// ==================== 6. SET 列集合 == 产物列集合 - 主键 ====================

test("SET 里出现的列集合必须 == .json 的 columns 去掉主键（脚本不许自己补列/漏列）", async () => {
  const { directory, payload } = await writeBackupFixture();
  const bundle = await loadBackupBundle({ directory });
  const artifact = bundle.tables[0];
  const expected = payload.columns.filter((column) => column !== payload.primary_key);

  assert.deepEqual(artifact.setColumns, expected, "产物里的 SET 列集合必须等于 columns - 主键");
  assert.equal(artifact.setColumns.includes("id"), false, "主键不许出现在 SET 里（它在 WHERE 里）");

  const statement = buildUpdateStatement({
    table: artifact.table,
    setColumns: artifact.setColumns,
    primaryKey: artifact.primaryKey,
  });
  assert.deepEqual(statementColumns(statement), expected, "生成语句的 SET 列集合必须逐字等于期望集合");

  const sequelize = createFakeSequelize();
  await replayBundle({ sequelize, bundle, expectDatabase: "touwaka_drill_261102" });
  const executed = writeCalls(sequelize);
  assert.ok(executed.length > 0, "必须真的发出语句");
  for (const call of executed) {
    assert.deepEqual(statementColumns(call.sql), expected, "发出去的每一条语句 SET 列集合都必须一致");
    // 生成列 / 多余列一个都不许出现：写 VIRTUAL 列在 sql_mode='' 下只是 warning、值被静默忽略。
    assert.equal(/\bkind\b|\bseq\b|\bpart_of\b/.test(call.sql), false, "不许自己往 SET 里补生成列");
    assert.equal((call.sql.match(/\?/g) ?? []).length, expected.length + 1, "占位符个数 = SET 列数 + 主键");
  }
});

test("值走参数化（不从 .sql 里切字符串）：含 ; ' \\ 换行 emoji 的值原样进 replacements", async () => {
  const { directory } = await writeBackupFixture();
  const bundle = await loadBackupBundle({ directory });
  const sequelize = createFakeSequelize();
  const report = await replayBundle({ sequelize, bundle, expectDatabase: "touwaka_drill_261102" });

  const calls = writeCalls(sequelize);
  const nastyCall = calls.find((call) => call.replacements.includes(NASTY));
  assert.ok(nastyCall, "含 ; ' \\ 换行 emoji 的值必须作为**参数**发出去（不在 SQL 文本里）");
  assert.equal(nastyCall.sql.includes(NASTY), false, "值不许内联进 SQL 文本（那就要自己写转义，迟早出事）");
  assert.equal(report.ok, true);
  assert.equal(report.written_rows, 3, "三行都按 affectedRows 核对通过");
  assert.equal(report.affected_rows_total, 3);
  assert.equal(report.mode, "apply");
});

test("matched 与 changed_rows 分开报：开了 FOUND_ROWS 后「匹配但值没变」也算通过", async () => {
  const { directory } = await writeBackupFixture();
  const bundle = await loadBackupBundle({ directory });
  // 三行都匹配上（affectedRows=1），但只有 atr_2 的值真的变了（Changed: 0/1/0）。
  // 这就是整表回放的常态：绝大多数行"本来就一致"，闸门必须按**匹配**算，
  // 否则每一次正常回放都会被判失败（那正是 Sequelize 默认 -FOUND_ROWS 的坑）。
  const sequelize = createFakeSequelize({
    changedRowsFor: ({ key }) => (key === "atr_2" ? 1 : 0),
  });
  const report = await replayBundle({ sequelize, bundle, expectDatabase: "touwaka_drill_261102" });
  assert.equal(report.ok, true, "匹配但值没变 ⇒ 依然是通过（affectedRows 是匹配口径）");
  assert.equal(report.tables[0].matched, 3);
  assert.equal(report.tables[0].changed_rows, 1, "值真变的只有 1 行（报告要把它与 matched 分开）");
  assert.equal(report.tables[0].affected_rows_sum, 3);
  assert.equal(report.written_rows, 3);
  assert.match(formatReport(report), /匹配 3（值真变 1）/);
});

// ==================== 7. 子进程真退出码 ====================

async function runFixtureProcess(source, args = []) {
  const directory = await makeTempDirectory();
  const fixturePath = join(directory, "fixture.mjs");
  await writeFile(fixturePath, source, "utf8");
  const child = spawn(process.execPath, [fixturePath, ...args], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const status = await new Promise((resolve) => child.on("close", resolve));
  return { status, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}

test("子进程真退出码：主键不存在 ⇒ exit 非零（spawn 实测，不在断言里模拟）", async () => {
  const { directory } = await writeBackupFixture();
  const fixture = `
import { loadBackupBundle, replayBundle, describeFailure } from ${JSON.stringify(SCRIPT_PATH)};

const bundle = await loadBackupBundle({ directory: ${JSON.stringify(directory)} });
const calls = [];
const existing = new Set(["atr_1", "atr_3"]); // atr_2 不存在
const sequelize = {
  query: async (sql, options = {}) => {
    const flat = String(sql).replace(/\\s+/g, " ").trim();
    if (/^SELECT DATABASE\\(\\) AS db$/i.test(flat)) return [[{ db: "touwaka_drill_261102" }], []];
    const probe = /^SELECT \`([^\`]+)\` AS pk FROM \`([^\`]+)\` WHERE/.exec(flat);
    if (probe) {
      const wanted = new Set((options.replacements ?? []).map(String));
      return [[...existing].filter((key) => wanted.has(key)).map((key) => ({ pk: key })), []];
    }
    calls.push(flat);
    const key = String((options.replacements ?? []).at(-1));
    return [{ affectedRows: existing.has(key) ? 1 : 0 }, 1];
  },
};
try {
  await replayBundle({ sequelize, bundle, expectDatabase: "touwaka_drill_261102" });
  console.log(JSON.stringify({ ok: true, writes: calls.length }));
} catch (error) {
  const failure = describeFailure(error);
  console.error(failure.message);
  console.log(JSON.stringify({ ok: false, writes: calls.length, code: failure.code, written: error.writtenRows }));
  process.exitCode = failure.exitCode;
}
`;
  const { status, stdout, stderr } = await runFixtureProcess(fixture);
  assert.equal(status, 1, `回放失败时进程退出码必须是 1（不是 0），实际 ${status}；stdout=${stdout} stderr=${stderr}`);
  const parsed = JSON.parse(stdout.trim().split("\n").pop());
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, REPLAY_ERROR_CODES.ROW_NOT_FOUND);
  assert.equal(parsed.written, 2, "写进去 2 行才遇到缺主键的那一行");
  assert.match(stderr, /code=ERR_REPLAY_ROW_NOT_FOUND/, "stderr 必须打出错误码");
  assert.match(stderr, /atr_2/, "stderr 必须点名缺主键的那一行");
});

test("子进程真退出码：产物被动过 ⇒ 连库之前 exit 非零（不碰数据库也能红）", async () => {
  const { directory } = await writeBackupFixture({
    sqlTransform: (text) => {
      // 真的删掉一条 UPDATE：条数从 3 变 2，产物之间不再自洽。
      const lines = text.split("\n");
      const lastUpdate = lines.map((line) => line.startsWith("UPDATE ")).lastIndexOf(true);
      lines.splice(lastUpdate, 1);
      return lines.join("\n");
    },
  });
  const fixture = `
import { loadBackupBundle, describeFailure } from ${JSON.stringify(SCRIPT_PATH)};
try {
  await loadBackupBundle({ directory: ${JSON.stringify(directory)} });
  console.log(JSON.stringify({ ok: true }));
} catch (error) {
  const failure = describeFailure(error);
  console.error(failure.message);
  console.log(JSON.stringify({ ok: false, code: failure.code }));
  process.exitCode = failure.exitCode;
}
`;
  const { status, stdout, stderr } = await runFixtureProcess(fixture);
  assert.equal(status, 1, `产物不自洽必须 exit 1，实际 ${status}`);
  const parsed = JSON.parse(stdout.trim().split("\n").pop());
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, REPLAY_ERROR_CODES.ARTIFACT_ROW_COUNT_MISMATCH);
  assert.match(stderr, /code=ERR_REPLAY_ARTIFACT_ROW_COUNT_MISMATCH/);
});

// ==================== 附带：工具函数的边界 ====================

test("默认备份目录取最新一份（含 backup-manifest.json 的目录）", async () => {
  const root = await makeTempDirectory();
  const older = await writeBackupFixture();
  const newer = await writeBackupFixture();
  // 只造两个目录 + 一个不含清单的旧演练目录（真实备份根的形状）。
  await mkdir(join(root, "drill-261102"), { recursive: true });
  await mkdir(join(root, "verify-transcript-projection-261101"), { recursive: true });
  for (const [name, source] of [["verify-transcript-projection-261101", older], ["verify-transcript-projection-261102", newer]]) {
    await mkdir(join(root, name), { recursive: true });
    for (const file of ["agent_transcript_rounds.json", "agent_transcript_rounds.rollback.sql", "backup-manifest.json"]) {
      await writeFile(join(root, name, file), await readFile(join(source.directory, file), "utf8"), "utf8");
    }
  }
  const latest = await resolveLatestBackupDirectory({ root });
  assert.equal(latest, join(root, "verify-transcript-projection-261102"));

  await assert.rejects(
    () => resolveLatestBackupDirectory({ root: join(root, "nope") }),
    (error) => error.code === REPLAY_ERROR_CODES.BACKUP_DIR_NOT_FOUND,
  );
});

test("affectedRowsOf 认 sequelize 的 [OkPacket, metadata] 两种形状（拿不到就是 0，不猜成 1）", () => {
  assert.equal(affectedRowsOf({ affectedRows: 1 }, 1), 1);
  assert.equal(affectedRowsOf(null, { affectedRows: 2 }), 2);
  assert.equal(affectedRowsOf({ affectedRows: 0 }, 0), 0);
  assert.equal(affectedRowsOf(undefined, undefined), 0, "拿不到受影响行数时默认 0 ⇒ 会触发核对失败，不是静默成功");
});

test("每一种失败都打印「本次已写 N 行」（回放中途失败时人要知道库处在什么状态）", async () => {
  const cases = [];
  // 产物层失败（零写）
  const tampered = await writeBackupFixture({
    jsonTransform: (payload) => ({ ...payload, rows: payload.rows.map((row, index) => (index === 0 ? { ...row, record_json: "{}" } : row)) }),
  });
  cases.push(await loadBackupBundle({ directory: tampered.directory }).catch((error) => error));
  // 库名不符（零写）
  const { directory } = await writeBackupFixture();
  const bundle = await loadBackupBundle({ directory });
  cases.push(await replayBundle({
    sequelize: createFakeSequelize(),
    bundle,
    expectDatabase: "touwaka_mate",
  }).catch((error) => error));
  // 回放中途（已写 2 行）
  cases.push(await replayBundle({
    sequelize: createFakeSequelize({ existingKeys: ["atr_1", "atr_3"] }),
    bundle,
    expectDatabase: "touwaka_drill_261102",
  }).catch((error) => error));

  assert.equal(cases.length, 3);
  const codes = new Set();
  for (const error of cases) {
    const rendered = describeFailure(error).message;
    assert.match(rendered, /code=ERR_REPLAY_/, `必须打出错误码：${rendered}`);
    assert.match(rendered, /本次已写 \d+ 行/, `文案必须写「本次已写 N 行」：${rendered}`);
    assert.equal(describeFailure(error).exitCode, 1, "任何失败都是非零退出");
    codes.add(error.code);
  }
  assert.equal(codes.size, 3, "三种失败必须是三个不同错误码（不是一个大杂烩）");
});

test("主键存在性预检分块（一次 SELECT 一个 IN 集合，不逐行点查）", async () => {
  const sequelize = createFakeSequelize({ existingKeys: ["a", "b", "c", "d", "e"] });
  const existing = await probeExistingPrimaryKeys({
    sequelize,
    table: "agent_transcript_rounds",
    primaryKey: "id",
    keys: ["a", "b", "c", "d", "e", "zz"],
    chunkSize: 2,
  });
  assert.deepEqual([...existing].sort(), ["a", "b", "c", "d", "e"]);
  assert.equal(sequelize.calls.filter((call) => /AS pk FROM/.test(call.sql)).length, 3, "6 个主键按 2 个一块 = 3 次查询");
});
