/**
 * #1237 切片 C（审计补测 3 + D3）—— **`streamChat` 的 `complete` 事件**（可选字段不得阻断完成）
 *
 * 审计指出的两条“当前测试测不出”：
 *   - `lib/chat-service.js` 的 `complete` 里 `reasoning_content` 若被改回 `fullReasoningContent`
 *     （跨轮累积串），现有测试**不会红**——因为没有任何一条测试真正跑过 `streamChat` 并断言
 *     `complete.message`。本文件补上这条：`complete.message.reasoning_content` 必须逐字等于
 *     REST 终稿行的 `reasoning_content`（会话内与刷新后一致），`run_reasoning_content` 必须逐字
 *     等于读侧拼接值。
 *   - D3：两次“读可选展示字段”原本就在 `streamChat` 的大 `try` 里 ⇒ DB 瞬时故障时 `onError`
 *     会把**已经落库成功**的请求报成失败（REST 侧 `MessageController._attachRunReasoning` 是
 *     `logger.warn` 后照常返回）。本文件用故障注入钉住：读失败 ⇒ `complete` 照发、字段为 `null`、
 *     `onError` 不触发。
 *
 * 夹具形状：一条请求 + 两轮 canonical 行（`round_id IS NOT NULL`，思考分别是 R1 / R2），
 * 与切片 A 的写侧结论一致（终稿 UPDATE 不写 `reasoning_content`）。**只有 `agentLoop` 是假的**
 * ——终稿保存、两次读、REST 序列化都走真代码真库。
 *
 * 依赖：真库 `llm_kit_test`（`~/.config/mcp/creds/touwaka-test-db.json`，缺失则 skip）。
 */

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import logger from '../lib/logger.js';
// logs/ 目录可能非本用户属主：屏蔽文件写入，别让日志权限错误盖住断言。
for (const method of ['info', 'warn', 'error', 'debug']) {
  if (typeof logger[method] === 'function') logger[method] = () => {};
}
logger.logFile = '/tmp/touwaka-1237c-complete.log';

const { openTestDatabase, DEFAULT_CREDS_PATH } = await import('./helpers/test-db-guard.mjs');
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;
const db = dbCtx?.db ?? null;

if (creds) {
  process.env.DB_HOST = String(creds.host ?? 'localhost');
  process.env.DB_PORT = String(creds.port ?? 3306);
  process.env.DB_USER = creds.user;
  process.env.DB_PASSWORD = creds.password;
  process.env.DB_NAME = creds.database;
}

const { default: ChatService } = await import('../lib/chat-service.js');
const { default: MessageController } = await import('../server/controllers/message.controller.js');
const { RUN_REASONING_FIELD, RUN_REASONING_ROUNDS_FIELD } = await import('../lib/message-run-reasoning.js');

const ns = randomUUID().slice(0, 8);
const REQUEST_PREFIX = `complete-1237c-${ns}-`;
const skipReason = creds ? false : `缺少凭据 ${CREDS_PATH}`;

let testUserId = 'u_1237c';
let testExpertId = null;
if (db) {
  const [users] = await db.sequelize.query('SELECT id FROM users LIMIT 1');
  const [experts] = await db.sequelize.query('SELECT id FROM experts LIMIT 1');
  testUserId = users[0]?.id ?? 'u_1237c';
  testExpertId = experts[0]?.id ?? null;
}

// 轮内思考（两轮各一段）+ 旧的“跨轮累积串”（agent-loop 的 fullReasoningContent）
const REASONING_R1 = 'C-R1：先看目录。';
const REASONING_R2 = 'C-R2：直接收尾。';
const ACCUMULATED = `${REASONING_R1}${REASONING_R2}`;
const FINAL_TEXT = '切片C：complete 事件终稿正文';

async function cleanupRequest(id) {
  if (!db) return;
  const [rounds] = await db.sequelize.query(
    'SELECT id FROM agent_rounds WHERE request_id = :id',
    { replacements: { id } },
  );
  const roundIds = rounds.map((row) => row.id);
  if (roundIds.length > 0) {
    await db.sequelize.query('DELETE FROM messages WHERE round_id IN (:roundIds)', {
      replacements: { roundIds },
    });
  }
  await db.sequelize.query('DELETE FROM messages WHERE request_id = :id', { replacements: { id } });
  await db.sequelize.query('DELETE FROM agent_rounds WHERE request_id = :id', { replacements: { id } });
}

after(async () => {
  if (!db) return;
  const [rows] = await db.sequelize.query(
    'SELECT DISTINCT request_id AS rid FROM agent_rounds WHERE request_id LIKE :pattern',
    { replacements: { pattern: `${REQUEST_PREFIX}%` } },
  );
  for (const row of rows) await cleanupRequest(row.rid);
  await db.close();
});

