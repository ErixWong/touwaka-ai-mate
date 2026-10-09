/**
 * issue #1156 Stage A：`agent_transcript_rounds` / `llm_kit_run_checkpoint` 的 DDL 护栏测试
 *
 * 这一组断言**钉住 Eric 已拍板的形状**（issue #1156 评论「Eric 已拍板」2026-10-09），
 * 不是为了测行为，而是为了让"顺手把索引改成唯一"这类改动当场变红：
 *
 *   决策①（最重要）：唯一性**只**落在身份 `dedup_key` 上，`(request_id, round_no)` 必须是
 *     **普通 KEY（NON_UNIQUE = 1）**。理由：同轮两条不同 `dedupKey` 是上游契约要求
 *     （见 tests/llm-kit-adapters/transcript-store.contract.test.mjs 的 appendUserTurn 用例），
 *     而写入侧走 `INSERT IGNORE` —— 一旦把 (request_id, round_no) 建成 UNIQUE，
 *     同轮第二行会被**静默丢掉**（丢的是用户行），不报错、不可观测。
 *   决策③′：引擎面只留 `record_json` 一个 JSON 列；判据是「只有 SQL 真按它筛/排/局部更新，
 *     派生列才允许存在」。因此 `folded` / `messages_json` / `folded_payload_json` /
 *     `stop_reason` / `usage` / `latency_ms` **都不建**（grep 证据见下）。
 *   AGENTS.md 红线：禁 `TINYINT`、布尔一律 `BIT(1)`、时间列应用侧写入
 *     （DDL 里不得出现 `DEFAULT CURRENT_TIMESTAMP`）、全字符串主键。
 *
 * 元数据一律走 information_schema.statistics / .columns（不用 SHOW INDEX，表格解析易错）。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 * 破坏性操作（DROP 新表后重跑建表步骤）之前必须过 openTestDatabase() 的硬断言（#1167）。
 */

import { test, after, before } from "node:test";
import assert from "node:assert/strict";

// logs/ 目录可能非本用户属主，屏蔽文件写入，避免日志权限错误掩盖数据库结果。
import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

// issue #1167：openTestDatabase() 内部先跑硬断言（白名单仅 llm_kit_test），
// 不命中就在**建连接之前**抛 NonTestDatabaseError；凭据文件缺失则返回 null → 用例 skip。
const { openTestDatabase, DEFAULT_CREDS_PATH } = await import("../helpers/test-db-guard.mjs");
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;

// upgrade-database.js 在建模块时就读 DB_CONFIG（process.env.DB_*），因此凭据必须先于 import 落地。
if (creds) {
  process.env.DB_HOST = String(creds.host ?? "localhost");
  process.env.DB_PORT = String(creds.port ?? 3306);
  process.env.DB_USER = creds.user;
  process.env.DB_PASSWORD = creds.password;
  process.env.DB_NAME = creds.database;
}

const { MIGRATIONS, runMigrationSteps, parseUpgradeOptions } = await import(
  "../../scripts/upgrade-database.js"
);

const ATR_STEPS = [
  "create agent_transcript_rounds table (#1156 Stage A)",
  "create llm_kit_run_checkpoint table (#1156 Stage A)",
];
// --step 走大小写不敏感子串匹配；两条步骤名共用 "#1156 stage a"。
const STEP_FILTER = "#1156 Stage A";

const db = dbCtx?.db ?? null;

/** information_schema.statistics：索引列 / 唯一性 */
async function indexRows(table, indexName) {
  const [rows] = await db.sequelize.query(
    `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX,
            SUB_PART, COLLATION AS INDEX_COLLATION
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table AND INDEX_NAME = :index
      ORDER BY SEQ_IN_INDEX`,
    { replacements: { schema: creds.database, table, index: indexName } },
  );
  return rows;
}

