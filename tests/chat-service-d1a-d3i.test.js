/**
 * ChatService T3 单测（issue #1134）：
 * - D1-a：saveAssistantMessageAndCompleteRequest 终稿绑定——有 canonical 行
 *   UPDATE 不 INSERT；无行兜底 INSERT
 * - D3-i：_executeTools skipToolMessageRow 旗标——erix 路径停写 role=tool 行，
 *   legacy 路径保持写
 *
 * Run:
 *   node tests/chat-service-d1a-d3i.test.js
 */

import ChatService from '../lib/chat-service.js';

let passed = 0;
let failed = 0;

function assert(condition, name, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name} ${detail}`);
  }
}

function createFakeDb({ canonicalRows = [] } = {}) {
  const state = {
    messageFindAll: [],
    messageUpdates: [],
    messageCreates: [],
    chatRequestUpdates: [],
    topicIncrements: [],
  };

  const fakeTxn = { committed: false, rolledBack: false, async commit() { this.committed = true; }, async rollback() { this.rolledBack = true; } };

  const Message = {
    async findAll(options) {
      state.messageFindAll.push(options);
      return canonicalRows.map((row) => ({ ...row }));
    },
    async update(values, options) {
      state.messageUpdates.push({ values, where: options.where });
      return [1];
    },
    async create(values) {
      state.messageCreates.push(values);
      return values;
    },
  };

  const db = {
    Op: { ne: '$ne' },
    sequelize: {
      async transaction() { return fakeTxn; },
      async query() { return [[]]; },
    },
    getModel(name) {
      const models = {
        message: Message,
        topic: { async increment() { state.topicIncrements.push(arguments); } },
        chat_request: {
          async update(values, options) {
            state.chatRequestUpdates.push({ values, where: options.where });
            return [1];
          },
        },
        ai_model: {},
        provider: {},
        task: {},
      };
      return models[name];
    },
  };

  return { db, state, fakeTxn };
}

function createService(fakeDb) {
  return new ChatService(fakeDb.db, {
    agentLoop: { run: async () => ({ fullContent: '', fullReasoningContent: '', tokenUsage: null, allToolCalls: [] }) },
  });
}

console.log('\n场景 1（D1-a）：有 canonical 行时 UPDATE 不 INSERT，chat_request 绑定该行');
{
  const canonicalRow = {
    id: 'round_msg_1',
    request_id: 'req-1',
    role: 'assistant',
    round_id: 'round_abc',
    created_at: new Date('2026-08-01T00:00:01.000Z'),
  };
  const { db, state, fakeTxn } = createFakeDb({ canonicalRows: [canonicalRow] });
  const service = createService({ db });

  const messageId = await service.saveAssistantMessageAndCompleteRequest('topic-1', 'user-1', '修正后的终稿', {
    request_id: 'req-1',
    prompt_tokens: 11,
    completion_tokens: 22,
    latency_ms: 330,
    model_name: 'm1',
    provider_name: 'p1',
    reasoning_content: 'reasoning final',
  });

  assert(messageId === 'round_msg_1', '返回 canonical 行 id');
  assert(state.messageCreates.length === 0, '不新增 messages 行');
  assert(state.messageUpdates.length === 1, 'UPDATE 最后 canonical 行');
  const update = state.messageUpdates[0];
  assert(update.where.id === 'round_msg_1', 'UPDATE 命中 canonical 行');
  assert(update.values.content === '修正后的终稿', 'content 更新为 post-check 终稿');
  assert(update.values.prompt_tokens === 11 && update.values.completion_tokens === 22, 'tokens 更新');
  assert(update.values.latency_ms === 330, 'latency 更新');
  assert(update.values.model_name === 'm1' && update.values.provider_name === 'p1', 'model/provider 更新');
  assert(update.values.reasoning_content === 'reasoning final', 'reasoning_content 更新');
  const findAllWhere = state.messageFindAll[0].where;
  assert(findAllWhere.request_id === 'req-1' && findAllWhere.role === 'assistant', '按 request_id + assistant 找行');
  assert(findAllWhere.round_id !== undefined && findAllWhere.round_id !== null, 'canonical 行条件含 round_id IS NOT NULL');
  assert(state.chatRequestUpdates.length === 1, 'chat_requests 照旧完成绑定');
  assert(state.chatRequestUpdates[0].values.assistant_message_id === 'round_msg_1', 'assistant_message_id 绑定 canonical 行');
  assert(state.chatRequestUpdates[0].values.status === 'completed', 'status=completed 不变（状态机语义不动）');
  assert(fakeTxn.committed === true, '事务提交');
}

console.log('\n场景 2（D1-a）：无 canonical 行时兜底 INSERT，行为不变');
{
  const { db, state, fakeTxn } = createFakeDb({ canonicalRows: [] });
  const service = createService({ db });

  const messageId = await service.saveAssistantMessageAndCompleteRequest('topic-1', 'user-1', '终稿', {
    request_id: 'req-legacy',
    prompt_tokens: 1,
    completion_tokens: 2,
    latency_ms: 50,
    model_name: 'm1',
    provider_name: 'p1',
  });

  assert(typeof messageId === 'string' && messageId.length > 0, '返回新 INSERT 行 id');
  assert(state.messageCreates.length === 1, '兜底 INSERT 一行');
  assert(state.messageCreates[0].role === 'assistant' && state.messageCreates[0].content === '终稿', 'INSERT 内容正确');
  assert(state.messageUpdates.length === 0, '无 UPDATE');
  assert(state.chatRequestUpdates.length === 1, 'chat_requests 照旧绑定');
  assert(state.chatRequestUpdates[0].values.assistant_message_id === messageId, '绑定新行 id');
  assert(fakeTxn.committed === true, '事务提交');
}

console.log('\n场景 3（D1-a）：无 request_id 时不查 canonical 行，直接 INSERT（internal.controller 直调路径）');
{
  const { db, state } = createFakeDb({ canonicalRows: [{ id: 'x', request_id: 'other', role: 'assistant', round_id: 'r' }] });
  const service = createService({ db });

  const messageId = await service.saveAssistantMessageAndCompleteRequest('topic-1', 'user-1', '直接回复', {
    latency_ms: 10,
    model_name: 'm1',
    provider_name: 'p1',
  });

  assert(typeof messageId === 'string', '返回新行 id');
  assert(state.messageFindAll.length === 0, '无 request_id 不触发 canonical 查询');
  assert(state.messageCreates.length === 1, '直调路径走原 INSERT');
  assert(state.chatRequestUpdates.length === 0, '无 request_id 不更新 chat_requests');
}

console.log('\n场景 4（D3-i）：_executeTools skipToolMessageRow=true 停写 role=tool 行');
{
  const { db } = createFakeDb();
  const service = createService({ db });
  let saved = 0;
  service.saveToolMessage = async () => { saved += 1; };
  let callbackFired = 0;
  const deltas = [];
  const expertService = {
    async handleToolCalls(_calls, _user, _token, _ctx, _topic, onToolResult) {
      await onToolResult({ toolCallId: 'c1', toolName: 'echo', success: true, data: 'ok' });
      return [{ success: true }];
    },
  };

  await service._executeTools(expertService, {
    collectedToolCalls: [{ id: 'c1', name: 'echo' }],
    user_id: 'user-1',
    topic_id: 'topic-1',
    onDelta: (event) => deltas.push(event),
    skipToolMessageRow: true,
  });
  assert(saved === 0, 'erix 路径不写 role=tool 行（正身在 chat_tool_calls.result_json）');
  assert(callbackFired === 0 && deltas.length === 1 && deltas[0].type === 'tool_result', 'tool_result SSE 事件照旧发出');
}

console.log('\n场景 5（D3-i）：legacy 路径不传旗标保持写 role=tool 行');
{
  const { db } = createFakeDb();
  const service = createService({ db });
  let saved = 0;
  service.saveToolMessage = async () => { saved += 1; };
  const expertService = {
    async handleToolCalls(_calls, _user, _token, _ctx, _topic, onToolResult) {
      await onToolResult({ toolCallId: 'c1', toolName: 'echo', success: true, data: 'ok' });
      return [{ success: true }];
    },
  };

  await service._executeTools(expertService, {
    collectedToolCalls: [{ id: 'c1', name: 'echo' }],
    user_id: 'user-1',
    topic_id: 'topic-1',
  });
  assert(saved === 1, 'legacy 路径照旧 saveToolMessage');
}

console.log(`\n完成：${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
