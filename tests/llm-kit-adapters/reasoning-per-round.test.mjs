/**
 * #1237 切片 A —— **终稿不再用跨轮累积思考覆盖末轮行** + 存量按轮回填（`--fix-reasoning`）
 *
 * 缺陷（已证）：`lib/agent/agent-loop.js` 的 `onReasoningDelta` 把**每一轮**的思考累进
 * `fullReasoningContent`；终稿落库时 `lib/chat-service.js#saveAssistantMessageAndCompleteRequest`
 * 把整段累积串当 `reasoning_content` UPDATE 到**最后一轮**的 assistant 行上，覆盖该行原本的
 * 本轮值 ⇒ 同一份思考在同一请求里存两遍（前面几轮各一份 + 末行整段）、显示两遍。
 *
 * 覆盖目标（每格一个 `test()`，名字要能被 `not ok N - <格名>` 精确指认）：
 *   1. 终稿 UPDATE 后末轮行 `reasoning_content` == **本轮** canonical 值，`content` == 终稿正文，
 *      计量列照旧更新（证明只改了该改的）；
 *   2. **回归钉子**：跨轮请求跑完后末行 `reasoning_content` **不得**等于整段累积串
 *      （旧实现下这一格必红：对账会把它归 `host_enriched_reasoning`）；
 *   3. 拼接等式：新写入后「各轮 `reasoning_content` 按轮序拼接」== 旧实现的累积串
 *      （切片 B 的读侧拼接要复现的就是这条等式）；
 *   4. legacy 读档不受影响：`store.load()` 的 legacy 路径读 `messages.reasoning_content`，
 *      按轮存之后它拼出来的 reasoning 块仍与 canonical 逐轮一致（不许“删断言”了事）；
 *   5. `--fix-reasoning` 三格方向（A 改 / B 不动 / C 不动且被点名）+ 幂等；
 *   6. 单表不变量探针：`--fix-reasoning` 只发 `UPDATE messages`，不写
 *      `agent_transcript_rounds` / `agent_rounds` / `chat_tool_calls`；计划阶段零写 SQL。
 *
 * 依赖：真库 `llm_kit_test`（`~/.config/mcp/creds/touwaka-test-db.json`，缺失则 skip）。
 * 与 `transcript-projection-reconcile.test.mjs` 共用同一套清理约定（本文件自带 request 前缀）。
 */

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import logger from "../../lib/logger.js";
// logs/ 目录可能非本用户属主：屏蔽文件写入，别让日志权限错误盖住断言。
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}
logger.logFile = "/tmp/touwaka-1237-reasoning-per-round.log";

const { openTestDatabase, DEFAULT_CREDS_PATH } = await import("../helpers/test-db-guard.mjs");
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;
const db = dbCtx?.db ?? null;

// ChatService 建实例时读 DB_*（agent-loop → upgrade-database 一带的既有约定），先落地凭据。
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
  REASONING_DIRECTIONS,
  REASONING_C_SUBCLASSES,
  applyReasoningRewrites,
  assertDriftBackfillAllowed,
  collectReasoningDirections,
  deriveProjectedRows,
  loadCanonicalRows,
  loadProjectionRows,
  planReasoningRewrites,
  reconcileRequest,
  summarizeReasoningDirections,
} = await import("../../lib/llm-kit-adapters/transcript-projection.js");
const {
  createTouwakaTranscriptStore,
  TRANSCRIPT_READ_MODE_ENV,
  TRANSCRIPT_READ_MODE_LEGACY,
  CANONICAL_TABLE,
} = await import("../../lib/llm-kit-adapters/transcript-store.js");
const { default: AgentLoop } = await import("../../lib/agent/agent-loop.js");
const { default: ChatService } = await import("../../lib/chat-service.js");

const ns = randomUUID().slice(0, 8);
const REQUEST_PREFIX = `run-1237a-${ns}-`;
const skipReason = creds ? false : `缺少凭据 ${CREDS_PATH}`;

let testUserId = "u_1237a";
let testExpertId = null;
if (db) {
  const [users] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  const [experts] = await db.sequelize.query("SELECT id FROM experts LIMIT 1");
  testUserId = users[0]?.id ?? "u_1237a";
  testExpertId = experts[0]?.id ?? null;
}