/** information_schema.statistics：某表全部索引名 */
async function indexNames(table) {
  const [rows] = await db.sequelize.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table`,
    { replacements: { schema: creds.database, table } },
  );
  return rows.map((row) => row.INDEX_NAME);
}

/** information_schema.columns：单列元数据（不存在返回 null） */
async function columnInfo(table, column) {
  const [rows] = await db.sequelize.query(
    `SELECT COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH,
            IS_NULLABLE, COLUMN_DEFAULT, EXTRA, DATETIME_PRECISION, COLUMN_COMMENT
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { replacements: { schema: creds.database, table, column } },
  );
  return rows[0] ?? null;
}

async function tableExists(table) {
  const [rows] = await db.sequelize.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table`,
    { replacements: { schema: creds.database, table } },
  );
  return rows.length > 0;
}

async function dropNewTables() {
  for (const table of ["agent_transcript_rounds", "llm_kit_run_checkpoint"]) {
    await db.sequelize.query(`DROP TABLE IF EXISTS \`${table}\``);
  }
}

/** 真跑建表步骤（不 dry-run），返回 runMigrationSteps 的 results */
async function applyNewSteps() {
  const connection = {
    execute: async (sql, params = []) =>
      db.sequelize.query(sql, { replacements: params.length ? params : {} }),
  };
  return quiet(() => runMigrationSteps(connection, parseUpgradeOptions(["--step", STEP_FILTER])));
}

/**
 * runMigrationSteps 会为全部 135 条步骤逐行打日志；在 node --test 的子进程里这种
 * 海量 stdout 会干扰测试运行器的 IPC 解析（实测报 Unable to deserialize cloned data）。
 * 真跑只关心 results，因此这里暂时静默 console（不影响真实 CLI 的输出）。
 */
async function quiet(fn) {
  const originals = {
    log: console.log,
    error: console.error,
    warn: console.warn,
  };
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, originals);
  }
}

before(async () => {
  if (!db) return;
  // 破坏性操作前再确认一次目标库（openTestDatabase 已断言过，这里显式重申红线）。
  assert.equal(
    creds.database,
    "llm_kit_test",
    "本文件会在测试库上 DROP 新表，目标库必须是 llm_kit_test",
  );
  await dropNewTables();
  const results = await applyNewSteps();
  assert.deepEqual(
    results.applied.filter((name) => ATR_STEPS.includes(name)).sort(),
    [...ATR_STEPS].sort(),
    `建表步骤应在空库上 Applied，实际 applied=${JSON.stringify(results.applied)} failed=${JSON.stringify(results.failed)}`,
  );
  assert.deepEqual(results.failed, [], "建表步骤不应失败");
});

after(async () => {
  if (db) {
    await dropNewTables();
  }
  if (dbCtx && typeof db?.close === "function") {
    await db.close();
  } else if (dbCtx && db?.sequelize) {
    await db.sequelize.close();
  }
});

const runWhenCreds = creds ? {} : { skip: `缺少凭据 ${CREDS_PATH}` };

// ==================== 两张表存在 ====================

test("两张新表都在目标库中存在", runWhenCreds, async () => {
  assert.ok(await tableExists("agent_transcript_rounds"), "agent_transcript_rounds 未建出来");
  assert.ok(await tableExists("llm_kit_run_checkpoint"), "llm_kit_run_checkpoint 未建出来");
});

// ==================== 决策①：主键单列 + 唯一性只落在 dedup_key ====================

test("agent_transcript_rounds 主键是单列 id（AGENTS.md §3.4 全字符串主键）", runWhenCreds, async () => {
  const rows = await indexRows("agent_transcript_rounds", "PRIMARY");
  assert.ok(rows.length > 0, "PRIMARY 索引不存在");
  assert.deepEqual(
    rows.map((row) => row.COLUMN_NAME),
    ["id"],
    `主键必须是单列 id，实际=${JSON.stringify(rows.map((r) => r.COLUMN_NAME))}`,
  );
  assert.equal(rows[0].NON_UNIQUE, 0, "PRIMARY 必须 NON_UNIQUE=0");
  const id = await columnInfo("agent_transcript_rounds", "id");
  assert.equal(id.DATA_TYPE, "varchar", "id 必须是字符串主键（禁止自增整型混用）");
  assert.ok(id.CHARACTER_MAXIMUM_LENGTH >= 32, "id 宽度至少 varchar(32)");
});

