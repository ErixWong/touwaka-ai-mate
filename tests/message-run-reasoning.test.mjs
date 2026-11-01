/**
 * #1237 切片 B —— **整段思考的读侧拼接**（`lib/message-run-reasoning.js`）+ 三个查询口行为一致
 *
 * 切片 A 已锁死的等式（`lib/llm-kit-adapters/README.md`「`--fix-reasoning`」）：
 *
 * ```
 * 各轮 messages.reasoning_content（按 agent_rounds.round_no ASC, messages.sequence_no ASC，无分隔 join）
 *   === 旧实现的 fullReasoningContent（跨轮累积串）
 * ```
 *
 * 本文件钉住切片 B 的读侧：
 *   1. `loadRunReasoningByRequest` 的拼接**逐字**等于上面那条等式（== 旧实现的累积串）；
 *   2. 只挂**终稿行**：同一请求里其余 assistant 行不带 `run_reasoning_content`；
 *   3. 三个历史查询口（`query` / `listByExpert` / `listWithBefore` / `listSince`）给出的
 *      `run_reasoning_content` **逐字相同**、都落在同一条终稿行上（行为一致，不是三份实现）；
 *   4. 分页窗口切掉终稿行时**一行都不挂**（不把“部分轮”冒充整段）；
 *   5. 既有字段不动：每行 `reasoning_content` 仍是**本轮**值（切片 A 的写侧结论），
 *      `content` / 计量列 / 列名一律不改（本切片无 DDL）。
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
logger.logFile = '/tmp/touwaka-1237b-run-reasoning.log';

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

const {
  RUN_REASONING_FIELD,
  RUN_REASONING_ROUNDS_FIELD,
  attachRunReasoningContent,
  loadRunReasoningByRequest,
} = await import('../lib/message-run-reasoning.js');
const { default: AgentLoop } = await import('../lib/agent/agent-loop.js');
const { default: ChatService } = await import('../lib/chat-service.js');
const { default: MessageController } = await import('../server/controllers/message.controller.js');
const { CANONICAL_TABLE } = await import('../lib/llm-kit-adapters/transcript-store.js');

const ns = randomUUID().slice(0, 8);
const REQUEST_PREFIX = `run-1237b-${ns}-`;
const skipReason = creds ? false : `缺少凭据 ${CREDS_PATH}`;

let testUserId = 'u_1237b';
let testExpertId = null;
if (db) {
  const [users] = await db.sequelize.query('SELECT id FROM users LIMIT 1');
  const [experts] = await db.sequelize.query('SELECT id FROM experts LIMIT 1');
  testUserId = users[0]?.id ?? 'u_1237b';
  testExpertId = experts[0]?.id ?? null;
}

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
    await db.sequelize.query('DELETE FROM chat_tool_calls WHERE round_id IN (:roundIds)', {
      replacements: { roundIds },
    });
  }
  await db.sequelize.query('DELETE FROM messages WHERE request_id = :id', { replacements: { id } });
  await db.sequelize.query('DELETE FROM chat_tool_calls WHERE request_id = :id', { replacements: { id } });
  await db.sequelize.query(`DELETE FROM ${CANONICAL_TABLE} WHERE request_id = :id`, { replacements: { id } });
  await db.sequelize.query('DELETE FROM agent_rounds WHERE request_id = :id', { replacements: { id } });
}

after(async () => {
  if (!db) return;
  for (const table of [CANONICAL_TABLE, 'agent_rounds']) {
    const [rows] = await db.sequelize.query(
      `SELECT DISTINCT request_id AS rid FROM ${table} WHERE request_id LIKE :pattern`,
      { replacements: { pattern: `${REQUEST_PREFIX}%` } },
    );
    for (const row of rows) await cleanupRequest(row.rid);
  }
  await db.close();
});

// ============================================================================
// 真跑一轮跨轮请求（两轮都吐 reasoning + 一个工具调用），再走终稿单写
// ============================================================================

const REASONING_R1 = 'B-R1：先确认目录里有没有入口文件。';
const REASONING_R2 = 'B-R2：够了，直接收尾给结论。';
// 末轮正文必须带完成信号，否则 agent-loop 会继续 nudge 下一轮（轮数就不确定了）
const FINAL_TEXT = '任务完成：切片B 终稿正文';
const TOOL_TEXT = '切片B 需要工具';

/** 两轮脚本化专家服务（与切片 A 的 `reasoning-per-round.test.mjs` 同构，故意不共享）。 */
function createTwoRoundExpertService(toolCallId) {
  const toolCall = {
    id: toolCallId,
    type: 'function',
    function: { name: 'echo', arguments: '{"value":42}' },
  };
  let streamCalls = 0;
  return {
    expertConfig: { expert: { max_tool_rounds: 5, context_strategy: 'full' } },
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
          role: 'tool',
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
      throw new Error('runErix should use execute_tools');
    },
    _consumeDocRetrievalResult() {
      return { found: false };
    },
  };
}

