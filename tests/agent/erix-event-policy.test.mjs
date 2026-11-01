/**
 * issue #1255：erix 事件面策略（run_outcome 接住 / 显式白名单 / 未知仍 WARN）
 *
 * 背景（现网实测，不是推测）：erix-agent 0.29 经 `onEvent` 向宿主发射 25 种事件，宿主处理 14 种
 * （`HANDLED_ERIX_EVENT_TYPES` 6 + `switch` 8），剩下 11 种全落到 `default` 那条
 * `erix.unhandled_event` WARN 上——24h 内 8 条 WARN **全部是 `run_outcome`**，每 run 恰好一条。
 * 也就是说：`run_outcome`（run 级终局裁决）在生产上一直是黑洞
 * （`grep -rn "\.termination" lib/ server/` = 0 命中）。
 *
 * 本文件钉死三件事：
 *   ① `run_outcome` 打 INFO 且终局字段齐全（含缺失字段不写假值、长 detail 截断到 500）；
 *   ② 显式白名单（`DELIBERATELY_IGNORED_ERIX_EVENT_TYPES`，6 种结构上不会发的）打 DEBUG + 计数；
 *   ③ **未知事件仍打 WARN**，保持 WARN 的 4 种仍 WARN——白名单是显式清单，不是「其他一律静默」。
 *
 * 全部离线：只读本地源码 + 纯函数调用，不连库、不联网。
 *
 * Run:
 *   node --test tests/agent/erix-event-policy.test.mjs
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
  HANDLED_ERIX_EVENT_TYPES,
} from '../../lib/agent/agent-loop.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const AGENT_LOOP_SOURCE = join(REPO_ROOT, 'lib', 'agent', 'agent-loop.js');

/** 记录型 logger：把每次调用原样收下，便于逐格断言级别 / 字段。 */
function createRecordingLogger({ throwInfo = false } = {}) {
  const entries = [];
  const record = (level) => (message, fields) => {
    if (level === 'info' && throwInfo) throw new Error('logger info failed');
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

/** 引擎 0.29 `runOutcomeRecord()` 真实载荷形状（`src/loop/judge-record.js`）。 */
function fullRunOutcomeEvent(overrides = {}) {
  return {
    type: 'run_outcome',
    runId: 'req_1255_full',
    model: 'claude-sonnet-4',
    rounds: 7,
    judgeRecordCount: 0,
    termination: {
      reason: 'end_turn',
      errorCode: 'E_NONE',
      forcedFinal: false,
      detail: 'run finished after the model returned a final answer',
      usage: { input_tokens: 100, output_tokens: 20 },
      rounds: 7,
    },
    verification: { status: 'skipped', reason: 'no_final_guard' },
    ...overrides,
  };
}

// ── ① run_outcome 接住 ────────────────────────────────────────────────────────

test('run_outcome 打 INFO 且终局字段齐全（reason/errorCode/forcedFinal/verification.status 都在）', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1255_full', logger });

  onEvent(fullRunOutcomeEvent());

  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.level, 'info');
  assert.equal(entry.fields.event, 'erix.run_outcome');
  assert.equal(entry.fields.request_id, 'req_1255_full');
  assert.equal(entry.fields.runId, 'req_1255_full');
  assert.equal(entry.fields.model, 'claude-sonnet-4');
  assert.equal(entry.fields.rounds, 7);
  // 终局裁决必须逐格点名出现在日志对象里——这就是本单净新增的观测面。
  assert.equal(entry.fields.termination.reason, 'end_turn');
  assert.equal(entry.fields.termination.errorCode, 'E_NONE');
  assert.equal(entry.fields.termination.forcedFinal, false);
  assert.equal(
    entry.fields.termination.detail,
    'run finished after the model returned a final answer',
  );
  assert.equal(entry.fields.verification.status, 'skipped');
  // 不许把整条载荷搬进日志（usage 汇总有别的账务通道；finalText 根本不在载荷里）。
  assert.equal(entry.fields.termination.usage, undefined);
  assert.doesNotMatch(JSON.stringify(entry.fields), /judgeRecordCount/);
});

