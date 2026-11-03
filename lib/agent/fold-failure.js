/**
 * `fold-llm` 摘要器失败的可读化与留证（issue #1277）。
 *
 * ## 语义：失败**不降级**，只负责说清楚
 *
 * 用户裁决 B（2026-11-03）：默认折叠档是 `fold-llm`，**不加**宿主侧降级处置。所以
 * 摘要器坏（超时 / 超窗 / 返回空文本 / 任意 reject）时，erix-agent 0.30 的 `fold-llm` 会抛
 * `KitError("summarizer_failed")`，一路把 run 落成 `termination.reason = "failed"` +
 * `errorCode = "summarizer_failed"`——**这是用户可见的硬失败，是有意的取舍**
 * （0.30 之前引擎会静默降级成统计摘要，质量掉了没人发现）。
 *
 * 本模块**不做**、也不许别人加：自动重试、自动改选 `fold-statistical`、把终局改成 `completed`。
 * 它只做裁决里保留的那条最低要求——「**失败要可读、要留证**」：
 *
 * | 面 | 改前 | 改后 |
 * |---|---|---|
 * | 日志 | 只有 `[ChatService] 流式聊天失败: fold-llm 摘要失败（timeout）：…` 一行 message | 多一条结构化 ERROR：`event=erix.summarizer_failed` + `details_kind` + 根因 `errorCode` + 策略名 + 诊断计数 |
 * | HTTP（流式 error 帧 / 非流式 `error` 字段） | 引擎原文 `fold-llm 摘要失败（timeout）：…`（**没有**根因 `errorCode`） | `上下文折叠失败：fold-llm 摘要器出错（kind=timeout, 根因 errorCode=summarizer_timeout）：…` |
 * | 终局语义 | `failed` / `summarizer_failed` | **不变**（`termination` 原样带过） |
 *
 * ## 引擎在错误对象上给的三份事实（实测 erix-agent 0.30.0）
 *
 * `fold-llm` 的 `summarizerFailure()`（`src/compact/fold-llm.js`）造的 `KitError`：
 *   · `error.code = "summarizer_failed"`——终局分类（`withErrorCode` 读的就是它）；
 *   · `error.errorCode`——**根因**自己的 `code`（`terminationErrorCodeForError`，取不到即
 *     `"unknown"`；例：`summarizer_timeout` / `summarizer_empty_summary` / 上游网关的 `server_error`）；
 *   · `error.details.kind` ∈ `timeout` / `context_window_exceeded` / `empty_summary` / `error`
 *     （`classifyFoldDegradeKind` 的四类原值），外加诊断计数
 *     `attempts` / `droppedMessages` / `droppedRounds` / `budgetExhausted`。
 * 另外 `orchestrator.fail()` 会 `annotateTermination()` 把 `termination` 挂到同一个错误对象上，
 * 于是宿主在 catch 里能同时拿到「终局怎么说」与「根因是什么」。
 *
 * 这三份事实**都不许**被吞：吞了等于把硬失败退化成「run 失败但不知道为什么」。
 */

/** 终局分类：`fold-llm` 摘要器失败的 `errorCode`（erix-agent 0.30 起是终局错误，不再降级）。 */
export const SUMMARIZER_FAILED_CODE = 'summarizer_failed';

/**
 * `details.kind` 的四类原值（`classifyFoldDegradeKind`）。
 * 这里只用于**文档与用例断言**：宿主不校验取值（引擎将来加一类时，我们照样原样记下来，
 * 不认识的 kind 走 `unknown` 兜底，绝不因为「不认识」就丢字段）。
 */
export const SUMMARIZER_FAILURE_KINDS = Object.freeze([
  'timeout',
  'context_window_exceeded',
  'empty_summary',
  'error',
]);

