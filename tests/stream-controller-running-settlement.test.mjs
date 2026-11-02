/**
 * #1264：卡在 running 的 chat_request 自愈（启动期 + 周期结算）
 *
 * 背景（详见 issue #1264）：`chat_requests.status='running'` 没有任何收口路径，
 * 进程中途死掉（部署重启 / OOM / 崩溃）后该请求永远停在 running：UI 像“还在跑”、
 * 不报错、`retryRequest` 还被 409 拒。本文件钉住三条：
 *
 *   1. 结算判据：`status='running' AND updated_at <= now - 30min`，结算成
 *      `failed` + `error_message='进程中断，请求未完成'`（零 DDL：枚举里没有 interrupted）。
 *   2. **不许误杀活着的 run**：本进程 activeRequests 里仍是非终态相位、且**内存心跳**
 *      （last_progress_at）新鲜的请求，无论 DB 里的 updated_at 多陈旧都不结算；
 *      本进程刚创建（updated_at 很新）的请求被 SQL 的 updated_at 条件挡住。
 *      心跳陈旧超阈值（promise 泄漏/挂住）才允许结算——那是周期结算的增量价值。
 *   3. 幂等 + 可观测 + 重试放行：第二次跑影响行数 0、日志含条数与 request_id 列表、
 *      结算后 requestStore 缓存被清（否则重试继续 409）。
 *
 * 纯内存假象（假 db + 假 ctx），不连数据库、不写生产库。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Op } from 'sequelize';

import logger from '../lib/logger.js';
import StreamController from '../server/controllers/stream.controller.js';

// ---------------------------------------------------------------- logger 捕获
const logLines = { warn: [], info: [], error: [], debug: [] };
const originalLogger = {};
for (const level of Object.keys(logLines)) {
  originalLogger[level] = logger[level];
  logger[level] = (message) => { logLines[level].push(String(message)); };
}
process.on('exit', () => {
  for (const [level, fn] of Object.entries(originalLogger)) {
    logger[level] = fn;
  }
});

// ---------------------------------------------------------------- 假 db / 假 controller
const SILENCE_MS = 30 * 60 * 1000;

/**
 * 假 db：只实现 StreamController 用到的面。
 * `runningRows` 是 `ChatRequest.findAll` 的返回值（模拟“候选陈旧 running 行”）。
 * `updateResult` 用来模拟影响行数（幂等用例里给 0）。
 */
function createFakeDb({ runningRows = [], updateResult = 1 } = {}) {
  const calls = { findAll: [], update: [], create: [] };

  const chatRequest = {
    async findAll(options) {
      calls.findAll.push(options);
      return runningRows;
    },
    async update(values, options) {
      calls.update.push({ values, options });
      return [updateResult];
    },
    async create(record) {
      calls.create.push(record);
      return record;
    },
    async findOne() {
      return null;
    },
  };

  const passThrough = {
    async findOne() { return null; },
    async findAll() { return []; },
    async create(record) { return record; },
    async update() { return [1]; },
  };

  const db = {
    Op,
    calls,
    chatRequest,
    getModel(name) {
      if (name === 'chat_request') return chatRequest;
      if (name === 'expert') {
        return { ...passThrough, findOne: async () => ({ id: 'expert001', is_active: true }) };
      }
      return passThrough;
    },
  };
  return db;
}

function createController(options = {}) {
  const db = createFakeDb(options);
  const chatService = {
    streamChat: async () => {},
    abortRequest: async () => true,
  };
  const controller = new StreamController(db, chatService);
  // 权限服务是进程级单例，这里直接换成放行版，避免用例触到真实 DB
  controller.permissionService = { canAccessExpert: async () => true };
  return { controller, db };
}

function createCtx({ request_id = 'req_x', user_id = 'user001' } = {}) {
  const ctx = {
    params: { request_id },
    state: { session: { id: user_id } },
    result: null,
    errorCalls: [],
  };
  ctx.success = (payload) => { ctx.result = payload; };
  ctx.error = (message, status) => {
    ctx.errorCalls.push({ message, status });
    ctx.status = status;
  };
  return ctx;
}