async function cleanupRequest(id) {
  if (!db) return;
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

after(async () => {
  if (!db) return;
  for (const table of [CANONICAL_TABLE, "agent_rounds"]) {
    const [rows] = await db.sequelize.query(
      `SELECT DISTINCT request_id AS rid FROM ${table} WHERE request_id LIKE :pattern`,
      { replacements: { pattern: `${REQUEST_PREFIX}%` } },
    );
    for (const row of rows) await cleanupRequest(row.rid);
  }
  await db.close();
});

// ============================================================================
// ① 真跑一轮跨轮请求（agent-loop 累积 + 终稿单写），逐格断言
// ============================================================================

const REASONING_R1 = "R1-第一轮：先看目录结构，确认入口文件位置。";
const REASONING_R2 = "R2-第二轮：信息够了，直接给结论。";
const FINAL_TEXT = "任务完成 Final answer";
const TOOL_TEXT = "Need tool";

let scenario = null;

/** 两轮脚本化专家服务：两轮都吐 reasoning（正是缺陷的触发条件）。 */
function createTwoRoundExpertService(toolCallId) {
  const toolCall = {
    id: toolCallId,
    type: "function",
    function: { name: "echo", arguments: "{\"value\":42}" },
  };
  let streamCalls = 0;
  return {
    expertConfig: { expert: { max_tool_rounds: 5, context_strategy: "full" } },
    llmClient: {
      getExpertLLMParams() {
        return { temperature: 0.7, top_p: 1, frequency_penalty: 0, presence_penalty: 0 };
      },
      async callStream(_modelConfig, _messages, options) {
        streamCalls += 1;
        options.onUsage({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 });
        if (streamCalls === 1) {
          options.onReasoningDelta(REASONING_R1);
          options.onDelta(TOOL_TEXT);
          options.onToolCall([toolCall]);
          return;
        }
        options.onReasoningDelta(REASONING_R2);
        options.onDelta(FINAL_TEXT);
      },
      // erix 0.12 forceFinalIfNeeded 走非流式 provider.chat → llmClient.call
      async call() {
        return { content: FINAL_TEXT };
      },
    },
    toolManager: {
      formatToolDisplay(toolId) {
        return `Tool: ${toolId}`;
      },
      formatToolResultsForLLM(results) {
        return results.map((item) => ({
          role: "tool",
          tool_call_id: item.toolCallId,
          content: JSON.stringify({ success: item.success, data: item.data, error: item.error }),
        }));
      },
    },
    createToolResult(call) {
      return {
        success: true,
        data: { value: 42 },
        duration: 5,
        toolCallId: call.id,
        toolName: call.name,
      };
    },
    async handleToolCalls() {
      throw new Error("runErix should use execute_tools");
    },
    _consumeDocRetrievalResult() {
      return { found: false };
    },
  };
}

/** 按**轮序**读 `messages.reasoning_content`（切片 B 的读侧拼接口径：round_no, sequence_no）。 */
async function reasoningRowsInRoundOrder(requestId) {
  const [rows] = await db.sequelize.query(
    `SELECT m.id, m.round_id, m.role, m.content, m.reasoning_content,
            r.round_no, m.sequence_no, r.dedup_key
       FROM messages AS m
       JOIN agent_rounds AS r ON r.id = m.round_id
      WHERE r.request_id = :requestId
      ORDER BY r.round_no ASC, m.sequence_no ASC, m.id ASC`,
    { replacements: { requestId } },
  );
  return rows.map((row) => ({
    id: row.id,
    roundId: row.round_id,
    role: row.role,
    content: row.content,
    reasoningContent: row.reasoning_content,
    roundNo: Number(row.round_no),
    sequenceNo: Number(row.sequence_no),
    dedupKey: row.dedup_key,
  }));
}

before(async () => {
  if (!db) return;
  const requestId = `${REQUEST_PREFIX}e2e`;
  const toolCallId = `tool-${ns}`;
  await cleanupRequest(requestId);
  try {
    const loop = new AgentLoop({
      db,
      execute_tools: async (expertService, input) => {
        const call = input.collectedToolCalls[0];
        const result = expertService.createToolResult(call);
        input.onDelta?.({ type: "tool_result", result });
        return [result];
      },
      save_llm_payload: () => {},
      generate_tool_call_summary: () => "summary",
    });
    const result = await loop.runErix(createTwoRoundExpertService(toolCallId), {
      modelConfig: { model_name: "test-model", context_window_tokens: 32768, max_output_tokens: 2048 },
      thinkingConfig: {
        thinking: false,
        reasoning: null,
        reasoning_effort: null,
        enable_thinking: false,
        chat_template_kwargs: null,
      },
      tools: [{
        type: "function",
        function: { name: "echo", description: "Echo input", parameters: { type: "object" } },
      }],
      currentMessages: [{ role: "user", content: "hello" }],
      llmPayload: { _debug: {} },
      user_id: testUserId,
      expert_id: testExpertId,
      taskContext: { workspace_mode: "test" },
      topic_id: null,
      task_id: null,
      session: { accessToken: "token" },
      request_id: requestId,
    });

    const before = await reasoningRowsInRoundOrder(requestId);
    // 终稿单写：**逐字模拟 chat-service 的真实调用**（`reasoning_content` 传的就是累积串）。
    const chatService = new ChatService(db);
    const assistantMessageId = await chatService.saveAssistantMessageAndCompleteRequest(
      null,
      testUserId,
      FINAL_TEXT,
      {
        request_id: requestId,
        prompt_tokens: 12,
        completion_tokens: 34,
        latency_ms: 56,
        model_name: "test-model",
        provider_name: "test-provider",
        expert_id: testExpertId,
        reasoning_content: result.fullReasoningContent,
      },
    );

    const after = await reasoningRowsInRoundOrder(requestId);
    const [finalRow] = await db.sequelize.query(
      `SELECT id, role, content, reasoning_content, prompt_tokens, completion_tokens, latency_ms,
              model_name, provider_name, round_id
         FROM messages WHERE id = :id`,
      { replacements: { id: assistantMessageId } },
    );

    // canonical 侧逐轮 reasoning（与对账器/回填器同一份推导，不另写口径）。
    const canonicalRows = await loadCanonicalRows({ sequelize: db.sequelize, runId: requestId });
    const expected = deriveProjectedRows({ canonicalRows, runId: requestId });
    const canonicalReasoningByRound = expected.messages
      .filter((row) => row.reasoningContent !== null)
      .map((row) => ({ dedupKey: row.ownerDedupKey, sequenceNo: row.sequenceNo, text: row.reasoningContent }));

    scenario = {
      requestId,
      assistantMessageId,
      fullReasoningContent: result.fullReasoningContent,
      fullContent: result.fullContent,
      rowsBefore: before,
      rowsAfter: after,
      finalRow: finalRow[0],
      canonicalReasoningByRound,
      reconciliation: await reconcileRequest({ sequelize: db.sequelize, runId: requestId }),
    };
  } catch (error) {
    await cleanupRequest(requestId);
    throw error;
  }
});

test("终稿 UPDATE 后末轮行 reasoning_content 等于本轮 canonical 值，content 是终稿正文", {
  skip: skipReason,
}, () => {
  assert.ok(scenario, "场景必须先跑起来（before 里跑了一轮两轮请求）");
  const { finalRow, rowsAfter, canonicalReasoningByRound } = scenario;
  assert.ok(finalRow, "终稿必须绑定到一条 canonical 行（round_id 非空）");
  assert.ok(finalRow.round_id, "终稿行必须带 round_id（不是兜底 INSERT 的宿主行）");

  const lastRoundNo = Math.max(...rowsAfter.map((row) => row.roundNo));
  const lastRoundAssistant = rowsAfter.filter(
    (row) => row.roundNo === lastRoundNo && row.role === "assistant",
  );
  assert.equal(lastRoundAssistant.length, 1, "末轮应恰好一条 assistant 行");
  assert.equal(finalRow.id, lastRoundAssistant[0].id, "终稿 UPDATE 命中的就是末轮 assistant 行");

  const canonicalLastRound = canonicalReasoningByRound
    .filter((row) => row.dedupKey === lastRoundAssistant[0].dedupKey);
  assert.equal(canonicalLastRound.length, 1, "末轮 canonical 应有一条带 reasoning 的 assistant 消息");
  assert.equal(
    finalRow.reasoning_content,
    canonicalLastRound[0].text,
    "末轮行的 reasoning_content 必须等于**本轮** canonical 值（不被累积串覆盖）",
  );
  assert.equal(
    finalRow.reasoning_content,
    REASONING_R2,
    "末轮值就是第二轮自己那段思考",
  );

  // 只改了该改的：正文与计量列照旧更新。
  assert.equal(finalRow.content, FINAL_TEXT, "content 仍更新为终稿正文");
  assert.equal(Number(finalRow.prompt_tokens), 12, "prompt_tokens 照旧更新");
  assert.equal(Number(finalRow.completion_tokens), 34, "completion_tokens 照旧更新");
  assert.equal(Number(finalRow.latency_ms), 56, "latency_ms 照旧更新");
  assert.equal(finalRow.model_name, "test-model", "model_name 照旧更新");
  assert.equal(finalRow.provider_name, "test-provider", "provider_name 照旧更新");
});

test("回归钉子：跨轮请求跑完后末行不得等于整段累积串（旧实现下必红）", {
  skip: skipReason,
}, () => {
  const { rowsAfter, fullReasoningContent, finalRow, reconciliation } = scenario;
  assert.equal(
    fullReasoningContent,
    REASONING_R1 + REASONING_R2,
    "agent-loop 的 fullReasoningContent 仍是跨轮累积串（SSE 侧还要用它，切片 B 才收口）",
  );
  assert.notEqual(
    finalRow.reasoning_content,
    fullReasoningContent,
    "末行 reasoning_content **不得**等于整段累积串（旧实现就是这样覆盖的）",
  );
  assert.equal(
    finalRow.reasoning_content.length,
    REASONING_R2.length,
    "末行长度必须是本轮那段的长度，而不是整段累积串的长度",
  );

  const assistantRows = rowsAfter.filter((row) => row.role === "assistant");
  for (const row of assistantRows) {
    assert.notEqual(
      row.reasoningContent,
      fullReasoningContent,
      `任何一轮的行都不该存整段累积串：${row.dedupKey}`,
    );
  }

  // 同一份思考不得重复存：各行 reasoning 拼接恰好是累积串（不是它的真超集）。
  const spliced = assistantRows.map((row) => row.reasoningContent ?? "").join("");
  assert.equal(spliced, fullReasoningContent, "按轮拼接恰好等于累积串 ⇒ 没有多存也没有少存");

  // 对账器口径：旧实现下这里会报 `host_enriched_reasoning`（非缺陷但正是本单要消灭的形态）。
  assert.equal(
    reconciliation.counts.host_enriched_reasoning ?? 0,
    0,
    "写侧修好后新请求不应再产生 host_enriched_reasoning",
  );
  assert.deepEqual(
    Object.keys(reconciliation.counts).filter((kind) => kind !== "host_enriched_reasoning"),
    [],
    `终稿单写后不该留下任何投影差异（实际：${JSON.stringify(reconciliation.counts)}）`,
  );
});

test("拼接等式：各轮 reasoning_content 按轮序拼接 == 旧实现的累积串", {
  skip: skipReason,
}, () => {
  const { rowsAfter, fullReasoningContent } = scenario;
  const perRound = rowsAfter
    .filter((row) => row.role === "assistant")
    .map((row) => row.reasoningContent ?? "");
  assert.deepEqual(
    perRound,
    [REASONING_R1, REASONING_R2],
    "每轮各自只存本轮那段（按轮序：[R1, R2]）",
  );
  assert.equal(
    perRound.join(""),
    fullReasoningContent,
    "读侧拼接（按 round_no, sequence_no 顺序无分隔 join）必须逐字复现旧实现的累积串——切片 B 就靠这条等式保持展示等价",
  );
});

test("legacy 读档：按轮存 reasoning 后 store.load() 的 legacy 装配仍与 canonical 逐轮一致", {
  skip: skipReason,
}, async () => {
  const { requestId, rowsAfter, fullReasoningContent } = scenario;
  const store = createTouwakaTranscriptStore({
    db,
    requestContext: { topic_id: null, user_id: testUserId, expert_id: testExpertId },
  });
  const previous = process.env[TRANSCRIPT_READ_MODE_ENV];
  process.env[TRANSCRIPT_READ_MODE_ENV] = TRANSCRIPT_READ_MODE_LEGACY;
  let legacyRecords;
  try {
    legacyRecords = await store.load(requestId);
  } finally {
    if (previous === undefined) delete process.env[TRANSCRIPT_READ_MODE_ENV];
    else process.env[TRANSCRIPT_READ_MODE_ENV] = previous;
  }
  assert.ok(Array.isArray(legacyRecords) && legacyRecords.length > 0, "legacy 读档必须读得回来");

  // legacy 路径读 `messages.reasoning_content`（reconstructMessages → canonicalFromRow 的 reasoning 块），
  // 按轮存之后它拼出来的 reasoning 必须**逐轮**等于本轮值，且整段拼接仍是累积串。
  const legacyReasoning = [];
  for (const record of legacyRecords) {
    for (const message of record.messages ?? []) {
      if (message?.role !== "assistant") continue;
      const text = (Array.isArray(message.content) ? message.content : [])
        .filter((block) => block?.type === "reasoning")
        .map((block) => String(block.text ?? ""))
        .join("\n");
      if (text) legacyReasoning.push(text);
    }
  }
  const dbReasoning = rowsAfter
    .filter((row) => row.role === "assistant")
    .map((row) => row.reasoningContent ?? "")
    .filter(Boolean);
  assert.deepEqual(legacyReasoning, dbReasoning, "legacy 装配出的 reasoning 块逐轮等于 messages 列值");
  assert.deepEqual(legacyReasoning, [REASONING_R1, REASONING_R2], "legacy 读出来的仍是两轮各自那段");
  assert.equal(
    legacyReasoning.join(""),
    fullReasoningContent,
    "legacy 读档拼出来仍是整段累积串（回填没有让 legacy 丢内容）",
  );
  // 正文侧同样不受影响：末轮正文是终稿。
  const legacyTexts = legacyRecords
    .flatMap((record) => record.messages ?? [])
    .filter((message) => message?.role === "assistant")
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((block) => block?.type === "text")
    .map((block) => String(block.text ?? ""));
  assert.ok(legacyTexts.includes(FINAL_TEXT), "legacy 读档仍能看到终稿正文");
});

// ============================================================================
// ② `--fix-reasoning` 三格方向 + 单表不变量（fixture 造 A/B/C 各一行）
// ============================================================================

const FIX_R1 = "FIX-R1-甲";
const FIX_R2 = "FIX-R2-乙";
const FIX_ACCUMULATED = FIX_R1 + FIX_R2;
// C-opaque 的列值：**不等于**逐字拼接（这里故意少一个字符）⇒ 来路不明，禁止猜。
const FIX_OPAQUE = FIX_ACCUMULATED.slice(0, -1);

/**
 * 四轮 fixture（每轮一行 canonical + 它自己的 messages 行）：
 *   round 1 assistant reasoning `FIX-R1`  ⇒ **B**（列 == canonical）
 *   round 2 assistant reasoning `FIX-R2`  ⇒ **A**（列被写成累积串）
 *   round 3 assistant **无** reasoning，列 = 累积串 ⇒ **C-derived**（可证明是本缺陷产物 ⇒ 清 NULL）
 *   round 4 assistant **无** reasoning，列 = 拼接**少一个字符** ⇒ **C-opaque**（来路不明 ⇒ 不动只点名）
 *
 * round 3/4 同时验证 C 格的**两条判据缺一不可**：两行都满足 (a)「canonical 本轮为空」，
 * 只有 (b)「列值 == 逐字拼接」把它们分开。
 */
async function seedReasoningFixture(label) {
  const id = `${REQUEST_PREFIX}${label}`;
  await cleanupRequest(id);
  const store = createTouwakaTranscriptStore({
    db,
    requestContext: { topic_id: null, user_id: testUserId, expert_id: testExpertId },
  });
  const records = [
    {
      round: 1,
      dedupKey: `${id}:engine:round:1`,
      ts: "2026-11-01T10:00:01.000Z",
      messages: [{
        role: "assistant",
        content: [{ type: "reasoning", text: FIX_R1 }, { type: "text", text: "t1" }],
      }],
    },
    {
      round: 2,
      dedupKey: `${id}:engine:round:2`,
      ts: "2026-11-01T10:00:02.000Z",
      messages: [{
        role: "assistant",
        content: [{ type: "reasoning", text: FIX_R2 }, { type: "text", text: "t2" }],
      }],
    },
    {
      round: 3,
      dedupKey: `${id}:engine:round:3`,
      ts: "2026-11-01T10:00:03.000Z",
      messages: [{ role: "assistant", content: [{ type: "text", text: "t3" }] }],
    },
    {
      round: 4,
      dedupKey: `${id}:engine:round:4`,
      ts: "2026-11-01T10:00:04.000Z",
      messages: [{ role: "assistant", content: [{ type: "text", text: "t4" }] }],
    },
  ];
  for (const record of records) await store.appendRound(id, record);

  const rows = await reasoningRowsInRoundOrder(id);
  const byRound = new Map(rows.map((row) => [row.roundNo, row]));
  // 复现缺陷：round 2 / round 3 的列被宿主写成整段累积串（round 3 的 canonical 本轮无 reasoning）。
  await db.sequelize.query(
    "UPDATE messages SET reasoning_content = :value WHERE id = :id",
    { replacements: { value: FIX_ACCUMULATED, id: byRound.get(2).id } },
  );
  await db.sequelize.query(
    "UPDATE messages SET reasoning_content = :value WHERE id = :id",
    { replacements: { value: FIX_ACCUMULATED, id: byRound.get(3).id } },
  );
  // round 4：同样是「canonical 本轮无 reasoning + 列有值」，但列值**不是**那个拼接 ⇒ C-opaque。
  await db.sequelize.query(
    "UPDATE messages SET reasoning_content = :value WHERE id = :id",
    { replacements: { value: FIX_OPAQUE, id: byRound.get(4).id } },
  );
  return { id, roundRowIds: byRound, store };
}

/** 记录所有 SQL 的 sequelize 代理：只读放行、写语句登记后放行（供单表不变量断言）。 */
function withSqlRecorder(sequelize, fn) {
  const originalQuery = sequelize.query.bind(sequelize);
  const seen = [];
  const writePattern = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE)\b/i;
  const restore = () => {
    sequelize.query = originalQuery;
  };
  sequelize.query = async (sql, options) => {
    const text = typeof sql === "string" ? sql : sql?.query;
    const flat = String(text ?? "").replace(/\s+/g, " ").trim();
    if (writePattern.test(flat)) seen.push(flat);
    return originalQuery(sql, options);
  };
  return Promise.resolve(fn(seen)).finally(restore);
}