test("uk_atr_dedup_key 是 UNIQUE 且恰好覆盖 dedup_key（唯一性 = 领域身份）", runWhenCreds, async () => {
  const rows = await indexRows("agent_transcript_rounds", "uk_atr_dedup_key");
  assert.ok(rows.length > 0, "uk_atr_dedup_key 索引不存在");
  assert.equal(rows[0].NON_UNIQUE, 0, "uk_atr_dedup_key 必须是 UNIQUE（NON_UNIQUE=0）");
  assert.deepEqual(rows.map((row) => row.COLUMN_NAME), ["dedup_key"]);
});

test("idx_atr_request_round 存在且 NON_UNIQUE=1（决策①护栏：普通 KEY，绝不 UNIQUE）", runWhenCreds, async () => {
  const rows = await indexRows("agent_transcript_rounds", "idx_atr_request_round");
  assert.ok(
    rows.length > 0,
    "idx_atr_request_round 不存在：同轮两条不同 dedupKey 是上游契约要求，索引不能改成唯一",
  );
  assert.equal(
    rows[0].NON_UNIQUE,
    1,
    "决策①：(request_id, round_no) 是属性不是身份，必须保持普通 KEY。建成 UNIQUE 会让" +
      "同轮第二行在写入侧 INSERT IGNORE 下静默丢失（丢用户行）。",
  );
  assert.deepEqual(
    rows.map((row) => row.COLUMN_NAME),
    ["request_id", "round_no"],
    "idx_atr_request_round 必须是 (request_id, round_no) 两列复合索引",
  );
});

test("(request_id, round_no) 上不存在任何 UNIQUE 索引（防止换个名字绕过决策①）", runWhenCreds, async () => {
  const [rows] = await db.sequelize.query(
    `SELECT INDEX_NAME, NON_UNIQUE,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = 'agent_transcript_rounds'
      GROUP BY INDEX_NAME, NON_UNIQUE`,
    { replacements: { schema: creds.database } },
  );
  const uniqueOnRequestRound = rows.filter(
    (row) => row.NON_UNIQUE === 0 && row.cols === "request_id,round_no",
  );
  assert.deepEqual(
    uniqueOnRequestRound,
    [],
    `出现 UNIQUE(request_id,round_no) 即违反决策①：${JSON.stringify(uniqueOnRequestRound)}`,
  );
  // 顺带钉住全表索引集合：只允许这三条（PRIMARY / uk_atr_dedup_key / idx_atr_request_round）。
  assert.deepEqual(
    (await indexNames("agent_transcript_rounds")).sort(),
    ["PRIMARY", "idx_atr_request_round", "uk_atr_dedup_key"],
  );
});

test("同轮两条不同 dedup_key 能真实共存（决策①的行为级证据，非仅元数据）", runWhenCreds, async () => {
  const runId = "run-1156a-same-round";
  await db.sequelize.query("DELETE FROM agent_transcript_rounds WHERE request_id = :id", {
    replacements: { id: runId },
  });
  const insert = (id, dedupKey) =>
    db.sequelize.query(
      `INSERT IGNORE INTO agent_transcript_rounds
         (id, request_id, round_no, dedup_key, record_json, created_at, updated_at)
       VALUES (:id, :runId, 2, :dedupKey, :record, NOW(), NOW())`,
      {
        replacements: {
          id,
          runId,
          dedupKey,
          record: JSON.stringify({ round: 2, dedupKey }),
        },
      },
    );
  // 与写入侧一致：两条都是 INSERT IGNORE。UNIQUE(request_id,round_no) 会静默丢第二行。
  await insert("atr_1156a_engine_row", "run-1156a-same-round:engine:round:2");
  await insert("atr_1156a_input_row", "run-1156a-same-round:input:abc");
  const [rows] = await db.sequelize.query(
    `SELECT id, dedup_key FROM agent_transcript_rounds
      WHERE request_id = :id ORDER BY id`,
    { replacements: { id: runId } },
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ["atr_1156a_engine_row", "atr_1156a_input_row"],
    `同轮两行必须都能落库；只回 1 行说明 (request_id,round_no) 被建成了 UNIQUE：` +
      JSON.stringify(rows),
  );
  await db.sequelize.query("DELETE FROM agent_transcript_rounds WHERE request_id = :id", {
    replacements: { id: runId },
  });
});

