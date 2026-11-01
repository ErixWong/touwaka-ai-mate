/**
 * issue #1227 阶段 3 切片 C1 —— 投影可重建对账器 + 孤儿检测（真实 MariaDB 测试库 `llm_kit_test`）
 *
 * 覆盖目标（逐类断言，**不允许**“至少报出一条”这种糊弄）：
 *   0. 干净的 0.23 形状 fixture（载体 + 消息行 + **分片行 `partOf`**）⇒ 对账 0 差异、孤儿 0 条；
 *   1. 人为制造每一类差异，断言对账器**每一类都报得出且报得准**（分类计数 + 命中行 key + 期望/实际值）：
 *      - 删一条 `messages` 行            → `missing_message_row`
 *      - 多插一条未被吸附的 `messages` 行 → `unexpected_message_row`
 *      - 改分片 `partOf`                 → `part_of_mismatch`（+ 必然伴随的 `record_json_mismatch`）
 *      - 造一条孤儿 `chat_tool_calls`     → `orphan_tool_row`（孤儿检测段）
 *      - 把工具行 `result_json` 置 NULL   → `tool_result_missing`（对账 + 孤儿检测两处都报）
 *      - 删一条工具行                     → `missing_tool_row`
 *      - 改一条消息正文                   → `content_mismatch`
 *      - 删一条载体行 / 多插一条载体行     → `missing_carrier` / `extra_carrier`
 *      #1227 阶段 3 切片 C2 补齐 R4 的 5 格（**精确计数 + 命中 key**，不许“至少报一条”）：
 *      - 删一条消息行（`kind='message'`）  → `missing_round_row`
 *      - 多插一条消息行                   → `extra_round_row`
 *      - 改消息行 `seq`                   → `seq_mismatch`（+ 必然的 `record_json_mismatch`）
 *      - 多插一条工具行                   → `extra_tool_row`
 *      - 改工具行 `result_json`           → `tool_result_mismatch`
 *   2. **dry-run 只读自证**：用「遇到写 SQL 就抛」的 sequelize 代理跑完整个 dry-run 分支；
 *      另加静态断言：写 SQL 只出现在 `applyProjectionWrites()`（写入口）之后。
 *   3. `--apply` 库名判据：`touwaka_mate` 一律拒绝（exit code 语义由 `ERR_PROJECTION_APPLY_FORBIDDEN` 表达），
 *      测试库放行；库名为空也拒绝。
 *   4. `--apply` 幂等：删一行 messages + 一行工具行 → 第一次补齐（written > 0、差异归零），
 *      第二次 written 全 0、差异仍为 0。
 *   5. 宿主增强 reasoning（终稿单写把 reasoning 换成整个 run 的累积推理）归类为
 *      `host_enriched_reasoning`（非缺陷），且 `--apply` **不回写**它。
 *   6. #1227 阶段 3 切片 C2b 存量漂移回填：
 *      - `assertDriftBackfillAllowed` 纯函数：生产库缺 `ALLOW_NON_TEST_DB=1` 一律拒写；
 *      - `--fix-is-error` 三格方向（A=canonical真&列0 / B=两边真 / C=列真&canonical非真）：
 *        只改 A 格；**C 格列已 1 的行绝不翻回 0**；第二次写 0 行；
 *      - `--rewrite-record-json` 结果与 `buildAgentRoundRecordSnapshot` **逐字节相等**，且幂等；
 *      - 两个开关的**计划阶段**（dry-run 路径）同样零写 SQL。
 *
 * 依赖顺序（勿删）：`tests/llm-kit-adapters/transcript-rounds-ddl.test.mjs` 会 DROP 这几张表；
 * `npm run test:llm-kit` 用 `--test-concurrency=1` 串行跑文件且本文件排在其后，before() 另外做
 * 「缺表就补建」，单独跑本文件也不会因为缺表而假绿。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 */

import { test, after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// logs/ 目录可能非本用户属主：屏蔽文件写入，别让日志权限错误掩盖数据库结果。
import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

const { openTestDatabase, DEFAULT_CREDS_PATH } = await import("../helpers/test-db-guard.mjs");
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;

// upgrade-database.js 在建模块时就读 DB_*，因此凭据必须先于 import 落地。
if (creds) {
  process.env.DB_HOST = String(creds.host ?? "localhost");
  process.env.DB_PORT = String(creds.port ?? 3306);
  process.env.DB_USER = creds.user;
  process.env.DB_PASSWORD = creds.password;
  process.env.DB_NAME = creds.database;
}

const {
  PRODUCTION_DATABASE_NAME,
  DRIFT_BACKFILL_ALLOW_ENV_VAR,
  applyCanonicalRecordRewrites,
  applyRecordJsonRewrites,
  assertDriftBackfillAllowed,
  assertProjectionApplyAllowed,
  bitToBoolean,
  clearToolErrorBlocks,
  collectBaselineStats,
  collectFoldedDirections,
  collectToolErrorDirections,
  deriveCanonicalFoldShape,
  detectOrphans,
  explainReconcileQueries,
  loadCanonicalRows,
  loadCarrierOnlyRounds,
  planCanonicalCleanups,
  planRecordJsonRewrites,
  probeLegacyVsCarrierOnly,
  projectRequest,
  reconcileRequest,
  summarizeFoldedDirections,
  summarizeToolErrorDirections,
} = await import("../../lib/llm-kit-adapters/transcript-projection.js");
const {
  buildAgentRoundRecordSnapshot,
  createTouwakaTranscriptStore,
  CANONICAL_TABLE,
} = await import("../../lib/llm-kit-adapters/transcript-store.js");
const { runMigrationSteps, parseUpgradeOptions } = await import("../../scripts/upgrade-database.js");

const db = dbCtx?.db ?? null;

/**
 * 通道 B：与 `scripts/*` 的 `DB_*` 直连同形状的连接——**不带** `dialectOptions.typeCast`，
 * `BIT(1)` 列原样返回 `Buffer`（正是 2026-10-09 回填事故的连接形态）。凭据已过
 * `openTestDatabase()` 的 #1167 硬断言（同一个 creds 对象，不会指向别的库）。
 */
let rawSequelize = null;
if (creds) {
  const { Sequelize } = await import("sequelize");
  rawSequelize = new Sequelize(creds.database, creds.user, creds.password, {
    host: creds.host ?? "localhost",
    port: Number(creds.port ?? 3306),
    dialect: "mysql",
    logging: false,
  });
  await rawSequelize.authenticate();
}
const ns = randomUUID().slice(0, 8);
const REQUEST_PREFIX = `run-c1-${ns}-`;

let userId = "u_c1_projection";
let expertId = null;
const requestContext = () => ({ topic_id: null, user_id: userId, expert_id: expertId });

function runId(label) {
  return `${REQUEST_PREFIX}${label}`;
}

const MODULE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../lib/llm-kit-adapters/transcript-projection.js",
);

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

/** 缺表就补建（走现成建表步骤，不自己抄一份 DDL）。 */
async function ensureTables() {
  const missing = [];
  for (const table of [CANONICAL_TABLE, "agent_rounds", "messages", "chat_tool_calls"]) {
    if (!(await tableExists(table))) missing.push(table);
  }
  if (missing.length === 0) return;
  const connection = {
    execute: async (sql, params = []) =>
      db.sequelize.query(sql, { replacements: params.length ? params : {} }),
  };
  await quiet(() => runMigrationSteps(connection, parseUpgradeOptions([])));
  for (const table of missing) {
    assert.ok(await tableExists(table), `${table} 补建失败`);
  }
}

async function cleanupRequest(id) {
  const [rounds] = await db.sequelize.query(
    "SELECT id FROM agent_rounds WHERE request_id = :id",
    { replacements: { id } },
  );
  const roundIds = rounds.map((row) => row.id);
  if (roundIds.length > 0) {
    await db.sequelize.query("DELETE FROM messages WHERE round_id IN (:roundIds)", {
      replacements: { roundIds },
    });
    await db.sequelize.query("DELETE FROM chat_tool_calls WHERE round_id IN (:roundIds)", {
      replacements: { roundIds },
    });
  }
  await db.sequelize.query("DELETE FROM messages WHERE request_id = :id", { replacements: { id } });
  await db.sequelize.query("DELETE FROM chat_tool_calls WHERE request_id = :id", { replacements: { id } });
  await db.sequelize.query(`DELETE FROM ${CANONICAL_TABLE} WHERE request_id = :id`, { replacements: { id } });
  await db.sequelize.query("DELETE FROM agent_rounds WHERE request_id = :id", { replacements: { id } });
}

