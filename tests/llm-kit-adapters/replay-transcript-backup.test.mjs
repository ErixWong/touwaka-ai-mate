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

// ==================== 8. 补钉：逐条件短路探针查出的四条缺口 ====================
//
// 由来（#1246 逐条件短路探针）：把下面每处的 `if (...)` 改成 `if (false && (...))`，
// 上面 18 格**全绿**——判据在代码里，却没有一格钉住它。这一节就是补钉。
// 每一格的注释写明「钉的是哪一行、哪种变异把它打红」；变异红名单见报告。
//
//   A. 三方计数里的**清单**两半（`scripts/replay-transcript-backup.mjs:471` / `:474`）
//   B. `row_count` 的类型判据（`:350`）
//   C. 标识符白名单（`:295` 表名 / `:360` 列名与主键名 / `:504`+`:512` buildUpdateStatement 直调）
//   D. 写前预检 `primary_keys_missing_before_write`（`:849` 报告分支；`:690` dry-run 闸门）

// `main` 单独动态取一次：既有的 import 清单一个字不动（本单只许加格，不许改既有格）。
// 用途只有一个——用「env 里没有 DB_NAME」跑 main 来**结构性**证明「产物阶段 abort 时根本没连库」：
// main 里 loadBackupBundle（:937）早于 connectDatabase（:941），所以走到连库那一步会抛
// ERR_REPLAY_USAGE（缺 DB_NAME），而不是产物码。断言拿到产物码 == 没连库 == 零写。
const { main: runReplayMain } = await import("../../scripts/replay-transcript-backup.mjs");

async function assertAbortsBeforeAnyConnection({ directory, code, pattern = null }) {
  await assert.rejects(
    () => runReplayMain({
      argv: ["--backup-dir", directory, "--expect-database", "touwaka_drill_261102"],
      env: {},
    }),
    (error) => {
      assert.equal(
        error.code,
        code,
        `必须是产物码（若变成 ERR_REPLAY_USAGE 说明先连库了 ⇒ 零写不再成立）：${error.message}`,
      );
      if (pattern) assert.match(error.message, pattern);
      return true;
    },
    "产物阶段的 abort 必须发生在 connectDatabase 之前",
  );
}

// ---------- A. 三方计数：清单的 update_count / row_count ----------

test("清单 update_count 与 .json 行数不等（.sql 与 .json 自洽）⇒ 走「产物行数不自洽」码、abort、不连库", async () => {
  // 只有清单那一个数字错：.sql 的 UPDATE 3 条、.json 的 row_count=3 且 rows 3 行，
  // 清单 update_count 撒谎成 2。短路 `:471` 会让这一格全绿（= 没钉住）。
  const { directory } = await writeBackupFixture({
    manifestTransform: (manifest) => ({
      ...manifest,
      tables: manifest.tables.map((entry) => ({ ...entry, update_count: 2 })),
    }),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory }),
    (error) => {
      assert.equal(error.code, REPLAY_ERROR_CODES.ARTIFACT_ROW_COUNT_MISMATCH);
      assert.match(error.message, /清单 update_count=2 ≠ \.json 的 3 行/);
      assert.equal(
        /\.sql 的 UPDATE/.test(error.message),
        false,
        "这一格必须是**只有清单**那一路错（.sql 与 .json 一致），否则等于没钉 manifest 那一路",
      );
      return true;
    },
    "清单 update_count 撒谎必须在**连库之前** abort",
  );
  await assertAbortsBeforeAnyConnection({
    directory,
    code: REPLAY_ERROR_CODES.ARTIFACT_ROW_COUNT_MISMATCH,
    pattern: /清单 update_count=2/,
  });
});

test("清单 update_count 不是数字（\"3\"）⇒ 视为「未记录」不参与比对（`!== null` 那一半）", async () => {
  // 这一格钉的是条件的**左半**：`manifestUpdateCount !== null &&`。
  // 把左半去掉（`manifestUpdateCount !== rows.length`）⇒ "3" !== 3 ⇒ 误报不自洽 ⇒ 这格红。
  const { directory } = await writeBackupFixture({
    manifestTransform: (manifest) => ({
      ...manifest,
      tables: manifest.tables.map((entry) => ({ ...entry, update_count: "3" })),
    }),
  });
  const bundle = await loadBackupBundle({ directory });
  assert.equal(bundle.tables[0].manifestUpdateCount, null, "非数字的 update_count 归为「未记录」");
  const sequelize = createFakeSequelize();
  const report = await replayBundle({ sequelize, bundle, expectDatabase: "touwaka_drill_261102" });
  assert.equal(report.ok, true, "清单没记 update_count（或记成字符串）不是回放失败的理由");
  assert.equal(report.written_rows, 3);
});