/** 按轮序读 assistant 行（切片 A 的等式口径：round_no, sequence_no）。 */
async function assistantRowsInRoundOrder(requestId) {
  const [rows] = await db.sequelize.query(
    `SELECT m.id, m.request_id, m.round_id, m.role, m.content, m.reasoning_content, m.sequence_no, r.round_no
       FROM messages AS m
       JOIN agent_rounds AS r ON r.id = m.round_id
      WHERE r.request_id = :requestId
        AND m.role = 'assistant'
      ORDER BY r.round_no ASC, m.sequence_no ASC, m.id ASC`,
    { replacements: { requestId } },
  );
  return rows;
}

function createCtx({ params = {}, query = {}, body = {} } = {}) {
  return {
    params,
    query,
    request: { body },
    state: { session: { id: testUserId } },
    body: null,
    status: 200,
    success(data) {
      this.body = { code: 200, message: 'success', data };
    },
    error(message, status = 400) {
      this.status = status;
      this.body = { code: status, message, data: null };
    },
  };
}

let scenario = null;

before(async () => {
  if (!db) return;
  const requestId = `${REQUEST_PREFIX}e2e`;
  const toolCallId = `tool-${ns}`;
  await cleanupRequest(requestId);

  const loop = new AgentLoop({
    db,
    execute_tools: async (expertService, input) => {
      const call = input.collectedToolCalls[0];
      const result = expertService.createToolResult(call);
      input.onDelta?.({ type: 'tool_result', result });
      return [result];
    },
    save_llm_payload: () => {},
    generate_tool_call_summary: () => 'summary',
  });
  const result = await loop.runErix(createTwoRoundExpertService(toolCallId), {
    modelConfig: { model_name: 'test-model', context_window_tokens: 32768, max_output_tokens: 2048 },
    thinkingConfig: {
      thinking: false,
      reasoning: null,
      reasoning_effort: null,
      enable_thinking: false,
      chat_template_kwargs: null,
    },
    tools: [{
      type: 'function',
      function: { name: 'echo', description: 'Echo input', parameters: { type: 'object' } },
    }],
    currentMessages: [{ role: 'user', content: 'hello' }],
    llmPayload: { _debug: {} },
    user_id: testUserId,
    expert_id: testExpertId,
    taskContext: { workspace_mode: 'test' },
    topic_id: null,
    task_id: null,
    session: { accessToken: 'token' },
    request_id: requestId,
  });

  // 终稿单写：**逐字模拟 chat-service 的真实调用**（传进去的仍是跨轮累积串）。
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
      model_name: 'test-model',
      provider_name: 'test-provider',
      expert_id: testExpertId,
      reasoning_content: result.fullReasoningContent,
    },
  );

  scenario = {
    requestId,
    assistantMessageId,
    accumulated: result.fullReasoningContent,
    rows: await assistantRowsInRoundOrder(requestId),
  };
});

// ============================================================================
// ① 拼接等式
// ============================================================================

test('拼接等式：loadRunReasoningByRequest 的文本逐字等于旧实现的跨轮累积串', { skip: skipReason }, async () => {
  const byRequest = await loadRunReasoningByRequest({
    sequelize: db.sequelize,
    requestIds: [scenario.requestId],
  });
  const info = byRequest.get(scenario.requestId);
  assert.ok(info, '必须为该请求产出整段思考');
  const expected = scenario.rows
    .map((row) => row.reasoning_content ?? '')
    .join('');
  assert.equal(info.text, expected, '拼接必须等于各轮按轮序无分隔 join');
  assert.equal(info.text, scenario.accumulated, '拼接必须等于旧实现的 fullReasoningContent（切片 A 的等式）');
  assert.equal(info.text, `${REASONING_R1}${REASONING_R2}`);
  assert.equal(info.rounds, 2, '两轮都有思考 ⇒ 轮数为 2');
  const finalRow = scenario.rows[scenario.rows.length - 1];
  assert.equal(info.finalMessageId, finalRow.id, '终稿行 = 轮序最后一条 assistant 行');
  assert.equal(finalRow.id, scenario.assistantMessageId, '终稿行就是终稿单写绑定的那条 canonical 行');
});

