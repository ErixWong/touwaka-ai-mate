/**
 * erix 折叠策略的配置面（issue #1277）。
 *
 * ## 为什么需要这一层
 *
 * `runErix()` 把折叠配置交给引擎时，只给 `budgetTokens` / `keepRounds` /
 * `stripHistoricalImages` 三格**数据**。引擎的语义是：`folding.context.strategy` 未配置 ⇒
 * 超预算时走**库层兜底** `createSlidingWindowStrategy()`（零 LLM 的机械折叠），并发一条
 * `compaction_strategy_fallback`（erix-agent `src/loop/orchestrator.js:3853` 起）。
 * 也就是说：配置面缺 `strategy` 时，本项目**永远吃不到语义折叠**——这是本单修的病。
 *
 * ## 三档（都是引擎内置策略名，逐字匹配、大小写敏感）
 *
 * | 名字 | 行为 | 每次真折叠的模型调用 | 新失败面 |
 * |---|---|---|---|
 * | `sliding-window` | 机械折叠（整轮 tail keep / head drop），零 LLM | 0 | 无 |
 * | `fold-statistical` | 统计式摘要折叠，零 LLM | 0 | 无 |
 * | `fold-llm` | 语义摘要折叠，摘要器由引擎用**本次 run 的 provider** 注入 | **1 次** | 有：摘要器坏/超时/空文本 ⇒ 本次 run `failed`（`errorCode=summarizer_failed`） |
 *
 * ## 默认档 = `fold-llm`（用户裁决 B，2026-11-03）
 *
 * 摘要器坏 = 这次 run 以 `failed` 收尾，是**用户可见的硬失败**。这是有意的取舍：0.30 之前
 * 引擎会把它静默降级成统计摘要，质量掉了没人发现（erix-agent #661 改成了终局错误）。
 * **一键回退口是环境变量** `ERIX_FOLDING_STRATEGY`（设 `fold-statistical` 或 `sliding-window`），
 * 不需要发版。宿主侧**不加**自动重试 / 自动改选策略 / 把终局改成 `completed` 这类处置。
 *
 * ## 非法值 = 配置错误，当场抛
 *
 * 引擎自己也会在启动期对未知策略名抛 `TypeError`，但那条报错**不含**我们的环境变量名与
 * 配置项名（只有 `unknown compaction strategy` 之类），运维看到它找不到该改哪里。所以取值域
 * 校验在**装配处**做：点名收到的值 + 合法清单 + 环境变量名，并且**不**静默退回默认档
 * （静默退回等于把「配置写错了」伪装成「配好了」——正是本单要消除的那类假绿）。
 *
 * 读法与 `CHAT_COMPACT_BUDGET_TOKENS` / `CHAT_COMPACT_KEEP_ROUNDS`
 * （`lib/agent/agent-loop.js` 的 `resolvePositiveIntegerEnv`）同姿势：**未设 / 空串 ⇒ 默认值**。
 */

/** 环境变量名（唯一的运行时开关；改档不需要发版）。 */
export const FOLDING_STRATEGY_ENV = 'ERIX_FOLDING_STRATEGY';

/**
 * 合法取值域——逐字等于 erix-agent 的内置策略注册表
 * （`node_modules/erix-agent/src/compact/strategy-resolution.js` 的 `BUILTIN_COMPACTION_STRATEGIES`
 * 三个键：`sliding-window` / `fold-statistical` / `fold-llm`；同文件导出的
 * `BUILTIN_COMPACTION_STRATEGY_NAMES` 就是这份键表，引擎对未知名在启动期抛 `TypeError`）。
 * **引擎只有这三档**：在 0.30.0 产物 `src/` 里 grep 任何复合策略名（如
 * `fold-statistical+fold-llm`）以及 `pipeline.js` 里的 `STRATEGY_DEFINITIONS` 这个名字，都零命中
 * （验收时实测）。宿主侧就只开这三档，多开放一档就多一条没被用例覆盖的路径；
 * 下次若引擎真加了第四档，**必须同时补那一档的用例才能收进本表**。
 */
export const FOLDING_STRATEGY_NAMES = Object.freeze([
  'sliding-window',
  'fold-statistical',
  'fold-llm',
]);

/** 未配置时的默认档（用户裁决 B）。 */
export const DEFAULT_FOLDING_STRATEGY = 'fold-llm';

/** 配置错误的 `code`（与引擎的 `KitError.code` 同一命名空间语义，宿主侧可据此分流）。 */
export const INVALID_FOLDING_STRATEGY_CODE = 'invalid_folding_strategy';

/**
 * `ERIX_FOLDING_STRATEGY` 的非法值错误。
 *
 * 报错文案必须同时点名三件事（否则运维还得翻源码）：收到的值、合法清单、环境变量名。
 * 三个字段也各自留成属性，便于用例与上层日志按字段取，不必解析文案。
 */
