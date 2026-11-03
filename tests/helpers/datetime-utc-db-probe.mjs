/**
 * issue #1282 时区口径回归的**子进程探针**（只由 tests/db-datetime-utc.test.mjs 调用）
 *
 * 为什么是子进程：本单的核心判据是「DATETIME 落库口径与**进程 TZ** 无关」。
 * 在父进程里写 `process.env.TZ = 'Asia/Shanghai'` 是假绿——Node 会缓存首次解析出的
 * 时区（`Date` 的本地偏移在进程里定死后不再随环境变量变化），改环境变量不会让 `Date` 改口径。
 * 唯一可靠的办法是**新起一个进程**并在 `spawnSync` 的 `env` 里显式给 `TZ`。
 *
 * 这个探针做的事（全部在 TZ=Asia/Shanghai 的进程里）：
 *   1. 走**模型 create** 通道写一行 messages（`created_at: new Date()`，Sequelize DATE
 *      serializer ⇒ UTC 挂钟，本单不改它，作为「正确口径」的对照臂）；
 *   2. 走**生产真实裸 SQL 通道**写一轮投影：`createTouwakaTranscriptStore().appendRound()`
 *      ——它内部有 4 个裸 SQL 写点（agent_transcript_rounds / agent_rounds / messages /
 *      chat_tool_calls），时间参数全部经 `SqlString.escape` 序列化；
 *   2b. 再走**投影修复写入口** `projectRequest({ apply: true })`：先删掉自己刚写的投影
 *      messages 行制造漂移，让它经 `applyProjectionWrites()` 重新 INSERT 一次
 *      ——issue #1282 点名的病根 `transcript-projection.js` 的 messages 裸 SQL 写点就在这条路上；
 *   3. 每条写入前记下 `Date.now()`（发送时刻 epoch），写完用**DB 侧**函数
 *      `unix_timestamp(col)` 取回真实 epoch（绕开 mysql2 的客户端时区解释；
 *      否则「两个 Date 在 JS 里相等」这种断言会把误差一起挪掉，测不出来）；
 *   4. 按自己插入的 id **只删自己那几行**（`finally` 里必删，探针中途失败也不留脏行），
 *      并复查剩余行数为 0；
 *   5. 把结果打成一行 `__PROBE_RESULT__{json}` 到 stdout（父进程只做断言，不连库）。
 *
 * 退出码：0 = 探针跑完（结论由父进程断言）；2 = 探针本身失败（错误走 stderr）。
 */

import { randomUUID } from "node:crypto";

import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

import { openTestDatabase } from "../helpers/test-db-guard.mjs";
import { createTouwakaTranscriptStore } from "../../lib/llm-kit-adapters/transcript-store.js";
import { projectRequest } from "../../lib/llm-kit-adapters/transcript-projection.js";

const cleanupPlan = [];
let db = null;

async function cleanupOwnRows() {
  const deleted = {};
  const remaining = {};
  for (const [table, keyExpr, whereSql, replacements] of cleanupPlan) {
    // key 里带上被删的值：messages 有两行（模型臂 + 投影臂）走同一条 whereSql，
    // 只用 `${table}:${whereSql}` 会让后一条覆盖前一条的统计。
    const label = `${table}:${keyExpr}=${replacements[0]}`;
    try {
      const [res] = await db.sequelize.query(`DELETE FROM ${table} WHERE ${whereSql}`, { replacements });
      deleted[label] = Number(res?.affectedRows ?? 0);
      const [rows] = await db.sequelize.query(
        `SELECT COUNT(*) AS c FROM ${table} WHERE ${whereSql}`,
        { replacements },
      );
      remaining[label] = Number(rows?.[0]?.c ?? -1);
    } catch (error) {
      deleted[label] = `ERR: ${error.message}`;
      remaining[label] = `ERR: ${error.message}`;
    }
  }
  return { deleted, remaining };
}

function fail(message, extra) {
  process.stderr.write(`[datetime-utc-probe] ${message}\n`);
  if (extra) process.stderr.write(`${JSON.stringify(extra, null, 2)}\n`);
  process.exitCode = 2;
  throw new Error(`[datetime-utc-probe] ${message}`);
}