async function cleanupAll() {
  if (!db) return;
  const [rows] = await db.sequelize.query(
    "SELECT DISTINCT request_id AS rid FROM agent_rounds WHERE request_id LIKE :pattern",
    { replacements: { pattern: `${REQUEST_PREFIX}%` } },
  );
  for (const row of rows) await cleanupRequest(row.rid);
  const [canonicalOnly] = await db.sequelize.query(
    `SELECT DISTINCT request_id AS rid FROM ${CANONICAL_TABLE} WHERE request_id LIKE :pattern`,
    { replacements: { pattern: `${REQUEST_PREFIX}%` } },
  );
  for (const row of canonicalOnly) await cleanupRequest(row.rid);
}

/**
 * 0.23 形状 fixture：**载体 + 消息行 + 分片行**（引擎 0.23 的真实落盘形状）。
 *
 * round 1（工具轮）：
 *   carrier      `:engine:round:1`（无 messages，只有 response/元数据）
 *   message seq0 `:msg:1:0` assistant [reasoning, tool_use t1, tool_use t2]
 *   message seq1 `:msg:1:1` user [tool_result t1]
 *   shard   seq2 `:msg:1:2` user [tool_result t2]，`partOf = :msg:1:1`（同一条逻辑 user 消息的第二片）
 * round 2（终稿轮）：
 *   carrier      `:engine:round:2`
 *   message seq0 `:msg:2:0` assistant [reasoning, text]
 * round 0：种子载体（record_json 自带 messages，写侧不拆行）
 */
function fixtureRecords(id) {
  const roundKey = (round) => `${id}:round:${round}`;
  const tool1 = `tool-1-${ns}`;
  const tool2 = `tool-2-${ns}`;
  return {
    tool1,
    tool2,
    records: [
      {
        round: 0,
        roundKey: roundKey(0),
        dedupKey: `${id}:engine:round:0:seed`,
        ts: "2026-11-01T00:00:00.000Z",
        messages: [{ role: "system", content: [{ type: "text", text: "seed context" }] }],
      },
      {
        round: 1,
        roundKey: roundKey(1),
        dedupKey: `${id}:engine:round:1`,
        ts: "2026-11-01T00:00:01.000Z",
        response: { stopReason: "tool_use", usage: { input_tokens: 10, output_tokens: 2 } },
        textPreview: "",
        toolUses: 2,
      },
      {
        round: 1,
        roundKey: roundKey(1),
        dedupKey: `${id}:msg:1:0`,
        kind: "message",
        seq: 0,
        ts: "2026-11-01T00:00:01.100Z",
        messages: [{
          role: "assistant",
          content: [
            { type: "reasoning", text: "need two tools" },
            { type: "tool_use", id: tool1, name: "list", input: { path: "." } },
            { type: "tool_use", id: tool2, name: "read", input: { path: "a.txt" } },
          ],
        }],
      },
      {
        round: 1,
        roundKey: roundKey(1),
        dedupKey: `${id}:msg:1:1`,
        kind: "message",
        seq: 1,
        ts: "2026-11-01T00:00:01.200Z",
        messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: tool1, content: "ok-1" }] }],
      },
      {
        round: 1,
        roundKey: roundKey(1),
        dedupKey: `${id}:msg:1:2`,
        kind: "message",
        seq: 2,
        partOf: `${id}:msg:1:1`,
        ts: "2026-11-01T00:00:01.300Z",
        messages: [{
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: tool2,
            content: "boom",
            is_error: true,
            erix: { durationMs: 12 },
          }],
        }],
      },
      {
        round: 2,
        roundKey: roundKey(2),
        dedupKey: `${id}:engine:round:2`,
        ts: "2026-11-01T00:00:02.000Z",
        response: { stopReason: "end_turn", usage: { input_tokens: 20, output_tokens: 5 } },
        textPreview: "done",
      },
      {
        round: 2,
        roundKey: roundKey(2),
        dedupKey: `${id}:msg:2:0`,
        kind: "message",
        seq: 0,
        ts: "2026-11-01T00:00:02.100Z",
        messages: [{
          role: "assistant",
          content: [
            { type: "reasoning", text: "final answer" },
            { type: "text", text: "all done" },
          ],
        }],
      },
    ],
  };
}

/** 建一个新 fixture 并返回它的 id / 关键 key / tool id。 */
async function freshFixture(label) {
  const id = runId(label);
  await cleanupRequest(id);
  const fixture = fixtureRecords(id);
  const store = createTouwakaTranscriptStore({ db, requestContext: requestContext() });
  for (const record of fixture.records) await store.appendRound(id, record);
  return { id, tool1: fixture.tool1, tool2: fixture.tool2, store };
}

function countsOf(diffs) {
  const counts = {};
  for (const item of diffs) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
}

async function roundRowId(id, dedupKey) {
  const [rows] = await db.sequelize.query(
    "SELECT id FROM agent_rounds WHERE request_id = :id AND dedup_key = :dedupKey",
    { replacements: { id, dedupKey } },
  );
  return rows[0]?.id ?? null;
}

before(async () => {
  if (!db) return;
  const [user] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  userId = user?.[0]?.id ?? userId;
  const [expert] = await db.sequelize.query("SELECT id FROM experts LIMIT 1");
  expertId = expert?.[0]?.id ?? null;
  await ensureTables();
});

after(async () => {
  if (!db) return;
  await cleanupAll();
  if (typeof rawSequelize?.close === "function") await rawSequelize.close();
  if (typeof db.close === "function") await db.close();
  else if (db.sequelize) await db.sequelize.close();
});