// ==================== 决策③′：列集合与 NOT NULL ====================

test("record_json 是 NOT NULL 的唯一 JSON 真相列", runWhenCreds, async () => {
  const col = await columnInfo("agent_transcript_rounds", "record_json");
  assert.ok(col, "record_json 列不存在");
  assert.equal(col.IS_NULLABLE, "NO", "record_json 必须 NOT NULL（唯一真相，禁止空真相行）");
});

test("引擎面 DDL 不含展示面投影列与 folded（决策③′判据：无 SQL 按其筛/排/局部更新）", runWhenCreds, async () => {
  const banned = [
    "messages_json",
    "folded_payload_json",
    "folded",
    "folded_range",
    "stop_reason",
    "usage",
    "latency_ms",
    "ts",
  ];
  const [rows] = await db.sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = 'agent_transcript_rounds'`,
    { replacements: { schema: creds.database } },
  );
  const present = rows.map((row) => row.COLUMN_NAME);
  assert.deepEqual(
    present.filter((name) => banned.includes(name)),
    [],
    `以下派生列不该出现在新表（判据：只有 SQL 真按它筛/排/局部更新才允许存在）：` +
      JSON.stringify(present.filter((name) => banned.includes(name))),
  );
  assert.deepEqual(
    present.sort(),
    ["created_at", "dedup_key", "id", "record_json", "request_id", "round_no", "updated_at"],
    "列集合必须恰好是：身份 + 索引标量 + record_json + 时间列",
  );
});

test("dedup_key 宽度与已验证的 agent_rounds.dedup_key 一致（varchar(255)）", runWhenCreds, async () => {
  const [atr, legacy] = await Promise.all([
    columnInfo("agent_transcript_rounds", "dedup_key"),
    columnInfo("agent_rounds", "dedup_key"),
  ]);
  assert.ok(atr, "agent_transcript_rounds.dedup_key 不存在");
  assert.ok(legacy, "对照列 agent_rounds.dedup_key 不存在");
  assert.equal(atr.COLUMN_TYPE, legacy.COLUMN_TYPE);
  assert.equal(atr.CHARACTER_MAXIMUM_LENGTH, 255);
  assert.equal(atr.IS_NULLABLE, "NO");
});

// ==================== AGENTS.md 红线 ====================

test("两张新表全表无 TINYINT；布尔列（若有）必须是 BIT(1)", runWhenCreds, async () => {
  for (const table of ["agent_transcript_rounds", "llm_kit_run_checkpoint"]) {
    const [rows] = await db.sequelize.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table
          AND (DATA_TYPE = 'tinyint' OR DATA_TYPE = 'boolean')`,
      { replacements: { schema: creds.database, table } },
    );
    assert.deepEqual(rows, [], `${table} 出现 TINYINT/BOOLEAN 列，违反红线：${JSON.stringify(rows)}`);

    const [bools] = await db.sequelize.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table AND DATA_TYPE = 'bit'`,
      { replacements: { schema: creds.database, table } },
    );
    for (const col of bools) {
      assert.equal(col.COLUMN_TYPE, "bit(1)", `${table}.${col.COLUMN_NAME} 布尔列必须是 BIT(1)`);
    }
  }
});

test("时间列由应用侧写入：无 DEFAULT CURRENT_TIMESTAMP、无 ON UPDATE CURRENT_TIMESTAMP", runWhenCreds, async () => {
  for (const table of ["agent_transcript_rounds", "llm_kit_run_checkpoint"]) {
    const [rows] = await db.sequelize.query(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table
          AND DATA_TYPE IN ('datetime', 'timestamp', 'date')`,
      { replacements: { schema: creds.database, table } },
    );
    assert.ok(rows.length > 0, `${table} 没有任何时间列，与形状不符`);
    for (const col of rows) {
      const def = String(col.COLUMN_DEFAULT ?? "").toUpperCase();
      assert.ok(
        !def.includes("CURRENT_TIMESTAMP") && !def.includes("NOW()"),
        `${table}.${col.COLUMN_NAME} 出现 DEFAULT ${col.COLUMN_DEFAULT}，时间列必须应用侧写入`,
      );
      assert.ok(
        !String(col.EXTRA).toUpperCase().includes("ON UPDATE CURRENT_TIMESTAMP"),
        `${table}.${col.COLUMN_NAME} 出现 ON UPDATE CURRENT_TIMESTAMP，时间列必须应用侧写入`,
      );
    }
  }
});

