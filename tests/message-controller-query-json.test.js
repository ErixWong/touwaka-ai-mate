/**
 * MessageController JSON query tests.
 *
 * Run:
 *   node tests/message-controller-query-json.test.js
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

function createCtx(body) {
  return {
    params: {},
    query: {},
    request: { body },
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

function createController(rows) {
  const calls = {
    findAndCountAll: [],
  };

  const Message = {
    async findAndCountAll(options) {
      calls.findAndCountAll.push(options);
      return {
        count: 99,
        rows,
      };
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

console.log('\n场景 1：POST /messages/query 使用 JSON filter/sort/pagination');
{
  const rows = [
    {
      id: 'msg-3',
      request_id: 'req-3',
      expert_id: 'expert-1',
      user_id: 'user-1',
      topic_id: null,
      role: 'assistant',
      content: 'third',
      created_at: '2026-08-01T00:00:03.000Z',
    },
    {
      id: 'msg-2',
      request_id: 'req-2',
      expert_id: 'expert-1',
      user_id: 'user-1',
      topic_id: null,
      role: 'user',
      content: 'second',
      created_at: '2026-08-01T00:00:02.000Z',
    },
  ];

  const { controller, calls } = createController(rows);
  const ctx = createCtx({
    filter: {
      expert_id: 'expert-1',
    },
    sort: [
      { field: 'created_at', order: 'asc' },
      { field: 'id', order: 'asc' },
    ],
    pagination: {
      page: 2,
      size: 2,
      window: 'latest',
    },
  });

  await controller.query(ctx);

  const query = calls.findAndCountAll[0];
  assert(query.where.user_id === 'user-1', '查询限定当前用户');
  assert(query.where.expert_id === 'expert-1', '查询使用 body.filter.expert_id');
  assert(query.limit === 2, '查询使用 body.pagination.size');
  assert(query.offset === 2, '查询使用 body.pagination.page 计算 offset');
  assert(JSON.stringify(query.order) === JSON.stringify([['created_at', 'DESC'], ['id', 'DESC']]), 'latest 窗口内部从最新端取页');
  assert(ctx.body.data.items[0].id === 'msg-2', '返回结果按 created_at/id 老到新排序');
  assert(ctx.body.data.items[1].id === 'msg-3', '返回结果保留老到新顺序');
  assert(ctx.body.data.pagination.window === 'latest', '响应返回分页窗口语义');
}

console.log('\n场景 2：缺少 filter.expert_id 会拒绝');
{
  const { controller, calls } = createController([]);
  const ctx = createCtx({
    filter: {},
    pagination: { page: 1, size: 30 },
  });

  await controller.query(ctx);

  assert(ctx.status === 400, '返回 400');
  assert(calls.findAndCountAll.length === 0, '不执行数据库查询');
}

console.log('\n场景 3：GET /messages/expert/:expertId 复用 JSON 查询语义');
{
  const rows = [
    {
      id: 'msg-5',
      request_id: 'req-5',
      expert_id: 'expert-2',
      user_id: 'user-1',
      topic_id: null,
      role: 'assistant',
      content: 'newer',
      created_at: '2026-08-01T00:00:05.000Z',
    },
    {
      id: 'msg-4',
      request_id: 'req-4',
      expert_id: 'expert-2',
      user_id: 'user-1',
      topic_id: null,
      role: 'user',
      content: 'older',
      created_at: '2026-08-01T00:00:04.000Z',
    },
  ];
  const { controller, calls } = createController(rows);
  const ctx = createCtx({});
  ctx.params = { expertId: 'expert-2' };
  ctx.query = { page: '1', size: '2' };

  await controller.listByExpert(ctx);

  const query = calls.findAndCountAll[0];
  assert(query.where.expert_id === 'expert-2', 'GET 入口使用 path expertId 作为 filter.expert_id');
  assert(JSON.stringify(query.order) === JSON.stringify([['created_at', 'DESC'], ['id', 'DESC']]), 'GET 入口使用 latest 窗口查询顺序');
  assert(ctx.body.data.items[0].id === 'msg-4', 'GET 入口返回老到新');
  assert(ctx.body.data.items[1].id === 'msg-5', 'GET 入口返回老到新稳定次序');
}

console.log(`\n完成：${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
