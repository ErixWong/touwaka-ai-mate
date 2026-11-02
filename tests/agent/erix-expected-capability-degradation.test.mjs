/**
 * issue #1249（裁定 B）：erix 可选 capability 未实现是**预期降级**，按 capability 名降噪。
 *
 * 背景（现网实测，不是推测）：erix-agent 0.29.0 的 `persist()` / `persistRunSnapshot()` 在 store 缺
 * 某个方法时按**方法名**发一条 `persistence_capability_degraded`（引擎 `Set` 去重 ⇒ 每 run 每方法
 * 一条），然后跳过该次持久化、run 正常执行。宿主 `createErixStore` 刻意只暴露 4 个方法
 * （`lib/llm-kit-adapters/loop-bridge.js:330`，注释在 `:313-317`），于是每 run 稳定发 3 条 WARN：
 * 24h 现网 9 条 = `markRunState` 4 + `saveRunState` 4 + `saveRunSnapshot` 1（**三个方法，不是两个**）。
 *
 * Eric 2026-11-02 裁定 **B：正式承认为预期降级并降噪**——不补 run-state / run-snapshot 端口、
 * 不动 DDL（`llm_kit_run_checkpoint` 空表保留）。本文件钉死的是**降噪的边界**：
 *
 *   ① 清单内 3 个方法 ⇒ DEBUG + 计数，一条 WARN 都不打；
 *   ② **未知方法名 ⇒ 仍打 WARN**（本单最重要的一格：将来引擎把**必需**端口报成降级时不能哑）；
 *   ③ 载荷缺 `method` 字段 ⇒ 不许静默，走 WARN（防引擎换字段名 = 发现通道被静默拔掉）；
 *   ④ 清单常量与实现一致（`createErixStore` 真实现了某个方法 / 引擎里没这个发射点 ⇒ 打红）；
 *   ⑤ 降噪不波及同一窗口的其他事件（`run_outcome` 照常 INFO）。
 *
 * 全部离线：只读本地源码 + 纯函数调用，不连库、不联网。
 *
 * Run:
 *   node --test tests/agent/erix-expected-capability-degradation.test.mjs
 *   （已登记进 package.json 的 `npm run test:llm-kit` 显式文件清单，不登记等于没跑）
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  createErixEventHandler,
  DELIBERATELY_IGNORED_ERIX_EVENT_TYPES,
  EXPECTED_UNIMPLEMENTED_CAPABILITIES,
  HANDLED_ERIX_EVENT_TYPES,
} from '../../lib/agent/agent-loop.js';
import { createErixStore } from '../../lib/llm-kit-adapters/loop-bridge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const AGENT_LOOP_SOURCE = join(REPO_ROOT, 'lib', 'agent', 'agent-loop.js');
const ENGINE_LOOP_DIR = join(REPO_ROOT, 'node_modules', 'erix-agent', 'src', 'loop');

/** 记录型 logger：把每次调用原样收下，便于逐格断言级别 / 字段。 */
function createRecordingLogger() {
  const entries = [];
  const record = (level) => (message, fields) => {
    entries.push({ level, message, fields });
  };
  return {
    entries,
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
  };
}

/**
 * 引擎 0.29.0 `notifyCapabilitySkipped()` 的**真实载荷形状**
 * （`node_modules/erix-agent/src/loop/orchestrator.js:1243-1250`，逐字段照抄）：
 * `{type, runId, parentRunId?, method, detail}`——注意 `method` 是**字符串方法名**，
 * `detail` 是 `store does not implement ${method}; …`。
 */
function degradedEvent(method, overrides = {}) {
  return {
    type: 'persistence_capability_degraded',
    runId: 'req_1249_run',
    method,
    detail: `store does not implement ${method}; the corresponding persistence is skipped for this run`,
    ...overrides,
  };
}

