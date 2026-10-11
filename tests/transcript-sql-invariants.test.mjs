/**
 * issue #1156 双层闸门**第①层** —— scripts/check-transcript-sql-invariants.mjs 的用例化
 *
 * 跑在测试库 llm_kit_test（openTestDatabase() 的 #1167 硬断言之前不建任何连接），
 * **自建 fixture、不依赖 dev 库**：语料用真的 store.appendRound() 落库，因此
 * "I5 的期望行数判据"是与写侧同一时刻、同一条路径校对过的——写侧拆行判据漂了
 * （比如哪天 tool_result 也要进 messages），第一条"干净语料全过"的用例就会红。
 *
 * 用例构成：
 *   ① 结构自检：5 条不变式必须都带"抓的是哪一类 bug"的说明（不许刷条数凑数）
 *   ② 干净语料：5 条全过、totals 全 0（= 判据没虚报，也是 I5 判据的防漂桩）
 *   ③-⑦ **有牙证明**：逐条注入违反，证明**每一条都会变红**，且报告点名到
 *      是哪条不变式、哪个 request_id：
 *        I1 删一条 canonical 轮行
 *        I2 插一条 round_id 找不到宿主轮的 chat_tool_calls（#1168 形态）
 *        I3 插一条 dedup_key 重复的 agent_rounds 行（临时摘掉唯一索引，测完装回）
 *        I4 canonical 侧多写一轮（展示面没有）
 *        I5 删一条 messages 行 / 多加一条不该有的 messages 行 / 种子轮被误拆
 *   ⑧ 退出码语义：干净 = 0，注入违反后 = 3（**闸门信号**），报告文件里点名不变式与 request_id
 *   ⑨ 库守卫：DB_NAME 指非测试库且没 ALLOW_NON_TEST_DB=1 → exit 1（连都不许连）
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import logger from "../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

const { openTestDatabase, assertTestDatabase, DEFAULT_CREDS_PATH } = await import("./helpers/test-db-guard.mjs");
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;
const db = dbCtx?.db ?? null;

const { createTouwakaTranscriptStore, CANONICAL_TABLE } = await import(
  "../lib/llm-kit-adapters/transcript-store.js"
);
const { INVARIANTS, runInvariants } = await import("../scripts/check-transcript-sql-invariants.mjs");
const { runMigrationSteps, parseUpgradeOptions } = await import("../scripts/upgrade-database.js");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT_PATH = path.join(ROOT, "scripts/check-transcript-sql-invariants.mjs");
const REPORT_DIR = await mkdtemp(path.join(tmpdir(), "sqlinv-"));

const ns = randomUUID().slice(0, 8);
let userId = "u_sqlinv_1156";
let expertId = null;

if (db) {
  const [user] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  userId = user?.[0]?.id ?? userId;
  const [expert] = await db.sequelize.query("SELECT id FROM experts LIMIT 1");
  expertId = expert?.[0]?.id ?? null;
}

const FIXTURE_PATTERN = `run-1156-sqlinv-${ns}-%`;
const CLEAN_REQUEST = `run-1156-sqlinv-${ns}-clean`;

/** runMigrationSteps 逐行打日志会干扰 node --test 的 IPC 解析：静默掉。 */
async function quiet(fn) {
  const originals = { log: console.log, error: console.error, warn: console.warn };
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, originals);
  }
}

async function tableExists(table) {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table`,
    { replacements: { table } },
  );
  return Number(rows[0].n) > 0;
}

async function columnExists(table, column) {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { replacements: { table, column } },
  );
  return Number(rows[0].n) > 0;
}

async function indexExists(table, index) {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND INDEX_NAME = :index`,
    { replacements: { table, index } },
  );
  return Number(rows[0].n) > 0;
}

async function runStep(step) {
  const connection = {
    execute: async (sql, params = []) =>
      db.sequelize.query(sql, { replacements: params.length ? params : {} }),
  };
  await quiet(() => runMigrationSteps(connection, parseUpgradeOptions(["--step", step])));
}