export class FoldingStrategyConfigError extends Error {
  constructor(received) {
    super(
      `[AgentLoop] 环境变量 ${FOLDING_STRATEGY_ENV} 的值 "${received}" 不是合法的折叠策略。`
      + `合法取值：${FOLDING_STRATEGY_NAMES.join(' | ')}（引擎内置策略名，大小写敏感）。`
      + `删除该环境变量即回到默认档 ${DEFAULT_FOLDING_STRATEGY}。`,
    );
    this.name = 'FoldingStrategyConfigError';
    this.code = INVALID_FOLDING_STRATEGY_CODE;
    this.received = received;
    this.allowed = [...FOLDING_STRATEGY_NAMES];
    this.envName = FOLDING_STRATEGY_ENV;
  }
}

/**
 * 把环境变量原值解析成策略名。
 *
 * @param {string|undefined|null} raw 环境变量原值（缺省读 `process.env`）
 * @returns {'sliding-window'|'fold-statistical'|'fold-llm'} 合法策略名
 * @throws {FoldingStrategyConfigError} 值不在取值域内（**不**退回默认档）
 */
export function resolveFoldingStrategy(raw = process.env[FOLDING_STRATEGY_ENV]) {
  // 与 `resolvePositiveIntegerEnv`（`agent-loop.js`）同姿势：`!raw` ⇒ 用默认值。
  // 空白串也算「没设」——`.env` 里写成 `ERIX_FOLDING_STRATEGY=` 是常见手误，
  // 而它**不会**让引擎走兜底（我们照样把默认档填进 `strategy`），所以按未设处理是安全的。
  if (raw === undefined || raw === null) return DEFAULT_FOLDING_STRATEGY;
  const value = String(raw).trim();
  if (value === '') return DEFAULT_FOLDING_STRATEGY;
  if (FOLDING_STRATEGY_NAMES.includes(value)) return value;
  throw new FoldingStrategyConfigError(String(raw));
}

/**
 * 折叠摘要器的两层死线（引擎默认都是 **30_000ms**）：
 *   · `summarizerTimeoutMs` —— provider 层**单发**超时；
 *   · `summarizerBudgetMs`  —— 策略层**整条步骤**死线（首发 + 超窗自愈共用）。
 *
 * 为什么本实例必须抬高：我们有进程级上游闸门 `LLM_MAX_CONCURRENCY`（默认 4），
 * 摘要那一发要排队。长流式轮次占满四个槽时，30s 根本排不到，引擎直接 abort
 * → `summarizer_failed` 终局失败（实测 12h：36 次 `empty_summary` + 14 次 `timeout`，
 * 时间线对得上「发出 → 闸门 active=4/4 → 整 30s 后 Request aborted by user」）。
 * 插队修顺序、这两个旋钮修耐性，两边都上才能不复发。
 *
 * 引擎侧在**装配期**校验这四个上限（`validateFoldSummarizerCaps`）：`null` / `0` /
 * 负数 / 小数 / 字符串一律 `TypeError`，不会静默失效——所以环境变量写错是启动即爆，
 * 不是等真发生折叠那一轮才爆。
 */
export const FOLD_SUMMARIZER_TIMEOUT_ENV = 'ERIX_FOLD_SUMMARIZER_TIMEOUT_MS';
export const FOLD_SUMMARIZER_BUDGET_ENV = 'ERIX_FOLD_SUMMARIZER_BUDGET_MS';
const DEFAULT_SUMMARIZER_TIMEOUT_MS = 120_000;
// 预算包「首发 + 超窗自愈」，必须大于单发超时，否则单发还没跑完就被步骤死线砍掉。
const DEFAULT_SUMMARIZER_BUDGET_MS = 180_000;

function resolveSummarizerCap(raw, fallback, envName) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `[folding-strategy] ${envName} 必须是正整数毫秒，收到: ${JSON.stringify(raw)}`
    );
  }
  return value;
}

/**
 * 造 `config.folding.context`——引擎侧折叠配置的**唯一**装配点。
 *
 * 原有数据成员的语义与取值**一律不动**：
 * `budgetTokens` / `keepRounds` 由调用点按既有环境变量算好传进来；
 * `stripHistoricalImages` 恒 `true`（与改造前逐字一致）。
 *
 * @param {{
 *   budgetTokens: number,
 *   keepRounds: number,
 *   stripHistoricalImages?: boolean,
 *   env?: Record<string, string|undefined>,
 * }} params
 * @returns {{budgetTokens: number, keepRounds: number, stripHistoricalImages: boolean, strategy: string,
 *   summarizerTimeoutMs: number, summarizerBudgetMs: number}}
 */
export function buildFoldingContext({
  budgetTokens,
  keepRounds,
  stripHistoricalImages = true,
  env = process.env,
} = {}) {
  const summarizerTimeoutMs = resolveSummarizerCap(
    env?.[FOLD_SUMMARIZER_TIMEOUT_ENV],
    DEFAULT_SUMMARIZER_TIMEOUT_MS,
    FOLD_SUMMARIZER_TIMEOUT_ENV
  );
  return {
    budgetTokens,
    keepRounds,
    stripHistoricalImages,
    strategy: resolveFoldingStrategy(env?.[FOLDING_STRATEGY_ENV]),
    summarizerTimeoutMs,
    summarizerBudgetMs: resolveSummarizerCap(
      env?.[FOLD_SUMMARIZER_BUDGET_ENV],
      Math.max(DEFAULT_SUMMARIZER_BUDGET_MS, summarizerTimeoutMs),
      FOLD_SUMMARIZER_BUDGET_ENV
    ),
  };
}
