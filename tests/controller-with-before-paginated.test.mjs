/**
 * 静态 + hermetic 回归：GET /api/messages/expert/:expertId/with-before/:messageId
 * 必须返回 buildPaginatedResponse() 的统一分页形状（issue #1195）。
 *
 * 背景：这个端点历史上直接 `ctx.success(数组)`（找不到锚点时甚至是裸的 `ctx.success([])`），
 * 违反 AGENTS.md §2.3「分页响应必须复用 buildPaginatedResponse()」。真机 HTTP 回归
 * tests/test-api-message-read-e2e.mjs 因此长期一条红（items=undefined）。
 * 本文件用假 model 把控制器跑在内存里，锁住形状，不依赖数据库。
 *
 * 零数据库依赖：只 new MessageController(fakeDb)，假 model 提供 findOne / findAndCountAll / findAll。
 * 自证有牙：
 *   - 断言 with-before 路径上 findAll 调用次数为 0（退回 findAll 裸数组实现会红）；
 *   - 断言 `!Array.isArray(data)`（退回裸数组会红）；
 *   - 断言 data 的键集与直接调用 buildPaginatedResponse() 的结果逐键相同（自己发明/改名
 *     字段会红）；开发环境的 summary 由同一函数决定，故断言与 NODE_ENV 无关。
 *   - findAll 供同控制器 listByExpert 参照物使用（形状一致性那条用例），实现为通用
 *     where/order 内存查询，不参与 with-before 断言。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Op } from 'sequelize';

import MessageController from '../server/controllers/message.controller.js';
import { buildPaginatedResponse } from '../lib/query-builder.js';

const EXPERT_ID = 'expert-1';
const USER_ID = 'user-1';
const ANCHOR_ID = 'msg-3';

/** 与 listWithBefore 查询列同形状的裸行（DB 以 created_at DESC 返回的顺序） */
function makeRows({ count, startCreatedAtMs, requestPrefix = 'req' }) {
  // 倒序：第 0 行最新。id 用 m1..mN 编号，m1 最早。
  return Array.from({ length: count }, (_, i) => {
    const index = count - i; // DESC → 从大到小
    return {
      id: `m${index}`,
      request_id: `${requestPrefix}-${index}`,
      expert_id: EXPERT_ID,
      user_id: USER_ID,
      topic_id: null,
      role: index % 2 === 0 ? 'assistant' : 'user',
      content: `content-${index}`,
      reasoning_content: null,
      prompt_tokens: 1,
      completion_tokens: 2,
      inner_voice: null,
      tool_calls: null,
      error_info: null,
      created_at: new Date(startCreatedAtMs - index * 1000),
      latency_ms: 5,
      meta_json: '{"engine":"erix"}',
    };
  });
}