/** 单独跑本文件时也要有表：缺什么补什么（与 read-mode 测试同款「缺表就补建」）。 */
async function ensureTables() {
  if (!(await tableExists("agent_rounds"))) await runStep("create agent_rounds table");
  if (!(await tableExists("chat_tool_calls"))) await runStep("create chat_tool_calls table");
  if (!(await tableExists(CANONICAL_TABLE))) await runStep("#1156 Stage A");
  if (!(await columnExists("messages", "round_id"))) await runStep("messages.round_id column add");
  if (!(await columnExists("messages", "sequence_no"))) await runStep("messages.sequence_no column add");
  assert.ok(await tableExists("agent_rounds"), "agent_rounds 补建失败");
  assert.ok(await tableExists("chat_tool_calls"), "chat_tool_calls 补建失败");
  assert.ok(await tableExists(CANONICAL_TABLE), `${CANONICAL_TABLE} 补建失败`);
  assert.ok(await columnExists("messages", "round_id"), "messages.round_id 补建失败");
  assert.ok(await columnExists("messages", "sequence_no"), "messages.sequence_no 补建失败");
}

function makeStore() {
  return createTouwakaTranscriptStore({
    db: { sequelize: db.sequelize },
    requestContext: { topic_id: null, user_id: userId, expert_id: expertId },
  });
}

/**
 * 干净语料：一个会话 4 轮 / 5 行轮记录。形状是**按 I5 判据挑的**，不是随手挑的：
 *   seed        round 0 种子轮：appendRound 有意整轮跳过拆行 → 期望 **0** 行 messages
 *   round 1     user 文本 + assistant（reasoning 块 + text 块拼成**同一行**）→ 期望 2 行
 *   round 2     assistant（text + tool_use）→ 1 行 messages + 1 行 chat_tool_calls；
 *               随后那条**纯 tool_result** 的 message 按判据**不产 messages 行**，
 *               只把结果 UPSERT 回同一条 chat_tool_calls（#1168 那条 tool 行的来源）
 *   round 3a/3b 同轮两行（appendUserTurn 预写用户行 vs 引擎轮）：各 1 行 messages
 *   round 4     不产行的三种形状：空 content、只含空串的 text 块、纯 tool_result
 *               —— 判据如果放宽（「有 message 就算一行」）这里立刻虚报
 * 期望 messages 行合计 = 2（round 1）+ 1（round 2）+ 1（round 3a）+ 1（round 3b）+ 0（round 4）= 5。
 */
function corpusRecords(id) {
  const toolUse = { type: "tool_use", id: `tu-${ns}`, name: "read_file", input: { path: "/tmp/a.txt" } };
  return [
    {
      round: 0,
      dedupKey: `${id}:seed`,
      ts: "2026-11-01T00:00:00.000Z",
      messages: [
        { role: "system", content: [{ type: "text", text: "初始上下文" }] },
        { role: "assistant", content: [{ type: "text", text: "历史回答" }] },
      ],
      folded: false,
    },
    {
      round: 1,
      roundKey: `${id}:engine:round:1`,
      dedupKey: `${id}:engine:round:1`,
      ts: "2026-11-01T00:00:01.000Z",
      messages: [
        { role: "user", content: [{ type: "text", text: "第一问" }] },
        { role: "assistant", content: [{ type: "reasoning", text: "先想一下" }, { type: "text", text: "再回答" }] },
      ],
      response: { content: [{ type: "text", text: "再回答" }], stopReason: "end_turn" },
      folded: false,
    },
    {
      round: 2,
      roundKey: `${id}:engine:round:2`,
      dedupKey: `${id}:engine:round:2`,
      ts: "2026-11-01T00:00:02.000Z",
      messages: [
        { role: "assistant", content: [{ type: "text", text: "我读一下" }, toolUse] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "文件内容", is_error: false }] },
      ],
      response: { content: [{ type: "text", text: "我读一下" }, toolUse], stopReason: "tool_use" },
      folded: false,
    },
    {
      round: 3,
      roundKey: `${id}:user:round:3`,
      dedupKey: `${id}:user:round:3`,
      ts: "2026-11-01T00:00:03.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "同轮预写的用户行" }] }],
      folded: false,
    },
    {
      round: 3,
      roundKey: `${id}:engine:round:3`,
      dedupKey: `${id}:engine:round:3`,
      ts: "2026-11-01T00:00:04.000Z",
      messages: [{ role: "assistant", content: [{ type: "text", text: "同轮的引擎轮" }] }],
      response: { content: [{ type: "text", text: "同轮的引擎轮" }], stopReason: "end_turn" },
      folded: false,
    },
    {
      round: 4,
      roundKey: `${id}:engine:round:4`,
      dedupKey: `${id}:engine:round:4`,
      ts: "2026-11-01T00:00:05.000Z",
      messages: [
        { role: "user", content: [] },
        { role: "assistant", content: [{ type: "text", text: "" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: `tu-absent-${ns}`, content: "x", is_error: false }] },
      ],
      folded: false,
    },
  ];
}

