/**
 * MessageController listSince cursor baseline tests.
 *
 * Run:
 *   node tests/message-controller-since-cursor.test.js
 */

import MessageController from '../server/controllers/message.controller.js';

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

function createCtx(query = {}) {
  return {
    params: { expertId: 'expert-1' },
    query,
    state: { session: { id: 'user-1' } },
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

function createController({ latestMessageId = 'msg-latest', anchor = null, rows = [] } = {}) {
  const calls = {
    findOne: [],
    findAll: [],
  };

  const Message = {
    async findOne(options) {
      calls.findOne.push(options);
      if (options?.where?.id) {
        return anchor;
      }
      return latestMessageId ? { id: latestMessageId } : null;
    },
    async findAll(options) {
      calls.findAll.push(options);
      return rows;
    },
  };

  const controller = new MessageController({
    getModel(name) {
      if (name !== 'message') throw new Error(`Unexpected model: ${name}`);
      return Message;
    },
  });

  return { controller, calls };
}

console.log('\n场景 1：空 after_message_id 只建立 live cursor 基线');
{
  const { controller, calls } = createController({ latestMessageId: 'msg-100' });
  const ctx = createCtx();

  await controller.listSince(ctx);

  assert(ctx.body?.data?.items?.length === 0, '不返回历史消息');
  assert(ctx.body?.data?.latest_message_id === 'msg-100', '返回当前最新消息作为基线');
  assert(ctx.body?.data?.cursor_initialized === true, '标记 cursor 已初始化');
  assert(calls.findAll.length === 0, '不执行增量列表查询');
}

console.log('\n场景 2：无效 anchor 不回退为全量旧历史');
{
  const { controller, calls } = createController({ latestMessageId: 'msg-200', anchor: null });
  const ctx = createCtx({ after_message_id: 'missing-anchor' });

  await controller.listSince(ctx);

  assert(ctx.body?.data?.items?.length === 0, '不返回历史消息');
  assert(ctx.body?.data?.latest_message_id === 'msg-200', '返回当前最新消息作为新基线');
  assert(ctx.body?.data?.anchor_found === false, '标记 anchor 未找到');
  assert(calls.findAll.length === 0, 'anchor 失效时不扫描消息列表');
}

console.log('\n场景 3：有效 anchor 才查询 anchor 之后的消息');
{
  const rows = [
    {
      id: 'msg-201',
      request_id: 'req-1',
      expert_id: 'expert-1',
      user_id: 'user-1',
      topic_id: null,
      role: 'assistant',
      content: 'hello',
      created_at: '2026-08-01T00:00:01.000Z',
    },
  ];
  const { controller, calls } = createController({
    anchor: { id: 'msg-200', created_at: '2026-08-01T00:00:00.000Z' },
    rows,
  });
  const ctx = createCtx({ after_message_id: 'msg-200' });

  await controller.listSince(ctx);

  assert(calls.findAll.length === 1, '执行增量列表查询');
  assert(ctx.body?.data?.items?.length === 1, '返回 anchor 之后的消息');
  assert(ctx.body?.data?.latest_message_id === 'msg-201', 'latest_message_id 指向返回批次最后一条');
}

console.log(`\n完成：${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
