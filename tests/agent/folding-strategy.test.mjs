/**
 * issue #1277 —— 折叠策略配置面（`ERIX_FOLDING_STRATEGY`）与摘要器失败的可读化。
 *
 * 纯函数用例，不连库、不跑引擎：本文件钉的是**我们这一层**的两条判据——
 *   ① 三档都能配起来、非法值当场报错（不静默退回默认档、也不靠引擎的 TypeError）；
 *   ② 摘要器失败的事实（`details.kind` / 根因 `errorCode` / 终局 `failed`）被完整搬出来，
 *      且**没有**任何降级处置（不重试、不改策略、不改终局）。
 *
 * 引擎侧「策略真的生效」与 e2e 失败面见 `tests/agent/fold-strategy-contract.test.mjs`。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_FOLDING_STRATEGY,
  FOLDING_STRATEGY_ENV,
  FOLDING_STRATEGY_NAMES,
  FoldingStrategyConfigError,
  INVALID_FOLDING_STRATEGY_CODE,
  buildFoldingContext,
  resolveFoldingStrategy,
} from '../../lib/agent/folding-strategy.js';
import {
  SUMMARIZER_FAILED_CODE,
  SUMMARIZER_FAILURE_KINDS,
  createReadableSummarizerFailure,
  describeSummarizerFailure,
  isSummarizerFailure,
  summarizerFailureLogFields,
} from '../../lib/agent/fold-failure.js';

// ─────────────────────────────────────────────────────────────────────────────
// 配置面
// ─────────────────────────────────────────────────────────────────────────────

test('#1277 默认档是 fold-llm（用户裁决 B）：未设 / 空串 / 纯空白都取默认', () => {
  assert.equal(DEFAULT_FOLDING_STRATEGY, 'fold-llm', '默认档必须是裁决选的那一档');
  assert.equal(resolveFoldingStrategy(undefined), 'fold-llm');
  assert.equal(resolveFoldingStrategy(null), 'fold-llm');
  assert.equal(resolveFoldingStrategy(''), 'fold-llm');
  assert.equal(resolveFoldingStrategy('   '), 'fold-llm');
});

test('#1277 三档都能配起来（取值域逐字等于引擎内置名）', () => {
  assert.deepEqual([...FOLDING_STRATEGY_NAMES], ['sliding-window', 'fold-statistical', 'fold-llm']);
  for (const name of FOLDING_STRATEGY_NAMES) {
    assert.equal(resolveFoldingStrategy(name), name, `${name} 必须原样通过`);
    // 前后空白不算改档（`.env` 里常见的尾随空格）
    assert.equal(resolveFoldingStrategy(`  ${name}\n`), name, `${name} 的空白必须被裁掉`);
  }
});

test('#1277 非法值当场抛：点名收到的值 + 合法清单 + 环境变量名，且不静默退回默认档', () => {
  for (const bad of ['fold-llm2', 'FOLD-LLM', 'statistical', 'fold-llm,fold-statistical']) {
    assert.throws(
      () => resolveFoldingStrategy(bad),
      (error) => {
        assert.ok(error instanceof FoldingStrategyConfigError, `${bad} 必须抛 FoldingStrategyConfigError`);
        assert.equal(error.name, 'FoldingStrategyConfigError');
        assert.equal(error.code, INVALID_FOLDING_STRATEGY_CODE);
        // 三件事必须同时出现在文案里，否则运维还得翻源码
        assert.match(error.message, new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `报错必须点名收到的值：${error.message}`);
        for (const name of FOLDING_STRATEGY_NAMES) {
          assert.ok(error.message.includes(name), `报错必须列全合法值（缺 ${name}）：${error.message}`);
        }
        assert.ok(error.message.includes(FOLDING_STRATEGY_ENV),
          `报错必须点名环境变量：${error.message}`);
        // 字段面同样可判读（上层日志/看板不必解析文案）
        assert.equal(error.received, bad);
        assert.deepEqual(error.allowed, [...FOLDING_STRATEGY_NAMES]);
        assert.equal(error.envName, FOLDING_STRATEGY_ENV);
        return true;
      },
    );
  }
});

test('#1277 buildFoldingContext：三个数据成员语义与取值一律不动，只多一格 strategy', () => {
  const context = buildFoldingContext({
    budgetTokens: 300,
    keepRounds: 1,
    env: { [FOLDING_STRATEGY_ENV]: 'fold-statistical' },
  });
  assert.deepEqual(context, {
    budgetTokens: 300,
    keepRounds: 1,
    stripHistoricalImages: true,
    strategy: 'fold-statistical',
  });
  assert.deepEqual(Object.keys(context).sort(),
    ['budgetTokens', 'keepRounds', 'strategy', 'stripHistoricalImages'],
    'config.folding.context 的键集合＝改造前三格 + strategy，不多不少');

  // 未设环境变量 ⇒ 默认档（这条正是「本单之前没有 strategy」的对照格）
  assert.equal(
    buildFoldingContext({ budgetTokens: 80000, keepRounds: 6, env: {} }).strategy,
    DEFAULT_FOLDING_STRATEGY,
  );
  // 非法值从装配处抛，不会带着坏值进引擎
  assert.throws(
    () => buildFoldingContext({ budgetTokens: 80000, keepRounds: 6, env: { [FOLDING_STRATEGY_ENV]: 'nope' } }),
    FoldingStrategyConfigError,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 摘要器失败：可读 + 留证，且不降级
// ─────────────────────────────────────────────────────────────────────────────

/** 造 erix-agent 0.30 `fold-llm` 抛上来的错误形状（实测字段，见 fold-failure.js 文件头）。 */
function summarizerFailureError({
  kind = 'timeout',
  rootErrorCode = 'summarizer_timeout',
  detail = 'fold-llm 摘要失败（timeout）：summarizer timed out',
  extraDetails = {},
} = {}) {
  const error = new Error(detail);
  error.name = 'KitError';
  error.code = SUMMARIZER_FAILED_CODE;
  error.errorCode = rootErrorCode;
  error.details = { kind, ...extraDetails };
  error.termination = { reason: 'failed', errorCode: SUMMARIZER_FAILED_CODE, detail };
  return error;
}