async function seedFixture(id) {
  const store = makeStore();
  for (const record of corpusRecords(id)) await store.appendRound(id, record);
  return id;
}

async function deleteFixture(id) {
  const [roundRows] = await db.sequelize.query(
    "SELECT id FROM agent_rounds WHERE request_id = :rid",
    { replacements: { rid: id } },
  );
  const roundIds = roundRows.map((row) => row.id);
  if (roundIds.length > 0) {
    await db.sequelize.query("DELETE FROM messages WHERE round_id IN (:ids)", { replacements: { ids: roundIds } });
    await db.sequelize.query("DELETE FROM chat_tool_calls WHERE round_id IN (:ids)", { replacements: { ids: roundIds } });
  }
  await db.sequelize.query("DELETE FROM chat_tool_calls WHERE request_id = :rid", { replacements: { rid: id } });
  await db.sequelize.query("DELETE FROM messages WHERE request_id = :rid", { replacements: { rid: id } });
  await db.sequelize.query("DELETE FROM agent_rounds WHERE request_id = :rid", { replacements: { rid: id } });
  await db.sequelize.query(`DELETE FROM \`${CANONICAL_TABLE}\` WHERE request_id = :rid`, { replacements: { rid: id } });
}

async function cleanupAll() {
  if (!db) return;
  assertTestDatabase(creds.database, { env: process.env });
  const collect = async (sql) => (await db.sequelize.query(sql, { replacements: { pattern: FIXTURE_PATTERN } }))[0]
    .map((row) => row.rid);
  const ids = new Set([
    ...await collect("SELECT DISTINCT request_id AS rid FROM agent_rounds WHERE request_id LIKE :pattern"),
    ...await collect(`SELECT DISTINCT request_id AS rid FROM \`${CANONICAL_TABLE}\` WHERE request_id LIKE :pattern`),
    ...await collect("SELECT DISTINCT request_id AS rid FROM chat_tool_calls WHERE request_id LIKE :pattern"),
  ]);
  for (const id of ids) await deleteFixture(id);
}

/** 跑不变式并把结果按 key 索引，方便「哪条红了」写成断言而不是翻 JSON。 */
async function check(requestId) {
  const outcome = await runInvariants(db.sequelize, { requestIds: [requestId] });
  const byKey = new Map(outcome.invariants.map((item) => [item.key, item]));
  return { outcome, byKey };
}

function assertRed(byKey, key, requestId, label) {
  const item = byKey.get(key);
  assert.ok(item, `${label}: 报告里没有 ${key} 这条不变式`);
  assert.equal(item.pass, false, `${label}: ${key} 应当变红，实际 pass=true`);
  assert.ok(item.violation_count > 0, `${label}: ${key} violation_count 应 > 0`);
  const named = item.violations.some((violation) => violation.request_id === requestId);
  assert.ok(
    named,
    `${label}: ${key} 的报告必须点名 request_id=${requestId}，实际=${JSON.stringify(item.violations)}`,
  );
}

function assertGreen(byKey, key, label) {
  const item = byKey.get(key);
  assert.ok(item, `${label}: 报告里没有 ${key} 这条不变式`);
  assert.equal(item.pass, true, `${label}: ${key} 不该被牵连变红：${JSON.stringify(item.violations)}`);
}