function createCtx({ messageId = ANCHOR_ID, limit } = {}) {
  return {
    params: { expertId: EXPERT_ID, messageId },
    query: limit === undefined ? {} : { limit: String(limit) },
    state: { session: { id: USER_ID } },
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

/**
 * 假 db：messages 表按 where.created_at<=锚点 + expert_id + user_id 过滤，
 * 按 created_at DESC 排序并按 limit 截断，count 为不受 limit 影响的匹配总数。
 */
function createController({ anchor, rows = [] } = {}) {
  const calls = { findOne: [], findAndCountAll: [], findAll: [] };

  const Message = {
    async findOne(options) {
      calls.findOne.push(options);
      if (options?.where?.id === ANCHOR_ID) return anchor;
      return null;
    },
    async findAndCountAll(options) {
      calls.findAndCountAll.push(options);
      const where = options.where || {};
      const lte = where.created_at?.[Op.lte];
      const matched = rows
        .filter((row) => row.expert_id === where.expert_id && row.user_id === where.user_id)
        .filter((row) => !lte || new Date(row.created_at) <= new Date(lte))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const limit = Number.isFinite(options.limit) ? options.limit : matched.length;
      return { rows: matched.slice(0, limit).map((row) => ({ ...row })), count: matched.length };
    },
    async findAll(options) {
      calls.findAll.push(options);
      const where = options.where || {};
      const matched = rows
        .filter((row) => row.user_id === where.user_id)
        .filter((row) => where.expert_id === undefined || row.expert_id === where.expert_id)
        .filter((row) => !where.role || row.role === where.role)
        .map((row) => ({ ...row }));
      for (const [field, direction] of [...(options.order || [])].reverse()) {
        matched.sort((a, b) => {
          const aValue = field === 'created_at' ? new Date(a.created_at).getTime() : String(a[field] ?? '');
          const bValue = field === 'created_at' ? new Date(b.created_at).getTime() : String(b[field] ?? '');
          if (aValue === bValue) return 0;
          const asc = aValue < bValue ? -1 : 1;
          return String(direction).toUpperCase() === 'DESC' ? -asc : asc;
        });
      }
      return matched;
    },
  };

  const db = {
    getModel(name) {
      if (name !== 'message') throw new Error(`Unexpected model: ${name}`);
      return Message;
    },
    // listByExpert 的 mergeToolCallRows 走 raw query；本用例不塞工具调用行
    sequelize: { async query() { return [[], []]; } },
  };

  return { controller: new MessageController(db), calls };
}

const ANCHOR = {
  id: ANCHOR_ID,
  request_id: 'req-3',
  expert_id: EXPERT_ID,
  user_id: USER_ID,
  created_at: new Date('2026-01-01T00:00:05.000Z'),
};

const CANONICAL_PAGINATION_KEYS = ['has_next', 'has_prev', 'page', 'pages', 'size', 'total'];

test('with-before：命中锚点时返回 { items, pagination } 统一形状（不是裸数组）', async () => {
  const rows = makeRows({ count: 7, startCreatedAtMs: Date.parse('2026-01-01T00:00:08.000Z') });
  const { controller } = createController({ anchor: ANCHOR, rows });
  const ctx = createCtx({ limit: 3 });

  await controller.listWithBefore(ctx);

  const data = ctx.body?.data;
  assert.equal(ctx.body?.code, 200, 'ctx.success 仍走统一响应封装');
  assert.ok(!Array.isArray(data), 'data 不能是裸数组（旧形状）');
  assert.ok(Array.isArray(data.items), 'data.items 必须是数组');
  assert.deepEqual(Object.keys(data).sort().filter((k) => k !== 'summary'), ['items', 'pagination']);

  // 与直接调用 buildPaginatedResponse() 的键集逐键一致（含开发环境的 summary）
  const reference = buildPaginatedResponse({ rows: [], count: 0 }, { page: 1, size: 3 }, Date.now());
  assert.deepEqual(
    Object.keys(data).sort(),
    Object.keys(reference).sort(),
    '顶层字段集合必须与 buildPaginatedResponse() 一致，不许自造字段',
  );

  // 锚点及之前共 5 条（created_at <= 锚点），limit=3 → 取最近的 3 条（m3/m4/m5），
  // 再反转为正序：最早的 m5 在前。
  assert.deepEqual(data.items.map((m) => m.id), ['m5', 'm4', 'm3']);
  assert.deepEqual(data.pagination, {
    page: 1,
    size: 3,
    total: 5,
    pages: 2,
    has_next: true,
    has_prev: false,
  });

  // items 仍是 formatMessage 的形状（对前端逐字不变）
  assert.equal(data.items[0].content, 'content-5');
  assert.deepEqual(data.items[0].metadata, {
    tokens: { total_tokens: 3, prompt_tokens: 1, completion_tokens: 2 },
    latency: 5,
  });
  assert.ok(!('meta_json' in data.items[0]), 'meta_json 不外泄');
});

test('with-before：锚点不存在时 items 是空数组（既不是 null 也不是裸数组）', async () => {
  const { controller, calls } = createController({ anchor: null, rows: makeRows({ count: 2, startCreatedAtMs: 1000 }) });
  const ctx = createCtx({ messageId: 'no-such-message', limit: 5 });

  await controller.listWithBefore(ctx);

  const data = ctx.body?.data;
  assert.equal(ctx.body?.code, 200);
  assert.ok(!Array.isArray(data), '空结果也不能退回裸数组');
  assert.ok(Array.isArray(data.items), 'items 必须是数组');
  assert.deepEqual(data.items, []);
  assert.notEqual(data.items, null);
  assert.deepEqual(data.pagination, {
    page: 1,
    size: 5,
    total: 0,
    pages: 0,
    has_next: false,
    has_prev: false,
  });
  assert.equal(calls.findAndCountAll.length, 0, '锚点缺失时不查列表');
});

test('with-before：锚点存在但窗口内零行时 items 同样是空数组', async () => {
  const { controller } = createController({ anchor: ANCHOR, rows: [] });
  const ctx = createCtx({ limit: 10 });

  await controller.listWithBefore(ctx);

  const data = ctx.body?.data;
  assert.ok(Array.isArray(data.items));
  assert.deepEqual(data.items, []);
  assert.equal(data.pagination.total, 0);
  assert.equal(data.pagination.pages, 0);
});

test('with-before：limit / where / order 语义未变，且走 findAndCountAll', async () => {
  const rows = makeRows({ count: 4, startCreatedAtMs: Date.parse('2026-01-01T00:00:09.000Z') });
  const { controller, calls } = createController({ anchor: ANCHOR, rows });
  const ctx = createCtx({ limit: 2 });

  await controller.listWithBefore(ctx);

  assert.equal(calls.findAll.length, 0, '不得再调用 findAll');
  assert.equal(calls.findAndCountAll.length, 1);
  const options = calls.findAndCountAll[0];
  assert.equal(options.limit, 2, 'limit 透传查询参数（默认 10，未夹紧）');
  assert.deepEqual(options.order, [['created_at', 'DESC']], '仍按时间倒序取窗口');
  assert.equal(options.where.expert_id, EXPERT_ID);
  assert.equal(options.where.user_id, USER_ID);
  assert.deepEqual(options.where.created_at[Op.lte], ANCHOR.created_at, '锚点 created_at 之前（含）');
  assert.ok(!('role' in options.where), '不新增 role 过滤');
  assert.equal(options.raw, true);
});

test('with-before：默认 limit=10 且 pagination.size 同步', async () => {
  const rows = makeRows({ count: 12, startCreatedAtMs: Date.parse('2026-01-01T00:00:20.000Z') });
  const { controller, calls } = createController({ anchor: ANCHOR, rows });
  const ctx = createCtx();

  await controller.listWithBefore(ctx);

  assert.equal(calls.findAndCountAll[0].limit, 10, '缺省 limit 仍是 10');
  assert.equal(ctx.body.data.pagination.size, 10);
  assert.equal(ctx.body.data.pagination.page, 1, '锚点窗口没有翻页概念，page 恒 1');
});

test('with-before：pagination 字段名与同控制器 listByExpert 列表接口一致（无自造字段）', async () => {
  const rows = makeRows({ count: 3, startCreatedAtMs: Date.parse('2026-01-01T00:00:09.000Z') });
  const { controller } = createController({ anchor: ANCHOR, rows });

  const wbCtx = createCtx({ limit: 2 });
  await controller.listWithBefore(wbCtx);

  // 同控制器的合规列表入口（POST /query 与 GET /expert/:id 共用 queryMessagesByRequest）
  const listCtx = createCtx({ limit: 2 });
  listCtx.query = { page: '1', size: '2' };
  await controller.listByExpert(listCtx);

  const wbPagination = Object.keys(wbCtx.body.data.pagination).sort();
  const listPagination = Object.keys(listCtx.body.data.pagination).sort();

  assert.deepEqual(
    CANONICAL_PAGINATION_KEYS.filter((k) => !wbPagination.includes(k)),
    [],
    `with-before 缺少标准分页键：${CANONICAL_PAGINATION_KEYS.join(',')}`,
  );
  assert.deepEqual(
    wbPagination,
    CANONICAL_PAGINATION_KEYS,
    'with-before 的分页键必须正好是 buildPaginatedResponse 的六键',
  );
  assert.ok(
    wbPagination.every((key) => listPagination.includes(key)),
    `with-before 出现 listByExpert 没有的分页键：${wbPagination.filter((k) => !listPagination.includes(k)).join(',')}`,
  );
  assert.ok(Array.isArray(listCtx.body.data.items), 'listByExpert 参照物本身可用');
});