// ==================== llm_kit_run_checkpoint ====================

test("llm_kit_run_checkpoint 主键是单列 run_id、revision 是 BIGINT、snapshot_json NOT NULL", runWhenCreds, async () => {
  const pk = await indexRows("llm_kit_run_checkpoint", "PRIMARY");
  assert.ok(pk.length > 0, "PRIMARY 索引不存在");
  assert.deepEqual(pk.map((row) => row.COLUMN_NAME), ["run_id"]);
  const runId = await columnInfo("llm_kit_run_checkpoint", "run_id");
  assert.equal(runId.DATA_TYPE, "varchar", "run_id 必须是字符串主键");
  assert.equal(runId.IS_NULLABLE, "NO");

  const revision = await columnInfo("llm_kit_run_checkpoint", "revision");
  assert.ok(revision, "revision 列不存在");
  assert.equal(revision.DATA_TYPE, "bigint", "revision 必须是 BIGINT（单 run 单调 CAS）");
  assert.equal(revision.IS_NULLABLE, "NO");

  const snapshot = await columnInfo("llm_kit_run_checkpoint", "snapshot_json");
  assert.ok(snapshot, "snapshot_json 列不存在");
  assert.equal(snapshot.IS_NULLABLE, "NO", "snapshot_json 必须 NOT NULL");

  const updated = await columnInfo("llm_kit_run_checkpoint", "updated_at");
  assert.ok(updated, "updated_at 列不存在");
  assert.equal(updated.IS_NULLABLE, "NO");

  assert.deepEqual((await indexNames("llm_kit_run_checkpoint")).sort(), ["PRIMARY"]);
});

// ==================== 迁移步骤幂等 ====================

test("建表步骤幂等：第二次跑同一 --step 必须 Skipped 且零 DDL 写入", runWhenCreds, async () => {
  // before() 已真实应用过一次，这里第二次跑同一 --step。
  const second = await applyNewSteps();
  for (const name of ATR_STEPS) {
    assert.ok(
      second.skipped.includes(name),
      `第二次必须 Skipped（already exists），实际 skipped=${JSON.stringify(second.skipped)}`,
    );
    assert.ok(!second.applied.includes(name), `第二次不应再次 Applied：${name}`);
  }
  assert.deepEqual(second.applied, [], "第二次不应有任何步骤被应用");
  assert.deepEqual(second.failed, []);

  // 再自证一次"幂等不是靠漏跑步骤蒙过去"：先 DROP 再跑，必须重新 Applied。
  await dropNewTables();
  const third = await applyNewSteps();
  assert.deepEqual(
    third.applied.filter((name) => ATR_STEPS.includes(name)).sort(),
    [...ATR_STEPS].sort(),
    "DROP 后重跑必须重新 Applied（证明 check 真的在看表是否存在）",
  );
});