test('run_outcome 缺 model/rounds 时不炸、不写 undefined 假值', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1255_sparse', logger });

  const sparse = fullRunOutcomeEvent({ runId: 'req_1255_sparse' });
  delete sparse.model;
  delete sparse.rounds;

  assert.doesNotThrow(() => onEvent(sparse));
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.level, 'info');
  assert.equal(entry.fields.model, null);
  assert.equal(entry.fields.rounds, null);
  // 关键：不能出现字符串 "undefined"（那是把缺失伪装成一个值）。
  assert.doesNotMatch(JSON.stringify(entry.fields), /undefined/);
  // 其余字段照旧齐全（缺两个字段不该把整条日志打成空壳）。
  assert.equal(entry.fields.termination.reason, 'end_turn');
  assert.equal(entry.fields.verification.status, 'skipped');
});

test('run_outcome 长字符串字段（termination.detail / model）截断到 500 字符', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1255_long', logger });

  const longDetail = `HEAD${'d'.repeat(2000)}`;
  const longModel = `m-${'x'.repeat(900)}`;
  onEvent(fullRunOutcomeEvent({ model: longModel, termination: { reason: 'failed', detail: longDetail } }));

  const [entry] = entries;
  assert.equal(entry.fields.termination.detail.length, 500);
  assert.equal(entry.fields.termination.detail, longDetail.slice(0, 500));
  assert.equal(entry.fields.model.length, 500);
  assert.equal(entry.fields.model, longModel.slice(0, 500));

  // 边界：正好 500 的 detail 原样通过（截断不是「一律砍短」）。
  const exact = 'e'.repeat(500);
  entries.length = 0;
  onEvent(fullRunOutcomeEvent({ termination: { reason: 'failed', detail: exact } }));
  assert.equal(entries[0].fields.termination.detail, exact);
});

// ── ② 显式白名单 ──────────────────────────────────────────────────────────────

test('白名单 6 种打 DEBUG + 计数，且一条 WARN 都不打', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1255_ignored', logger });

  const whitelisted = [
    'continuity_written',
    'continuity_write_failed',
    'continuity_injection_skipped',
    'final_guard_extend',
    'config_override_conflict',
    'resume_journal_skipped',
  ];
  assert.deepEqual([...DELIBERATELY_IGNORED_ERIX_EVENT_TYPES].sort(), [...whitelisted].sort());

  for (const type of whitelisted) onEvent({ type, runId: 'run_ignored' });
  // 同一种再来一次：计数必须涨（这是「结构上不会发」这条推理被打破时的早期信号）。
  onEvent({ type: 'continuity_written', runId: 'run_ignored' });

  assert.equal(entries.length, 7);
  assert.deepEqual(entries.map(({ level }) => level), Array(7).fill('debug'));
  assert.equal(entries.filter(({ level }) => level === 'warn').length, 0);
  assert.deepEqual(
    entries.slice(0, 6).map(({ fields }) => fields.type),
    whitelisted,
  );
  for (const { fields } of entries.slice(0, 6)) {
    assert.equal(fields.event, 'erix.deliberately_ignored_event');
    assert.equal(fields.request_id, 'req_1255_ignored');
    assert.equal(fields.runId, 'run_ignored');
    assert.equal(fields.count, 1);
  }
  assert.equal(entries[6].fields.type, 'continuity_written');
  assert.equal(entries[6].fields.count, 2);
});

// ── ③ 未知仍 WARN / 保持 WARN 的 4 种 ─────────────────────────────────────────

test('未知事件（引擎清单里不存在的 type）仍打 WARN —— 这是本单最重要的格子', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1255_unknown', logger });

  onEvent({ type: 'engine_0_30_brand_new_event', payload: 'sensitive body' });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, 'warn');
  assert.equal(entries[0].fields.event, 'erix.unhandled_event');
  assert.equal(entries[0].fields.type, 'engine_0_30_brand_new_event');
  // 白名单不是「其他一律静默」：没登记的类型必须继续可见。
  assert.doesNotMatch(JSON.stringify(entries), /sensitive body/);
});

