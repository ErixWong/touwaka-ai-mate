/**
 * issue #1277 —— 折叠策略配置面（`ERIX_FOLDING_STRATEGY`）与摘要器失败的可读化。
 *
 * 纯函数用例，不连库、不跑引擎：本文件钉的是**我们这一层**的两条判据——
 *   ① 三档都能配起来、非法值当场报错（不静默退回默认档、也不靠引擎的 TypeError）；
 *   ② 摘要器失败的事实（`details.kind` / 根因 `errorCode` / 终局 `failed`）被完整搬出来，
 *      且**没有**任何降级处置（不重试、不改策略、不改终局）。
 *
 * 引擎侧「策略真的生效」与 e2e 失败面见 `tests/agent/fold-strategy-contract.test.mjs`。
 *
 * issue #1307 —— 从「形状快照」改成「不变量」的原因：commit `06d8d46`（#1293）之后，
 * 引擎新增 summarizer 超时/预算两格旋钮，本文件原来那条 `assert.deepEqual(context, {四格})`
 * 加「键集合不多不少」是纯形状快照——引擎每加/删一格它就红，且红了也说不清"谁没消费这格"。
 * 现把它拆成可判定不变量：三成员与入参逐一对应、键集合与登记表双向相等（加格须登记消费者）、
 * 两格上限不变量（正整数 + 预算恒不短于单发）、以及到引擎源码里查接线证据。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_FOLDING_STRATEGY,
  FOLDING_STRATEGY_ENV,
  FOLDING_STRATEGY_NAMES,
  FOLD_SUMMARIZER_TIMEOUT_ENV,
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

// ── #1307：把原来的「形状快照」拆成可判定不变量（见文件头注释）──
// config.folding.context 的键登记表：每个键注明**引擎侧消费者**。
// 加/删一格是有意动作，必须同时改这张表并写明谁消费它，否则闸 2 就红。
const EXPECTED_FOLDING_CONTEXT_KEYS = Object.freeze({
  budgetTokens: 'erix-agent 折叠预算（compact 目标 token）',
  keepRounds: 'erix-agent 折叠保留轮数',
  stripHistoricalImages: 'erix-agent 折叠时是否剥离历史图片',
  strategy: 'erix-agent 折叠策略选择（createFoldLlmStrategy / ErixAgent 装配）',
  summarizerTimeoutMs: 'erix-agent 摘要器单发超时（src 内 provider-summarizer / assembly-validators / orchestrator 消费）',
  summarizerBudgetMs: 'erix-agent 摘要器总预算（src 内 fold-llm / assembly-validators / orchestrator 消费）',
});

// 不变量 1：三成员（budgetTokens/keepRounds/stripHistoricalImages）取值与入参逐一对应（保留 #1277 原意）。
test('#1307 buildFoldingContext：budgetTokens/keepRounds/stripHistoricalImages 三成员与入参逐一对应（#1277 原意）', () => {
  const a = buildFoldingContext({
    budgetTokens: 300,
    keepRounds: 1,
    env: { [FOLDING_STRATEGY_ENV]: 'fold-statistical' },
  });
  assert.equal(a.budgetTokens, 300, 'budgetTokens 必须原样透传，不许被动到');
  assert.equal(a.keepRounds, 1, 'keepRounds 必须原样透传，不许被动到');
  assert.equal(a.stripHistoricalImages, true, '未显式传时默认 true（与改造前逐字一致）');
  assert.equal(a.strategy, 'fold-statistical', 'strategy 按环境变量配档');

  const b = buildFoldingContext({ budgetTokens: 80000, keepRounds: 6, stripHistoricalImages: false, env: {} });
  assert.equal(b.budgetTokens, 80000, 'budgetTokens 必须随入参变');
  assert.equal(b.keepRounds, 6, 'keepRounds 必须随入参变');
  assert.equal(b.stripHistoricalImages, false, 'stripHistoricalImages 是入参直通，不是恒 true 的常量');

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

// 不变量 2：键集合与登记表双向相等；加格是有意识动作，要同时写明引擎侧消费者。
test('#1307 buildFoldingContext：键集合与登记表双向相等（加格必须同时登记消费者）', () => {
  const context = buildFoldingContext({ budgetTokens: 300, keepRounds: 1, env: {} });
  const actualKeys = Object.keys(context).sort();
  const expectedKeys = Object.keys(EXPECTED_FOLDING_CONTEXT_KEYS).sort();
  const unregistered = actualKeys.filter((k) => !(k in EXPECTED_FOLDING_CONTEXT_KEYS));
  const disappeared = expectedKeys.filter((k) => !(k in context));
  assert.deepEqual(
    actualKeys,
    expectedKeys,
    'config.folding.context 的键集合必须与登记表双向相等：' +
      (unregistered.length ? `【有键未登记消费者】${unregistered.join(', ')}——` : '') +
      (disappeared.length ? `【登记键已从 context 消失】${disappeared.join(', ')}——` : '') +
      '给折叠上下文加/删一格是有意识动作，必须同时改 EXPECTED_FOLDING_CONTEXT_KEYS 并写明引擎侧谁消费。',
  );
});

// 不变量 3：两格上限的不变量——都是正整数，且预算恒不短于单发超时。
test('#1307 buildFoldingContext：summarizer 两格是正整数，且预算恒不短于单发超时', () => {
  const ctx = buildFoldingContext({ budgetTokens: 300, keepRounds: 1, env: {} });
  assert.ok(
    Number.isInteger(ctx.summarizerTimeoutMs) && ctx.summarizerTimeoutMs > 0,
    `summarizerTimeoutMs 必须是正整数毫秒，收到 ${ctx.summarizerTimeoutMs}`,
  );
  assert.ok(
    Number.isInteger(ctx.summarizerBudgetMs) && ctx.summarizerBudgetMs > 0,
    `summarizerBudgetMs 必须是正整数毫秒，收到 ${ctx.summarizerBudgetMs}`,
  );
  // 默认档：预算必须严格大于单发超时——预算要盖住「首发 + 超窗自愈」，等于单发就没自愈余量。
  assert.ok(
    ctx.summarizerBudgetMs > ctx.summarizerTimeoutMs,
    `默认档预算必须严格大于单发超时（预算 ${ctx.summarizerBudgetMs} 应 > 超时 ${ctx.summarizerTimeoutMs}）：`
      + '预算若不盖住单发 + 超窗自愈，单发还没跑完就被步骤死线砍掉。',
  );

  // env 把单发超时抬到 200000（大于默认预算 180000）⇒ 预算必须跟住单发，不能仍停在旧默认。
  const raised = buildFoldingContext({
    budgetTokens: 300,
    keepRounds: 1,
    env: { [FOLD_SUMMARIZER_TIMEOUT_ENV]: '200000' },
  });
  assert.ok(
    raised.summarizerBudgetMs >= raised.summarizerTimeoutMs,
    `单发超时抬到 200000 后，预算(${raised.summarizerBudgetMs}) 必须 >= 单发(${raised.summarizerTimeoutMs})——` +
      '预算要跟住单发，不能被单发超时甩开。',
  );
});

// 不变量 4：接线证据——两格必须在引擎源码里真有消费者（不是我们这层的死字段）。
test('#1307 summarizerTimeoutMs / summarizerBudgetMs 在引擎源码里各有消费者（接线证据）', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const srcRoot = new URL('../../node_modules/erix-agent/src/', import.meta.url);
  const enginePkgUrl = new URL('../../node_modules/erix-agent/package.json', import.meta.url);
  // 版本现读（用 fs 读 package.json，不 import 引擎内部模块——后者会 ERR_PACKAGE_PATH_NOT_EXPORTED）。
  const engineVersion = JSON.parse(await readFile(enginePkgUrl, 'utf8')).version;

  const files = [];
  async function walk(dirUrl) {
    for (const ent of await readdir(dirUrl, { withFileTypes: true })) {
      // 目录 URL 必须带尾斜杠再拼接，否则 new URL 会把末段当文件名丢掉（src/tools 的子项会错拼成 src/…）。
      if (ent.isDirectory()) await walk(new URL(ent.name + '/', dirUrl));
      else if (ent.isFile() && ent.name.endsWith('.js')) files.push(new URL(ent.name, dirUrl));
    }
  }
  await walk(srcRoot);

  async function filesMentioning(token) {
    const hits = [];
    for (const fileUrl of files) {
      const text = await readFile(fileUrl, 'utf8');
      if (text.includes(token)) hits.push(decodeURIComponent(fileUrl.pathname));
    }
    return hits;
  }
  const timeoutConsumers = await filesMentioning('summarizerTimeoutMs');
  const budgetConsumers = await filesMentioning('summarizerBudgetMs');

  assert.ok(
    timeoutConsumers.length >= 1,
    `erix-agent ${engineVersion} 源码里必须至少 1 个文件消费 summarizerTimeoutMs，实测命中 ${timeoutConsumers.length} 个——` +
      '若为 0 说明这格是我们这层的死字段，引擎根本不读它。',
  );
  assert.ok(
    budgetConsumers.length >= 1,
    `erix-agent ${engineVersion} 源码里必须至少 1 个文件消费 summarizerBudgetMs，实测命中 ${budgetConsumers.length} 个——` +
      '若为 0 说明这格是我们这层的死字段，引擎根本不读它。',
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