test('写侧不被读侧改动：每行 reasoning_content 仍是本轮值，content/计量列不变', { skip: skipReason }, async () => {
  const [rows] = await db.sequelize.query(
    `SELECT id, role, content, reasoning_content, prompt_tokens, completion_tokens, latency_ms, model_name
       FROM messages WHERE id = :id`,
    { replacements: { id: scenario.assistantMessageId } },
  );
  const row = rows[0];
  assert.equal(row.reasoning_content, REASONING_R2, '末轮行只存本轮那段（切片 A 结论）');
  assert.notEqual(row.reasoning_content, scenario.accumulated, '末轮行不得是累积串');
  assert.equal(row.content, FINAL_TEXT);
  assert.equal(Number(row.prompt_tokens), 12);
  assert.equal(Number(row.completion_tokens), 34);
  assert.equal(Number(row.latency_ms), 56);
  assert.equal(row.model_name, 'test-model');
  const earlier = scenario.rows.slice(0, -1).map((item) => item.reasoning_content);
  assert.ok(earlier.includes(REASONING_R1), '第一轮的思考留在第一轮行上');
});

// ============================================================================
// ② 只挂终稿行
// ============================================================================

test('attachRunReasoningContent：只有终稿行带 run_reasoning_content，其余 assistant 行不带', { skip: skipReason }, async () => {
  const rows = scenario.rows.map((row) => ({ ...row }));
  await attachRunReasoningContent({ sequelize: db.sequelize, rows });
  const carriers = rows.filter((row) => row[RUN_REASONING_FIELD] !== undefined);
  assert.equal(carriers.length, 1, '整段思考只能挂在一条行上');
  assert.equal(carriers[0].id, scenario.assistantMessageId);
  assert.equal(carriers[0][RUN_REASONING_FIELD], scenario.accumulated);
  assert.equal(carriers[0][RUN_REASONING_ROUNDS_FIELD], 2);
  for (const row of rows.filter((item) => item.id !== scenario.assistantMessageId)) {
    assert.equal(row[RUN_REASONING_FIELD], undefined, `${row.id} 不是终稿行，不得带整段字段`);
  }
});

test('窗口切掉终稿行时一行都不挂（不把“部分轮”的拼接冒充整段）', { skip: skipReason }, async () => {
  const truncated = scenario.rows.slice(0, 1).map((row) => ({ ...row }));
  await attachRunReasoningContent({ sequelize: db.sequelize, rows: truncated });
  assert.equal(truncated[0][RUN_REASONING_FIELD], undefined);
});

test('请求里没有轮绑定行时“不猜”：只有唯一一条 assistant 行才用它自己那一份', { skip: skipReason }, async () => {
  const legacyRequestId = `${REQUEST_PREFIX}legacy`;
  const legacyId = `legacy-${ns}`;
  await cleanupRequest(legacyRequestId);
  try {
    await db.sequelize.query(
      `INSERT INTO messages (id, request_id, topic_id, user_id, expert_id, role, content, reasoning_content, round_id, sequence_no)
       VALUES (:id, :requestId, NULL, :userId, :expertId, 'assistant', 'legacy 正文', 'legacy 思考', NULL, NULL)`,
      {
        replacements: {
          id: legacyId,
          requestId: legacyRequestId,
          userId: testUserId,
          expertId: testExpertId,
        },
      },
    );
    const byRequest = await loadRunReasoningByRequest({
      sequelize: db.sequelize,
      requestIds: [legacyRequestId],
    });
    const info = byRequest.get(legacyRequestId);
    assert.equal(info.text, 'legacy 思考');
    assert.equal(info.rounds, 1);
    assert.equal(info.finalMessageId, legacyId);

    // 两条无轮序的 assistant 行 ⇒ 没有轮序可依 ⇒ text = null（不拿 created_at 发明第四条规则）
    const secondId = `legacy2-${ns}`;
    await db.sequelize.query(
      `INSERT INTO messages (id, request_id, topic_id, user_id, expert_id, role, content, reasoning_content, round_id, sequence_no, created_at)
       VALUES (:id, :requestId, NULL, :userId, :expertId, 'assistant', 'legacy 正文2', 'legacy 思考2', NULL, NULL, DATE_ADD(NOW(), INTERVAL 1 SECOND))`,
      {
        replacements: {
          id: secondId,
          requestId: legacyRequestId,
          userId: testUserId,
          expertId: testExpertId,
        },
      },
    );
    const ambiguous = (await loadRunReasoningByRequest({
      sequelize: db.sequelize,
      requestIds: [legacyRequestId],
    })).get(legacyRequestId);
    assert.equal(ambiguous.text, null, '多条无轮序行 ⇒ 不猜，返回 null');
  } finally {
    await db.sequelize.query('DELETE FROM messages WHERE request_id = :id', {
      replacements: { id: legacyRequestId },
    });
  }
});

// ============================================================================
// ③ 三个查询口行为一致
// ============================================================================