test("清单 row_count 与 .json 行数不等 ⇒ 同一个「产物行数不自洽」码（第三个计数也要钉）", async () => {
  // 同段代码的第三个条件（`:474`）：探针只列了 update_count，但 row_count 一样是裸的。
  const { directory } = await writeBackupFixture({
    manifestTransform: (manifest) => ({
      ...manifest,
      tables: manifest.tables.map((entry) => ({ ...entry, row_count: 5 })),
    }),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory }),
    (error) => {
      assert.equal(error.code, REPLAY_ERROR_CODES.ARTIFACT_ROW_COUNT_MISMATCH);
      assert.match(error.message, /清单 row_count=5 ≠ \.json 的 3 行/);
      assert.equal(/\.sql 的 UPDATE/.test(error.message), false, "只有清单 row_count 错（.sql 与 .json 一致）");
      return true;
    },
  );
  await assertAbortsBeforeAnyConnection({ directory, code: REPLAY_ERROR_CODES.ARTIFACT_ROW_COUNT_MISMATCH });
});

// ---------- B. row_count 必须是 number（三种形态各一格） ----------

test("row_count 缺失 ⇒ ERR_REPLAY_ARTIFACT_MISSING_FIELD（不是「行数不自洽」）、不连库", async () => {
  const { directory } = await writeBackupFixture({
    jsonTransform: (payload) => {
      const clone = { ...payload };
      delete clone.row_count;
      return clone;
    },
  });
  await assert.rejects(
    () => loadBackupBundle({ directory }),
    (error) => {
      assert.equal(error.code, REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD);
      assert.match(error.message, /缺 row_count/);
      return true;
    },
    "缺字段要报「产物缺字段」，不能滑到「行数不自洽」（两者处置不同）",
  );
  await assertAbortsBeforeAnyConnection({ directory, code: REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD });
});

test("row_count 为 null ⇒ 同上（typeof null 是 object，不许当数字）", async () => {
  const { directory } = await writeBackupFixture({
    jsonTransform: (payload) => ({ ...payload, row_count: null }),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory }),
    (error) => error.code === REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD && /缺 row_count/.test(error.message),
  );
  await assertAbortsBeforeAnyConnection({ directory, code: REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD });
});

test("row_count 是字符串 \"3\" ⇒ 同上（字符串数字不是数字，不许隐式比较放过）", async () => {
  // 短路 `:350` 时 `"3" !== 3` 会走「行数不自洽」——错误码变了，所以这格能红。
  const { directory } = await writeBackupFixture({
    jsonTransform: (payload) => ({ ...payload, row_count: String(payload.rows.length) }),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory }),
    (error) => {
      assert.equal(error.code, REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD);
      assert.match(error.message, /缺 row_count/);
      return true;
    },
    "字符串形式的数字必须按「缺字段」拒（否则 row_count 与 rows.length 的比较口径就变成了 JS 隐式转换）",
  );
  await assertAbortsBeforeAnyConnection({ directory, code: REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD });
});

// ---------- C. 标识符白名单：四处出现，分别覆盖 ----------

test("列名非法（空格 / 反引号 / SQL 注释符）⇒ 三个变体各自 abort、不连库", async () => {
  // 钉 `:360`（`[...columns, primaryKey]` 那一处）。列名要拼进 `SET \`x\` = ?`，必须 fail-closed。
  const variants = ["bad column", "bad`column", "record_json--x"];
  for (const bad of variants) {
    const { directory } = await writeBackupFixture({
      jsonTransform: (payload) => ({ ...payload, columns: [...payload.columns, bad] }),
    });
    await assert.rejects(
      () => loadBackupBundle({ directory }),
      (error) => {
        assert.equal(error.code, REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD);
        assert.match(error.message, /列名非法/, `必须报「列名非法」而不是滑到「缺列」：${error.message}`);
        assert.ok(error.message.includes(JSON.stringify(bad)), `必须点名那个非法列名：${error.message}`);
        return true;
      },
      `列名 ${JSON.stringify(bad)} 必须被拒`,
    );
    await assertAbortsBeforeAnyConnection({ directory, code: REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD });
  }
});