test("--fix-reasoning 三格方向：A 改回本轮值、B 不动、C-derived 清空、C-opaque 不动且被点名", {
  skip: skipReason,
}, async () => {
  const { id, roundRowIds } = await seedReasoningFixture("fix-abc");
  try {
    const directions = await collectReasoningDirections({ sequelize: db.sequelize, runIds: [id] });
    const summary = summarizeReasoningDirections(directions);
    assert.deepEqual(
      { A: summary.A, B: summary.B, C: summary.C },
      { A: 1, B: 1, C: 2 },
      `三格命中：A=1 / B=1 / C=2（实际：${JSON.stringify(directions.map((row) => [row.direction, row.subClass, row.roundId]))}）`,
    );
    // C 格**按可推导性**再分两类：放宽的是判据粒度，不是纪律。
    assert.deepEqual(
      { derived: summary.C_derived, opaque: summary.C_opaque },
      { derived: 1, opaque: 1 },
      "C-derived 一行（可证明是本缺陷产物）/ C-opaque 一行（来路不明）",
    );

    const rowOf = (direction, subClass) => directions.filter(
      (row) => row.direction === direction && (subClass === undefined || row.subClass === subClass),
    );
    const aRow = rowOf("A")[0];
    const bRow = rowOf("B")[0];
    const derivedRow = rowOf("C", "C-derived")[0];
    const opaqueRow = rowOf("C", "C-opaque")[0];

    // A 格
    assert.equal(aRow.roundId, roundRowIds.get(2).roundId, "A 格是 round 2（canonical 有值、列是累积串）");
    assert.equal(aRow.canonicalValue, FIX_R2, "A 格的 canonical 值是本轮那段");
    assert.equal(aRow.columnValue, FIX_ACCUMULATED, "A 格的列值是累积串");
    assert.equal(aRow.columnEqualsAccumulated, true, "A 格列值逐字等于各轮拼接");
    assert.equal(aRow.action, "set-canonical", "A 格动作：改回本轮 canonical 值");
    assert.equal(aRow.subClass, null, "A 格不属 C 子类");

    // B 格
    assert.equal(bRow.action, "none", "B 格无需动作");
    assert.equal(bRow.columnValue, FIX_R1, "B 格列值本来就等于本轮 canonical 值");

    // C-derived：两条判据同时成立（canonical 本轮空 + 列值 == 逐字拼接）
    assert.equal(derivedRow.roundId, roundRowIds.get(3).roundId, "C-derived 是 round 3");
    assert.equal(derivedRow.canonicalValue, null, "C-derived 的 canonical 本轮确实没有 reasoning");
    assert.equal(derivedRow.columnValue, FIX_ACCUMULATED, "C-derived 的列值是那个拼接");
    assert.equal(derivedRow.columnEqualsAccumulated, true, "C-derived 的旁证：列值逐字等于拼接");
    assert.equal(derivedRow.action, "clear-to-null", "C-derived 动作：清成 NULL");

    // C-opaque：只有 (a) 成立、(b) 不成立 ⇒ 不动
    assert.equal(opaqueRow.roundId, roundRowIds.get(4).roundId, "C-opaque 是 round 4");
    assert.equal(opaqueRow.canonicalValue, null, "C-opaque 的 canonical 本轮也没有 reasoning");
    assert.equal(opaqueRow.columnValue, FIX_OPAQUE, "C-opaque 的列值是拼接**少一个字符**");
    assert.equal(opaqueRow.columnEqualsAccumulated, false, "C-opaque 的列值 ≠ 逐字拼接 ⇒ 来路不明");
    assert.equal(opaqueRow.action, "report-only", "C-opaque 只点名，不改（不猜）");
    assert.ok(REASONING_DIRECTIONS.C.length > 0, "C 格方向必须有稳定标签（报告里可读）");
    assert.ok(REASONING_C_SUBCLASSES.DERIVED === "C-derived" && REASONING_C_SUBCLASSES.OPAQUE === "C-opaque",
      "子类名稳定（报告与 README 用同一组字符串）");

    const plans = planReasoningRewrites({ directions });
    assert.equal(plans.length, 2, "计划收 A 格 + C-derived 两行（C-opaque 不进计划）");
    const planOfA = plans.find((plan) => plan.direction === "A");
    const planOfDerived = plans.find((plan) => plan.direction === "C");
    assert.equal(planOfA.messageId, roundRowIds.get(2).id, "计划定位到 A 格那行的主键");
    assert.equal(planOfA.newValue, FIX_R2, "A 格计划的新值是本轮 canonical 值");
    assert.equal(planOfDerived.messageId, roundRowIds.get(3).id, "计划定位到 C-derived 那行的主键");
    assert.equal(planOfDerived.newValue, null, "C-derived 计划的目标值是 NULL");
    assert.equal(planOfDerived.subClass, "C-derived", "计划条目带子类名（可审计）");

    const applied = await applyReasoningRewrites({ sequelize: db.sequelize, plans });
    assert.equal(applied.written, 2, "第一次写 2 行（A + C-derived）");

    const rows = await reasoningRowsInRoundOrder(id);
    const byRound = new Map(rows.map((row) => [row.roundNo, row]));
    assert.equal(byRound.get(2).reasoningContent, FIX_R2, "A 格：列已改回本轮值");
    assert.equal(byRound.get(1).reasoningContent, FIX_R1, "B 格：一行未动");
    assert.equal(byRound.get(3).reasoningContent, null, "C-derived：列已清成 NULL");
    assert.equal(byRound.get(4).reasoningContent, FIX_OPAQUE, "C-opaque：**一行未动**（只点名，不猜）");

    // 复账：A 与 C-derived 归零，C-opaque 仍被点名（不静默）。
    const after = await collectReasoningDirections({ sequelize: db.sequelize, runIds: [id] });
    const afterSummary = summarizeReasoningDirections(after);
    assert.deepEqual(
      { A: afterSummary.A, B: afterSummary.B, C: afterSummary.C, derived: afterSummary.C_derived },
      { A: 0, B: 2, C: 1, derived: 0 },
      "回填后 A / C-derived 归零，C-opaque 仍在报告里",
    );
    assert.equal(
      after.filter((row) => row.direction === "C")[0].subClass,
      "C-opaque",
      "点名时子类名必须是 C-opaque",
    );

    // 幂等：第二次写 0 行。
    const secondApply = await applyReasoningRewrites({
      sequelize: db.sequelize,
      plans: planReasoningRewrites({ directions: after }),
    });
    assert.equal(secondApply.written, 0, "第二次写 0 行（幂等）");
  } finally {
    await cleanupRequest(id);
  }
});