test('三个查询口（query / listByExpert / listWithBefore / listSince）给出的整段思考逐字相同', { skip: skipReason }, async () => {
  const controller = new MessageController(db);

  // (a) POST /query（JSON filter）
  const queryCtx = createCtx({
    body: {
      filter: { expert_id: testExpertId },
      sort: [{ field: 'created_at', order: 'asc' }, { field: 'id', order: 'asc' }],
      pagination: { page: 1, size: 100, window: 'latest' },
    },
  });
  await controller.query(queryCtx);
  const queryItems = queryCtx.body?.data?.items ?? [];

  // (b) GET /expert/:expertId（listByExpert）
  const byExpertCtx = createCtx({ params: { expertId: testExpertId }, query: { page: '1', size: '100' } });
  await controller.listByExpert(byExpertCtx);
  const byExpertItems = byExpertCtx.body?.data?.items ?? [];

  // (c) GET /expert/:expertId/with-before/:messageId
  const beforeCtx = createCtx({
    params: { expertId: testExpertId, messageId: scenario.assistantMessageId },
    query: { limit: '100' },
  });
  await controller.listWithBefore(beforeCtx);
  const beforeItems = beforeCtx.body?.data?.items ?? [];

  // (d) GET /expert/:expertId/since?after_message_id=...（锚点 = 该请求用户行，此处补一条，
  //     真实链路里它由 `saveUserMessage` 先落库；本用例只造 assistant 行，故就地补一条更早的行）
  const anchorId = `anchor-${ns}`;
  await db.sequelize.query(
    `INSERT INTO messages (id, request_id, topic_id, user_id, expert_id, role, content, round_id, sequence_no, created_at)
     SELECT :anchorId, :requestId, NULL, :userId, :expertId, 'user', '锚点用户行', NULL, NULL,
            DATE_SUB(MIN(created_at), INTERVAL 2 SECOND)
       FROM messages WHERE request_id = :requestId`,
    {
      replacements: {
        anchorId,
        requestId: scenario.requestId,
        userId: testUserId,
        expertId: testExpertId,
      },
    },
  );
  const sinceCtx = createCtx({
    params: { expertId: testExpertId },
    query: { after_message_id: anchorId, limit: '100' },
  });
  await controller.listSince(sinceCtx);
  const sinceItems = sinceCtx.body?.data?.items ?? [];

  const collect = (items) => items
    .filter((item) => item.request_id === scenario.requestId && item.role === 'assistant')
    .map((item) => ({
      id: item.id,
      run: item[RUN_REASONING_FIELD] ?? null,
      rounds: item[RUN_REASONING_ROUNDS_FIELD] ?? null,
      reasoning: item.reasoning_content ?? null,
    }));

  const fromQuery = collect(queryItems);
  const fromExpert = collect(byExpertItems);
  const fromBefore = collect(beforeItems);
  const fromSince = collect(sinceItems);

  for (const [name, list] of [
    ['query', fromQuery],
    ['listByExpert', fromExpert],
    ['listWithBefore', fromBefore],
    ['listSince', fromSince],
  ]) {
    assert.ok(list.length >= 2, `${name} 必须能拿到该请求的多轮行（拿到 ${list.length} 条）`);
    const carriers = list.filter((item) => item.run !== null);
    assert.equal(carriers.length, 1, `${name}: 整段思考只能出现在一条行上`);
    assert.equal(carriers[0].id, scenario.assistantMessageId, `${name}: 必须落在终稿行`);
    assert.equal(carriers[0].run, scenario.accumulated, `${name}: 整段文本必须与拼接等式逐字相等`);
    assert.equal(carriers[0].rounds, 2, `${name}: 轮数一致`);
    // 既有字段照旧：每行 reasoning_content 仍是本轮值
    assert.equal(carriers[0].reasoning, REASONING_R2, `${name}: reasoning_content 仍是本轮值（字段名与语义都不许改）`);
  }
});

test('既有响应字段集合不被改名/删除：reasoning_content 仍在且列名未变', { skip: skipReason }, async () => {
  const controller = new MessageController(db);
  const ctx = createCtx({
    params: { expertId: testExpertId, messageId: scenario.assistantMessageId },
    query: { limit: '20' },
  });
  await controller.listWithBefore(ctx);
  const item = (ctx.body?.data?.items ?? []).find((row) => row.id === scenario.assistantMessageId);
  assert.ok(item, '终稿行必须在响应里');
  assert.ok(Object.prototype.hasOwnProperty.call(item, 'reasoning_content'), 'reasoning_content 字段必须保留');
  assert.ok(Object.prototype.hasOwnProperty.call(item, RUN_REASONING_FIELD), '新增字段是可选字段（终稿行上有）');
  // 没有新增/改名的列：messages 表列集合与切片 B 之前逐字一致
  const [columns] = await db.sequelize.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' ORDER BY ORDINAL_POSITION`,
  );
  const names = columns.map((column) => column.name);
  assert.ok(names.includes('reasoning_content'));
  assert.ok(!names.includes(RUN_REASONING_FIELD), '整段思考不得落库成新列（本切片无 DDL）');
  assert.ok(!names.includes('round_no'), '未新增轮序冗余列');
});