test('#1277 摘要器失败被认出来（按 code 或 termination.errorCode 任一），别的失败不被误认', () => {
  assert.equal(isSummarizerFailure(summarizerFailureError()), true);

  const terminationOnly = new Error('wrapped');
  terminationOnly.termination = { reason: 'failed', errorCode: SUMMARIZER_FAILED_CODE };
  assert.equal(isSummarizerFailure(terminationOnly), true, '只搬了 termination 的包装错误也要认出来');

  const other = new Error('model exploded');
  other.code = 'server_error';
  other.termination = { reason: 'failed', errorCode: 'server_error' };
  assert.equal(isSummarizerFailure(other), false);
  assert.equal(describeSummarizerFailure(other), null, '非摘要器失败必须返回 null（调用点原样透传）');
  assert.equal(describeSummarizerFailure(undefined), null);
});

test('#1277 失败事实齐全：details.kind + 根因 errorCode + 终局 failed/summarizer_failed', () => {
  const described = describeSummarizerFailure(summarizerFailureError({
    kind: 'context_window_exceeded',
    rootErrorCode: 'context_length_exceeded',
    extraDetails: { attempts: 2, droppedRounds: 3, budgetExhausted: true },
  }));
  assert.equal(described.kind, 'context_window_exceeded');
  assert.equal(described.kindKnown, true);
  assert.equal(described.rootErrorCode, 'context_length_exceeded');
  assert.equal(described.terminationReason, 'failed');
  assert.equal(described.terminationErrorCode, SUMMARIZER_FAILED_CODE);
  assert.equal(described.attempts, 2);
  assert.equal(described.droppedRounds, 3);
  assert.equal(described.budgetExhausted, true);

  // 四类 kind 全都要认（引擎 `classifyFoldDegradeKind` 的原值）
  for (const kind of SUMMARIZER_FAILURE_KINDS) {
    assert.equal(describeSummarizerFailure(summarizerFailureError({ kind })).kindKnown, true,
      `${kind} 必须在已知四类里`);
  }

  // 引擎将来加一类：字段不丢，只是标记「不在我们知道的那四类里」
  const unknownKind = describeSummarizerFailure(summarizerFailureError({ kind: 'rate_limited' }));
  assert.equal(unknownKind.kind, 'rate_limited');
  assert.equal(unknownKind.kindKnown, false);
});

test('#1277 日志字段：kind / 根因 / 策略名都在，且明确写死 host_degraded=false', () => {
  const described = describeSummarizerFailure(summarizerFailureError());
  const fields = summarizerFailureLogFields(described, {
    request_id: 'req-1277',
    strategy: 'fold-llm',
    runId: 'req-1277',
  });
  assert.equal(fields.event, 'erix.summarizer_failed');
  assert.equal(fields.request_id, 'req-1277');
  assert.equal(fields.strategy, 'fold-llm');
  assert.equal(fields.details_kind, 'timeout');
  assert.equal(fields.root_error_code, 'summarizer_timeout');
  assert.equal(fields.termination_reason, 'failed');
  assert.equal(fields.termination_error_code, 'summarizer_failed');
  assert.equal(fields.host_degraded, false, '没有降级处置：这条必须显式为 false');
  // detail 可能含整条上游错误 message ⇒ 入日志前截断（与 run_outcome 同一口径）
  const longDetail = describeSummarizerFailure(summarizerFailureError({ detail: 'x'.repeat(2000) }));
  assert.equal(summarizerFailureLogFields(longDetail, {}).detail.length, 500);
});

test('#1277 可读错误：message 带 kind 与根因，终局字段原样搬过、原始错误挂 cause', () => {
  const original = summarizerFailureError({ kind: 'empty_summary', rootErrorCode: 'summarizer_empty_summary' });
  const readable = createReadableSummarizerFailure(original);

  assert.notEqual(readable, original, '必须换一条可读 message（引擎原文没有根因 errorCode）');
  assert.equal(readable.name, 'ErixSummarizerFailure');
  assert.match(readable.message, /kind=empty_summary/);
  assert.match(readable.message, /errorCode=summarizer_empty_summary/);
  assert.match(readable.message, /上下文折叠失败/);

  // 终局语义**不改**：上层照旧读到 failed / summarizer_failed
  assert.equal(readable.code, SUMMARIZER_FAILED_CODE);
  assert.equal(readable.errorCode, 'summarizer_empty_summary');
  assert.deepEqual(readable.termination, original.termination);
  assert.deepEqual(readable.details, { kind: 'empty_summary' });
  assert.equal(readable.cause, original, '原始错误不许丢（排查要拿引擎对象）');

  // 非摘要器失败：**原样返回同一个对象**（不包一层、不改 message）
  const other = new Error('boom');
  other.code = 'server_error';
  assert.equal(createReadableSummarizerFailure(other), other);
});