test("C-derived 清成 NULL 而不是空串（读侧对 NULL 与 '' 的语义不同）", {
  skip: skipReason,
}, async () => {
  const { id, roundRowIds } = await seedReasoningFixture("fix-null-not-empty");
  try {
    const directions = await collectReasoningDirections({ sequelize: db.sequelize, runIds: [id] });
    const plans = planReasoningRewrites({ directions });
    const derivedPlan = plans.find((plan) => plan.subClass === "C-derived");
    assert.ok(derivedPlan, "C-derived 必须在计划里");
    assert.equal(derivedPlan.newValue, null, "目标值必须是 null（不是空串）");
    assert.notEqual(derivedPlan.newValue, "", "目标值不得是空串");

    const applied = await applyReasoningRewrites({ sequelize: db.sequelize, plans });
    assert.equal(applied.written, 2, "A + C-derived 各写 1 行");

    const rows = await reasoningRowsInRoundOrder(id);
    const derivedRow = rows.find((row) => row.roundNo === 3);
    assert.equal(derivedRow.reasoningContent, null, "库里必须是 SQL NULL（`IS NULL` 为真）");
    assert.notEqual(derivedRow.reasoningContent, "", "库里不得是空串（伪装成“已清”）");
    const [raw] = await db.sequelize.query(
      "SELECT reasoning_content IS NULL AS is_null, CHAR_LENGTH(reasoning_content) AS len FROM messages WHERE id = :id",
      { replacements: { id: roundRowIds.get(3).id } },
    );
    assert.equal(Number(raw[0].is_null), 1, "SQL 侧 `IS NULL` 必须为真");
    assert.equal(raw[0].len, null, "NULL 的 CHAR_LENGTH 是 NULL（不是 0）");

    // 读侧语义：legacy 装配读 `messages.reasoning_content`，NULL 时**不产生** reasoning 块
    //（空串同样 falsy，但“看起来干净”与“真的没有”必须能从 SQL 侧区分——上面两格就是那道分界）。
    const store = createTouwakaTranscriptStore({
      db,
      requestContext: { topic_id: null, user_id: testUserId, expert_id: testExpertId },
    });
    const previous = process.env[TRANSCRIPT_READ_MODE_ENV];
    process.env[TRANSCRIPT_READ_MODE_ENV] = TRANSCRIPT_READ_MODE_LEGACY;
    let legacyRecords;
    try {
      legacyRecords = await store.load(id);
    } finally {
      if (previous === undefined) delete process.env[TRANSCRIPT_READ_MODE_ENV];
      else process.env[TRANSCRIPT_READ_MODE_ENV] = previous;
    }
    const round3Messages = legacyRecords
      .filter((record) => Number(record.round) === 3)
      .flatMap((record) => record.messages ?? []);
    const round3ReasoningBlocks = round3Messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .filter((block) => block?.type === "reasoning");
    assert.deepEqual(round3ReasoningBlocks, [], "清成 NULL 后 legacy 读档不再凭空长出 reasoning 块");
  } finally {
    await cleanupRequest(id);
  }
});

