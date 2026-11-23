/**
 * #1303：chat_request 状态写入的「终态不可倒写」守卫
 *
 * 现象（详见 issue #1303）：点「中止」后立刻点「重试」⇒ 409「请求仍在执行中，暂不允许重试」。
 * 根因：`stopRequest()` 已把 DB 收口成 `stopped`，但仍在跑的执行管线会把状态**写回** `running`
 * ——`status:'running'` 的两处写（`processMessageAsync` 起跑处、`onDelta` 的 `start` 分支）
 * 都没有 DB 状态条件，而 `_updateRequestRecord()` 是「读整条 → 合并 → 整行覆盖写、where 只有
 * 主键」，于是连「只补 user_message_id」这种不带 status 的调用也能复活状态；缓存优先读
 * （`_getRequestRecord`）再把这个谎传给 retry 的 409 判据。
 *
 * 本文件钉住改后的语义：
 *   1. 延迟到达的 `start` delta **不得**把 DB 写回 `running`（终态优先）。
 *   2. 守卫没命中（影响 0 行）时 `requestStore` **不被污染**（否则内存 running / DB stopped）。
 *   3. 守卫没命中时同 patch 里的 `topic_id` **仍要落库**（守卫只拦状态，不许吃掉合法字段）。
 *   4. patch 不含 `status` 时**不得**把 status 写回 DB（SET 里根本不许出现 status 列）。
 *   5. 终态写（stopped / completed / failed）**仍可达**——不许把守卫套到终态上写死状态。
 *   6. 不传 `options` 时行为与改前一致：`where` 只有 `request_id`（默认无守卫）。
 *
 * 纯内存假象（假 db + 假 ChatRequest + 假 ctx），不连数据库、不写生产库。
 * 假 `ChatRequest.update` **真的模拟条件更新**：按 `where.status` 与当前行状态比对，
 * 命中才落值并返回 `[1]`，否则一行不改并返回 `[0]`（否则 1/2/3 全是假绿）。
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

/** 让 onDelta 里那些「同步回调中无法 await」的 Promise 落地（微任务 + 宏任务各排空若干轮） */
async function flushAsync(ticks = 4) {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// ---------------------------------------------------------------- 假 db（真的条件更新）
function seedRow(overrides = {}) {
  const now = new Date().toISOString();
  return {
    request_id: 'req_1',
    original_request_id: null,
    topic_id: 'topic_old',
    user_id: 'user001',
    expert_id: 'expert001',
    model_id: null,
    task_id: null,
    user_message_id: null,
    assistant_message_id: null,
    status: 'accepted',
    content: 'hi',
    working_path: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/**
 * 假 db：`table` 是「DB 真相」，`calls.update` 记录每一次 UPDATE 的
 * `{ values, options, affected }`。`update` 忠实模拟 SQL：
 *   · 主键找不到行 ⇒ [0]；
 *   · `where.status` 是 `{[Op.in]: [...]}` ⇒ 当前行状态不在集合里就 [0] 且**一行都不改**；
 *   · 只 SET `values` 里**真的出现**的列（values 不带 status 时 status 不可能被改）。
 * `findOne` 返回**副本**：否则 requestStore 会缓存住同一个对象引用，「缓存没被污染」会被假绿。
 */
function createFakeDb(rows = [], { changedRows = false } = {}) {
  const table = new Map(rows.map((row) => [row.request_id, { ...row }]));
  const calls = { update: [], findOne: [] };

  const chatRequest = {
    async findOne(options) {
      calls.findOne.push(options);
      const row = table.get(options?.where?.request_id);
      return row ? { ...row } : null;
    },
    async create(record) {
      table.set(record.request_id, { ...record });
      return record;
    },
    async update(values, options) {
      const where = options?.where || {};
      const row = table.get(where.request_id);
      let affected = 0;
      if (row) {
        const statusCondition = where.status;
        const allowed = statusCondition && typeof statusCondition === 'object'
          ? statusCondition[Op.in]
          : null;
        const matched = statusCondition === undefined
          || (Array.isArray(allowed) ? allowed.includes(row.status) : statusCondition === row.status);
        if (matched) {
          // #1303 跟进（缺陷 A 的用例需要）：MySQL 驱动的 Model.update() 返回的是
          // **changed rows** 而不是 matched rows —— SET 的值与现值逐项相同时影响行数就是 0
          // （updated_at 列只到秒，同一秒内的重复写视为「未变」，故这里不参与比较）。
          const changed = !changedRows
            || Object.entries(values).some(
              ([column, value]) => column !== 'updated_at' && !Object.is(row[column], value)
            );
          for (const [column, value] of Object.entries(values)) {
            row[column] = value;
          }
          affected = changed ? 1 : 0;
        }
      }
      calls.update.push({ values: { ...values }, options: { where: { ...where } }, affected });
      return [affected];
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
    table,
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

function createController({ rows = [], connected = true, changedRows = false } = {}) {
  const db = createFakeDb(rows, { changedRows });
  const chatService = {
    streamChat: async () => {},
    abortRequest: async () => true,
  };
  const controller = new StreamController(db, chatService);
  // 权限/系统设置服务是进程级单例，这里换成放行版，避免用例触到真实 DB
  controller.permissionService = { canAccessExpert: async () => true };
  if (connected) {
    const res = { writableEnded: false, writes: [], write(chunk) { this.writes.push(chunk); } };
    controller.expertConnections.set('expert001', new Set([{ user_id: 'user001', res }]));
    controller.capturedRes = res;
  }
  return { controller, db, table: db.table };
}

const PIPELINE_ARGS = {
  request_id: 'req_1',
  topic_id: 'topic_old',
  user_id: 'user001',
  expert_id: 'expert001',
  content: 'hi',
  session: {},
};

/**
 * 竞态剧本：管线已在跑（status=running）⇒ stopRequest() await 收口成 stopped
 * ⇒ 之后「延迟到达」的 delta 才落地（真实世界里这处写库时刻完全不可控）。
 * 返回已捕获的 onDelta，便于在 stop **之后**再喂任意 delta。
 */
async function runPipelineThenStopThenDelta(delta) {
  const harness = createController({ rows: [seedRow({ status: 'running', topic_id: 'topic_old' })] });
  const { controller, db, table } = harness;

  let feedDelta = null;
  controller.chatService.streamChat = async (params, onDelta) => {
    feedDelta = onDelta;
    // 1) 停止先到（stopRequest 内部 await 收口 ⇒ DB 已是 stopped）
    await controller.stopRequest(params.request_id, params.user_id);
    // 2) 在途 delta 之后才落地
    onDelta(delta);
  };

  await controller.processMessageAsync({ ...PIPELINE_ARGS });
  await flushAsync();

  return { ...harness, db, table, feedDelta };
}

const guardedRunningWrites = (db) => db.calls.update.filter(
  (call) => call.values.status === 'running' && call.options.where.status !== undefined
);

// ---------------------------------------------------------------- 1 + 2：终态不可倒写
test('stop 之后延迟到达的 start delta 不得把 DB 写回 running，也不得污染 requestStore', async () => {
  const { controller, db, table } = await runPipelineThenStopThenDelta({
    type: 'start',
    topic_id: 'topic_new',
    is_new_topic: false,
  });

  // 守卫确实带上了原子状态条件（不是「读后判断」）
  const guarded = guardedRunningWrites(db);
  assert.ok(guarded.length >= 1, 'status→running 的写必须带 WHERE status 条件');
  assert.deepEqual([...guarded[0].options.where.status[Op.in]].sort(), ['accepted', 'running']);

  // 至少一次守卫写被判定为「没命中」（stop 已收口），否则整条用例是假绿
  assert.ok(
    guarded.some((call) => call.affected === 0),
    `必须出现「影响 0 行」的条件更新（证明假 db 真在模拟条件更新）：${JSON.stringify(guarded)}`
  );

  assert.equal(table.get('req_1').status, 'stopped', 'DB 侧必须仍是 stopped（终态不可倒写）');
  assert.ok(controller.requestStore.has('req_1'), '缓存里应还有这条记录');
  assert.equal(
    controller.requestStore.get('req_1').status,
    'stopped',
    '守卫没命中时不许把 running 塞进 requestStore（否则内存说 running、DB 说 stopped）'
  );
});

test('守卫没命中是正常竞态：不抛异常、不打 error/warn，只留 debug 痕迹', async () => {
  logLines.debug.length = 0;
  logLines.warn.length = 0;
  logLines.error.length = 0;

  const { controller } = await runPipelineThenStopThenDelta({ type: 'start', topic_id: 'topic_new' });
  // 直接再撞一次守卫（同步可断言返回值）
  const guarded = await controller._updateRequestRecord('req_1', { status: 'running' }, {
    onlyFromStatuses: ['accepted', 'running'],
  });

  assert.equal(guarded, null, '守卫没命中必须返回 null（调用方可识别），而不是抛异常');
  assert.ok(
    logLines.debug.some((line) => line.includes('跳过 status→running') && line.includes('req_1')),
    '守卫没命中要留 debug 痕迹（含 request_id）'
  );
  assert.equal(
    logLines.error.filter((line) => line.includes('跳过 status')).length,
    0,
    '正常竞态不许打 error 级日志'
  );
});

// ---------------------------------------------------------------- 3：守卫不吃合法字段
test('守卫没命中时 start delta 带的 topic_id 仍要落库（状态被挡，字段不许丢）', async () => {
  const { table, db } = await runPipelineThenStopThenDelta({
    type: 'start',
    topic_id: 'topic_new',
    is_new_topic: true,
  });

  const row = table.get('req_1');
  assert.equal(row.topic_id, 'topic_new', '守卫只拦状态：topic_id 丢了会坏掉话题归组');
  assert.equal(row.status, 'stopped', '同时状态必须还是 stopped');

  // 补写那次必须走「不带 status」的通路（而不是把 stopped 又写回去）
  const topicOnlyWrite = db.calls.update.find(
    (call) => call.values.topic_id === 'topic_new' && !('status' in call.values)
  );
  assert.ok(
    topicOnlyWrite,
    `必须用「不含 status 的 patch」补写 topic_id：${JSON.stringify(db.calls.update.map((c) => Object.keys(c.values)))}`
  );
});

test('起跑处的 status→running 被挡住时，topic_id / started_at / error_message 仍落库', async () => {
  // 剧本变体：stop 在**起跑写之前**就收口成 stopped（DB 已终态），起跑写整条被守卫挡下
  const { controller, db, table } = createController({
    rows: [seedRow({ status: 'stopped', error_message: '请求已停止', started_at: null })],
  });
  controller.chatService.streamChat = async () => {
    // 什么都不做：起跑处那次带守卫写已经在 processMessageAsync 里被挡下
  };

  await controller.processMessageAsync({ ...PIPELINE_ARGS, topic_id: 'topic_new', content: 'hi' });
  await flushAsync();

  const row = table.get('req_1');
  assert.equal(row.status, 'stopped', '起跑写不许把 stopped 复活成 running');
  assert.equal(row.topic_id, 'topic_new', 'topic_id 仍要落库');
  assert.ok(row.started_at, 'started_at 仍要落库（否则耗时统计缺失）');
  assert.equal(row.error_message, null, 'error_message 的清除也仍要落库（改前值是「请求已停止」）');

  const runningWrites = db.calls.update.filter((c) => c.values.status === 'running');
  assert.ok(runningWrites.length >= 1, '起跑处必须真的发过一次 status→running');
  assert.ok(
    runningWrites.every((c) => c.options.where.status !== undefined),
    '起跑处的 status→running 必须全带状态条件（漏一次就是漏守卫）'
  );
  assert.ok(
    runningWrites.every((c) => c.affected === 0),
    'DB 已是 stopped ⇒ 起跑那次带守卫写必须判定为没命中'
  );
});

// ---------------------------------------------------------------- 4：不带 status 就不许碰 status
test('patch 不含 status 时：SET 里不许出现 status 列，DB 状态纹丝不动', async () => {
  const { controller, db, table } = createController({ rows: [seedRow({ status: 'stopped' })] });
  const before = db.calls.update.length;

  const updated = await controller._updateRequestRecord('req_1', { user_message_id: 'msg_user_1' });

  assert.ok(updated, '非状态写要正常返回合并后的记录');
  assert.equal(updated.status, 'stopped', '返回值里的 status 也必须是现状（不许凭空造 running）');

  const call = db.calls.update[before];
  assert.ok(call, '必须真的发了一次 UPDATE');
  assert.ok(
    !('status' in call.values),
    `SET 里不许出现 status（改前正是这里把缓存里的 status 写回、于是能复活终态）：${JSON.stringify(Object.keys(call.values))}`
  );
  assert.equal(call.values.user_message_id, 'msg_user_1', '该写的字段照写');
  assert.equal(table.get('req_1').user_message_id, 'msg_user_1');
  assert.equal(table.get('req_1').status, 'stopped', 'DB 状态不许被这次写改动');
});

test('user_message_saved delta（只补 message_id）不得把 stopped 复活成 running', async () => {
  const { table, db } = await runPipelineThenStopThenDelta({
    type: 'user_message_saved',
    message_id: 'msg_user_9',
  });

  const row = table.get('req_1');
  assert.equal(row.status, 'stopped', '只补 message_id 的调用绝不能复活状态');
  assert.equal(row.user_message_id, 'msg_user_9', '但 message_id 必须落库');
  assert.ok(
    db.calls.update.every((call) => call.values.status !== 'running' || call.options.where.status !== undefined),
    '本用例里任何 status=running 的写都必须带状态条件（不许漏守卫）'
  );
});

// ---------------------------------------------------------------- 5：终态写仍可达
test('终态写不受守卫影响：stopped / completed / failed 照常落库，且 where 不带状态条件', async () => {
  const { controller, db, table } = createController({ rows: [seedRow({ status: 'running' })] });
  const before = db.calls.update.length;

  for (const terminal of ['stopped', 'completed', 'failed']) {
    const updated = await controller._updateRequestRecord('req_1', {
      status: terminal,
      completed_at: new Date().toISOString(),
    });
    assert.ok(updated, `${terminal} 终态写不许被挡（管线自己必须收得了口）`);
    assert.equal(table.get('req_1').status, terminal, `${terminal} 必须真的落库`);
    assert.equal(controller.requestStore.get('req_1').status, terminal, '缓存要跟着终态走');
  }

  const terminalWrites = db.calls.update.slice(before);
  assert.equal(terminalWrites.length, 3);
  for (const call of terminalWrites) {
    assert.equal(
      call.options.where.status,
      undefined,
      `终态写不许套「只从 accepted/running 出发」的守卫：${JSON.stringify(call.options.where)}`
    );
    assert.equal(call.affected, 1, '终态写必须命中');
  }
  // 终态之间也不许互相挡住（completed 之后仍能写 failed/stopped 是本文件上一轮已验的事实）
  assert.equal(table.get('req_1').status, 'failed');
});

test('管线级终态仍可达：onComplete ⇒ completed、抛错 ⇒ failed', async () => {
  // completed：正常跑完
  const done = createController({ rows: [seedRow({ status: 'accepted' })] });
  done.controller.chatService.streamChat = async (params, onDelta, onComplete) => {
    onComplete({ message: { id: 'msg_assistant_1', topic_id: 'topic_new' }, user_message_id: 'msg_user_1' });
  };
  await done.controller.processMessageAsync({ ...PIPELINE_ARGS });
  await flushAsync();
  assert.equal(done.table.get('req_1').status, 'completed', 'completed 必须照常可达');
  assert.equal(done.table.get('req_1').assistant_message_id, 'msg_assistant_1');

  // failed：管线抛错
  const boom = createController({ rows: [seedRow({ status: 'accepted' })] });
  boom.controller.chatService.streamChat = async () => {
    throw new Error('socket hang up');
  };
  await boom.controller.processMessageAsync({ ...PIPELINE_ARGS });
  await flushAsync();
  assert.equal(boom.table.get('req_1').status, 'failed', 'failed 必须照常可达');
  assert.match(boom.table.get('req_1').error_message, /socket hang up/);

  // stopped：stopRequest 的乐观收口（权威）
  const stopped = createController({ rows: [seedRow({ status: 'running' })] });
  await stopped.controller._createRuntimeState('req_1', { expert_id: 'expert001', user_id: 'user001' });
  stopped.controller._transitionRuntimeState('req_1', 'running');
  const result = await stopped.controller.stopRequest('req_1', 'user001');
  assert.equal(result.success, true);
  assert.equal(stopped.table.get('req_1').status, 'stopped');
});

// ---------------------------------------------------------------- 6：默认无守卫 ⇒ 行为零变化
test('不传 options 时 where 只有 request_id（未点名的 12 个调用点行为零变化）', async () => {
  const { controller, db, table } = createController({ rows: [seedRow({ status: 'running' })] });
  const before = db.calls.update.length;

  const updated = await controller._updateRequestRecord('req_1', { status: 'completed' });

  assert.ok(updated);
  assert.equal(updated.status, 'completed');
  const call = db.calls.update[before];
  assert.deepEqual(Object.keys(call.options.where), ['request_id'], '默认不许出现任何状态条件');
  assert.equal(call.options.where.request_id, 'req_1');
  assert.equal(table.get('req_1').status, 'completed');
});

test('守卫命中时照常推进：accepted → running 成功、缓存同步、WHERE 带 Op.in', async () => {
  const { controller, db, table } = createController({ rows: [seedRow({ status: 'accepted' })] });

  const advanced = await controller._transitionRequestStatus('req_1', {
    status: 'running',
    topic_id: 'topic_new',
    started_at: new Date().toISOString(),
  }, { onlyFromStatuses: ['accepted', 'running'] });

  assert.equal(advanced, true, '当前状态在允许集合里就必须推进');
  assert.equal(table.get('req_1').status, 'running');
  assert.equal(controller.requestStore.get('req_1').status, 'running', '推进成功时缓存要同步');

  const call = guardedRunningWrites(db)[0];
  assert.ok(call, '必须真的发出带状态条件的 UPDATE');
  assert.deepEqual([...call.options.where.status[Op.in]], ['accepted', 'running']);
  assert.deepEqual(Object.keys(call.options.where).sort(), ['request_id', 'status'], '条件里只有主键 + status');
  assert.equal(call.affected, 1);
});

test('记录不存在时不写库、返回 null（守卫改动没引入新的空指针路径）', async () => {
  const { controller, db } = createController({ rows: [] });

  const updated = await controller._updateRequestRecord('req_missing', { status: 'running' }, {
    onlyFromStatuses: ['accepted', 'running'],
  });

  assert.equal(updated, null);
  assert.equal(db.calls.update.length, 0, '查不到记录时一条 UPDATE 都不许发');
  assert.equal(controller.requestStore.has('req_missing'), false);
});

// ================================================================ #1303 跟进（两个残余缺陷）
//
// 缺陷 A：MySQL 驱动下 `Model.update()` 的影响行数是 **changed rows**，不是 matched rows。
//         守卫其实命中、但要写的值与现值完全相同（updated_at 列只到秒 ⇒ 同一秒内不变）时
//         同样返回 0 ⇒ 旧实现把「值没变」误判成「守卫拒绝」。
// 缺陷 B：`_getRequestRecord()` 是**缓存优先**读，而 `_updateRequestRecord` 过去用本次调用
//         开头读到的快照整体 `requestStore.set()`：期间 `stopRequest` 写进缓存的 stopped
//         会被快照里的 running 盖回 ⇒ DB 已 stopped、缓存说 running ⇒ retry 照旧 409。

test('缺陷 A 正例：守卫命中但 UPDATE 影响 0 行（changed rows）⇒ 仍算已推进、不补写、缓存同步', async () => {
  logLines.debug.length = 0;
  const startedAt = new Date().toISOString();
  const { controller, db, table } = createController({
    // 现值与要写的值逐项相同 ⇒ 假 db 在守卫命中的前提下也返回 [0]（模拟 MySQL 语义）
    rows: [seedRow({ status: 'running', topic_id: 'topic_new', started_at: startedAt })],
    changedRows: true,
  });

  const patch = { status: 'running', topic_id: 'topic_new', started_at: startedAt };
  const updated = await controller._updateRequestRecord('req_1', patch, {
    onlyFromStatuses: ['accepted', 'running'],
  });

  assert.equal(db.calls.update.length, 1, '只该发一条带守卫的 UPDATE');
  assert.equal(db.calls.update[0].affected, 0, '假 db 确实在模拟 changed rows（值相同 ⇒ 0 行）');
  assert.ok(updated, '值未变化不是「守卫拒绝」：必须返回记录而不是 null');
  assert.equal(updated.status, 'running');
  assert.equal(controller.requestStore.get('req_1').status, 'running', '守卫命中就要同步缓存');
  assert.ok(
    logLines.debug.some((line) => line.includes('值未变化') && line.includes('req_1')),
    `要留下「值未变化，视为已推进」的 debug 痕迹：${JSON.stringify(logLines.debug)}`
  );

  const advanced = await controller._transitionRequestStatus('req_1', patch, {
    onlyFromStatuses: ['accepted', 'running'],
  });
  assert.equal(advanced, true, '守卫命中（只是值没变）不许返回假 false');
  assert.equal(db.calls.update.length, 2, '不许因为假的「守卫未命中」再补发一条 UPDATE');
  assert.ok(
    db.calls.update.every((call) => 'status' in call.values),
    '两条都必须是带 status 的守卫写（出现不含 status 的那条就是补写）'
  );
  assert.equal(table.get('req_1').status, 'running');
});

test('缺陷 A 反例：DB 现值 stopped ⇒ 真未命中，返回 null、缓存仍是 stopped、走不带 status 的补写', async () => {
  logLines.debug.length = 0;
  const { controller, db, table } = createController({
    rows: [seedRow({ status: 'stopped', topic_id: 'topic_old', error_message: '请求已停止' })],
  });
  await controller._getRequestRecord('req_1');   // 先让缓存里有一条 stopped

  const advanced = await controller._transitionRequestStatus('req_1', {
    status: 'running',
    topic_id: 'topic_new',
  }, { onlyFromStatuses: ['accepted', 'running'] });

  assert.equal(advanced, false, '现值是终态 ⇒ 真未命中，返回 false');
  assert.equal(table.get('req_1').status, 'stopped', 'DB 状态不许被倒写');
  assert.equal(table.get('req_1').topic_id, 'topic_new', '守卫只拦状态：topic_id 仍要落库');
  assert.equal(controller.requestStore.get('req_1').status, 'stopped', '缓存不许被 running 污染');
  assert.ok(
    db.calls.update
      .filter((call) => call.values.status === 'running')
      .every((call) => call.options.where.status !== undefined && call.affected === 0),
    'status→running 只许出现在「带守卫且判定未命中」的那次尝试里，不许落库'
  );
  assert.ok(
    db.calls.update.some((call) => !('status' in call.values) && call.values.topic_id === 'topic_new'),
    `必须走「不带 status」的补写通路：${JSON.stringify(db.calls.update.map((c) => Object.keys(c.values)))}`
  );
  assert.ok(
    logLines.debug.some((line) => line.includes('跳过 status→running') && line.includes('req_1')),
    '真未命中的 debug 痕迹保持原样（现有用例钉着这句文案）'
  );
});

test('缺陷 B 竞态：helper 读完快照后 stopRequest 才把缓存改成 stopped ⇒ 缓存必须停在 stopped', async () => {
  const { controller, db, table } = createController({ rows: [seedRow({ status: 'running' })] });
  await controller._getRequestRecord('req_1');   // 快照来自缓存（running）
  assert.equal(controller.requestStore.get('req_1').status, 'running');

  const fakeUpdate = controller.ChatRequest.update.bind(controller.ChatRequest);
  let injected = false;
  controller.ChatRequest.update = async (values, options) => {
    if (!injected) {
      injected = true;
      // stopRequest 在「helper 读完快照之后、UPDATE 落地之前」把缓存改成 stopped
      controller.requestStore.set('req_1', {
        ...controller.requestStore.get('req_1'),
        status: 'stopped',
      });
    }
    return fakeUpdate(values, options);
  };

  const updated = await controller._updateRequestRecord('req_1', { user_message_id: 'msg_user_7' });

  assert.ok(updated && typeof updated === 'object', '返回值语义不变：仍是合并后的记录');
  assert.equal(updated.user_message_id, 'msg_user_7');
  assert.equal(
    controller.requestStore.get('req_1').status,
    'stopped',
    '缓存不许被开头读到的 running 快照盖回（#1303 验收实测：缓存 running ⇒ retry 照样 409）'
  );
  assert.ok(
    db.calls.update.every((call) => call.values.status !== 'running'),
    `这次写不许把 DB 的 status 改成 running：${JSON.stringify(db.calls.update.map((c) => Object.keys(c.values)))}`
  );
  assert.equal(table.get('req_1').status, 'running', 'DB 侧本来还是 running（stop 的 DB 写尚未落地）');
  assert.equal(table.get('req_1').user_message_id, 'msg_user_7', '非状态字段照常落库');
});

test('缺陷 B 配套：缓存里没有该条且 patch 不含 status ⇒ 不回填陈旧快照（返回记录本身）', async () => {
  const { controller, db } = createController({ rows: [seedRow({ status: 'stopped' })] });

  const fakeUpdate = controller.ChatRequest.update.bind(controller.ChatRequest);
  let injected = false;
  controller.ChatRequest.update = async (values, options) => {
    if (!injected) {
      injected = true;
      controller.requestStore.delete('req_1');   // 写库之前缓存条目失效/被清掉
    }
    return fakeUpdate(values, options);
  };

  const updated = await controller._updateRequestRecord('req_1', { user_message_id: 'msg_user_8' });

  assert.ok(updated && typeof updated === 'object', '返回值仍是记录对象');
  assert.equal(updated.status, 'stopped');
  assert.equal(db.calls.update.length, 1);
  assert.equal(
    controller.requestStore.has('req_1'),
    false,
    '本次没有权威 status ⇒ 不许把开头快照的 status 塞回缓存，让下一次读回落到 DB'
  );
});