/** 造一条轮（`agent_rounds` 的 NOT NULL 列只有 id/request_id/round_no/dedup_key/ts/created_at）。 */
async function insertRound({ id, requestId, roundNo, offsetSeconds = 0 }) {
  await db.sequelize.query(
    `INSERT INTO agent_rounds (id, request_id, round_no, dedup_key, ts, created_at)
     VALUES (:id, :requestId, :roundNo, :dedupKey, :ts, DATE_ADD(NOW(3), INTERVAL :offset SECOND))`,
    {
      replacements: {
        id,
        requestId,
        roundNo,
        dedupKey: `dedup-${id}`,
        ts: new Date().toISOString(),
        offset: offsetSeconds,
      },
    },
  );
}

/** 造一条 canonical assistant 行（`round_id` 非空 = 引擎已落的终稿候选行）。 */
async function insertAssistantRow({ id, requestId, roundId, sequenceNo, content, reasoningContent, offsetSeconds = 0 }) {
  await db.sequelize.query(
    `INSERT INTO messages
       (id, request_id, topic_id, user_id, expert_id, role, content, reasoning_content, round_id, sequence_no, created_at)
     VALUES
       (:id, :requestId, NULL, :userId, :expertId, 'assistant', :content, :reasoningContent, :roundId, :sequenceNo,
        DATE_ADD(NOW(3), INTERVAL :offset SECOND))`,
    {
      replacements: {
        id,
        requestId,
        userId: testUserId,
        expertId: testExpertId,
        content,
        reasoningContent,
        roundId,
        sequenceNo,
        offset: offsetSeconds,
      },
    },
  );
}

/**
 * 假专家服务 + 假 `agentLoop`：只有 LLM 那一段是假的，其余（终稿保存、两次读、REST）都是真代码。
 * `fullReasoningContent` 故意给“跨轮累积串”——这正是 D1/D3 之外那条“切片 B”要防的取值。
 */
function createHarness({ requestId, userMessageId, agentLoopResult }) {
  const expertService = {
    expertConfig: { expert: { context_strategy: 'full', max_tool_rounds: 5 } },
    memorySystem: { compressContext: async () => ({ success: true, topicsCreated: 0 }) },
    buildContext: async () => ({ messages: [{ role: 'user', content: '你好' }] }),
    getDefaultModelConfig: () => ({
      model_name: 'test-model',
      provider_name: 'test-provider',
      context_window_tokens: 32768,
      max_output_tokens: 2048,
    }),
    getThinkingConfig: () => ({
      thinking: false,
      reasoning: null,
      reasoning_effort: null,
      enable_thinking: false,
      chat_template_kwargs: null,
    }),
    toolManager: { getToolDefinitions: async () => [] },
    recallStrategy: null,
    performReflection: async () => ({}),
    processHistoryIfNeeded: async () => ({}),
  };

  const service = new ChatService(db, {
    agentLoop: { run: async () => agentLoopResult },
    agentRuntime: { runRoot: async (arg, fn) => fn(arg) },
  });
  service.getExpertService = async () => expertService;
  service.saveUserMessageAndBindRequest = async () => userMessageId;
  service.saveLLMPayload = () => {};

  const events = { complete: [], errors: [], deltas: [] };
  const run = () => service.streamChat(
    {
      topic_id: 'topic-1237c-complete-test',
      user_id: testUserId,
      expert_id: testExpertId,
      content: '你好',
      request_id: requestId,
      session: null,
    },
    (delta) => events.deltas.push(delta),
    (payload) => events.complete.push(payload),
    (error) => events.errors.push(error),
  );

  return { service, events, run };
}

const agentLoopResult = {
  fullContent: FINAL_TEXT,
  fullReasoningContent: ACCUMULATED,
  tokenUsage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  allToolCalls: [],
};

// ============================================================================
// 主场景：两轮 canonical 行（R1 / R2），agentLoop 交回累积串 ACCUMULATED
// ============================================================================

const REQUEST_ID = `${REQUEST_PREFIX}main`;
const MESSAGE_IDS = {
  assistant1: `cmp-a1-${ns}`,
  assistant2: `cmp-a2-${ns}`,
};
const USER_MESSAGE_ID = `cmp-u-${ns}`;
let mainComplete = null;
let mainErrors = [];