test("反向钉子：C-opaque（列值 ≠ 逐字拼接）绝不被顺手清掉", {
  skip: skipReason,
}, async () => {
  const { id, roundRowIds } = await seedReasoningFixture("fix-opaque-nail");
  try {
    const directions = await collectReasoningDirections({ sequelize: db.sequelize, runIds: [id] });
    const opaqueRows = directions.filter((row) => row.subClass === "C-opaque");
    assert.equal(opaqueRows.length, 1, "fixture 里恰好一行 C-opaque");
    assert.equal(opaqueRows[0].columnValue, FIX_OPAQUE, "C-opaque 的列值就是那个“差一个字符”的串");
    assert.equal(opaqueRows[0].columnEqualsAccumulated, false, "它不等于逐字拼接");
    assert.equal(opaqueRows[0].action, "report-only", "动作只能是 report-only");

    const plans = planReasoningRewrites({ directions });
    assert.ok(
      plans.every((plan) => plan.messageId !== opaqueRows[0].messageId),
      "C-opaque 那行**不得**进改写计划（没有这格，后人会把“只清可证明的”写成“C 全清”而测试照样绿）",
    );

    await applyReasoningRewrites({ sequelize: db.sequelize, plans });
    const rows = await reasoningRowsInRoundOrder(id);
    const opaqueAfter = rows.find((row) => row.roundNo === 4);
    assert.equal(opaqueAfter.reasoningContent, FIX_OPAQUE, "C-opaque 的列值必须一字未变");
    assert.equal(opaqueAfter.id, roundRowIds.get(4).id, "命中同一行");
  } finally {
    await cleanupRequest(id);
  }
});