// ---------------------------------------------------------------- 1. 结算判据
test('陈旧 running 请求被结算成 failed + 固定文案（零 DDL）', async () => {
  const { controller, db } = createController({
    runningRows: [{ request_id: 'req_dead_1', updated_at: '2026-11-01 10:00:00' }],
  });

  const result = await controller.settleStaleRunningRequests({ reason: 'startup' });

  assert.equal(result.settled, 1, '应结算 1 条');
  assert.deepEqual(result.request_ids, ['req_dead_1']);
  assert.equal(db.calls.update.length, 1, '必须真的发一次 UPDATE');

  const { values, options } = db.calls.update[0];
  assert.equal(values.status, 'failed', '枚举里没有 interrupted，只能用 failed');
  assert.equal(values.error_message, '进程中断，请求未完成', '文案必须是固定值');
  assert.ok(values.completed_at instanceof Date, '必须写 completed_at');
  assert.ok(values.updated_at instanceof Date, '必须刷新 updated_at');

  // 结算范围不许外扩：只动 running，且条件里带 updated_at 阈值
  assert.equal(options.where.status, 'running', 'WHERE 必须锁 status=running');
  assert.deepEqual(options.where.request_id, { [Op.in]: ['req_dead_1'] });
  assert.ok(options.where.updated_at[Op.lte] instanceof Date, 'WHERE 必须带 updated_at <= cutoff');
});

// ---------------------------------------------------------------- 2. 阈值落在 SQL
test('静默期阈值=30min 且落在 SQL 条件里（不是 JS 侧过滤）', async () => {
  const { controller, db } = createController({ runningRows: [] });
  const before = Date.now();

  await controller.settleStaleRunningRequests({ reason: 'periodic' });

  assert.equal(db.calls.findAll.length, 1, '候选查询必须发一次');
  const where = db.calls.findAll[0].where;
  assert.equal(where.status, 'running');
  const cutoff = where.updated_at[Op.lte];
  assert.ok(cutoff instanceof Date, 'updated_at 条件必须是 Op.lte + Date');

  const deltaMs = before - cutoff.getTime();
  assert.ok(
    deltaMs >= SILENCE_MS - 5000 && deltaMs <= SILENCE_MS + 5000,
    `cutoff 必须是 now-30min（实测 ${deltaMs}ms），实际静默期阈值不许拍脑袋改`
  );
});

// ---------------------------------------------------------------- 3. 幂等
test('幂等：第二次跑候选为空 ⇒ 影响行数 0、不再发 UPDATE', async () => {
  // 第一次：有候选且影响 1 行
  const first = createController({
    runningRows: [{ request_id: 'req_dead_1', updated_at: '2026-11-01 10:00:00' }],
  });
  const r1 = await first.controller.settleStaleRunningRequests({ reason: 'startup' });
  assert.equal(r1.settled, 1);

  // 第二次：该行已是 failed ⇒ 候选查询返回空
  first.db.chatRequest.findAll = async () => [];
  const r2 = await first.controller.settleStaleRunningRequests({ reason: 'periodic' });
  assert.equal(r2.settled, 0, '第二次影响行数必须是 0');
  assert.deepEqual(r2.request_ids, []);
  assert.equal(first.db.calls.update.length, 1, '第二次不许再发 UPDATE');

  // 影响行数 0（并发下别人已收口）时也不许清缓存/不许谎报
  const third = createController({
    runningRows: [{ request_id: 'req_dead_2', updated_at: '2026-11-01 10:00:00' }],
    updateResult: 0,
  });
  third.controller.requestStore.set('req_dead_2', { request_id: 'req_dead_2', status: 'running' });
  const r3 = await third.controller.settleStaleRunningRequests({ reason: 'periodic' });
  assert.equal(r3.settled, 0, '影响行数 0 时 settled 必须是 0');
  assert.ok(third.controller.requestStore.has('req_dead_2'), '影响 0 行时不许清缓存（那行不是我们收的）');
});

// ---------------------------------------------------------------- 4. 不许误杀活着的 run
test('不许误杀活着的 run：本进程 phase=running 且心跳新鲜的请求，即使 DB updated_at 陈旧也不结算', async () => {
  const { controller, db } = createController({
    runningRows: [{ request_id: 'req_live_1', updated_at: '2026-11-01 10:00:00' }],
  });
  // 本进程正在跑（内存真相源）：长跑期间 DB updated_at 会很陈旧，但它是活的
  controller._createRuntimeState('req_live_1', { expert_id: 'e1', user_id: 'u1' });
  controller._transitionRuntimeState('req_live_1', 'running');
  controller.requestStore.set('req_live_1', { request_id: 'req_live_1', status: 'running' });

  const result = await controller.settleStaleRunningRequests({ reason: 'periodic' });

  assert.equal(result.settled, 0, '活着的 run 一条都不许结算');
  assert.deepEqual(result.skipped, ['req_live_1']);
  assert.equal(db.calls.update.length, 0, '不许对活着的 run 发 UPDATE');
  assert.ok(
    controller.requestStore.has('req_live_1'),
    '活着的 run 的读缓存也不许被清'
  );
  assert.ok(
    logLines.warn.some((line) => line.includes('跳过本进程在跑的请求') && line.includes('req_live_1')),
    '跳过必须留痕（含 request_id）'
  );
});