before(async () => {
  if (!db) return;
  await cleanupRequest(REQUEST_ID);
  await insertRound({ id: `cmp-r1-${ns}`, requestId: REQUEST_ID, roundNo: 1 });
  await insertRound({ id: `cmp-r2-${ns}`, requestId: REQUEST_ID, roundNo: 2, offsetSeconds: 1 });
  await insertAssistantRow({
    id: MESSAGE_IDS.assistant1,
    requestId: REQUEST_ID,
    roundId: `cmp-r1-${ns}`,
    sequenceNo: 0,
    content: '',
    reasoningContent: REASONING_R1,
  });
  await insertAssistantRow({
    id: MESSAGE_IDS.assistant2,
    requestId: REQUEST_ID,
    roundId: `cmp-r2-${ns}`,
    sequenceNo: 0,
    content: '',
    reasoningContent: REASONING_R2,
    offsetSeconds: 1,
  });

  const harness = createHarness({
    requestId: REQUEST_ID,
    userMessageId: USER_MESSAGE_ID,
    agentLoopResult,
  });
  await harness.run();
  mainComplete = harness.events.complete;
  mainErrors = harness.events.errors;
});

test('complete 只发一次，且不触发 onError（正常路径语义不变）', { skip: skipReason }, () => {
  assert.equal(mainErrors.length, 0, `onError 不得触发：${mainErrors.map((e) => e?.message).join(', ')}`);
  assert.equal(mainComplete.length, 1, 'complete 必须恰好一次');
  assert.equal(mainComplete[0].type, 'complete');
  assert.equal(mainComplete[0].message.id, MESSAGE_IDS.assistant2, 'complete.message.id = 终稿 canonical 行');
});

test('补测3：complete.message.reasoning_content 是**本轮**那段，不是跨轮累积串', { skip: skipReason }, () => {
  const message = mainComplete[0].message;
  assert.equal(message.reasoning_content, REASONING_R2, '必须是末轮行回读值（逐字）');
  assert.notEqual(message.reasoning_content, ACCUMULATED, '不得是 fullReasoningContent（跨轮累积串）');
  assert.equal(message.content, FINAL_TEXT, '终稿正文照旧');
});

test('补测3：complete.message.run_reasoning_content 逐字等于读侧拼接值', { skip: skipReason }, () => {
  const message = mainComplete[0].message;
  assert.equal(message[RUN_REASONING_FIELD], ACCUMULATED, '整段 = 两段拼接（逐字）');
  assert.equal(message[RUN_REASONING_ROUNDS_FIELD], 2, '段数 = 2');
});

test('补测3：会话内（complete）与刷新后（REST）两个字段逐字一致', { skip: skipReason }, async () => {
  const controller = new MessageController(db);
  const ctx = {
    params: { expertId: testExpertId, messageId: MESSAGE_IDS.assistant2 },
    query: { limit: '20' },
    state: { session: { id: testUserId } },
    body: null,
    status: 200,
    success(data) { this.body = { code: 200, message: 'success', data }; },
    error(message, status = 400) { this.status = status; this.body = { code: status, message, data: null }; },
  };
  await controller.listWithBefore(ctx);
  const item = (ctx.body?.data?.items ?? []).find((row) => row.id === MESSAGE_IDS.assistant2);
  assert.ok(item, '终稿行必须在 REST 响应里');
  const message = mainComplete[0].message;
  assert.equal(item.reasoning_content, message.reasoning_content, 'reasoning_content 会话内 === 刷新后（逐字）');
  assert.equal(item[RUN_REASONING_FIELD], message[RUN_REASONING_FIELD], 'run_reasoning_content 会话内 === 刷新后（逐字）');
  assert.equal(item[RUN_REASONING_ROUNDS_FIELD], message[RUN_REASONING_ROUNDS_FIELD], '轮数一致');
});

test('写侧未被 complete 路径改动：终稿行仍是本轮思考，正文被终稿 UPDATE 覆盖', { skip: skipReason }, async () => {
  const [rows] = await db.sequelize.query(
    'SELECT content, reasoning_content FROM messages WHERE id = :id',
    { replacements: { id: MESSAGE_IDS.assistant2 } },
  );
  assert.equal(rows[0].content, FINAL_TEXT, '终稿正文已落库');
  assert.equal(rows[0].reasoning_content, REASONING_R2, '终稿 UPDATE 不写 reasoning_content（切片 A 结论）');
});

// ============================================================================
// D3：两次“读可选展示字段”各自本地降级 —— complete 照发、字段为 null、onError 不触发
// ============================================================================