function readField(target, key) {
  try {
    return target?.[key];
  } catch {
    return undefined;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 这个错误是不是「折叠摘要器失败」？
 *
 * 判据取两个来源的**或**：错误自己的 `code`（`KitError` 的原值）与 `termination.errorCode`
 * （`fail()` 注解后的终局）。只看一个都会漏：`copyErrorCarrier` 保证两者同时在场，但宿主
 * 若把错误包了一层（只搬 `termination`）就只有后者。
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isSummarizerFailure(error) {
  if (readField(error, 'code') === SUMMARIZER_FAILED_CODE) return true;
  return readField(readField(error, 'termination'), 'errorCode') === SUMMARIZER_FAILED_CODE;
}

/**
 * 把「摘要器失败」拆成可记录 / 可响应的事实。非摘要器失败返回 `null`（调用点据此原样透传）。
 *
 * @param {unknown} error
 * @returns {null | {
 *   kind: string,
 *   kindKnown: boolean,
 *   rootErrorCode: string,
 *   terminationReason: string,
 *   terminationErrorCode: string,
 *   detail: string,
 *   attempts?: number,
 *   droppedMessages?: number,
 *   droppedRounds?: number,
 *   budgetExhausted?: boolean,
 * }}
 */
export function describeSummarizerFailure(error) {
  if (!isSummarizerFailure(error)) return null;
  const details = readField(error, 'details') ?? {};
  const termination = readField(error, 'termination') ?? {};
  const rawKind = nonEmptyString(readField(details, 'kind'));
  const rootErrorCode = nonEmptyString(readField(error, 'errorCode')) ?? 'unknown';
  const detail = nonEmptyString(readField(termination, 'detail'))
    ?? nonEmptyString(readField(error, 'message'))
    ?? '摘要器失败（引擎未给出 detail）';

  const described = {
    // 不认识的 kind 不丢字段：原样记下来，`kindKnown` 标出「它不在我们知道的那四类里」。
    kind: rawKind ?? 'unknown',
    kindKnown: rawKind !== undefined && SUMMARIZER_FAILURE_KINDS.includes(rawKind),
    rootErrorCode,
    terminationReason: nonEmptyString(readField(termination, 'reason')) ?? 'failed',
    terminationErrorCode: nonEmptyString(readField(termination, 'errorCode')) ?? SUMMARIZER_FAILED_CODE,
    detail,
  };
  for (const key of ['attempts', 'droppedMessages', 'droppedRounds']) {
    const value = finiteNumber(readField(details, key));
    if (value !== undefined) described[key] = value;
  }
  if (readField(details, 'budgetExhausted') === true) described.budgetExhausted = true;
  return described;
}

/**
 * 造**日志字段**（结构化一条 ERROR）。字段名与 `agent-loop.js` 里其余 erix 观测面同风格：
 * 顶层 `event` 是检索键，`request_id` 是关联键，其余是诊断事实。
 *
 * 为什么不把 `detail` 全文塞进来：它可能含整条上游错误 message（`RUN_OUTCOME_LOG_TEXT_MAX`
 * 那条注释同理），统一截断到 500 字符——诊断价值通常在前段。
 *
 * @param {ReturnType<typeof describeSummarizerFailure>} described
 * @param {{request_id?: string, strategy?: string, runId?: string}} context
 * @returns {Record<string, unknown>}
 */
export function summarizerFailureLogFields(described, { request_id, strategy, runId } = {}) {
  const fields = {
    event: 'erix.summarizer_failed',
    request_id: nonEmptyString(request_id) ?? null,
    // 配置面：哪一档策略下失败的（回退时第一时间要看到这个）
    strategy: nonEmptyString(strategy) ?? null,
    // 终局怎么说（**语义不变**：failed / summarizer_failed）
    termination_reason: described?.terminationReason ?? 'failed',
    termination_error_code: described?.terminationErrorCode ?? SUMMARIZER_FAILED_CODE,
    // 根因是什么（引擎 `details.kind` 的四类 + 底层错误自己的 code）
    details_kind: described?.kind ?? 'unknown',
    details_kind_known: described?.kindKnown === true,
    root_error_code: described?.rootErrorCode ?? 'unknown',
    // 为什么失败 / 试过几次 / 丢了什么
    detail: (described?.detail ?? '').slice(0, 500),
    attempts: described?.attempts ?? null,
    dropped_messages: described?.droppedMessages ?? null,
    dropped_rounds: described?.droppedRounds ?? null,
    budget_exhausted: described?.budgetExhausted === true,
    // 没有降级处置：明确写死，免得后人以为这里还有一条「自动回退」的暗门
    host_degraded: false,
  };
  const safeRunId = nonEmptyString(runId);
  if (safeRunId !== undefined) fields.runId = safeRunId;
  return fields;
}

/**
 * 造**可读的宿主侧错误**（HTTP 面 / 上层 catch 看到的那条 message）。
 *
 * 关键约束：
 *   1. **终局语义不变**——`termination` / `code` / `errorCode` / `details` / `usage` / `rounds`
 *      原样搬过来，上层据此仍然读到 `failed` + `summarizer_failed`；只换 message（加 kind 与根因）。
 *   2. **原始错误不丢**——挂在 `cause` 上（`Error.cause`），排查时能拿到引擎的完整对象。
 *   3. **不吞**：本函数只返回一个错误对象，调用点必须 `throw` 它。
 *
 * @param {unknown} error 引擎抛上来的原始错误
 * @param {ReturnType<typeof describeSummarizerFailure>} [described]
 * @returns {Error} 原始错误（非摘要器失败）或可读包装
 */
export function createReadableSummarizerFailure(error, described = describeSummarizerFailure(error)) {
  if (!described) return error;
  const wrapped = new Error(
    `上下文折叠失败：fold-llm 摘要器出错（kind=${described.kind}, 根因 errorCode=${described.rootErrorCode}）：${described.detail}`,
  );
  wrapped.name = 'ErixSummarizerFailure';
  for (const key of ['code', 'errorCode', 'details', 'termination', 'usage', 'rounds', 'finalText']) {
    const value = readField(error, key);
    if (value !== undefined) wrapped[key] = value;
  }
  wrapped.cause = error;
  return wrapped;
}