test('recovering / stopping 相位同样算“在跑”，不许结算', async () => {
  const { controller, db } = createController({
    runningRows: [
      { request_id: 'req_recovering', updated_at: '2026-11-01 10:00:00' },
      { request_id: 'req_stopping', updated_at: '2026-11-01 10:00:00' },
    ],
  });
  controller._createRuntimeState('req_recovering', { expert_id: 'e1', user_id: 'u1' });
  controller._transitionRuntimeState('req_recovering', 'running');
  controller._transitionRuntimeState('req_recovering', 'recovering');
  controller._createRuntimeState('req_stopping', { expert_id: 'e1', user_id: 'u1' });
  controller._transitionRuntimeState('req_stopping', 'running');
  controller._transitionRuntimeState('req_stopping', 'stopping', { stop_requested: true });

  const result = await controller.settleStaleRunningRequests({ reason: 'periodic' });

  assert.equal(result.settled, 0);
  assert.deepEqual(result.skipped.sort(), ['req_recovering', 'req_stopping']);
  assert.equal(db.calls.update.length, 0);
});

test('本进程持有但心跳陈旧超阈值（promise 泄漏/挂住）⇒ 结算', async () => {
  const { controller, db } = createController({
    runningRows: [{ request_id: 'req_hung_1', updated_at: '2026-11-01 10:00:00' }],
  });
  controller._createRuntimeState('req_hung_1', { expert_id: 'e1', user_id: 'u1' });
  controller._transitionRuntimeState('req_hung_1', 'running');
  // 管线还在内存里占着相位，但已经 31min 没有任何进展（心跳不动）
  controller.activeRequests.get('req_hung_1').last_progress_at = Date.now() - 31 * 60 * 1000;

  const result = await controller.settleStaleRunningRequests({ reason: 'periodic' });

  assert.equal(result.settled, 1, '心跳陈旧的挂住 run 必须被结算（周期结算的增量价值）');
  assert.deepEqual(result.request_ids, ['req_hung_1']);
  assert.equal(db.calls.update.length, 1);
});

test('内存心跳真的由执行管线的 delta 刷新（接线，不是只测 helper）', async () => {
  const { controller } = createController();
  // 真跑一次 processMessageAsync，走完整的 onDelta 接线
  const res = { writableEnded: false, write: () => {} };
  controller.expertConnections.set('expert001', new Set([{ user_id: 'user001', res }]));

  let heartbeatAfterDelta = null;
  controller.chatService.streamChat = async (params, onDelta, onComplete) => {
    const state = controller.activeRequests.get(params.request_id);
    // 模拟「长跑中 DB 一行都没写」：心跳被人为推到 20min 前
    state.last_progress_at = Date.now() - 20 * 60 * 1000;
    onDelta({ type: 'delta', content: 'x' });
    heartbeatAfterDelta = controller.activeRequests.get(params.request_id).last_progress_at;
    onComplete({ message: { id: 'msg_assistant', topic_id: 'topic_1' }, user_message_id: 'msg_user' });
  };

  await controller.processMessageAsync({
    request_id: 'req_beat',
    topic_id: 'topic_1',
    user_id: 'user001',
    expert_id: 'expert001',
    content: 'hi',
    session: {},
  });

  assert.ok(heartbeatAfterDelta !== null, '管线必须真的推过 delta');
  assert.ok(
    Date.now() - heartbeatAfterDelta < 5000,
    '收到 delta 后心跳必须立刻刷新（这是「活着」的判据，不是 DB updated_at）'
  );
});

test('本进程刚创建、updated_at 很新的请求：SQL 阈值直接挡在候选集外', async () => {
  // 假 db 忠实模拟 SQL：只有 updated_at <= cutoff 的行才会被返回。
  // 阈值缺失时**故意返回全部行**（而不是抛错），否则「实现漏了阈值」会被
  // controller 的 try/catch 吞成 0 候选，让本格假绿。
  const { controller, db } = createController({ runningRows: [] });
  db.chatRequest.findAll = async (options) => {
    db.calls.findAll.push(options);
    const rows = [
      { request_id: 'req_fresh', updated_at: new Date(Date.now() - 1000) },      // 刚起跑 1s
      { request_id: 'req_mid', updated_at: new Date(Date.now() - 5 * 60 * 1000) }, // 跑了 5min
    ];
    const cutoff = options?.where?.updated_at?.[Op.lte];
    if (!cutoff) return rows;
    return rows.filter((row) => row.updated_at.getTime() <= cutoff.getTime());
  };

  const result = await controller.settleStaleRunningRequests({ reason: 'periodic' });

  assert.equal(result.scanned, 0, '新行必须被阈值挡在候选集外');
  assert.equal(result.settled, 0, '刚起跑的请求不许被结算');
  assert.equal(db.calls.update.length, 0);
});