test('D3：回读终稿行思考抛异常 ⇒ complete 照发（reasoning_content=null），不报错', { skip: skipReason }, async () => {
  const requestId = `${REQUEST_PREFIX}fail-find-one`;
  await cleanupRequest(requestId);
  await insertRound({ id: `cmp-f1-r1-${ns}`, requestId, roundNo: 1 });
  await insertAssistantRow({
    id: `cmp-f1-a1-${ns}`,
    requestId,
    roundId: `cmp-f1-r1-${ns}`,
    sequenceNo: 0,
    content: '',
    reasoningContent: REASONING_R2,
  });

  const harness = createHarness({ requestId, userMessageId: `${USER_MESSAGE_ID}-f1`, agentLoopResult });
  harness.service.loadAssistantReasoningContent = async () => {
    throw new Error('模拟 DB 瞬时故障：回读终稿行思考失败');
  };

  await harness.run();

  assert.equal(harness.events.errors.length, 0, '可选字段读失败**不得**变成 onError（消息早已落库成功）');
  assert.equal(harness.events.complete.length, 1, 'complete 必须照发');
  const message = harness.events.complete[0].message;
  assert.equal(message.reasoning_content, null, '本次事件没有该字段 ⇒ null（与 REST 同口径）');
  assert.equal(message[RUN_REASONING_FIELD], null, '单轮请求：整段与末轮值相等 ⇒ 不挂（D1 规则）');
  assert.equal(message.content, FINAL_TEXT, '正文与保存语义不受影响');
});

test('D3：整段拼接读抛异常 ⇒ complete 照发（run_reasoning_content=null），reasoning_content 仍在', { skip: skipReason }, async () => {
  const requestId = `${REQUEST_PREFIX}fail-join`;
  await cleanupRequest(requestId);
  await insertRound({ id: `cmp-f2-r1-${ns}`, requestId, roundNo: 1 });
  await insertRound({ id: `cmp-f2-r2-${ns}`, requestId, roundNo: 2, offsetSeconds: 1 });
  await insertAssistantRow({
    id: `cmp-f2-a1-${ns}`,
    requestId,
    roundId: `cmp-f2-r1-${ns}`,
    sequenceNo: 0,
    content: '',
    reasoningContent: REASONING_R1,
  });
  await insertAssistantRow({
    id: `cmp-f2-a2-${ns}`,
    requestId,
    roundId: `cmp-f2-r2-${ns}`,
    sequenceNo: 0,
    content: '',
    reasoningContent: REASONING_R2,
    offsetSeconds: 1,
  });

  const harness = createHarness({ requestId, userMessageId: `${USER_MESSAGE_ID}-f2`, agentLoopResult });

  // 只让 `loadRunReasoningByRequest` 的那条 JOIN 查询炸掉（其余查询照常）
  const originalQuery = db.sequelize.query.bind(db.sequelize);
  let injected = 0;
  db.sequelize.query = async (sql, options) => {
    if (typeof sql === 'string' && sql.includes('JOIN agent_rounds AS r')) {
      injected += 1;
      throw new Error('模拟 DB 瞬时故障：整段思考拼接读失败');
    }
    return originalQuery(sql, options);
  };
  try {
    await harness.run();
  } finally {
    db.sequelize.query = originalQuery;
  }

  assert.equal(injected, 1, '故障注入必须真的命中那条拼接查询（否则本格没有证明力）');
  assert.equal(harness.events.errors.length, 0, '可选字段读失败**不得**变成 onError');
  assert.equal(harness.events.complete.length, 1, 'complete 必须照发');
  const message = harness.events.complete[0].message;
  assert.equal(message[RUN_REASONING_FIELD], null, '本次事件没有整段字段 ⇒ null');
  assert.equal(message[RUN_REASONING_ROUNDS_FIELD], 0, '轮数降级为 0');
  assert.equal(message.reasoning_content, REASONING_R2, '另一个可选字段不受连累（各自本地降级）');

  // 恢复后 REST 仍能拿到整段（证明只是“本次事件降级”，没有破坏读侧）
  const controller = new MessageController(db);
  const ctx = {
    params: { expertId: testExpertId, messageId: `cmp-f2-a2-${ns}` },
    query: { limit: '20' },
    state: { session: { id: testUserId } },
    body: null,
    status: 200,
    success(data) { this.body = { code: 200, message: 'success', data }; },
    error(messageText, status = 400) { this.status = status; this.body = { code: status, message: messageText, data: null }; },
  };
  await controller.listWithBefore(ctx);
  const item = (ctx.body?.data?.items ?? []).find((row) => row.id === `cmp-f2-a2-${ns}`);
  assert.ok(item, '终稿行必须在 REST 响应里');
  assert.equal(item[RUN_REASONING_FIELD], ACCUMULATED, 'REST 侧照旧给出整段（故障只在本次 complete 事件里降级）');
});