/** DB 侧取挂钟 + 真实 epoch：cast 成 char 看落库字面值，unix_timestamp 看真实秒 */
async function readRow({ table, keyExpr, wallColumn = "created_at", whereSql, replacements }) {
  const [rows] = await db.sequelize.query(
    `SELECT ${keyExpr} AS row_key, cast(${wallColumn} as char) AS wall,
            unix_timestamp(${wallColumn}) AS epoch
       FROM ${table} WHERE ${whereSql} LIMIT 1`,
    { replacements },
  );
  const row = rows?.[0];
  if (!row) fail(`回读失败：${table} 里找不到刚写入的行`, { whereSql, replacements });
  return { key: row.row_key, wall: row.wall, epoch: Number(row.epoch) };
}

let result;
try {
  const dbCtx = await openTestDatabase();
  if (!dbCtx) fail("缺少测试库凭据（~/.config/mcp/creds/touwaka-test-db.json），探针无法取证");
  db = dbCtx.db;
  const sequelize = db.sequelize;

  const ns = randomUUID().slice(0, 8);
  const runId = `run-${ns}-tz1282`;
  const toolUseId = `tz1282_${ns}_t1`;

  const [[userRow]] = await sequelize.query("SELECT id FROM users LIMIT 1");
  const userId = userRow?.id;
  if (!userId) fail("测试库 users 表为空：模型 create 通道需要合法 user_id（FK），无法取证");

  // ── 臂 A：模型 create 通道（Sequelize DATE serializer，UTC 口径的参照）────────
  const modelMessageId = `tz1282_${ns}_model`;
  const modelSentMs = Date.now();
  await db.getModel("message").create({
    id: modelMessageId,
    request_id: runId,
    topic_id: null,
    user_id: userId,
    expert_id: null,
    role: "user",
    content: `tz1282 model arm ${ns}`,
    created_at: new Date(modelSentMs),
  });
  cleanupPlan.push(["messages", "id", "id = ?", [modelMessageId]]);
  const modelRow = await readRow({
    table: "messages", keyExpr: "id", whereSql: "id = ?", replacements: [modelMessageId],
  });

  // ── 臂 B：生产真实裸 SQL 通道（appendRound → 4 个 raw insert）──────────────
  // record.ts 给 ISO（含 Z）⇒ store 内部 `new Date(record.ts)` 得到同一时刻；
  // 这条 Date 随后经 `SqlString.escape(Date)` 进 replacements，正是本单的病根所在。
  const rawSentMs = Date.now();
  const record = {
    round: 1,
    roundKey: `${runId}:round:1`,
    dedupKey: `${runId}:engine:round:1`,
    ts: new Date(rawSentMs).toISOString(),
    messages: [
      { role: "user", content: [{ type: "text", text: `tz1282 raw arm ${ns}` }] },
      { role: "assistant", content: [{ type: "tool_use", id: toolUseId, name: "noop", input: { a: 1 } }] },
    ],
    response: {
      content: [{ type: "tool_use", id: toolUseId, name: "noop", input: { a: 1 } }],
      stopReason: "tool_use",
    },
    textPreview: "",
    toolUses: 1,
  };

  const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };
  const store = createTouwakaTranscriptStore({
    db,
    requestContext: { topic_id: null, user_id: userId, expert_id: null },
    logger: noopLogger,
  });
  await store.appendRound(runId, record);

  const [roundRows] = await sequelize.query("SELECT id FROM agent_rounds WHERE request_id = ? LIMIT 1", {
    replacements: [runId],
  });
  const roundId = roundRows?.[0]?.id;
  if (!roundId) fail("appendRound 没有写出 agent_rounds 行", { runId });
  cleanupPlan.push(["agent_rounds", "id", "id = ?", [roundId]]);

  const [canonicalRows] = await sequelize.query(
    "SELECT id FROM agent_transcript_rounds WHERE request_id = ? LIMIT 1",
    { replacements: [runId] },
  );
  const canonicalId = canonicalRows?.[0]?.id;
  if (!canonicalId) fail("appendRound 没有写出 agent_transcript_rounds 行", { runId });
  cleanupPlan.push(["agent_transcript_rounds", "id", "id = ?", [canonicalId]]);

  const [messageRows] = await sequelize.query(
    "SELECT id FROM messages WHERE round_id = ? AND sequence_no = 0 LIMIT 1",
    { replacements: [roundId] },
  );
  const projectionMessageId = messageRows?.[0]?.id;
  if (!projectionMessageId) fail("appendRound 没有写出投影 messages 行", { roundId });
  cleanupPlan.push(["messages", "id", "id = ?", [projectionMessageId]]);
  cleanupPlan.push(["chat_tool_calls", "tool_use_id", "tool_use_id = ?", [toolUseId]]);

  const projectionMessageRow = await readRow({
    table: "messages", keyExpr: "id", whereSql: "id = ?", replacements: [projectionMessageId],
  });
  const agentRoundRow = await readRow({
    table: "agent_rounds", keyExpr: "id", whereSql: "id = ?", replacements: [roundId],
  });
  const toolCallRow = await readRow({
    table: "chat_tool_calls", keyExpr: "tool_use_id", whereSql: "tool_use_id = ?", replacements: [toolUseId],
  });
  const canonicalCreated = await readRow({
    table: "agent_transcript_rounds", keyExpr: "id", wallColumn: "created_at",
    whereSql: "id = ?", replacements: [canonicalId],
  });
  const canonicalUpdated = await readRow({
    table: "agent_transcript_rounds", keyExpr: "id", wallColumn: "updated_at",
    whereSql: "id = ?", replacements: [canonicalId],
  });

  // ── 臂 C：投影修复写入口 projectRequest({apply:true}) ────────────────────────
  // 制造漂移：删掉自己刚写的投影 messages 行（自己的行，允许删），让 reconcile 判出缺行，
  // apply 时走 applyProjectionWrites() 的裸 SQL INSERT —— issue #1282 点名的病根就在这条路上。
  const [manualDelete] = await sequelize.query(
    "DELETE FROM messages WHERE id = ?",
    { replacements: [projectionMessageId] },
  );
  const manualDeletes = { projectionMessage: Number(manualDelete?.affectedRows ?? 0) };
  const applySentMs = Date.now();
  const applied = await projectRequest({
    sequelize,
    runId,
    database: dbCtx.creds?.database ?? "",
    apply: true,
    requestContext: { topic_id: null, user_id: userId, expert_id: null },
  });
  const [reinsertedRows] = await sequelize.query(
    "SELECT id FROM messages WHERE round_id = ? AND sequence_no = 0 LIMIT 1",
    { replacements: [roundId] },
  );
  const reinsertedId = reinsertedRows?.[0]?.id;
  if (!reinsertedId) fail("projectRequest({apply:true}) 没有补回投影 messages 行", { runId });
  cleanupPlan.push(["messages", "id", "id = ?", [reinsertedId]]);
  const projectionAppliedRow = await readRow({
    table: "messages", keyExpr: "id", whereSql: "id = ?", replacements: [reinsertedId],
  });

  result = {
    ns,
    runId,
    tz: {
      env: process.env.TZ,
      // getTimezoneOffset() 的符号与直觉相反：UTC+8 ⇒ -480
      offsetMinutes: new Date().getTimezoneOffset(),
      // 同一时刻在本进程里的本地小时（用来证明 TZ 真的生效，而不是被忽略）
      localHours: new Date(rawSentMs).getHours(),
    },
    sentMs: { model: modelSentMs, raw: rawSentMs, apply: applySentMs },
    appliedWritten: applied?.written ?? null,
    manualDeletes,
    rows: {
      modelMessage: modelRow,
      projectionMessage: projectionMessageRow,
      projectionAppliedMessage: projectionAppliedRow,
      agentRound: agentRoundRow,
      chatToolCall: toolCallRow,
      canonicalCreated,
      canonicalUpdated,
    },
  };
} catch (error) {
  if (db) {
    const { deleted, remaining } = await cleanupOwnRows();
    process.stderr.write(`[datetime-utc-probe] 失败后清理：${JSON.stringify({ deleted, remaining })}\n`);
  }
  if (!process.exitCode) process.exitCode = 2;
  throw error;
}

// ── 正常路径清理：按自己插入的 id 逐条删（只删自己插的，不碰既有行）──────────────
const { deleted, remaining } = await cleanupOwnRows();
result.deleted = deleted;
result.remaining = remaining;
// 汇总数：cleanup 里删掉的行数 / 清理后剩余的行数（父进程断言这两个数就够，
// 逐条明细只用于失败时的诊断输出）
result.deletedTotal = Object.values(deleted).reduce((sum, value) => sum + (Number(value) || 0), 0);
result.remainingTotal = Object.values(remaining).reduce((sum, value) => sum + (Number(value) || 0), 0);

if (typeof db.close === "function") await db.close();
else if (db.sequelize) await db.sequelize.close();

process.stdout.write(`__PROBE_RESULT__${JSON.stringify(result)}\n`);