function runScript(args, env) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

if (!creds) {
  test("SQL 不变式闸门", { skip: `缺少凭据 ${CREDS_PATH}` }, () => {});
} else {
  await ensureTables();

  after(async () => {
    try {
      await cleanupAll();
    } finally {
      await db.close();
      await rm(REPORT_DIR, { recursive: true, force: true });
    }
  });

  test("不变式清单：5 条，每条都必须写清「抓的是哪一类 bug」", () => {
    assert.deepEqual(
      INVARIANTS.map((item) => item.key),
      ["round_coverage", "orphan_tool_calls", "dedup_key_unique", "max_round_equal", "message_row_count"],
      "第①层的不变式清单（增删要同时改本用例与注释）",
    );
    for (const item of INVARIANTS) {
      assert.ok(item.id && item.title, `${item.key} 缺 id/title`);
      assert.ok(
        typeof item.catches === "string" && item.catches.length >= 40,
        `${item.key} 没写清抓的是哪一类 bug（写不出来就不该有这条）`,
      );
    }
  });

  test("干净语料：5 条不变式全过（I5 判据与写侧同一时刻校对）", async () => {
    const id = await seedFixture(CLEAN_REQUEST);
    const messages = await db.sequelize.query(
      "SELECT COUNT(*) AS n FROM messages WHERE request_id = :rid",
      { replacements: { rid: id } },
    );
    assert.equal(Number(messages[0][0].n), 5, "fixture 应落 5 行 messages（判据的基准数）");
    const tools = await db.sequelize.query(
      "SELECT COUNT(*) AS n FROM chat_tool_calls WHERE request_id = :rid",
      { replacements: { rid: id } },
    );
    assert.equal(Number(tools[0][0].n), 2, "fixture 应落 2 行 chat_tool_calls（tool_use+tool_result 合一、外加 round 4 那条先到 tool_result 的）");

    const { outcome, byKey } = await check(id);
    for (const item of outcome.invariants) {
      assert.equal(item.pass, true, `${item.key} 干净语料不该红：${JSON.stringify(item.violations)}`);
    }
    assert.equal(outcome.totals.invariants_checked, 5);
    assert.equal(outcome.totals.invariants_violated, 0);
    assert.equal(outcome.totals.violations_total, 0);
    assert.ok(byKey.size === 5);
  });

  test("I1 轮覆盖：删一条 canonical 轮行 → 只有 I1 红，且点名 request_id 与轮号", async () => {
    const id = `run-1156-sqlinv-${ns}-i1`;
    await seedFixture(id);
    try {
      // 删种子轮的 canonical 行：I2/I3/I4/I5 都不该被牵连（轮号不是最大轮、messages 行没动），
      // 这样"红的是 I1"这件事才是被证明的，而不是被连带出来的。
      await db.sequelize.query(
        `DELETE FROM \`${CANONICAL_TABLE}\` WHERE request_id = :rid AND round_no = 0`,
        { replacements: { rid: id } },
      );
      const { byKey } = await check(id);
      assertRed(byKey, "round_coverage", id, "删 canonical 种子轮");
      const violation = byKey.get("round_coverage").violations[0];
      assert.equal(violation.round_no, 0, "I1 明细要给出缺的轮号");
      assert.ok(violation.dedup_keys.includes(`${id}:seed`), "I1 明细要给出展示面那行的 dedup_key");
      assertGreen(byKey, "orphan_tool_calls", "删 canonical 种子轮");
      assertGreen(byKey, "dedup_key_unique", "删 canonical 种子轮");
      assertGreen(byKey, "max_round_equal", "删 canonical 种子轮");
      assertGreen(byKey, "message_row_count", "删 canonical 种子轮");
    } finally {
      await deleteFixture(id);
    }
  });

  test("I2 孤儿工具调用：round_id 找不到宿主轮 → 只有 I2 红（#1168 形态）", async () => {
    const id = `run-1156-sqlinv-${ns}-i2`;
    const hostId = `run-1156-sqlinv-${ns}-i2host`;
    await seedFixture(id);
    await seedFixture(hostId);
    try {
      await db.sequelize.query(`
        INSERT INTO chat_tool_calls
          (tool_use_id, request_id, round_id, name, input_json, result_json, is_error, duration_ms, created_at)
        VALUES
          (:toolUseId, :rid, :roundId, 'write_file', NULL, NULL, b'0', NULL, NOW())
      `, { replacements: { toolUseId: `tu-orphan-${ns}`, rid: id, roundId: `round-absent-${ns}` } });
      const { byKey } = await check(id);
      assertRed(byKey, "orphan_tool_calls", id, "插孤儿 tool 行");
      const violation = byKey.get("orphan_tool_calls").violations[0];
      assert.equal(violation.tool_use_id, `tu-orphan-${ns}`, "I2 明细要点名 tool_use_id");
      assert.equal(violation.round_id, `round-absent-${ns}`, "I2 明细要给出找不到的 round_id");
      assertGreen(byKey, "round_coverage", "插孤儿 tool 行");
      assertGreen(byKey, "dedup_key_unique", "插孤儿 tool 行");
      assertGreen(byKey, "max_round_equal", "插孤儿 tool 行");
      assertGreen(byKey, "message_row_count", "插孤儿 tool 行");

      // 另一半判据：宿主轮存在但属于别的 request，同样算孤儿（那种行 load() 也取不回来）
      await db.sequelize.query(
        "UPDATE chat_tool_calls SET round_id = (SELECT id FROM agent_rounds WHERE request_id = :other LIMIT 1) WHERE tool_use_id = :toolUseId",
        { replacements: { other: hostId, toolUseId: `tu-orphan-${ns}` } },
      );
      const cross = await check(id);
      assertRed(cross.byKey, "orphan_tool_calls", id, "tool 行挂到别的会话的轮");
    } finally {
      await db.sequelize.query("DELETE FROM chat_tool_calls WHERE tool_use_id = :toolUseId", {
        replacements: { toolUseId: `tu-orphan-${ns}` },
      });
      await deleteFixture(id);
      await deleteFixture(hostId);
    }
  });

  test("I3 dedup_key 唯一性：两张轮表各插一条重复 dedup_key → I3 红并点名表名", async () => {
    const id = `run-1156-sqlinv-${ns}-i3`;
    await seedFixture(id);
    const dedupKey = `${id}:engine:round:1`;
    const indexName = "uk_agent_rounds_dedup_key";
    const hadIndex = await indexExists("agent_rounds", indexName);
    try {
      // 唯一索引在不在是「这个库到底有没有那道护栏」的运行时事实：不在就直接插，
      // 在就临时摘掉（模拟升级步骤没跑全 / 存量脏行），测完装回。
      if (hadIndex) await quiet(() => db.sequelize.query(`ALTER TABLE agent_rounds DROP INDEX \`${indexName}\``));
      await db.sequelize.query(`
        INSERT INTO agent_rounds
          (id, request_id, round_no, dedup_key, stop_reason, folded, record_json, ts, created_at)
        VALUES
          (:dupId, :rid, 1, :dedupKey, 'end_turn', b'0', NULL, '2026-11-01T00:00:01.000Z', NOW())
      `, { replacements: { dupId: `round-dup-${ns}`, rid: id, dedupKey } });
      const { byKey } = await check(id);
      assertRed(byKey, "dedup_key_unique", id, "插重复 dedup_key");
      const violation = byKey.get("dedup_key_unique").violations.find((item) => item.dedup_key === dedupKey);
      assert.ok(violation, `I3 明细要点名 dedup_key=${dedupKey}`);
      assert.equal(violation.table, "agent_rounds", "I3 明细要说明是哪张表重复");
      assert.equal(violation.copies, 2);
      assert.ok(violation.round_ids.includes(`round-dup-${ns}`), "I3 明细要给出重复行的 id");
      assertGreen(byKey, "round_coverage", "插重复 dedup_key");
      assertGreen(byKey, "max_round_equal", "插重复 dedup_key");
      assertGreen(byKey, "message_row_count", "插重复 dedup_key");
    } finally {
      await db.sequelize.query("DELETE FROM agent_rounds WHERE id = :dupId", { replacements: { dupId: `round-dup-${ns}` } });
      if (hadIndex && !(await indexExists("agent_rounds", indexName))) {
        await quiet(() => db.sequelize.query(
          `ALTER TABLE agent_rounds ADD UNIQUE KEY \`${indexName}\` (dedup_key)`,
        ));
      }
    }
    // canonical 表同样要查：摘掉自己的唯一索引再插一条重复 dedup_key
    const canonicalIndex = "uk_atr_dedup_key";
    const hadCanonicalIndex = await indexExists(CANONICAL_TABLE, canonicalIndex);
    try {
      if (hadCanonicalIndex) await quiet(() => db.sequelize.query(`ALTER TABLE \`${CANONICAL_TABLE}\` DROP INDEX \`${canonicalIndex}\``));
      await db.sequelize.query(`
        INSERT INTO \`${CANONICAL_TABLE}\` (id, request_id, round_no, dedup_key, record_json, created_at)
        VALUES (:dupId, :rid, 1, :dedupKey, :recordJson, NOW())
      `, {
        replacements: {
          dupId: `atr-dup-${ns}`,
          rid: id,
          dedupKey,
          recordJson: JSON.stringify({ round: 1, messages: [], dedupKey }),
        },
      });
      const { byKey } = await check(id);
      assertRed(byKey, "dedup_key_unique", id, "canonical 侧插重复 dedup_key");
      assert.ok(
        byKey.get("dedup_key_unique").violations.some((item) => item.table === CANONICAL_TABLE),
        "I3 必须也查 canonical 表",
      );
    } finally {
      await db.sequelize.query(`DELETE FROM \`${CANONICAL_TABLE}\` WHERE id = :dupId`, { replacements: { dupId: `atr-dup-${ns}` } });
      if (hadCanonicalIndex && !(await indexExists(CANONICAL_TABLE, canonicalIndex))) {
        await quiet(() => db.sequelize.query(
          `ALTER TABLE \`${CANONICAL_TABLE}\` ADD UNIQUE KEY \`${canonicalIndex}\` (dedup_key)`,
        ));
      }
    }
    assert.ok(await indexExists("agent_rounds", "uk_agent_rounds_dedup_key"), "唯一索引必须装回");
    assert.ok(await indexExists(CANONICAL_TABLE, "uk_atr_dedup_key"), "canonical 唯一索引必须装回");
    await deleteFixture(id);
  });

  test("I4 MAX(round_no)：canonical 侧多写一轮 → 只有 I4 红并给出两侧最大轮号", async () => {
    const id = `run-1156-sqlinv-${ns}-i4`;
    await seedFixture(id);
    const dedupKey = `${id}:engine:round:9`;
    try {
      // messages 留空：期望行数 0，免得把 I5 一起牵连红，证明「红的是 I4」而不是连片红
      await db.sequelize.query(`
        INSERT INTO \`${CANONICAL_TABLE}\` (id, request_id, round_no, dedup_key, record_json, created_at)
        VALUES (:id, :rid, 9, :dedupKey, :recordJson, NOW())
      `, {
        replacements: {
          id: `atr-extra-${ns}`,
          rid: id,
          dedupKey,
          recordJson: JSON.stringify({ round: 9, messages: [], dedupKey }),
        },
      });
      const { byKey } = await check(id);
      assertRed(byKey, "max_round_equal", id, "canonical 多一轮");
      const violation = byKey.get("max_round_equal").violations[0];
      assert.equal(violation.canonical_max_round_no, 9);
      assert.equal(violation.display_max_round_no, 4, "展示面最大轮号仍是 4");
      assertGreen(byKey, "round_coverage", "canonical 多一轮");
      assertGreen(byKey, "message_row_count", "canonical 多一轮");

      // 另一头：整个会话只有一张表有行，也必须被 I4 抓到（I1 的包含方向管不到这个）
      await db.sequelize.query(`DELETE FROM \`${CANONICAL_TABLE}\` WHERE request_id = :rid`, { replacements: { rid: id } });
      const onlyDisplay = await check(id);
      assertRed(onlyDisplay.byKey, "max_round_equal", id, "canonical 整会话 0 行");
      assert.ok(
        onlyDisplay.byKey.get("max_round_equal").violations[0].detail.includes("canonical"),
        "一侧 0 行时明细要说明是哪一侧",
      );
    } finally {
      await deleteFixture(id);
    }
  });

  test("I5 messages 行数：少一行 / 多一行 / 种子轮被误拆 → 都红且给期望与实际", async () => {
    const id = `run-1156-sqlinv-${ns}-i5`;
    await seedFixture(id);
    try {
      const [rows] = await db.sequelize.query(
        "SELECT id, round_id FROM messages WHERE request_id = :rid ORDER BY round_id ASC, sequence_no ASC",
        { replacements: { rid: id } },
      );
      assert.equal(rows.length, 5);

      // (a) 删一行（= 拆行半失败 / 展示面漏写）
      await db.sequelize.query("DELETE FROM messages WHERE id = :id", { replacements: { id: rows[0].id } });
      const missing = await check(id);
      assertRed(missing.byKey, "message_row_count", id, "删一条 messages 行");
      const missingViolation = missing.byKey.get("message_row_count").violations[0];
      assert.equal(missingViolation.expected_messages_rows, 5);
      assert.equal(missingViolation.actual_messages_rows, 4);
      assert.equal(missingViolation.rounds[0].expected_messages_rows, 2, "I5 要定位到具体轮");
      assert.equal(missing.byKey.get("round_coverage").pass, true, "只动 messages 不该牵连 I1");
      assert.equal(missing.byKey.get("max_round_equal").pass, true, "只动 messages 不该牵连 I4");

      // (b) 补回来再加一条不该有的（= 写重 / 不该产行的 message 被拆了行）
      await seedFixture(id);
      const round1 = (await db.sequelize.query(
        "SELECT id FROM agent_rounds WHERE request_id = :rid AND round_no = 1",
        { replacements: { rid: id } },
      ))[0][0].id;
      await db.sequelize.query(`
        INSERT INTO messages (id, request_id, user_id, role, content, round_id, sequence_no, created_at)
        VALUES (:id, :rid, :userId, 'assistant', '多出来的一条', :roundId, 99, NOW())
      `, { replacements: { id: `msg-extra-${ns}`, rid: id, userId, roundId: round1 } });
      const extra = await check(id);
      assertRed(extra.byKey, "message_row_count", id, "加一条不该有的 messages 行");
      assert.equal(extra.byKey.get("message_row_count").violations[0].actual_messages_rows, 6);
      assert.equal(extra.byKey.get("message_row_count").violations[0].expected_messages_rows, 5);

      // (c) 种子轮被误拆：round_no=0 不该有 messages 行（写侧整轮跳过拆行）
      await db.sequelize.query("DELETE FROM messages WHERE id = :id", { replacements: { id: `msg-extra-${ns}` } });
      const seedRound = (await db.sequelize.query(
        "SELECT id FROM agent_rounds WHERE request_id = :rid AND round_no = 0",
        { replacements: { rid: id } },
      ))[0][0].id;
      await db.sequelize.query(`
        INSERT INTO messages (id, request_id, user_id, role, content, round_id, sequence_no, created_at)
        VALUES (:id, :rid, :userId, 'assistant', '种子轮被误拆', :roundId, 7, NOW())
      `, { replacements: { id: `msg-seed-${ns}`, rid: id, userId, roundId: seedRound } });
      const seed = await check(id);
      assertRed(seed.byKey, "message_row_count", id, "种子轮被误拆");
      assert.ok(
        JSON.stringify(seed.byKey.get("message_row_count").violations).includes("种子轮"),
        "I5 明细要说明这是种子轮被误拆",
      );
    } finally {
      await db.sequelize.query("DELETE FROM messages WHERE id IN (:ids)", {
        replacements: { ids: [`msg-extra-${ns}`, `msg-seed-${ns}`] },
      });
      await deleteFixture(id);
    }
  });

  test("退出码语义：干净 0 / 注入违反 3，报告文件点名不变式与 request_id", async () => {
    const id = `run-1156-sqlinv-${ns}-exit`;
    const cleanReport = path.join(REPORT_DIR, "clean.json");
    const dirtyReport = path.join(REPORT_DIR, "dirty.json");
    const env = {
      ...process.env,
      DB_HOST: String(creds.host ?? "localhost"),
      DB_PORT: String(creds.port ?? 3306),
      DB_USER: creds.user,
      DB_PASSWORD: creds.password,
      DB_NAME: creds.database,
      ALLOW_NON_TEST_DB: "",
    };
    await seedFixture(id);
    try {
      const clean = runScript(["--request-id", id, "--report", cleanReport], env);
      assert.ifError(clean.error);
      assert.equal(clean.status, 0, `干净语料应 exit=0\nstdout:\n${clean.stdout}\nstderr:\n${clean.stderr}`);
      assert.match(clean.stdout, /\[PASS\] I1 round_coverage/);
      assert.match(clean.stdout, /\[PASS\] I5 message_row_count/);
      assert.match(clean.stdout, /违反 0 条/);

      await db.sequelize.query(`
        INSERT INTO chat_tool_calls
          (tool_use_id, request_id, round_id, name, input_json, result_json, is_error, duration_ms, created_at)
        VALUES
          (:toolUseId, :rid, :roundId, 'exec', NULL, NULL, b'0', NULL, NOW())
      `, { replacements: { toolUseId: `tu-exit-${ns}`, rid: id, roundId: `round-absent-exit-${ns}` } });

      const dirty = runScript(["--request-id", id, "--report", dirtyReport], env);
      assert.equal(dirty.status, 3, `注入违反应 exit=3（闸门信号）\nstdout:\n${dirty.stdout}\nstderr:\n${dirty.stderr}`);
      assert.equal(dirty.signal, null, "不许被信号杀掉（stdout 不接 head）");
      assert.match(dirty.stdout, /\[FAIL\] I2 orphan_tool_calls/);
      assert.match(dirty.stdout, new RegExp(id));

      const report = JSON.parse(await readFile(dirtyReport, "utf8"));
      assert.equal(report.exit_code, 3);
      assert.equal(report.database, creds.database);
      assert.equal(report.totals.invariants_checked, 5);
      assert.equal(report.totals.invariants_violated, 1);
      const violated = report.invariants.filter((item) => !item.pass);
      assert.deepEqual(violated.map((item) => item.key), ["orphan_tool_calls"]);
      assert.equal(violated[0].violations[0].request_id, id, "报告必须点名是哪个 request_id");
      assert.ok(violated[0].catches.includes("#1168"), "报告要带上这条不变式抓的是哪类 bug");
    } finally {
      await db.sequelize.query("DELETE FROM chat_tool_calls WHERE tool_use_id = :toolUseId", {
        replacements: { toolUseId: `tu-exit-${ns}` },
      });
      await deleteFixture(id);
    }
  });

  test("库守卫：DB_NAME 指非测试库且没 ALLOW_NON_TEST_DB=1 → exit 1（连都不许连）", () => {
    const env = {
      ...process.env,
      DB_HOST: String(creds.host ?? "localhost"),
      DB_PORT: String(creds.port ?? 3306),
      DB_USER: creds.user,
      DB_PASSWORD: creds.password,
      DB_NAME: "touwaka_mate",
    };
    delete env.ALLOW_NON_TEST_DB;
    const blocked = runScript(["--report", path.join(REPORT_DIR, "blocked.json")], env);
    assert.equal(blocked.status, 1, `被守卫拦下应 exit=1\nstdout:\n${blocked.stdout}\nstderr:\n${blocked.stderr}`);
    assert.match(`${blocked.stdout}${blocked.stderr}`, /非测试库/);
  });
}