test("--dry-run --step 在空库上只把这两步列入 pending 且不执行任何写语句", runWhenCreds, async () => {
  await dropNewTables();
  const statements = [];
  const connection = {
    execute: async (sql, params = []) => {
      statements.push(String(sql).trim());
      return db.sequelize.query(sql, { replacements: params.length ? params : {} });
    },
  };
  const options = parseUpgradeOptions(["--dry-run", "--step", STEP_FILTER]);
  const results = await quiet(() => runMigrationSteps(connection, options));
  assert.deepEqual(
    results.pending.sort(),
    [...ATR_STEPS].sort(),
    `空库上 dry-run 必须把这两步列入 pending，实际=${JSON.stringify(results.pending)}`,
  );
  assert.deepEqual(results.applied, []);
  assert.equal(
    await tableExists("agent_transcript_rounds"),
    false,
    "dry-run 绝不能真建表",
  );
  assert.equal(
    statements.filter((sql) => /^(ALTER|CREATE|UPDATE|INSERT|DROP)\b/i.test(sql)).length,
    0,
    "dry-run 绝不能执行 DDL/DML",
  );
  // 收尾：把表建回来，保持本文件后续/外部状态一致。
  const applied = await applyNewSteps();
  assert.deepEqual(
    applied.applied.filter((name) => ATR_STEPS.includes(name)).sort(),
    [...ATR_STEPS].sort(),
  );
});

// ==================== 双侧一致：init-database.js 也要有新装库基线 ====================

test("scripts/init-database.js 的新装库基线与 upgrade 步骤逐字段一致", runWhenCreds, async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const [initSrc, upgradeSrc] = await Promise.all([
    readFile(path.join(root, "scripts", "init-database.js"), "utf8"),
    readFile(path.join(root, "scripts", "upgrade-database.js"), "utf8"),
  ]);

  const normalize = (sql) =>
    sql
      .replace(/^\s*CREATE TABLE IF NOT EXISTS\s+/i, "")
      .replace(/\s+/g, " ")
      .replace(/,\s*\)/g, ")")
      .trim();

  for (const table of ["agent_transcript_rounds", "llm_kit_run_checkpoint"]) {
    const grab = (src) => {
      const start = src.search(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, "i"));
      assert.ok(start >= 0, `scripts 中缺少 ${table} 的 CREATE TABLE`);
      const open = src.indexOf("(", start);
      let depth = 0;
      for (let i = open; i < src.length; i += 1) {
        if (src[i] === "(") depth += 1;
        else if (src[i] === ")") {
          depth -= 1;
          if (depth === 0) return normalize(src.slice(start, i + 1));
        }
      }
      throw new Error(`${table} 的 CREATE TABLE 括号不闭合`);
    };
    // init-database.js 里出现一次；upgrade-database.js 里出现一次，且两者逐字段相等。
    const initCount = (
      initSrc.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, "gi")) ?? []
    ).length;
    assert.equal(initCount, 1, `init-database.js 里 ${table} 应恰好出现一次，实际 ${initCount}`);
    const upgradeCount = (
      upgradeSrc.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, "gi")) ?? []
    ).length;
    assert.equal(
      upgradeCount,
      1,
      `upgrade-database.js 里 ${table} 应恰好出现一次，实际 ${upgradeCount}`,
    );
    assert.equal(grab(initSrc), grab(upgradeSrc), `${table} 双侧 DDL 不一致`);
  }
});

test("两条新步骤都在 MIGRATIONS 里注册且 check 以表存在为幂等判据", runWhenCreds, async () => {
  const connection = {
    execute: async (sql, params = []) =>
      db.sequelize.query(sql, { replacements: params.length ? params : {} }),
  };
  for (const name of ATR_STEPS) {
    const step = MIGRATIONS.find((migration) => migration.name === name);
    assert.ok(step, `MIGRATIONS 未注册步骤：${name}`);
    assert.equal(await step.check(connection), true, "建好表后 check 必须返回 true（幂等判据）");
  }
  await dropNewTables();
  for (const name of ATR_STEPS) {
    const step = MIGRATIONS.find((migration) => migration.name === name);
    assert.equal(
      await step.check(connection),
      false,
      `DROP 后 check 必须返回 false，否则 --step 重跑会被误判为已完成：${name}`,
    );
  }
  const applied = await applyNewSteps();
  assert.deepEqual(
    applied.applied.filter((name) => ATR_STEPS.includes(name)).sort(),
    [...ATR_STEPS].sort(),
  );
});