test("清单里的表名非法 ⇒ 「产物缺字段」码（表名也拼进 UPDATE，必须 fail-closed）", async () => {
  // 钉 `:295`。manifest 的 table 是**清单**里的字段（人可改），不像 payload.table 有交叉核对。
  const badTable = "agent_transcript_rounds; DROP TABLE x";
  const { directory } = await writeBackupFixture({
    manifestTransform: (manifest) => ({
      ...manifest,
      tables: manifest.tables.map((entry) => ({ ...entry, table: badTable })),
    }),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory }),
    (error) => {
      assert.equal(error.code, REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD);
      assert.match(error.message, /清单里的表名非法或缺失/);
      return true;
    },
    "非法表名要在**读文件之前**就拒（json_path 是清单给的，读谁由它决定）",
  );
  await assertAbortsBeforeAnyConnection({ directory, code: REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD });
});

test("主键名非法 ⇒ 「产物缺字段」码（不是「主键不在 columns 里」——两处校验别混）", async () => {
  // 同一处 `:360` 的 `primaryKey` 那一半；短路后才会滑到 `:369` 的 ARTIFACT_PRIMARY_KEY_MISSING，
  // 错误码不同 ⇒ 这格红。
  const { directory } = await writeBackupFixture({
    jsonTransform: (payload) => ({ ...payload, primary_key: "id`x" }),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory }),
    (error) => {
      assert.equal(error.code, REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD);
      assert.match(error.message, /列名非法/);
      assert.ok(error.message.includes('"id`x"'));
      return true;
    },
    "非法主键名（拼进 WHERE）必须按标识符拒，不能只报「不在 columns 里」",
  );
});

test("第二处标识符校验（buildUpdateStatement 直调，不经文件）：表名 / 主键名 / SET 列名各自抛", () => {
  // 钉 `:504`（table+primaryKey）与 `:512`（setColumns）。这层是"不经产物、直接构造语句"的
  // 防御：loadBackupBundle 走完之后还会再拼一次语句，两处都得 fail-closed。
  const legalSet = ["request_id", "record_json", "created_at", "updated_at"];
  assert.throws(
    () => buildUpdateStatement({ table: "agent transcript rounds", setColumns: legalSet, primaryKey: "id" }),
    (error) => error.code === REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD && /表名\/主键名非法/.test(error.message),
    "表名带空格必须抛",
  );
  assert.throws(
    () => buildUpdateStatement({ table: "agent_transcript_rounds", setColumns: legalSet, primaryKey: "id--x" }),
    (error) => error.code === REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD && /表名\/主键名非法/.test(error.message),
    "主键名带 SQL 注释符必须抛",
  );
  assert.throws(
    () => buildUpdateStatement({ table: "agent_transcript_rounds", setColumns: ["bad column"], primaryKey: "id" }),
    (error) => error.code === REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD && /列名非法/.test(error.message),
    "SET 列名带空格必须抛",
  );
});

test("合法标识符照常通过（挡住「一律拒绝」式糊弄）：同一份夹具只换一个非法列名才红", async () => {
  // 没有这一格，"把 IDENTIFIER_PATTERN 改成永远 false"也能让上面几格全绿——那就是糊弄。
  const legal = await writeBackupFixture();
  const bundle = await loadBackupBundle({ directory: legal.directory });
  assert.equal(bundle.tables[0].table, "agent_transcript_rounds");
  assert.deepEqual(bundle.tables[0].setColumns, ["request_id", "record_json", "created_at", "updated_at"]);
  const statement = buildUpdateStatement({
    table: "agent_transcript_rounds",
    setColumns: bundle.tables[0].setColumns,
    primaryKey: "id",
  });
  assert.match(statement, /^UPDATE `agent_transcript_rounds` SET /);
  assert.deepEqual(statementColumns(statement), bundle.tables[0].setColumns);
  const sequelize = createFakeSequelize();
  const report = await replayBundle({ sequelize, bundle, expectDatabase: "touwaka_drill_261102" });
  assert.equal(report.ok, true, "合法标识符必须照常回放通过");
  assert.equal(writeCalls(sequelize).length, 3);

  // 对照：同一入口、同一夹具，只把列名换成带空格的 ⇒ 必须红。
  const illegal = await writeBackupFixture({
    jsonTransform: (payload) => ({ ...payload, columns: [...payload.columns, "record json"] }),
  });
  await assert.rejects(
    () => loadBackupBundle({ directory: illegal.directory }),
    (error) => error.code === REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD && /列名非法/.test(error.message),
    "对照组必须红（证明上面的绿不是「一律放过」）",
  );
});

// ---------- D. 写前预检 primary_keys_missing_before_write ----------