if (!creds) {
  test("投影可重建对账器（真实 MariaDB）", { skip: `缺少凭据 ${CREDS_PATH}` }, () => {});
} else {
  beforeEach(async () => {
    // 每个用例自带独占 request_id，这里只兜底清掉上一次失败残留。
    await cleanupAll();
  });

  test("干净 0.23 fixture（载体 + 消息行 + 分片）：对账 0 差异、孤儿 0 条", async () => {
    const { id } = await freshFixture("clean");
    const result = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(result.diffs, [], `干净 fixture 不应有差异：${JSON.stringify(result.diffs, null, 1)}`);
    assert.equal(result.stats.canonical_rows, 7);
    assert.equal(result.stats.canonical_carriers, 3);
    assert.equal(result.stats.canonical_message_rows, 4);
    assert.equal(result.stats.messages_rows, 2, "round2 assistant 正文行 + round1 纯 reasoning 行");
    assert.equal(result.stats.tool_rows, 2);

    const orphans = await detectOrphans({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(orphans.counts, { orphan_tool_row: 0, tool_result_missing: 0, tool_result_pending: 0 });

    // 折叠基线：canonical 折叠出的每轮正文与 carrier-only 装配只应有块顺序差。
    const probe = await probeLegacyVsCarrierOnly({ sequelize: db.sequelize, runId: id, logger });
    assert.equal(probe.canonical_rounds, 3);
    assert.equal(probe.carrier_only_rounds, 3);
  });

  test("分类①：删一条 messages 行 → 只报 missing_message_row（精确到 round2#0）", async () => {
    const { id } = await freshFixture("missing-message-row");
    const ownerKey = `${id}:msg:2:0`;
    const ownerRoundId = await roundRowId(id, ownerKey);
    assert.ok(ownerRoundId);
    await db.sequelize.query(
      "DELETE FROM messages WHERE round_id = :roundId AND sequence_no = 0",
      { replacements: { roundId: ownerRoundId } },
    );

    const { diffs } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(countsOf(diffs), { missing_message_row: 1 });
    const hit = diffs[0];
    assert.equal(hit.table, "messages");
    assert.equal(hit.dedupKey, ownerKey);
    assert.equal(hit.sequenceNo, 0);
    assert.equal(hit.actual, null);
    assert.equal(hit.expected.role, "assistant");
    assert.equal(hit.expected.contentLength, "all done".length);
  });

  test("分类②：多插一条未被吸附的 messages 行 → 只报 unexpected_message_row", async () => {
    const { id } = await freshFixture("unexpected-message-row");
    const ownerRoundId = await roundRowId(id, `${id}:msg:2:0`);
    await db.sequelize.query(`
      INSERT INTO messages (id, request_id, topic_id, user_id, expert_id, role, content,
        reasoning_content, round_id, sequence_no, created_at, meta_json)
      VALUES ('ghost-${ns}', :id, NULL, :userId, :expertId, 'assistant', 'ghost', NULL,
        :roundId, 9, NOW(3), NULL)
    `, { replacements: { id, userId, expertId, roundId: ownerRoundId } });

    const { diffs } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(countsOf(diffs), { unexpected_message_row: 1 });
    assert.equal(diffs[0].table, "messages");
    assert.equal(diffs[0].dedupKey, `${id}:msg:2:0`);
    assert.equal(diffs[0].sequenceNo, 9);
    assert.equal(diffs[0].actual.role, "assistant");
    assert.equal(diffs[0].actual.contentLength, "ghost".length);
  });

  test("分类③：改分片 partOf → 报 part_of_mismatch（+ 必然的 record_json_mismatch）", async () => {
    const { id } = await freshFixture("part-of-mismatch");
    const shardKey = `${id}:msg:1:2`;
    const wrong = `${id}:msg:1:0`;
    await db.sequelize.query(`
      UPDATE agent_rounds SET record_json = JSON_SET(record_json, '$.partOf', :wrong)
      WHERE request_id = :id AND dedup_key = :shardKey
    `, { replacements: { id, wrong, shardKey } });

    const { diffs } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(countsOf(diffs), { part_of_mismatch: 1, record_json_mismatch: 1 });
    const hit = diffs.find((item) => item.kind === "part_of_mismatch");
    assert.equal(hit.table, "agent_rounds");
    assert.equal(hit.dedupKey, shardKey);
    assert.equal(hit.expected, `${id}:msg:1:1`);
    assert.equal(hit.actual, wrong);
    // 生成列随 record_json 现算：库里 part_of 也真的变成了错值。
    const [rows] = await db.sequelize.query(
      "SELECT part_of FROM agent_rounds WHERE request_id = :id AND dedup_key = :shardKey",
      { replacements: { id, shardKey } },
    );
    assert.equal(rows[0].part_of, wrong);
  });

  test("分类④：造一条孤儿 chat_tool_calls → 孤儿检测精确命中（对账段不重复报）", async () => {
    const { id } = await freshFixture("orphan-tool");
    const orphanId = `orphan-tool-${ns}`;
    await db.sequelize.query(`
      INSERT INTO chat_tool_calls (tool_use_id, request_id, round_id, name, input_json, result_json,
        is_error, duration_ms, created_at)
      VALUES (:orphanId, :id, 'round_does_not_exist', 'ghost_tool', NULL, NULL, b'0', NULL, NOW())
    `, { replacements: { orphanId, id } });

    const { diffs } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(diffs, [], "孤儿行归孤儿检测段，不应在对账段重复报");

    const orphans = await detectOrphans({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(orphans.counts, { orphan_tool_row: 1, tool_result_missing: 0, tool_result_pending: 0 });
    assert.equal(orphans.orphanToolRows[0].toolUseId, orphanId);
    assert.equal(orphans.orphanToolRows[0].roundId, "round_does_not_exist");
    assert.equal(orphans.orphanToolRows[0].name, "ghost_tool");
  });

  test("分类⑤：工具行 result_json 置 NULL → 对账报 tool_result_missing + 孤儿检测同报", async () => {
    const { id, tool1 } = await freshFixture("null-result");
    await db.sequelize.query(
      "UPDATE chat_tool_calls SET result_json = NULL WHERE request_id = :id AND tool_use_id = :toolId",
      { replacements: { id, toolId: tool1 } },
    );

    const { diffs } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(countsOf(diffs), { tool_result_missing: 1 });
    assert.equal(diffs[0].toolUseId, tool1);
    assert.equal(diffs[0].actual.resultJson, null);

    const orphans = await detectOrphans({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(orphans.counts, { orphan_tool_row: 0, tool_result_missing: 1, tool_result_pending: 0 });
    assert.equal(orphans.completedRoundsWithNullResult[0].toolUseId, tool1);
    assert.equal(orphans.completedRoundsWithNullResult[0].roundNo, 1);
  });

  test("分类⑥：删一条工具行 → 只报 missing_tool_row", async () => {
    const { id, tool1 } = await freshFixture("missing-tool-row");
    await db.sequelize.query(
      "DELETE FROM chat_tool_calls WHERE request_id = :id AND tool_use_id = :toolId",
      { replacements: { id, toolId: tool1 } },
    );

    const { diffs } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(countsOf(diffs), { missing_tool_row: 1 });
    assert.equal(diffs[0].toolUseId, tool1);
    assert.equal(diffs[0].dedupKey, `${id}:msg:1:0`);
    assert.equal(diffs[0].expected.name, "list");
    assert.deepEqual(diffs[0].expected.input, { path: "." });
    assert.equal(diffs[0].expected.resultPresent, true);
  });

  test("分类⑦：改一条消息正文 → 只报 content_mismatch（字段级）", async () => {
    const { id } = await freshFixture("content-mismatch");
    const ownerRoundId = await roundRowId(id, `${id}:msg:2:0`);
    await db.sequelize.query(
      "UPDATE messages SET content = 'tampered' WHERE round_id = :roundId AND sequence_no = 0",
      { replacements: { roundId: ownerRoundId } },
    );

    const { diffs } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(countsOf(diffs), { content_mismatch: 1 });
    assert.deepEqual(diffs[0].fields, ["content"]);
    assert.equal(diffs[0].dedupKey, `${id}:msg:2:0`);
    assert.equal(diffs[0].expected.contentLength, "all done".length);
    assert.equal(diffs[0].actual.contentLength, "tampered".length);
  });

  test("分类⑧：删载体 / 多插载体 → missing_carrier / extra_carrier", async () => {
    const { id } = await freshFixture("carrier-diff");
    await db.sequelize.query(
      "DELETE FROM agent_rounds WHERE request_id = :id AND dedup_key = :key",
      { replacements: { id, key: `${id}:engine:round:2` } },
    );
    await db.sequelize.query(`
      INSERT INTO agent_rounds (id, request_id, round_no, dedup_key, stop_reason, \`usage\`, latency_ms,
        folded, folded_range, record_json, ts, created_at)
      VALUES ('round-ghost-${ns}', :id, 9, :ghostKey, NULL, NULL, NULL, b'0', NULL,
        JSON_OBJECT('roundKey', '${id}:round:9'), '2026-11-01T00:00:09.000Z', NOW())
    `, { replacements: { id, ghostKey: `${id}:ghost:round:9` } });

    const { diffs } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(countsOf(diffs), { missing_carrier: 1, extra_carrier: 1 });
    const missing = diffs.find((item) => item.kind === "missing_carrier");
    assert.equal(missing.dedupKey, `${id}:engine:round:2`);
    assert.equal(missing.roundNo, 2);
    const extra = diffs.find((item) => item.kind === "extra_carrier");
    assert.equal(extra.dedupKey, `${id}:ghost:round:9`);
    assert.equal(extra.roundNo, 9);
  });

  test("分类⑨：删一条消息行（kind='message'）→ 只报 missing_round_row（精确到 msg:1:2）", async () => {
    const { id } = await freshFixture("missing-round-row");
    const missingKey = `${id}:msg:1:2`;
    await db.sequelize.query(
      "DELETE FROM agent_rounds WHERE request_id = :id AND dedup_key = :key",
      { replacements: { id, key: missingKey } },
    );

    const { diffs, counts } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(counts, { missing_round_row: 1 });
    const hit = diffs[0];
    assert.equal(hit.table, "agent_rounds");
    assert.equal(hit.dedupKey, missingKey);
    assert.equal(hit.roundNo, 1);
    assert.equal(hit.expected.kind, "message");
    assert.equal(hit.expected.seq, 2);
    assert.equal(hit.expected.partOf, `${id}:msg:1:1`);
    assert.equal(hit.actual, null);
  });

  test("分类⑩：多插一条消息行 → 只报 extra_round_row（canonical 无来源）", async () => {
    const { id } = await freshFixture("extra-round-row");
    const ghostKey = `${id}:msg:9:7`;
    await db.sequelize.query(`
      INSERT INTO agent_rounds (id, request_id, round_no, dedup_key, stop_reason, \`usage\`, latency_ms,
        folded, folded_range, record_json, ts, created_at)
      VALUES ('round-ghost-msg-${ns}', :id, 1, :ghostKey, NULL, NULL, NULL, b'0', NULL,
        JSON_OBJECT('roundKey', '${id}:round:1', 'dedupKey', :ghostKey, 'kind', 'message', 'seq', 7),
        '2026-11-01T00:00:09.500Z', NOW())
    `, { replacements: { id, ghostKey } });

    const { diffs, counts } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(counts, { extra_round_row: 1 });
    const hit = diffs[0];
    assert.equal(hit.table, "agent_rounds");
    assert.equal(hit.dedupKey, ghostKey);
    assert.equal(hit.roundNo, 1);
    assert.equal(hit.expected, null);
    assert.equal(hit.actual.kind, "message");
    assert.equal(hit.actual.seq, 7);
  });

  test("分类⑪：改消息行 seq → 报 seq_mismatch（+ 必然的 record_json_mismatch）", async () => {
    const { id } = await freshFixture("seq-mismatch");
    const targetKey = `${id}:msg:2:0`;
    await db.sequelize.query(`
      UPDATE agent_rounds SET record_json = JSON_SET(record_json, '$.seq', 7)
      WHERE request_id = :id AND dedup_key = :key
    `, { replacements: { id, key: targetKey } });

    const { diffs, counts } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(counts, { seq_mismatch: 1, record_json_mismatch: 1 });
    const hit = diffs.find((item) => item.kind === "seq_mismatch");
    assert.equal(hit.table, "agent_rounds");
    assert.equal(hit.dedupKey, targetKey);
    assert.equal(hit.roundNo, 2);
    assert.equal(hit.expected, 0, "canonical 里这条消息的 seq 是 0");
    assert.equal(hit.actual, 7, "生成列 seq 随 record_json 现算成 7");
    // 生成列真的变了（不是只改了 JSON 文本）。
    const [rows] = await db.sequelize.query(
      "SELECT seq FROM agent_rounds WHERE request_id = :id AND dedup_key = :key",
      { replacements: { id, key: targetKey } },
    );
    assert.equal(Number(rows[0].seq), 7);
  });

  test("分类⑫：多插一条工具行 → 只报 extra_tool_row（canonical 无对应 tool_use）", async () => {
    const { id } = await freshFixture("extra-tool-row");
    const ownerRoundId = await roundRowId(id, `${id}:msg:2:0`);
    const ghostTool = `ghost-tool-${ns}`;
    await db.sequelize.query(`
      INSERT INTO chat_tool_calls (tool_use_id, request_id, round_id, name, input_json, result_json,
        is_error, duration_ms, created_at)
      VALUES (:ghostTool, :id, :roundId, 'ghost_tool', NULL, '"done"', b'0', NULL, NOW())
    `, { replacements: { ghostTool, id, roundId: ownerRoundId } });

    const { diffs, counts } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(counts, { extra_tool_row: 1 });
    const hit = diffs[0];
    assert.equal(hit.table, "chat_tool_calls");
    assert.equal(hit.toolUseId, ghostTool);
    assert.equal(hit.roundId, ownerRoundId);
    assert.equal(hit.expected, null);
    assert.equal(hit.actual.name, "ghost_tool");
    assert.equal(hit.actual.resultJsonPresent, true);
  });

  test("分类⑬：改工具行 result_json → 只报 tool_result_mismatch（正文长度精确）", async () => {
    const { id, tool1 } = await freshFixture("tool-result-mismatch");
    await db.sequelize.query(
      `UPDATE chat_tool_calls SET result_json = '"tampered"' WHERE request_id = :id AND tool_use_id = :toolId`,
      { replacements: { id, toolId: tool1 } },
    );

    const { diffs, counts } = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(counts, { tool_result_mismatch: 1 });
    const hit = diffs[0];
    assert.equal(hit.table, "chat_tool_calls");
    assert.equal(hit.toolUseId, tool1);
    assert.equal(hit.expected.resultLength, JSON.stringify("ok-1").length, "canonical 的 tool_result 正文是 \"ok-1\"");
    assert.equal(hit.actual.resultLength, JSON.stringify("tampered").length);
  });

  test("dry-run 只读自证：写 SQL 代理一抛，reconcile/orphan/probe/baseline 全跑通", async () => {
    const { id } = await freshFixture("readonly-proof");
    const originalQuery = db.sequelize.query.bind(db.sequelize);
    const writePattern = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE)\b/i;
    const seen = [];
    db.sequelize.query = async (sql, options) => {
      const text = typeof sql === "string" ? sql : sql?.query;
      seen.push(text);
      if (writePattern.test(String(text))) {
        throw new Error(`dry-run 分支发出了写 SQL：${String(text).slice(0, 120)}`);
      }
      return originalQuery(sql, options);
    };
    try {
      await reconcileRequest({ sequelize: db.sequelize, runId: id });
      await detectOrphans({ sequelize: db.sequelize, runId: id });
      await probeLegacyVsCarrierOnly({ sequelize: db.sequelize, runId: id, logger });
      await loadCarrierOnlyRounds({ sequelize: db.sequelize, runId: id });
      await collectBaselineStats({ sequelize: db.sequelize, runIds: [id] });
      await explainReconcileQueries({ sequelize: db.sequelize, runId: id });
      // #1227 C2b：回填开关的**计划**阶段也必须只读（--dry-run 就是只跑这几条）。
      await collectToolErrorDirections({ sequelize: db.sequelize, runIds: [id] });
      await planRecordJsonRewrites({ sequelize: db.sequelize, runIds: [id] });
      // #1227 C2d：canonical 清洗的两个方向表 + 合并计划器同样零写 SQL。
      const foldedDirections = await collectFoldedDirections({ sequelize: db.sequelize, runIds: [id] });
      await planCanonicalCleanups({
        sequelize: db.sequelize,
        toolErrorRows: await collectToolErrorDirections({ sequelize: db.sequelize, runIds: [id] }),
        foldedRows: foldedDirections,
      });
    } finally {
      db.sequelize.query = originalQuery;
    }
    assert.ok(seen.length > 10, "dry-run 应该真的查了库（不是空跑）");

    // 静态自证：写 SQL 只允许出现在写入口 applyProjectionWrites 之后。
    const source = readFileSync(MODULE_PATH, "utf8");
    const writeEntry = source.indexOf("async function applyProjectionWrites");
    assert.ok(writeEntry > 0, "写入口必须存在且可定位");
    const dryRunSource = source.slice(0, writeEntry)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(
      dryRunSource,
      /\b(INSERT\s+(IGNORE\s+)?INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|REPLACE\s+INTO)\b/i,
      "dry-run 代码段（写入口之前）不得出现写 SQL",
    );
  });

  test("--apply 库名判据：生产库拒绝、测试库放行、库名缺失拒绝", () => {
    assert.throws(
      () => assertProjectionApplyAllowed({ database: PRODUCTION_DATABASE_NAME, apply: true }),
      (error) => error.code === "ERR_PROJECTION_APPLY_FORBIDDEN" && error.database === PRODUCTION_DATABASE_NAME,
    );
    assert.throws(
      () => assertProjectionApplyAllowed({ database: "", apply: true }),
      (error) => error.code === "ERR_PROJECTION_APPLY_UNKNOWN_DATABASE",
    );
    assert.deepEqual(
      assertProjectionApplyAllowed({ database: "llm_kit_test", apply: true }),
      { allowed: true, reason: "non-production" },
    );
    assert.deepEqual(
      assertProjectionApplyAllowed({ database: PRODUCTION_DATABASE_NAME, apply: false }),
      { allowed: false, reason: "dry-run" },
    );
  });

  test("--apply 幂等：补齐缺失投影后第二次写 0 行、差异归零", async () => {
    const { id, tool1 } = await freshFixture("apply-idempotent");
    const ownerRoundId = await roundRowId(id, `${id}:msg:2:0`);
    // 人为制造两类“可重建”的缺失：一条 messages 行 + 一条工具行。
    await db.sequelize.query(
      "DELETE FROM messages WHERE round_id = :roundId AND sequence_no = 0",
      { replacements: { roundId: ownerRoundId } },
    );
    await db.sequelize.query(
      "DELETE FROM chat_tool_calls WHERE request_id = :id AND tool_use_id = :toolId",
      { replacements: { id, toolId: tool1 } },
    );

    const before = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(countsOf(before.diffs), { missing_message_row: 1, missing_tool_row: 1 });

    const first = await projectRequest({
      sequelize: db.sequelize,
      runId: id,
      database: creds.database,
      apply: true,
      requestContext: requestContext(),
    });
    assert.equal(first.diffsAfter.length, 0, `第一次 apply 后差异应归零：${JSON.stringify(first.diffsAfter)}`);
    assert.ok(first.written.messages >= 1, `第一次应补 messages 行，实际 ${JSON.stringify(first.written)}`);
    assert.ok(first.written.chat_tool_calls >= 1, `第一次应补工具行，实际 ${JSON.stringify(first.written)}`);

    const second = await projectRequest({
      sequelize: db.sequelize,
      runId: id,
      database: creds.database,
      apply: true,
      requestContext: requestContext(),
    });
    assert.deepEqual(second.diffsAfter, []);
    assert.deepEqual(second.written, {
      agent_rounds: 0,
      messages: 0,
      chat_tool_calls: 0,
      pruned_messages: 0,
    }, "第二次 apply 必须零写入（幂等）");

    // 行数也逐表相等：补齐后两次跑之间没有任何行被重复插入。
    const [[messages]] = await db.sequelize.query(
      "SELECT COUNT(*) AS n FROM messages WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(Number(messages.n), 2);
    const [[tools]] = await db.sequelize.query(
      "SELECT COUNT(*) AS n FROM chat_tool_calls WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(Number(tools.n), 2);
  });

  test("BIT(1) 读取：mysql2 返回 Buffer 时不能读成 false（否则每个错误工具行都误报）", () => {
    assert.equal(bitToBoolean(Buffer.from([1])), true);
    assert.equal(bitToBoolean(Buffer.from([0])), false);
    assert.equal(bitToBoolean(1), true);
    assert.equal(bitToBoolean(0), false);
    assert.equal(bitToBoolean("1"), true);
    assert.equal(bitToBoolean("0"), false);
    assert.equal(bitToBoolean(null), false);
    assert.equal(bitToBoolean(true), true);
  });

  test("--apply 不传 requestContext 时从已有 messages 行回填 user_id（CLI 路径）", async () => {
    const { id } = await freshFixture("ctx-fallback");
    const ownerRoundId = await roundRowId(id, `${id}:msg:2:0`);
    await db.sequelize.query(
      "DELETE FROM messages WHERE round_id = :roundId AND sequence_no = 0",
      { replacements: { roundId: ownerRoundId } },
    );

    const applied = await projectRequest({
      sequelize: db.sequelize,
      runId: id,
      database: creds.database,
      apply: true,
      // 刻意不传 requestContext：CLI 就是这个形状，必须能从库里回填。
    });
    assert.equal(applied.written.messages, 1);
    assert.deepEqual(applied.diffsAfter, []);
    const [rows] = await db.sequelize.query(
      "SELECT user_id FROM messages WHERE round_id = :roundId AND sequence_no = 0",
      { replacements: { roundId: ownerRoundId } },
    );
    assert.equal(rows[0].user_id, userId, "user_id 必须回填成该请求已有行的值");
  });

  test("CLI 参数解析与闸门判据（纯函数，不连库）", async () => {
    const { parseArgs, isRealDefect } = await import("../../scripts/verify-transcript-projection.mjs");
    assert.deepEqual(
      parseArgs(["--request-id", "a", "--request-id", "b", "--limit", "3", "--apply"]),
      {
        requestIds: ["a", "b"],
        since: null,
        limit: 3,
        apply: true,
        json: false,
        explain: false,
        skipProbe: false,
        reportPath: null,
        fixIsError: false,
        rewriteRecordJson: false,
        fixFolded: false,
        // #1237 切片 A：`--fix-reasoning` 默认关（写 messages 一张表，方向与 canonical 两个开关相反）。
        fixReasoning: false,
        dryRun: false,
      },
    );
    // #1227 C2b：两个回填开关 + --dry-run 的解析（默认全关）。
    assert.deepEqual(
      parseArgs(["--fix-is-error", "--rewrite-record-json", "--dry-run"]),
      {
        requestIds: [],
        since: null,
        limit: null,
        apply: false,
        json: false,
        explain: false,
        skipProbe: false,
        reportPath: null,
        fixIsError: true,
        rewriteRecordJson: true,
        fixFolded: false,
        fixReasoning: false,
        dryRun: true,
      },
    );
    // #1237 切片 A：`--fix-reasoning` 单独开、且**不带** `--apply`（同上，真写靠不给 --dry-run）。
    const reasoningOnly = parseArgs(["--fix-reasoning", "--limit", "40", "--dry-run"]);
    assert.equal(reasoningOnly.fixReasoning, true, "--fix-reasoning 可解析");
    assert.equal(reasoningOnly.apply, false, "--fix-reasoning 不隐含 --apply");
    assert.equal(reasoningOnly.dryRun, true, "--dry-run 与开关同用时只预演");
    // #1227 C2d：`--fix-folded` 单独开、且**不带** `--apply`（真写靠“不给 --dry-run”触发）。
    const foldedOnly = parseArgs(["--fix-folded", "--limit", "40"]);
    assert.equal(foldedOnly.fixFolded, true);
    assert.equal(foldedOnly.apply, false);
    assert.equal(foldedOnly.dryRun, false);
    assert.throws(() => parseArgs(["--nope"]), /未知参数/);
    assert.throws(() => parseArgs(["--limit", "-1"]), /非负整数/);
    assert.throws(() => parseArgs(["--since", "not-a-date"]), /可解析的日期/);

    const base = { reconciliation: { diffs: [] }, orphans: { orphanToolRows: [], completedRoundsWithNullResult: [] } };
    assert.equal(isRealDefect(base), false);
    assert.equal(isRealDefect({
      ...base,
      reconciliation: { diffs: [{ kind: "host_enriched_reasoning" }] },
    }), false, "宿主增强 reasoning 不算缺陷");
    assert.equal(isRealDefect({
      ...base,
      reconciliation: { diffs: [{ kind: "content_mismatch" }] },
    }), true);
    assert.equal(isRealDefect({
      ...base,
      orphans: { orphanToolRows: [{ toolUseId: "x" }], completedRoundsWithNullResult: [] },
    }), true);
  });

  test("宿主增强 reasoning 归类为非缺陷，且 --apply 不回写它", async () => {
    const { id } = await freshFixture("host-enriched");
    const ownerRoundId = await roundRowId(id, `${id}:msg:2:0`);
    const enriched = `round-1 accumulated reasoning\nfinal answer`;
    await db.sequelize.query(
      "UPDATE messages SET reasoning_content = :enriched WHERE round_id = :roundId AND sequence_no = 0",
      { replacements: { enriched, roundId: ownerRoundId } },
    );

    const before = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(countsOf(before.diffs), { host_enriched_reasoning: 1 });
    assert.deepEqual(before.diffs[0].fields, ["reasoning_content"]);

    const applied = await projectRequest({
      sequelize: db.sequelize,
      runId: id,
      database: creds.database,
      apply: true,
      requestContext: requestContext(),
    });
    assert.equal(applied.written.messages, 0, "宿主增强行不是重建目标");
    const [rows] = await db.sequelize.query(
      "SELECT reasoning_content FROM messages WHERE round_id = :roundId AND sequence_no = 0",
      { replacements: { roundId: ownerRoundId } },
    );
    assert.equal(rows[0].reasoning_content, enriched, "apply 不得把宿主增强的 reasoning 覆盖回 canonical 那一段");
  });

  // ==================== #1227 阶段 3 切片 C2b：存量漂移回填 ====================

  test("存量回填闸门：两个开关写生产库必须同时给 ALLOW_NON_TEST_DB=1（纯函数）", () => {
    // 不带开关 = 不写（与 C1 行为一致）
    assert.deepEqual(
      assertDriftBackfillAllowed({ database: PRODUCTION_DATABASE_NAME, env: {} }),
      { allowed: false, reason: "no-write-flag" },
    );
    for (const flag of ["fixIsError", "rewriteRecordJson"]) {
      assert.throws(
        () => assertDriftBackfillAllowed({ database: PRODUCTION_DATABASE_NAME, [flag]: true, env: {} }),
        (error) => error.code === "ERR_PROJECTION_BACKFILL_NEEDS_ALLOW_NON_TEST_DB"
          && error.database === PRODUCTION_DATABASE_NAME,
        `${flag} 单独在场（缺 ALLOW_NON_TEST_DB）必须拒绝`,
      );
      assert.deepEqual(
        assertDriftBackfillAllowed({
          database: PRODUCTION_DATABASE_NAME,
          [flag]: true,
          env: { [DRIFT_BACKFILL_ALLOW_ENV_VAR]: "1" },
        }),
        { allowed: true, reason: "production-explicit" },
      );
      // 测试库不需要显式确认（测试库演练靠这条）
      assert.deepEqual(
        assertDriftBackfillAllowed({ database: "llm_kit_test", [flag]: true, env: {} }),
        { allowed: true, reason: "non-production" },
      );
    }
    assert.throws(
      () => assertDriftBackfillAllowed({ database: "", fixIsError: true, env: {} }),
      (error) => error.code === "ERR_PROJECTION_BACKFILL_UNKNOWN_DATABASE",
    );
  });

  test("--fix-is-error 三格方向（C2d 方向）：只清 A 格的 canonical 键（不写列）；B/C 一律不动", async () => {
    const { id, tool1, tool2 } = await freshFixture("fix-is-error-directions");
    // tool1：canonical 无 is_error，把列设成 1 → C 格（列真 & canonical 非真，禁止反向修改）
    await db.sequelize.query(
      "UPDATE chat_tool_calls SET is_error = b'1' WHERE request_id = :id AND tool_use_id = :toolId",
      { replacements: { id, toolId: tool1 } },
    );

    // ── 第一段：tool2 列也是 1 ⇒ B 格（两边真），一个都不该动 ──────────────
    const bDirections = await collectToolErrorDirections({ sequelize: db.sequelize, runIds: [id] });
    const bByTool = new Map(bDirections.map((row) => [row.toolUseId, row]));
    assert.equal(bByTool.get(tool2).direction, "B", "canonical 真 & 列 1 = B 格");
    assert.equal(bByTool.get(tool1).direction, "C");
    assert.deepEqual(
      summarizeToolErrorDirections(bDirections),
      { A: 0, B: 1, C: 1, unchanged: 0, total: 2 },
    );
    const bPlan = await planCanonicalCleanups({ sequelize: db.sequelize, toolErrorRows: bDirections });
    assert.deepEqual(bPlan, [], "B/C 两格都不产生计划");
    const bApply = await applyCanonicalRecordRewrites({ sequelize: db.sequelize, plans: bPlan });
    assert.equal(bApply.written, 0);

    // ── 第二段：把 tool2 的列压回 0 ⇒ A 格（canonical 假阳性）─────────────
    await db.sequelize.query(
      "UPDATE chat_tool_calls SET is_error = b'0' WHERE request_id = :id AND tool_use_id = :toolId",
      { replacements: { id, toolId: tool2 } },
    );
    const directions = await collectToolErrorDirections({ sequelize: db.sequelize, runIds: [id] });
    const byTool = new Map(directions.map((row) => [row.toolUseId, row]));
    assert.equal(byTool.get(tool2).direction, "A");
    assert.equal(byTool.get(tool2).action, "clear-canonical");
    assert.equal(byTool.get(tool1).direction, "C");
    assert.deepEqual(
      summarizeToolErrorDirections(directions),
      { A: 1, B: 0, C: 1, unchanged: 0, total: 2 },
    );
    assert.equal(
      byTool.get(tool2).ownerDedupKey,
      `${id}:msg:1:0`,
      "ownerDedupKey 是 tool_use 块所在的行（写侧 round_id 钉在这里）",
    );
    assert.deepEqual(
      byTool.get(tool2).resultOwnerDedupKeys,
      [`${id}:msg:1:2`],
      "resultOwnerDedupKeys 才是 is_error 所在的行（清洗按它定位，两者可以不同行）",
    );

    const before = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(countsOf(before.diffs), { tool_row_mismatch: 2 });

    const plan = await planCanonicalCleanups({ sequelize: db.sequelize, toolErrorRows: directions });
    assert.equal(plan.length, 1, "只计划 A 格那 1 条 canonical 行");
    assert.equal(plan[0].dedupKey, `${id}:msg:1:2`);
    assert.deepEqual(plan[0].toolErrorCleared.map((item) => item.toolUseId), [tool2]);
    assert.equal(plan[0].toolErrorCleared[0].old, true);

    const first = await applyCanonicalRecordRewrites({ sequelize: db.sequelize, plans: plan });
    assert.equal(first.written, 1, "只允许改 A 格那 1 行 canonical");

    // ① canonical：A 格的 `is_error` 键**被删掉**（不是写 false），B 格（这里没有）不受影响
    const [canonicalRows] = await db.sequelize.query(
      `SELECT dedup_key, record_json FROM ${CANONICAL_TABLE} WHERE request_id = :id`,
      { replacements: { id } },
    );
    const recordByKey = new Map(canonicalRows.map((row) => [row.dedup_key, JSON.parse(row.record_json)]));
    const blockOf = (record, toolUseId) => {
      for (const message of record.messages ?? []) {
        for (const block of Array.isArray(message.content) ? message.content : []) {
          if (block?.type === "tool_result" && block.tool_use_id === toolUseId) return block;
        }
      }
      return null;
    };
    const cleaned = blockOf(recordByKey.get(`${id}:msg:1:2`), tool2);
    assert.equal(
      Object.hasOwn(cleaned, "is_error"),
      false,
      "无键 = 非错误（引擎契约）；写 false 会发明一个引擎从不产出的键",
    );

    // ② 列：一行都不许动（A 格的列仍是 0，C 格的列仍是 1）
    const [rows] = await db.sequelize.query(
      "SELECT tool_use_id, is_error+0 AS is_error FROM chat_tool_calls WHERE request_id = :id ORDER BY tool_use_id",
      { replacements: { id } },
    );
    const column = new Map(rows.map((row) => [row.tool_use_id, Number(row.is_error)]));
    assert.equal(column.get(tool2), 0, "A 格的列必须保持 0（本开关不写 chat_tool_calls）");
    assert.equal(column.get(tool1), 1, "C 格必须保持原值 1（绝不翻回 0）");

    // ③ C 格仍是差异（没被“顺手修好”），A 格已消失
    const after = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(countsOf(after.diffs), { tool_row_mismatch: 1 });
    assert.equal(after.diffs[0].toolUseId, tool1);
    assert.equal(after.diffs[0].field, "is_error");

    // 幂等：第二次方向表变成「两边皆假 + C」，计划为空、写 0 行
    const directions2 = await collectToolErrorDirections({ sequelize: db.sequelize, runIds: [id] });
    assert.deepEqual(
      summarizeToolErrorDirections(directions2),
      { A: 0, B: 0, C: 1, unchanged: 1, total: 2 },
    );
    const plan2 = await planCanonicalCleanups({ sequelize: db.sequelize, toolErrorRows: directions2 });
    assert.deepEqual(plan2, []);
    const second = await applyCanonicalRecordRewrites({ sequelize: db.sequelize, plans: plan2 });
    assert.equal(second.written, 0, "第二次必须写 0 行（幂等）");
  });

  test("--fix-folded 三格方向：只清 A 格（canonical 真 & 列 0）；B 不动；C 不动且被点名", async () => {
    const { id } = await freshFixture("fix-folded-directions");
    const seedKey = `${id}:engine:round:0:seed`;
    const round1Key = `${id}:engine:round:1`;
    const round2Key = `${id}:engine:round:2`;
    // A 格：canonical folded:true & 列 0（round 1）
    // B 格：canonical folded:true & 列 1（round 2）
    // C 格：canonical 无 folded & 列 1（round 0 种子）
    await db.sequelize.query(
      `UPDATE ${CANONICAL_TABLE} SET record_json = JSON_SET(record_json, '$.folded', true)`
      + " WHERE request_id = :id AND dedup_key IN (:k1, :k2)",
      { replacements: { id, k1: round1Key, k2: round2Key } },
    );
    await db.sequelize.query(
      "UPDATE agent_rounds SET folded = b'1' WHERE request_id = :id AND dedup_key IN (:k2, :k3)",
      { replacements: { id, k2: round2Key, k3: seedKey } },
    );

    const directions = await collectFoldedDirections({ sequelize: db.sequelize, runIds: [id] });
    const byKey = new Map(directions.map((row) => [row.dedupKey, row]));
    assert.equal(byKey.get(round1Key).direction, "A");
    assert.equal(byKey.get(round2Key).direction, "B");
    assert.equal(byKey.get(seedKey).direction, "C", "列真 & canonical 非真 = C 格");
    assert.equal(byKey.get(seedKey).action, "forbidden");
    assert.deepEqual(
      summarizeFoldedDirections(directions),
      { A: 1, B: 1, C: 1, unchanged: 4, total: 7 },
    );

    const plan = await planCanonicalCleanups({ sequelize: db.sequelize, foldedRows: directions });
    assert.equal(plan.length, 1, "只有 A 格进计划");
    assert.equal(plan[0].dedupKey, round1Key);
    assert.equal(plan[0].newRecord.folded, false);
    assert.equal(plan[0].folded.hadFolded, true);
    assert.equal(plan[0].folded.folded, true);

    const first = await applyCanonicalRecordRewrites({ sequelize: db.sequelize, plans: plan });
    assert.equal(first.written, 1);

    const [rows] = await db.sequelize.query(
      `SELECT dedup_key, JSON_EXTRACT(record_json, '$.folded') AS folded FROM ${CANONICAL_TABLE}`
      + " WHERE request_id = :id",
      { replacements: { id } },
    );
    const foldedOf = new Map(rows.map((row) => [
      row.dedup_key,
      row.folded === null ? null : Boolean(JSON.parse(row.folded)),
    ]));
    assert.equal(foldedOf.get(round1Key), false, "A 格必须被清成 false");
    assert.equal(foldedOf.get(round2Key), true, "B 格（两边真）不许动");
    assert.equal(foldedOf.get(seedKey), null, "C 格（列真 & canonical 非真）不许动，也不许发明键");

    // 列值一行都没动
    const [columnRows] = await db.sequelize.query(
      "SELECT dedup_key, folded+0 AS folded FROM agent_rounds WHERE request_id = :id",
      { replacements: { id } },
    );
    const columnOf = new Map(columnRows.map((row) => [row.dedup_key, Number(row.folded)]));
    assert.equal(columnOf.get(round1Key), 0, "A 格的列保持 0（本开关不写 agent_rounds）");
    assert.equal(columnOf.get(round2Key), 1, "B 格的列保持 1");
    assert.equal(columnOf.get(seedKey), 1, "C 格的列保持 1（绝不翻回 0）");

    // 幂等：A 格消失后计划为空、写 0 行
    const directions2 = await collectFoldedDirections({ sequelize: db.sequelize, runIds: [id] });
    assert.equal(summarizeFoldedDirections(directions2).A, 0);
    const plan2 = await planCanonicalCleanups({ sequelize: db.sequelize, foldedRows: directions2 });
    assert.deepEqual(plan2, []);
    const second = await applyCanonicalRecordRewrites({ sequelize: db.sequelize, plans: plan2 });
    assert.equal(second.written, 0, "第二次必须写 0 行（幂等）");
  });

  test("列值是 raw Buffer（b'0'/b'1'）时三格判定仍正确（无 typeCast 连接档）", async () => {
    assert.ok(rawSequelize !== null, "raw 连接必须可用（否则本格失去意义）");
    const { id, tool1, tool2 } = await freshFixture("raw-buffer-directions");
    const seedKey = `${id}:engine:round:0:seed`;
    const round1Key = `${id}:engine:round:1`;
    const round2Key = `${id}:engine:round:2`;
    await db.sequelize.query(
      `UPDATE ${CANONICAL_TABLE} SET record_json = JSON_SET(record_json, '$.folded', true)`
      + " WHERE request_id = :id AND dedup_key IN (:k1, :k2)",
      { replacements: { id, k1: round1Key, k2: round2Key } },
    );
    await db.sequelize.query(
      "UPDATE agent_rounds SET folded = b'1' WHERE request_id = :id AND dedup_key IN (:k2, :k3)",
      { replacements: { id, k2: round2Key, k3: seedKey } },
    );
    await db.sequelize.query(
      "UPDATE chat_tool_calls SET is_error = b'1' WHERE request_id = :id AND tool_use_id = :toolId",
      { replacements: { id, toolId: tool1 } },
    );
    await db.sequelize.query(
      "UPDATE chat_tool_calls SET is_error = b'0' WHERE request_id = :id AND tool_use_id = :toolId",
      { replacements: { id, toolId: tool2 } },
    );

    // 先证明这条连接真的拿到 Buffer（否则本格退化成 typeCast 通道的重复）
    const [rawRows] = await rawSequelize.query(
      "SELECT folded FROM agent_rounds WHERE request_id = :id ORDER BY round_no",
      { replacements: { id } },
    );
    assert.ok(rawRows.some((row) => Buffer.isBuffer(row.folded)), "raw 连接的 BIT 列必须是 Buffer");
    assert.equal(bitToBoolean(Buffer.from([0])), false);
    assert.equal(bitToBoolean(Buffer.from([1])), true);

    const folded = await collectFoldedDirections({ sequelize: rawSequelize, runIds: [id] });
    const byKey = new Map(folded.map((row) => [row.dedupKey, row]));
    assert.equal(byKey.get(round1Key).direction, "A", "Buffer b'0' 必须读成 false（不是恒真）");
    assert.equal(byKey.get(round2Key).direction, "B", "Buffer b'1' 必须读成 true");
    assert.equal(byKey.get(seedKey).direction, "C");
    assert.deepEqual(
      summarizeFoldedDirections(folded),
      { A: 1, B: 1, C: 1, unchanged: 4, total: 7 },
    );

    const toolErrors = await collectToolErrorDirections({ sequelize: rawSequelize, runIds: [id] });
    const byTool = new Map(toolErrors.map((row) => [row.toolUseId, row]));
    assert.equal(byTool.get(tool2).direction, "A", "is_error 的 Buffer b'0' 必须读成 false");
    assert.equal(byTool.get(tool1).direction, "C");

    // 在 raw 连接上真跑一遍：写入口与连接形态无关
    const plan = await planCanonicalCleanups({
      sequelize: rawSequelize, toolErrorRows: toolErrors, foldedRows: folded,
    });
    const applied = await applyCanonicalRecordRewrites({ sequelize: rawSequelize, plans: plan });
    assert.equal(applied.written, 2, "两条 canonical 行（msg:1:2 的 is_error + round 1 的 folded）");
    const after = await collectFoldedDirections({ sequelize: rawSequelize, runIds: [id] });
    assert.equal(summarizeFoldedDirections(after).A, 0);
    const afterTools = await collectToolErrorDirections({ sequelize: rawSequelize, runIds: [id] });
    assert.equal(summarizeToolErrorDirections(afterTools).A, 0);
  });

  test("清洗后 canonical 形状可被写侧函数重建（幂等），且 foldedRoundRange 与 folded 一致", async () => {
    const { id, tool2 } = await freshFixture("canonical-shape-rebuild");
    const round1Key = `${id}:engine:round:1`;
    // 模拟 2026-10-09 回填的存量形状：canonical 多了 folded:true，
    // 而 agent_rounds.record_json 是**旧写侧**落的（没有 __hostSynthesizedColumns 标记）。
    // ⚠ 只对“被污染的那一行”去标记：没被污染的行仍然带着 marker（生产实测 91 行带 / 69 行不带）。
    await db.sequelize.query(
      "UPDATE agent_rounds SET record_json = JSON_REMOVE(record_json, '$.__hostSynthesizedColumns')"
      + " WHERE request_id = :id AND dedup_key = :key",
      { replacements: { id, key: round1Key } },
    );
    await db.sequelize.query(
      `UPDATE ${CANONICAL_TABLE}`
      + " SET record_json = JSON_SET(record_json, '$.folded', true, '$.foldedRoundRange', JSON_OBJECT('from', 1, 'to', 2))"
      + " WHERE request_id = :id AND dedup_key = :key",
      { replacements: { id, key: round1Key } },
    );
    await db.sequelize.query(
      "UPDATE chat_tool_calls SET is_error = b'0' WHERE request_id = :id AND tool_use_id = :toolId",
      { replacements: { id, toolId: tool2 } },
    );

    const shapeOf = async () => {
      const canonicalRows = await loadCanonicalRows({ sequelize: db.sequelize, runId: id });
      const [diskRows] = await db.sequelize.query(
        "SELECT dedup_key, record_json FROM agent_rounds WHERE request_id = :id",
        { replacements: { id } },
      );
      const disk = new Map(diskRows.map((row) => [row.dedup_key, JSON.parse(row.record_json)]));
      return new Map(canonicalRows.map((row) => [
        row.dedupKey,
        { record: row.record, disk: disk.get(row.dedupKey) },
      ]));
    };

    // 清洗前：canonical folded:true ⇒ 快照不带标记，与旧写侧的盘上形状一致（这就是“自洽的假阳性”）
    const beforeShape = await shapeOf();
    for (const [, entry] of beforeShape) {
      assert.deepEqual(
        buildAgentRoundRecordSnapshot(entry.record).recordSnapshot,
        entry.disk,
        "清洗前每一行都必须能被写侧函数逐字段重建（否则本格测的不是同一件事）",
      );
    }

    const toolErrors = await collectToolErrorDirections({ sequelize: db.sequelize, runIds: [id] });
    const folded = await collectFoldedDirections({ sequelize: db.sequelize, runIds: [id] });
    const plan = await planCanonicalCleanups({
      sequelize: db.sequelize, toolErrorRows: toolErrors, foldedRows: folded,
    });
    // 两条 A 格落在同一条 canonical 行（round 1 载体行？不是——tool_result 在 msg:1:2）
    assert.equal(plan.length, 2, "msg:1:2 的假 is_error + round 1 的假 folded 各一条计划");

    const applied = await applyCanonicalRecordRewrites({ sequelize: db.sequelize, plans: plan });
    assert.equal(applied.written, 2);

    // ① 清洗后仍然可以被写侧函数逐字段重建（幂等的前提）
    const afterShape = await shapeOf();
    for (const [, entry] of afterShape) {
      assert.deepEqual(
        buildAgentRoundRecordSnapshot(entry.record).recordSnapshot,
        entry.disk,
        "清洗后的 canonical 必须仍与 agent_rounds.record_json 逐字段等价",
      );
    }
    // ② foldedRoundRange 的处置与 folded 一致：列 folded_range 是 NULL ⇒ 键被删掉
    const cleanedRound1 = afterShape.get(round1Key).record;
    assert.equal(cleanedRound1.folded, false);
    assert.equal(
      Object.hasOwn(cleanedRound1, "foldedRoundRange"),
      false,
      "列 folded_range 为 NULL ⇒ 写侧不设该键（foldedRoundRange 必须随 folded 一起清掉）",
    );
    // ③ 对账不再报 record_json_mismatch
    const after = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.equal(after.counts.record_json_mismatch ?? 0, 0);

    // ④ 幂等
    const plan2 = await planCanonicalCleanups({
      sequelize: db.sequelize,
      toolErrorRows: await collectToolErrorDirections({ sequelize: db.sequelize, runIds: [id] }),
      foldedRows: await collectFoldedDirections({ sequelize: db.sequelize, runIds: [id] }),
    });
    assert.deepEqual(plan2, []);
    const second = await applyCanonicalRecordRewrites({ sequelize: db.sequelize, plans: plan2 });
    assert.equal(second.written, 0);
  });

  test("foldedRoundRange 从列推导（列有值 ⇒ 用列的值，不用 canonical 里那份）", async () => {
    const { id } = await freshFixture("folded-range-from-column");
    const round1Key = `${id}:engine:round:1`;
    await db.sequelize.query(
      `UPDATE ${CANONICAL_TABLE}`
      + " SET record_json = JSON_SET(record_json, '$.folded', true, '$.foldedRoundRange', JSON_OBJECT('from', 9, 'to', 9))"
      + " WHERE request_id = :id AND dedup_key = :key",
      { replacements: { id, key: round1Key } },
    );
    await db.sequelize.query(
      "UPDATE agent_rounds SET folded_range = :range WHERE request_id = :id AND dedup_key = :key",
      { replacements: { id, key: round1Key, range: JSON.stringify({ from: 3, to: 4 }) } },
    );

    const folded = await collectFoldedDirections({ sequelize: db.sequelize, runIds: [id] });
    const row = folded.find((item) => item.dedupKey === round1Key);
    assert.equal(row.direction, "A");
    assert.deepEqual(row.canonicalFoldedRange, { from: 9, to: 9 }, "canonical 那份是缺陷产物");
    assert.deepEqual(row.columnFoldedRange, { from: 3, to: 4 }, "列才是区间的权威存储");

    const plan = await planCanonicalCleanups({ sequelize: db.sequelize, foldedRows: folded });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].newRecord.folded, false);
    assert.deepEqual(plan[0].newRecord.foldedRoundRange, { from: 3, to: 4 });
    assert.equal(plan[0].folded.foldedRoundRangeAction, "set");

    const applied = await applyCanonicalRecordRewrites({ sequelize: db.sequelize, plans: plan });
    assert.equal(applied.written, 1);
    const [rows] = await db.sequelize.query(
      `SELECT record_json FROM ${CANONICAL_TABLE} WHERE request_id = :id AND dedup_key = :key`,
      { replacements: { id, key: round1Key } },
    );
    const record = JSON.parse(rows[0].record_json);
    assert.equal(record.folded, false);
    assert.deepEqual(record.foldedRoundRange, { from: 3, to: 4 });
  });

  test("单表不变量：--fix-is-error / --fix-folded 只写 agent_transcript_rounds", async () => {
    const { id, tool2 } = await freshFixture("single-table-invariant");
    const round1Key = `${id}:engine:round:1`;
    await db.sequelize.query(
      `UPDATE ${CANONICAL_TABLE} SET record_json = JSON_SET(record_json, '$.folded', true)`
      + " WHERE request_id = :id AND dedup_key = :key",
      { replacements: { id, key: round1Key } },
    );
    await db.sequelize.query(
      "UPDATE chat_tool_calls SET is_error = b'0' WHERE request_id = :id AND tool_use_id = :toolId",
      { replacements: { id, toolId: tool2 } },
    );

    const originalQuery = db.sequelize.query.bind(db.sequelize);
    const writePattern = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE)\b/i;
    const writes = [];
    db.sequelize.query = async (sql, options) => {
      const text = String(typeof sql === "string" ? sql : sql?.query);
      if (writePattern.test(text)) writes.push(text.replace(/\s+/g, " ").trim());
      return originalQuery(sql, options);
    };
    let applied;
    try {
      const plan = await planCanonicalCleanups({
        sequelize: db.sequelize,
        toolErrorRows: await collectToolErrorDirections({ sequelize: db.sequelize, runIds: [id] }),
        foldedRows: await collectFoldedDirections({ sequelize: db.sequelize, runIds: [id] }),
      });
      applied = await applyCanonicalRecordRewrites({ sequelize: db.sequelize, plans: plan });
    } finally {
      db.sequelize.query = originalQuery;
    }
    assert.equal(applied.written, 2);
    assert.equal(writes.length, 2, "每条计划一句 UPDATE");
    for (const sql of writes) {
      assert.match(
        sql,
        new RegExp(`^UPDATE ${CANONICAL_TABLE}\\b`),
        `写入面只允许 ${CANONICAL_TABLE}（实际：${sql}）`,
      );
      for (const forbidden of ["chat_tool_calls", "agent_rounds", "messages"]) {
        assert.doesNotMatch(
          sql,
          new RegExp(`(UPDATE|INSERT\\s+(IGNORE\\s+)?INTO|DELETE\\s+FROM)\\s+${forbidden}\\b`),
          `禁止写 ${forbidden}（实际：${sql}）`,
        );
      }
    }
  });

  test("clearToolErrorBlocks / deriveCanonicalFoldShape 纯函数：只删真值键、列值优先、幂等", () => {
    const record = {
      round: 1,
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "x" }] },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "ok" },
            { type: "tool_result", tool_use_id: "t2", content: "boom", is_error: true },
          ],
        },
      ],
      folded: true,
      foldedRoundRange: { from: 1, to: 2 },
    };
    const cleared = clearToolErrorBlocks({ record, toolUseIds: ["t1", "t2"] });
    assert.deepEqual(cleared.cleared.map((item) => [item.toolUseId, item.messageIndex, item.blockIndex]), [["t2", 1, 1]]);
    assert.equal(Object.hasOwn(cleared.record.messages[1].content[0], "is_error"), false);
    assert.equal(Object.hasOwn(cleared.record.messages[1].content[1], "is_error"), false);
    assert.equal(record.messages[1].content[1].is_error, true, "纯函数不得改入参");
    // 幂等：再删一次没有任何改动
    assert.deepEqual(clearToolErrorBlocks({ record: cleared.record, toolUseIds: ["t2"] }).cleared, []);

    const shaped = deriveCanonicalFoldShape({
      record, columnFolded: Buffer.from([0]), columnFoldedRange: null,
    });
    assert.equal(shaped.record.folded, false);
    assert.equal(Object.hasOwn(shaped.record, "foldedRoundRange"), false);
    assert.equal(shaped.before.foldedRoundRangeAction, "removed");
    assert.equal(shaped.before.hadFolded, true);
    // 列有值 ⇒ 用列的值
    const withRange = deriveCanonicalFoldShape({
      record, columnFolded: 1, columnFoldedRange: { from: 5, to: 6 },
    });
    assert.equal(withRange.record.folded, true);
    assert.deepEqual(withRange.record.foldedRoundRange, { from: 5, to: 6 });
    assert.equal(withRange.before.foldedRoundRangeAction, "set");
    // 幂等：再推一次形状不变
    const again = deriveCanonicalFoldShape({
      record: withRange.record, columnFolded: 1, columnFoldedRange: { from: 5, to: 6 },
    });
    assert.deepEqual(again.record, withRange.record);
  });

  test("--rewrite-record-json：结果与 buildAgentRoundRecordSnapshot 逐字节相等，且幂等", async () => {
    const { id } = await freshFixture("rewrite-record-json");
    const targetKey = `${id}:engine:round:1`;
    // 模拟历史行：写侧当年的白名单把 response 剔掉了
    await db.sequelize.query(
      "UPDATE agent_rounds SET record_json = JSON_REMOVE(record_json, '$.response')"
      + " WHERE request_id = :id AND dedup_key = :key",
      { replacements: { id, key: targetKey } },
    );

    const plans = await planRecordJsonRewrites({ sequelize: db.sequelize, runIds: [id] });
    assert.equal(plans.length, 1);
    assert.equal(plans[0].dedupKey, targetKey);
    assert.deepEqual(plans[0].diff, { onlyExpected: ["response"], onlyActual: [], changed: [] });

    const before = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(countsOf(before.diffs), { record_json_mismatch: 1 });

    const first = await applyRecordJsonRewrites({ sequelize: db.sequelize, plans });
    assert.equal(first.written, 1);

    // 逐字节：盘上的 record_json 必须与**写侧同一份**快照函数的输出完全相同
    const canonicalRows = await loadCanonicalRows({ sequelize: db.sequelize, runId: id });
    const canonicalRow = canonicalRows.find((row) => row.dedupKey === targetKey);
    const expected = JSON.stringify(buildAgentRoundRecordSnapshot(canonicalRow.record).recordSnapshot);
    const [rows] = await db.sequelize.query(
      "SELECT record_json FROM agent_rounds WHERE request_id = :id AND dedup_key = :key",
      { replacements: { id, key: targetKey } },
    );
    assert.equal(rows[0].record_json, expected, "必须与 buildAgentRoundRecordSnapshot 逐字节相等");

    const after = await reconcileRequest({ sequelize: db.sequelize, runId: id });
    assert.deepEqual(after.diffs, []);

    // 幂等：第二次计划为空、写 0 行
    const plans2 = await planRecordJsonRewrites({ sequelize: db.sequelize, runIds: [id] });
    assert.deepEqual(plans2, []);
    const second = await applyRecordJsonRewrites({ sequelize: db.sequelize, plans: plans2 });
    assert.equal(second.written, 0);
  });
}
