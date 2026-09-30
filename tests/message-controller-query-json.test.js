/**
 * MessageController JSON query tests（issue #1134 D3-i 适配：列表查询改全量
 * 拉取 + chat_tool_calls 聚合合成行 + 内存分页，count 计入合成行）。
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

function createController(rows, toolCalls = []) {
  const calls = {
    findAll: [],
    toolCalls: [],
  };

  const Message = {
    async findAll(options) {
      calls.findAll.push(options);
      // 模拟 where 过滤（mock 不走真实 SQL）
      return rows.filter((row) => {
        const where = options?.where ?? {};
        if (where.role && row.role !== where.role) return false;
        if (where.expert_id && row.expert_id !== where.expert_id) return false;
        if (where.user_id && row.user_id !== where.user_id) return false;
        return true;
      });
    },
  };

  const controller = new MessageController({
    getModel(name) {
      if (name !== 'message') throw new Error(`Unexpected model: ${name}`);
      return Message;
    },
    sequelize: {
      async query(sql, { replacements } = {}) {
        calls.toolCalls.push({ sql, replacements });
        return [toolCalls.filter((call) => replacements.requestIds.includes(call.request_id))];
      },
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
      page: 1,
      size: 2,
      window: 'latest',
    },
  });

  await controller.query(ctx);

  const query = calls.findAll[0];
  assert(query.where.user_id === 'user-1', '查询限定当前用户');
  assert(query.where.expert_id === 'expert-1', '查询使用 body.filter.expert_id');
  assert(query.limit === undefined && query.offset === undefined, '聚合后内存分页：DB 查询不带 limit/offset');
  assert(JSON.stringify(query.order) === JSON.stringify([['created_at', 'ASC'], ['id', 'ASC']]), '查询按展示顺序拉取全量');
  assert(calls.toolCalls.length === 1, '聚合查询 chat_tool_calls 一次');
  assert(JSON.stringify(calls.toolCalls[0].replacements.requestIds) === JSON.stringify(['req-3', 'req-2']), '按页内 distinct request_id 聚合');
  assert(ctx.body.data.items[0].id === 'msg-2', '返回结果按 created_at/id 老到新排序');
  assert(ctx.body.data.items[1].id === 'msg-3', '返回结果保留老到新顺序');
  assert(ctx.body.data.pagination.window === 'latest', '响应返回分页窗口语义');
  assert(ctx.body.data.pagination.total === 2, 'total 计入归并后行数（无合成行时等于消息行数）');
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
  assert(calls.findAll.length === 0, '不执行数据库查询');
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

  const query = calls.findAll[0];
  assert(query.where.expert_id === 'expert-2', 'GET 入口使用 path expertId 作为 filter.expert_id');
  assert(ctx.body.data.items[0].id === 'msg-4', 'GET 入口返回老到新');
  assert(ctx.body.data.items[1].id === 'msg-5', 'GET 入口返回老到新稳定次序');
  assert(ctx.body.data.pagination.total === 2, 'GET 入口 total 正确');
}

console.log('\n场景 4（D3-i）：chat_tool_calls 合成行与存量行归并排序，total 计入合成行');
{
  const rows = [
    {
      id: 'msg-1',
      request_id: 'req-1',
      expert_id: 'expert-1',
      user_id: 'user-1',
      topic_id: null,
      role: 'assistant',
      content: 'calling tool',
      created_at: '2026-08-01T00:00:01.000Z',
    },
  ];
  const toolCalls = [
    {
      tool_use_id: 'call-1',
      request_id: 'req-1',
      round_id: 'round-x',
      name: 'echo',
      input_json: JSON.stringify({ text: 'hi' }),
      result_json: JSON.stringify('echo: hi'),
      is_error: false,
      duration_ms: null,
      created_at: '2026-08-01T00:00:02.000Z',
    },
  ];
  const { controller } = createController(rows, toolCalls);
  const ctx = createCtx({
    filter: { expert_id: 'expert-1' },
    sort: [{ field: 'created_at', order: 'asc' }, { field: 'id', order: 'asc' }],
    pagination: { page: 1, size: 30, window: 'latest' },
  });

  await controller.query(ctx);

  const items = ctx.body.data.items;
  assert(items.length === 2, '合成 role=tool 行与存量行一并返回');
  assert(items[0].id === 'msg-1', 'assistant 行在前');
  assert(items[1].id === 'toolcall_call-1', '合成行以 toolcall_ 前缀 + tool_use_id 为虚拟 id');
  assert(items[1].role === 'tool', '合成行 role=tool');
  assert(items[1].content === 'echo: hi', '合成行 content=result_json 正身（未超阈值）');
  const toolCallsField = items[1].tool_calls;
  assert(toolCallsField.tool_call_id === 'call-1', 'tool_calls.tool_call_id 一致');
  assert(toolCallsField.name === 'echo', 'tool_calls.name 一致');
  assert(JSON.stringify(toolCallsField.arguments) === JSON.stringify({ text: 'hi' }), 'tool_calls.arguments 还原 input_json');
  assert(toolCallsField.success === true, 'tool_calls.success 取反 is_error');
  assert(toolCallsField.duration === 0, 'duration_ms 缺失时 duration 缺省 0（与 saveToolMessage 一致）');
  assert(toolCallsField.context === null, 'chat_tool_calls 无 context 字段，如实缺 null');
  assert(toolCallsField.result_length === 8, 'result_length 为结果字符数');
  assert(toolCallsField.has_image === false, 'has_image 由结果内容探测');
  assert(toolCallsField.result === undefined, '未超阈值不带 result 全文');
  assert(items[1].prompt_tokens === 0 && items[1].completion_tokens === 0, '合成行 tokens 缺省 0（与 saveToolMessage 行一致）');
  assert(items[1].user_id === 'user-1' && items[1].expert_id === 'expert-1', '合成行归属取查询上下文');
  assert(ctx.body.data.pagination.total === 2, 'total 计入合成行');
}

console.log('\n场景 5（D3-i）：超阈值结果走摘要模式，result 全文进 tool_calls.result');
{
  const longResult = 'x'.repeat(6000);
  const rows = [
    {
      id: 'msg-1',
      request_id: 'req-1',
      expert_id: 'expert-1',
      user_id: 'user-1',
      topic_id: null,
      role: 'assistant',
      content: 'calling tool',
      created_at: '2026-08-01T00:00:01.000Z',
    },
  ];
  const toolCalls = [
    {
      tool_use_id: 'call-2',
      request_id: 'req-1',
      round_id: 'round-x',
      name: 'read',
      input_json: null,
      result_json: JSON.stringify(longResult),
      is_error: true,
      duration_ms: 12,
      created_at: '2026-08-01T00:00:02.000Z',
    },
  ];
  const { controller } = createController(rows, toolCalls);
  const ctx = createCtx({
    filter: { expert_id: 'expert-1' },
    sort: [{ field: 'created_at', order: 'asc' }, { field: 'id', order: 'asc' }],
    pagination: { page: 1, size: 30, window: 'latest' },
  });

  await controller.query(ctx);

  const toolRow = ctx.body.data.items.find((item) => item.role === 'tool');
  assert(toolRow.content.includes('工具: read'), '超阈值 content 为摘要文本');
  assert(toolRow.content.includes('6000 字符'), '摘要含结果长度');
  assert(toolRow.content.includes('失败'), 'is_error=true 摘要标记失败');
  assert(toolRow.tool_calls.result === longResult, '摘要模式 result 全文进 tool_calls.result');
  assert(toolRow.tool_calls.success === false, 'is_error=true → success=false');
  assert(toolRow.tool_calls.duration === 12, 'duration_ms 如实透传');
  assert(toolRow.tool_calls.arguments === null, 'input_json 缺失时 arguments 如实缺 null');
}

console.log('\n场景 6（D3-i）：分页窗口两种模式在含合成行时正确');
{
  // 共 4 行（2 消息 + 2 合成 tool 行），size=2
  const mkRow = (id, requestId, role, content, createdAt) => ({
    id, request_id: requestId, expert_id: 'expert-1', user_id: 'user-1',
    topic_id: null, role, content, created_at: createdAt,
  });
  const rows = [
    mkRow('msg-1', 'req-1', 'user', 'q1', '2026-08-01T00:00:01.000Z'),
    mkRow('msg-2', 'req-1', 'assistant', 'a1', '2026-08-01T00:00:04.000Z'),
  ];
  const toolCalls = [
    {
      tool_use_id: 'c1', request_id: 'req-1', round_id: 'r1', name: 't1',
      input_json: null, result_json: JSON.stringify('r1-result'), is_error: false,
      duration_ms: null, created_at: '2026-08-01T00:00:02.000Z',
    },
    {
      tool_use_id: 'c2', request_id: 'req-1', round_id: 'r2', name: 't2',
      input_json: null, result_json: JSON.stringify('r2-result'), is_error: false,
      duration_ms: null, created_at: '2026-08-01T00:00:03.000Z',
    },
  ];

  // latest 窗口 page 1 = 最新 2 行（tool c2 + assistant msg-2）
  {
    const { controller } = createController(rows, toolCalls);
    const ctx = createCtx({
      filter: { expert_id: 'expert-1' },
      sort: [{ field: 'created_at', order: 'asc' }, { field: 'id', order: 'asc' }],
      pagination: { page: 1, size: 2, window: 'latest' },
    });
    await controller.query(ctx);
    const ids = ctx.body.data.items.map((item) => item.id);
    assert(JSON.stringify(ids) === JSON.stringify(['toolcall_c2', 'msg-2']), `latest page1 取最新两行 ${JSON.stringify(ids)}`);
    assert(ctx.body.data.pagination.total === 4, 'latest total 计入合成行');
    assert(ctx.body.data.pagination.pages === 2, 'latest pages 正确');
  }

  // latest 窗口 page 2 = 较前 2 行（tool c1 + user msg-1）
  {
    const { controller } = createController(rows, toolCalls);
    const ctx = createCtx({
      filter: { expert_id: 'expert-1' },
      sort: [{ field: 'created_at', order: 'asc' }, { field: 'id', order: 'asc' }],
      pagination: { page: 2, size: 2, window: 'latest' },
    });
    await controller.query(ctx);
    const ids = ctx.body.data.items.map((item) => item.id);
    assert(JSON.stringify(ids) === JSON.stringify(['msg-1', 'toolcall_c1']), `latest page2 取较前两行 ${JSON.stringify(ids)}`);
  }

  // absolute 窗口 page 1 = 从头 2 行
  {
    const { controller } = createController(rows, toolCalls);
    const ctx = createCtx({
      filter: { expert_id: 'expert-1' },
      sort: [{ field: 'created_at', order: 'asc' }, { field: 'id', order: 'asc' }],
      pagination: { page: 1, size: 2, window: 'absolute' },
    });
    await controller.query(ctx);
    const ids = ctx.body.data.items.map((item) => item.id);
    assert(JSON.stringify(ids) === JSON.stringify(['msg-1', 'toolcall_c1']), `absolute page1 从取头两行 ${JSON.stringify(ids)}`);
  }

  // role=tool 过滤：存量 tool 行 + 合成行一并返回（request_id 源自页内 tool 行）
  {
    const rowsWithLegacyTool = [
      ...rows,
      mkRow('msg-tool-legacy', 'req-1', 'tool', 'legacy tool row', '2026-08-01T00:00:05.000Z'),
    ];
    const { controller } = createController(rowsWithLegacyTool, toolCalls);
    const ctx = createCtx({
      filter: { expert_id: 'expert-1', role: 'tool' },
      sort: [{ field: 'created_at', order: 'asc' }, { field: 'id', order: 'asc' }],
      pagination: { page: 1, size: 30, window: 'latest' },
    });
    await controller.query(ctx);
    assert(ctx.body.data.items.length === 3, `role=tool 返回存量 + 合成 tool 行 ${ctx.body.data.items.length}`);
    assert(ctx.body.data.items.every((item) => item.role === 'tool'), 'role=tool 过滤生效');
    assert(ctx.body.data.items.some((item) => item.id === 'msg-tool-legacy'), '存量 role=tool 行原样保留');
    assert(ctx.body.data.items.some((item) => item.id === 'toolcall_c1'), '合成 role=tool 行并入');
  }
}

console.log(`\n完成：${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