test("写前预检：主键不存在 ⇒ 报告点名（表名 + 主键）「缺主键（写前预检）」、dry-run 判 ok=false、零写", async () => {
  // 钉 `:849-850`（formatReport 的打印分支）。短路它 ⇒ 报告里就看不到「缺主键（写前预检）」这一行。
  const { directory } = await writeBackupFixture();
  const bundle = await loadBackupBundle({ directory });
  const sequelize = createFakeSequelize({ existingKeys: ["atr_1", "atr_2"] }); // atr_3 表里没有
  const report = await replayBundle({
    sequelize,
    bundle,
    expectDatabase: "touwaka_drill_261102",
    dryRun: true,
  });
  const text = formatReport(report);
  assert.match(text, /缺主键（写前预检）：atr_3/, "报告必须点名写前预检缺的那一行");
  assert.match(text, /agent_transcript_rounds\t主键 id/, "点名必须带表名与主键名（不是光一个值）");
  assert.deepEqual(report.tables[0].primary_keys_missing_before_write, ["atr_3"]);
  assert.equal(report.tables[0].ok, false, "dry-run 的 ok 就是预检结果（`:690`）");
  assert.equal(report.ok, false, "预演发现主键缺失 ⇒ 真跑会失败 ⇒ 报告 ok=false");
  assert.equal(writeCalls(sequelize).length, 0, "预演零写");
});

test("写路径：写前预检非空**不是**成败闸门（UPDATE 命中即 ok=true），但报告必须点名；复合情形仍是 ROW_NOT_FOUND", async () => {
  // 分支裁定（不许合并成一句话）：
  //   · dry-run：`entry.ok = missingBeforeWrite.length === 0`（`:690`）⇒ 预检非空 = 失败。
  //   · 真写：`entry.ok` 只看 affectedRows 三个桶（`:741-743`），**不含**预检 ⇒ 预检非空但
  //     UPDATE 命中（探针漏了/类型口径不一致）时 ok=true、退出码 0。
  //   · 真写且 UPDATE 也 0 行 ⇒ ROW_NOT_FOUND（`:776` 起），与既有第 3 格**同一个错误码**，
  //     但那条路径由 affectedRows 判，不由预检判。
  // 这一格把上面三条一起钉住：短路 `:849` 会让「缺主键（写前预检）」那行消失 ⇒ 红。
  const { directory } = await writeBackupFixture();
  const bundle = await loadBackupBundle({ directory });
  const probeMissed = () => createFakeSequelize({
    existingKeys: ["atr_1", "atr_3"], // 探针漏了 atr_2
    affectedFor: () => 1, // 但 UPDATE 按主键命中 1 行
  });

  const sequelize = probeMissed();
  const report = await replayBundle({ sequelize, bundle, expectDatabase: "touwaka_drill_261102" });
  assert.deepEqual(report.tables[0].primary_keys_missing_before_write, ["atr_2"]);
  assert.equal(report.tables[0].would_update, 2, "预检结果要体现在「会被更新的行数」上");
  assert.equal(report.ok, true, "真写路径的成败只看 affectedRows（`:741-743`）——预检不是闸门");
  assert.equal(report.written_rows, 3);
  const text = formatReport(report);
  assert.match(text, /会被更新的行数：2\t主键不存在的行数：1/);
  assert.match(text, /缺主键（写前预检）：atr_2/, "即使 ok=true，预检缺的行也必须被点名（否则这条信号等于不存在）");

  // 同一份夹具 + 同一个探针结果，dry-run 走另一条判据 ⇒ ok=false、零写。
  const drySequelize = probeMissed();
  const dryReport = await replayBundle({
    sequelize: drySequelize,
    bundle,
    expectDatabase: "touwaka_drill_261102",
    dryRun: true,
  });
  assert.equal(dryReport.ok, false, "同一份数据 dry-run 判失败、真写判通过 ⇒ 两条判据不同，必须分别钉");
  assert.equal(writeCalls(drySequelize).length, 0);

  // 复合情形（预检漏 + UPDATE 也 0 行）：同一个 ROW_NOT_FOUND 码，点名表名与主键。
  await assert.rejects(
    () => replayBundle({
      sequelize: createFakeSequelize({ existingKeys: ["atr_1", "atr_3"] }),
      bundle,
      expectDatabase: "touwaka_drill_261102",
    }),
    (error) => {
      assert.equal(error.code, REPLAY_ERROR_CODES.ROW_NOT_FOUND, "与既有第 3 格同码（预检没有自己的错误码）");
      assert.match(error.message, /agent_transcript_rounds/, "点名表名");
      assert.match(error.message, /atr_2/, "点名主键值");
      assert.equal(error.writtenRows, 2, "已写 2 行才撞上缺主键那行");
      assert.equal(describeFailure(error).exitCode, 1, "非零退出");
      return true;
    },
  );
});