test("单表不变量：--fix-reasoning 只写 messages，计划阶段零写 SQL", {
  skip: skipReason,
}, async () => {
  const { id, roundRowIds } = await seedReasoningFixture("fix-single-table");
  try {
    let directions = null;
    let plans = null;
    await withSqlRecorder(db.sequelize, async (seen) => {
      directions = await collectReasoningDirections({ sequelize: db.sequelize, runIds: [id] });
      plans = planReasoningRewrites({ directions });
      assert.deepEqual(seen, [], "计划阶段（dry-run 走的就是这两步）不得发出任何写 SQL");
    });

    let written = 0;
    await withSqlRecorder(db.sequelize, async (seen) => {
      const applied = await applyReasoningRewrites({ sequelize: db.sequelize, plans });
      written = applied.written;
      assert.ok(seen.length > 0, "真写必须真的发出写 SQL（不是空跑）");
      for (const statement of seen) {
        assert.match(statement, /^UPDATE messages\b/, `--fix-reasoning 只允许 UPDATE messages，实际：${statement}`);
        for (const forbidden of ["agent_transcript_rounds", "agent_rounds", "chat_tool_calls"]) {
          assert.ok(
            !statement.includes(forbidden),
            `--fix-reasoning 不得写 ${forbidden}（单表不变量），实际：${statement}`,
          );
        }
      }
    });
    assert.equal(written, 2, "单表探针这一轮写 2 行（A + C-derived）");

    // 另两张表一行未写：形状未变（行数与列值都照旧）。
    const [canonicalRows] = await db.sequelize.query(
      `SELECT COUNT(*) AS n FROM ${CANONICAL_TABLE} WHERE request_id = :id`,
      { replacements: { id } },
    );
    const [roundRows] = await db.sequelize.query(
      "SELECT COUNT(*) AS n FROM agent_rounds WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(Number(canonicalRows[0].n), 4, "canonical 行数不变");
    assert.equal(Number(roundRows[0].n), 4, "agent_rounds 行数不变");
    const rows = await reasoningRowsInRoundOrder(id);
    assert.equal(
      rows.find((row) => row.roundNo === 2).reasoningContent,
      FIX_R2,
      "A 格已改回本轮值",
    );
    assert.equal(
      rows.find((row) => row.roundNo === 4).reasoningContent,
      FIX_OPAQUE,
      "C-opaque 仍未被触碰",
    );
    assert.equal(
      rows.find((row) => row.roundNo === 3).reasoningContent,
      null,
      "C-derived 已清成 NULL",
    );
    assert.ok(roundRowIds.size === 4, "fixture 四行都还在");
  } finally {
    await cleanupRequest(id);
  }
});

test("--fix-reasoning 的库名闸门：生产库缺 ALLOW_NON_TEST_DB=1 一律拒写", {
  skip: skipReason,
}, () => {
  assert.throws(
    () => assertDriftBackfillAllowed({
      database: PRODUCTION_DATABASE_NAME,
      fixReasoning: true,
      env: {},
    }),
    (error) => error.code === "ERR_PROJECTION_BACKFILL_NEEDS_ALLOW_NON_TEST_DB",
    "生产库 + --fix-reasoning 缺显式确认必须拒写",
  );
  const allowed = assertDriftBackfillAllowed({
    database: PRODUCTION_DATABASE_NAME,
    fixReasoning: true,
    env: { [DRIFT_BACKFILL_ALLOW_ENV_VAR]: "1" },
  });
  assert.equal(allowed.allowed, true, "显式确认后放行");
  assert.equal(allowed.reason, "production-explicit");
  assert.equal(
    assertDriftBackfillAllowed({ database: "llm_kit_test", fixReasoning: true, env: {} }).reason,
    "non-production",
    "测试库无需显式确认",
  );
});