test('保持 WARN 的 4 种（压缩/预算/元数据）仍打 WARN，没被白名单吃掉', () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({ request_id: 'req_1255_keep', logger });

  const keepWarn = [
    'compaction_strategy_fallback',
    'compaction_deferred',
    'budget_below_working_set',
    'model_metadata_missing',
  ];
  for (const type of keepWarn) {
    assert.equal(DELIBERATELY_IGNORED_ERIX_EVENT_TYPES.has(type), false);
    onEvent({ type, runId: 'run_keep', detail: 'x'.repeat(1000) });
  }

  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(({ level }) => level), Array(4).fill('warn'));
  assert.deepEqual(entries.map(({ fields }) => fields.type), keepWarn);
  for (const { fields } of entries) assert.equal(fields.event, 'erix.unhandled_event');
});

// ── ④ 不外泄 / 常量自证 ───────────────────────────────────────────────────────

test('处理函数内部抛错不外泄：载荷 getter 抛错与 logger 抛错都不改变终局、不冒泡', () => {
  // (a) 载荷投毒：`termination` 的取值直接抛错（模拟畸形/代理事件对象）。
  const poisoned = createRecordingLogger();
  const onPoisoned = createErixEventHandler({ request_id: 'req_1255_poison', logger: poisoned.logger });
  const evilEvent = {
    type: 'run_outcome',
    runId: 'req_1255_poison',
    get termination() {
      throw new Error('payload getter exploded');
    },
  };
  assert.doesNotThrow(() => onPoisoned(evilEvent));
  assert.equal(poisoned.entries.length, 1);
  assert.equal(poisoned.entries[0].level, 'info');
  assert.equal(poisoned.entries[0].fields.event, 'erix.run_outcome');
  assert.equal(poisoned.entries[0].fields.termination.reason, null);

  // (b) logger 自身抛错：被 onEvent 的 catch 吸收并记 callback_error，不冒泡。
  const throwing = createRecordingLogger({ throwInfo: true });
  const onThrowing = createErixEventHandler({ request_id: 'req_1255_logger', logger: throwing.logger });
  assert.doesNotThrow(() => onThrowing(fullRunOutcomeEvent({ runId: 'req_1255_logger' })));
  assert.equal(throwing.entries.length, 1);
  assert.equal(throwing.entries[0].level, 'error');
  assert.equal(throwing.entries[0].fields.event, 'erix.callback_error');
  assert.equal(throwing.entries[0].fields.type, 'run_outcome');
});

test('白名单常量与实现清单一致（加了 case 忘了从白名单删会被抓）', () => {
  const source = readFileSync(AGENT_LOOP_SOURCE, 'utf8');
  const caseTypes = [...source.matchAll(/case '([a-z_]+)':/g)].map(([, type]) => type);

  // 实现面确实有 9 个 case（run_outcome + 原有 8；白名单是「switch 之前」的分流，
  // 两者重叠 ⇒ 白名单会赢 ⇒ 静默丢日志）。
  assert.equal(caseTypes.length, 9);
  const overlap = caseTypes.filter((type) => DELIBERATELY_IGNORED_ERIX_EVENT_TYPES.has(type));
  assert.deepEqual(overlap, [], `白名单与 switch case 重叠：${overlap.join(',')}`);

  // 白名单与「已处理」集合也必须不相交（同一类型不能既算处理又算忽略）。
  const handledOverlap = [...DELIBERATELY_IGNORED_ERIX_EVENT_TYPES]
    .filter((type) => HANDLED_ERIX_EVENT_TYPES.has(type));
  assert.deepEqual(handledOverlap, []);

  // run_outcome 必须走 case（被接住），不能出现在白名单里。
  assert.equal(caseTypes.includes('run_outcome'), true);
  assert.equal(DELIBERATELY_IGNORED_ERIX_EVENT_TYPES.has('run_outcome'), false);

  // 未知事件那条 WARN 通道必须还在（白名单不是「其他一律静默」）。
  assert.match(source, /event: 'erix\.unhandled_event'/);
  assert.match(source, /default:/);
});