/** 引擎 `runOutcomeRecord()` 的载荷（只留本文件要断言的那几格）。 */
function runOutcomeEvent(overrides = {}) {
  return {
    type: 'run_outcome',
    runId: 'req_1249_run',
    model: 'claude-sonnet-4',
    rounds: 4,
    termination: { reason: 'end_turn', errorCode: 'E_NONE', forcedFinal: false, detail: 'done' },
    verification: { status: 'skipped' },
    ...overrides,
  };
}

// ── ① 清单内 3 个方法：DEBUG + 计数，零 WARN ───────────────────────────────────

test('清单内三个方法（markRunState/saveRunState/saveRunSnapshot）⇒ DEBUG + 计数，一条 WARN 都不打', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1249_expected', logger });

  // 现网每 run 的真实三条（引擎每方法一条，Set 去重）。
  for (const method of ['markRunState', 'saveRunState', 'saveRunSnapshot']) {
    onEvent(degradedEvent(method));
  }
  // 同方法再来一次：计数必须涨（「每 run 一条」这条推理被打破时的早期信号）。
  onEvent(degradedEvent('saveRunState'));

  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(({ level }) => level), Array(4).fill('debug'));
  // 关键：一条 WARN 都没有——降噪的全部意义在这里。
  assert.equal(entries.filter(({ level }) => level === 'warn').length, 0);
  assert.equal(entries.filter(({ level }) => level === 'error').length, 0);

  assert.deepEqual(
    entries.map(({ fields }) => fields.method),
    ['markRunState', 'saveRunState', 'saveRunSnapshot', 'saveRunState'],
  );
  assert.deepEqual(
    entries.map(({ fields }) => fields.count),
    [1, 1, 1, 2],
  );
  for (const { fields } of entries) {
    assert.equal(fields.event, 'erix.persistence_capability_degraded_expected');
    assert.equal(fields.request_id, 'req_1249_expected');
    assert.equal(fields.runId, 'req_1249_run');
  }
});

test('降噪只动级别，不动归属字段：debug 条目仍带 request_id/runId/method（可回溯）', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1249_fields', logger });

  onEvent(degradedEvent('markRunState', { runId: 'req_1249_fields', parentRunId: 'req_parent' }));

  const [entry] = entries;
  assert.equal(entry.level, 'debug');
  assert.equal(entry.fields.method, 'markRunState');
  assert.equal(entry.fields.runId, 'req_1249_fields');
  // 引擎的 `detail` 文本不进日志（沿用 #1255 的口径：只记短标识，不搬整段正文）。
  assert.doesNotMatch(JSON.stringify(entry.fields), /does not implement/);
});

// ── ② 未知方法名：仍 WARN（本单最重要的一格） ────────────────────────────────────

test('未知方法名（saveFrobnicator）⇒ 仍打 WARN —— 这是本单最重要的格子', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1249_unknown_method', logger });

  onEvent(degradedEvent('saveFrobnicator'));

  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.level, 'warn');
  // 事件名保持 #1249 之前的值：既有看板/grep 口径不变，只有「清单内」那批换了通道。
  assert.equal(entry.fields.event, 'erix.persistence_capability_degraded');
  assert.equal(entry.fields.method, 'saveFrobnicator');
  assert.equal(entry.fields.runId, 'req_1249_run');
  assert.equal(entry.fields.request_id, 'req_1249_unknown_method');
});

test('必需端口被报成降级（appendRound/load）⇒ 仍打 WARN，绝不被清单吃掉', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1249_required', logger });

  // 这两条是引擎的**必需**面（`orchestrator.js:511` 的 JSDoc：其余才是 optional）。
  // 它们一旦降级意味着账本根本写不进去——必须是 WARN，不能因为「同一种事件」被连坐降噪。
  onEvent(degradedEvent('appendRound'));
  onEvent(degradedEvent('load'));

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(({ level }) => level), ['warn', 'warn']);
  assert.deepEqual(
    entries.map(({ fields }) => fields.method),
    ['appendRound', 'load'],
  );
  assert.equal(EXPECTED_UNIMPLEMENTED_CAPABILITIES.has('appendRound'), false);
  assert.equal(EXPECTED_UNIMPLEMENTED_CAPABILITIES.has('load'), false);
});