// ---------------------------------------------------------------- 5. 缓存 + 重试放行
test('结算后清掉 requestStore 缓存（否则 getRequestStatus/retry 继续读 running）', async () => {
  const { controller } = createController({
    runningRows: [{ request_id: 'req_dead_3', updated_at: '2026-11-01 10:00:00' }],
  });
  controller.requestStore.set('req_dead_3', {
    request_id: 'req_dead_3',
    status: 'running',
    user_id: 'user001',
  });

  await controller.settleStaleRunningRequests({ reason: 'startup' });

  assert.equal(
    controller.requestStore.has('req_dead_3'),
    false,
    '被结算的行必须从读缓存里删掉，否则重试会继续 409'
  );
});

test('被结算出来的请求允许 retry（不再 409 请求仍在执行中）', async () => {
  const { controller } = createController();
  const settledRecord = {
    request_id: 'req_dead_4',
    original_request_id: null,
    topic_id: 'topic_1',
    user_id: 'user001',
    expert_id: 'expert001',
    model_id: null,
    task_id: null,
    content: 'hello',
    working_path: null,
    status: 'failed',
    user_message_id: 'msg_user_1',
    assistant_message_id: null,
    error_message: '进程中断，请求未完成',
    created_at: '2026-11-01 10:00:00',
    updated_at: '2026-11-01 10:00:00',
    started_at: '2026-11-01 10:00:00',
    completed_at: '2026-11-01 10:30:00',
  };
  controller.ChatRequest.findOne = async () => settledRecord;
  controller._ensureRequestMaintenanceReady = async () => {};
  let processed = 0;
  controller.processMessageAsync = () => { processed += 1; };

  const ctx = createCtx({ request_id: 'req_dead_4', user_id: 'user001' });
  await controller.retryRequest(ctx);

  assert.deepEqual(ctx.errorCalls, [], 'status=failed 不许再被 409 拦住');
  assert.ok(ctx.result, '必须成功建出新请求');
  assert.equal(processed, 1, '必须真的重新调度一次执行');
  assert.equal(ctx.result.original_request_id, 'req_dead_4');
});

// ---------------------------------------------------------------- 6. 可观测 + 调度
test('可观测：结算日志含条数与 request_id 列表', async () => {
  logLines.warn.length = 0;
  const { controller } = createController({
    runningRows: [
      { request_id: 'req_dead_a', updated_at: '2026-11-01 10:00:00' },
      { request_id: 'req_dead_b', updated_at: '2026-11-01 10:00:00' },
    ],
    updateResult: 2,
  });

  await controller.settleStaleRunningRequests({ reason: 'startup' });

  const line = logLines.warn.find((entry) => entry.includes('自动收口'));
  assert.ok(line, '结算必须写 warn 日志');
  assert.ok(line.includes('2'), '日志必须含条数');
  assert.ok(line.includes('req_dead_a') && line.includes('req_dead_b'), '日志必须含 request_id 列表');
  assert.ok(line.includes('startup'), '日志必须能区分启动期/周期');
});

test('启动期立刻结算一次 + 周期定时器（5min）+ stop 后停掉', async () => {
  const { controller } = createController();
  const reasons = [];
  controller.settleStaleRunningRequests = async ({ reason }) => {
    reasons.push(reason);
    return { reason, scanned: 0, settled: 0, request_ids: [], skipped: [] };
  };

  const originalSetInterval = globalThis.setInterval;
  let captured = null;
  globalThis.setInterval = (fn, ms) => {
    captured = { fn, ms };
    return { unref() {} };
  };
  try {
    await controller.startRequestSettlement();
  } finally {
    globalThis.setInterval = originalSetInterval;
  }

  assert.deepEqual(reasons, ['startup'], '启动时必须立刻结算一次');
  assert.ok(captured, '必须挂上周期定时器');
  assert.equal(captured.ms, 5 * 60 * 1000, '周期间隔必须是 5min');
  assert.ok(controller.requestSettlementTimer, '定时器句柄必须可被 stop 拿到');

  await captured.fn();
  assert.deepEqual(reasons, ['startup', 'periodic'], '周期回调必须以 reason=periodic 再跑一次');

  controller.stopRequestSettlement();
  assert.equal(controller.requestSettlementTimer, null, 'stop 后句柄必须清空');
});