// ── ③ 缺 method 字段：不许静默 ────────────────────────────────────────────────

test('事件载荷缺 method 字段 ⇒ 走 WARN（防引擎换字段名后静默失明）', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1249_no_method', logger });

  const missing = degradedEvent('markRunState');
  delete missing.method;
  onEvent(missing);

  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.level, 'warn');
  assert.equal(entry.fields.event, 'erix.persistence_capability_degraded');
  // 缺失写 null，不写字符串 "undefined"（沿用 #1255 的口径）。
  assert.equal(entry.fields.method, null);
  assert.doesNotMatch(JSON.stringify(entry.fields), /undefined/);
});

test('method 字段是脏值（空串/对象/数字）⇒ 一律 WARN，不做任何「像清单项」的宽松匹配', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1249_dirty', logger });

  onEvent(degradedEvent(''));
  onEvent(degradedEvent({ name: 'markRunState' }));
  onEvent(degradedEvent('MarkRunState')); // 大小写不同就是不同方法名：宁可 WARN
  onEvent(degradedEvent(' markRunState')); // 前导空格同理

  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(({ level }) => level), Array(4).fill('warn'));
});

// ── ④ 清单常量与实现一致 ──────────────────────────────────────────────────────

test('清单常量与实现一致（createErixStore 真实现了某个方法 / 引擎里没这个发射点 ⇒ 打红）', () => {
  // (a) 钉死清单内容：增删都要**刻意改这里**（否则清单会悄悄膨胀成「藏 bug 的地方」）。
  assert.deepEqual(
    [...EXPECTED_UNIMPLEMENTED_CAPABILITIES].sort(),
    ['markRunState', 'saveRunSnapshot', 'saveRunState'],
  );

  // (b) 反向一致：清单里每个方法，宿主 store **必须真的没有**。
  // 这条是「将来有人补了端口却忘了删清单」的护栏——补了端口还留在清单里，
  // 就等于把「已实现的能力仍在降级」这件事静默掉。
  const store = createErixStore({ db: { sequelize: {} } });
  for (const method of EXPECTED_UNIMPLEMENTED_CAPABILITIES) {
    assert.equal(
      typeof store[method],
      'undefined',
      `createErixStore 已经实现了 ${method}，必须从 EXPECTED_UNIMPLEMENTED_CAPABILITIES 删掉`,
    );
  }
  // 必需面在，且不在清单里（清单只装 optional）。
  assert.equal(typeof store.appendRound, 'function');
  assert.equal(typeof store.load, 'function');

  // (c) 正向一致：清单里每个名字都必须是**引擎真的会发**的 method 取值。
  // 取值来源只有两处：`persist("X")` 的第一个实参、`notifyCapabilitySkipped("X")` 的实参
  // （`persist(method, …)` / `notifyCapabilitySkipped(method)` 两条动态调用由上面两条覆盖）。
  const engineSources = ['orchestrator.js', 'resume-manager.js']
    .map((file) => readFileSync(join(ENGINE_LOOP_DIR, file), 'utf8'))
    .join('\n');
  const engineMethods = new Set([
    ...[...engineSources.matchAll(/persist\("([A-Za-z_]+)"/g)].map(([, method]) => method),
    ...[...engineSources.matchAll(/notifyCapabilitySkipped(?:\?\.)?\("([A-Za-z_]+)"/g)]
      .map(([, method]) => method),
  ]);
  // 前提自检：引擎里确实能扫出这 6 个取值（3 个写端口 + 2 个 resume loader + 1 个必需面）。
  // 引擎升级后这条会先红——那是**有意的**：取值表变了就该回来看清单。
  assert.deepEqual(
    [...engineMethods].sort(),
    ['appendRound', 'loadLatestRunSnapshot', 'loadRunState', 'markRunState', 'saveRunSnapshot', 'saveRunState'],
  );
  for (const method of EXPECTED_UNIMPLEMENTED_CAPABILITIES) {
    assert.equal(engineMethods.has(method), true, `引擎里没有 ${method} 的发射点，清单写错了`);
  }

  // (d) 两个 resume loader **刻意不进清单**（它们只在 resume 路径发；未接 resume ⇒ 恒不发）。
  // 一旦有人接了 resume 却忘了实现 loader，我们要的是 WARN 而不是静默——所以这里钉住「不在清单里」。
  assert.equal(EXPECTED_UNIMPLEMENTED_CAPABILITIES.has('loadRunState'), false);
  assert.equal(EXPECTED_UNIMPLEMENTED_CAPABILITIES.has('loadLatestRunSnapshot'), false);

  // (e) 与 #1255 两张表不相交：清单装的是 `method` 名，另两张装的是事件 `type`。
  for (const method of EXPECTED_UNIMPLEMENTED_CAPABILITIES) {
    assert.equal(HANDLED_ERIX_EVENT_TYPES.has(method), false);
    assert.equal(DELIBERATELY_IGNORED_ERIX_EVENT_TYPES.has(method), false);
  }

  // (f) 分流必须发生在 `case 'persistence_capability_degraded'` 之内（按 method 分流），
  // 而不是把整个事件类型塞进 DELIBERATELY_IGNORED_ERIX_EVENT_TYPES（那会连未知方法一起静默）。
  assert.equal(DELIBERATELY_IGNORED_ERIX_EVENT_TYPES.has('persistence_capability_degraded'), false);
  const source = readFileSync(AGENT_LOOP_SOURCE, 'utf8');
  assert.match(source, /case 'persistence_capability_degraded': \{/);
  assert.match(source, /EXPECTED_UNIMPLEMENTED_CAPABILITIES\.has\(method\)/);
});

// ── ⑤ 降噪不波及同窗口其他事件 ────────────────────────────────────────────────

test('降噪不影响同一次 run 里其他事件：同窗口 erix.run_outcome 仍照常打 INFO', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1249_run', logger });

  // 一次 run 的真实事件序：三条预期降级 → run 终局。
  onEvent(degradedEvent('markRunState'));
  onEvent(degradedEvent('saveRunState'));
  onEvent(degradedEvent('saveRunSnapshot'));
  onEvent(runOutcomeEvent());

  assert.deepEqual(
    entries.map(({ level }) => level),
    ['debug', 'debug', 'debug', 'info'],
  );
  const outcome = entries.at(-1);
  assert.equal(outcome.fields.event, 'erix.run_outcome');
  assert.equal(outcome.fields.runId, 'req_1249_run');
  assert.equal(outcome.fields.termination.reason, 'end_turn');
  assert.equal(outcome.fields.verification.status, 'skipped');

  // 反过来也一样：降噪的 debug 计数不串到 run_outcome 的字段里。
  assert.equal(outcome.fields.method, undefined);
  assert.equal(outcome.fields.count, undefined);
});

test('未知事件与预期降级同窗口：前者仍 WARN（两种降噪通道互不干扰）', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1249_mixed', logger });

  onEvent(degradedEvent('saveRunState'));
  onEvent({ type: 'engine_0_30_brand_new_event' });
  onEvent(degradedEvent('saveFrobnicator'));

  assert.deepEqual(
    entries.map(({ level }) => level),
    ['debug', 'warn', 'warn'],
  );
  assert.deepEqual(
    entries.map(({ fields }) => fields.event),
    [
      'erix.persistence_capability_degraded_expected',
      'erix.unhandled_event',
      'erix.persistence_capability_degraded',
    ],
  );
});
