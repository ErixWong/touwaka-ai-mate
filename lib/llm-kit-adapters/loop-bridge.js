import { COMPLETION_SIGNALS } from "../agent/agent-loop.js";
import { createModelConfigResolver } from "erix-agent";
import { createTouwakaTranscriptStore } from "./transcript-store.js";

export const TOUWAKA_COMPLETION_SIGNALS = COMPLETION_SIGNALS;

const STRUCTURED_RESULT_FIELDS = [
  "data",
  "success",
  "error",
  "duration",
  "toolMessageId",
  "atomic_steps",
  "toolName",
  "metadata",
  "content",
];

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorText(error) {
  return String(error?.message ?? error);
}

function isTouwakaToolResult(value) {
  return isRecord(value) && STRUCTURED_RESULT_FIELDS.some((key) => hasOwn(value, key));
}

function resultMetadata(value) {
  if (!isRecord(value)) return {};

  const metadata = isRecord(value.metadata) ? { ...value.metadata } : {};
  for (const [key, entry] of Object.entries(value)) {
    if (!["data", "content", "success", "metadata"].includes(key)) {
      metadata[key] = entry;
    }
  }
  return metadata;
}

function normalizeToolResult(value) {
  if (value instanceof Error) {
    const message = errorText(value);
    return {
      success: false,
      data: message,
      content: message,
    };
  }

  if (!isTouwakaToolResult(value)) return value;

  const hasData = hasOwn(value, "data");
  const hasError = hasOwn(value, "error");
  const data = hasData
    ? value.data
    : hasError
      ? value.error
      : value.content;
  const normalized = {
    success: value.success ?? !hasError,
    data,
  };

  for (const key of ["duration", "toolMessageId"]) {
    if (hasOwn(value, key)) normalized[key] = value[key];
  }

  const metadata = resultMetadata(value);
  for (const [key, entry] of Object.entries(metadata)) {
    if (!hasOwn(normalized, key)) normalized[key] = entry;
  }
  if (isRecord(value.metadata)) normalized.metadata = { ...value.metadata };

  return normalized;
}

async function forwardToolResult(onToolResult, options, result) {
  if (typeof onToolResult !== "function") return result;

  const hookResult = onToolResult.length <= 1
    ? await onToolResult(result, options)
    : await onToolResult(
      options.name,
      result?.data ?? result,
      resultMetadata(result),
    );
  return hookResult === undefined ? result : normalizeToolResult(hookResult);
}

/**
 * Adapt either supported touwaka single-tool executor form to erix's
 * structured executeTool contract.
 *
 * A one-argument erix wrapper is intentional: erix uses function.length to
 * decide whether it should pass structured options or positional arguments.
 *
 * @param {{
 *   executeTool: Function,
 *   onToolResult?: Function,
 * }} options
 * @returns {Function}
 */
export function createErixToolExecutor({ executeTool, onToolResult } = {}) {
  if (typeof executeTool !== "function") {
    throw new TypeError("[llm-kit-adapters] executeTool is required");
  }
  if (onToolResult !== undefined && typeof onToolResult !== "function") {
    throw new TypeError("[llm-kit-adapters] onToolResult must be a function");
  }

  const useStructuredExecutor = executeTool.length <= 1;

  return async function erixExecuteTool(options) {
    const executionOptions = options ?? {};
    let result;
    try {
      result = useStructuredExecutor
        ? await executeTool(executionOptions)
        : await executeTool(executionOptions.name, executionOptions.input);
    } catch (error) {
      if (executionOptions.signal?.aborted) throw error;
      result = error instanceof Error ? error : new Error(errorText(error));
    }

    return forwardToolResult(
      onToolResult,
      executionOptions,
      normalizeToolResult(result),
    );
  };
}

function modelMetadataFor(modelConfig) {
  if (!isRecord(modelConfig)) return undefined;

  const metadata = {};
  const contextWindowTokens = modelConfig.contextWindowTokens
    ?? modelConfig.context_window_tokens
    ?? modelConfig.max_tokens;
  const maxOutputTokens = modelConfig.maxOutputTokens
    ?? modelConfig.max_output_tokens;
  if (contextWindowTokens !== undefined) {
    metadata.contextWindowTokens = contextWindowTokens;
  }
  if (maxOutputTokens !== undefined) metadata.maxOutputTokens = maxOutputTokens;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function buildRetryOptions(retry) {
  if (retry === false) return false;
  return {
    attempts: 2,
    backoffBaseMs: 1500,
    backoffMaxMs: 10000,
    ...(isRecord(retry) ? retry : {}),
  };
}

function buildStallDetection(stallDetection) {
  if (stallDetection === false) return false;
  return {
    window: 4,
    ...(isRecord(stallDetection) ? stallDetection : {}),
  };
}

/**
 * 把宿主交来的 `config` 树补成 0.29 引擎要的形状（issue #1227 阶段 1）。
 *
 * 只做三件「引擎形状适配」，不动宿主语义：
 *   1. `config.run.completion` 补默认 `maxNoToolRounds`，并让 `signals` 形参（宿主便利口）
 *      赢过树里的同名叶子——它一直是桥接层自己消费的，不是顶层选项；
 *   2. `config.run.stallDetection` / `config.timing.retry` 走既有的默认值归一
 *      （`false` 直通、对象补默认键），与 0.29 之前的行为逐字一致，只是家搬了；
 *   3. 从 `modelConfig` 派生的窗口数字落进 `config.metadata.modelMetadata`。
 *
 * `config` 里出现函数值会被引擎在 intake 当场拒（0.29 的 config 只装数据），
 * 所以行为载体（`onAfterFold` / `judgeProvider` 等）由调用点写进 `capabilities`。
 *
 * @param {object|undefined} config 宿主直传的 0.29 `config` 树
 * @param {{signals?: string[], modelMetadata?: object}} extras
 * @returns {object}
 */
function normalizeConfigTree(config, { signals, modelMetadata } = {}) {
  const source = isRecord(config) ? config : {};
  const run = { ...(isRecord(source.run) ? source.run : {}) };
  const timing = { ...(isRecord(source.timing) ? source.timing : {}) };
  const metadata = { ...(isRecord(source.metadata) ? source.metadata : {}) };

  const completion = {
    maxNoToolRounds: 3,
    ...(isRecord(run.completion) ? run.completion : {}),
  };
  completion.signals = signals ?? completion.signals ?? TOUWAKA_COMPLETION_SIGNALS;
  run.completion = completion;
  run.stallDetection = buildStallDetection(run.stallDetection);
  timing.retry = buildRetryOptions(timing.retry);
  if (modelMetadata !== undefined) metadata.modelMetadata = modelMetadata;

  return {
    ...source,
    run,
    timing,
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

/**
 * Build the complete erix runToolLoop option envelope without binding the
 * loop to touwaka's database or request runtime.
 *
 * issue #1227 阶段 1：erix-agent 0.29 的顶层白名单只剩 26 项，配置键全部搬进
 * `config.*`、行为载体搬进 `capabilities.*`。所以本函数**只**产出命名空间形态：
 *   - 结构性适配留在桥接层：`provider` / `executeTool` 包装 / `store` / `modelConfig` 的
 *     resolver 包装 / `completion.signals` 默认值 / `modelMetadata` 派生；
 *   - 其余宿主旋钮由调用点直接写成 `config.{input,run,tuning,timing,folding,metadata}`
 *     与 `capabilities.{hooks,ports}`（不再有第二张「扁平名 → 新家」的重命名表）。
 *
 * 曾经的 15 个扁平形参（runId / maxRounds / completion / retry / stallDetection /
 * toolContext / modelMetadata / initialMessages / maxTokens / temperature / topP /
 * wrapup / reflection / stream / context）已全部删除：任何遗留的扁平写法都会落进
 * `...passthrough`，被 0.29 的名称闸口以 `unknown runToolLoop option` 当场拒掉
 * （报错还会点名新家），不会静默失效。
 *
 * @param {{
 *   provider: object,
 *   executeTool: Function,
 *   store?: object,
 *   signals?: string[],
 *   modelConfig?: object,
 *   config?: object,        // 0.29 `config` 命名空间（宿主直传）
 *   capabilities?: object,  // 0.29 `capabilities` 命名空间（宿主直传）
 *   modelMetadata?: object, // 宿主便利口：并入 config.metadata.modelMetadata
 *   requestMeta?: object,   // 已废弃：erix 0.10.0 不接受，显式接住后丢弃
 *   onEvent?: Function,
 *   [key:string]: any,
 * }} options
 * @returns {object}
 */
export function buildErixRunOptions({
  provider,
  executeTool,
  store,
  signals,
  modelConfig,
  config,
  capabilities,
  modelMetadata: suppliedModelMetadata,
  // erix 0.10.0 顶层选项白名单不再接受 requestMeta（及其中 user_id/expert_id/
  // request_id 等宿主字段，provider 侧走 defaultUserId/defaultRequestId 闭包）。
  // 显式接住并丢弃：若放任其落入 ...passthrough，会以未知键透传进 runToolLoop
  // 触发白名单 TypeError。
  requestMeta,
  onEvent,
  ...passthrough
} = {}) {
  void requestMeta;
  const derivedModelMetadata = modelMetadataFor(modelConfig);
  const extraModelMetadata = isRecord(suppliedModelMetadata)
    ? suppliedModelMetadata
    : {};
  const modelMetadata = Object.keys({
    ...derivedModelMetadata,
    ...extraModelMetadata,
  }).length > 0
    ? { ...derivedModelMetadata, ...extraModelMetadata }
    : undefined;

  // erix 0.10.0：细粒度端口形态下 modelConfig 必须暴露 resolve(slot)。
  // touwaka 侧惯例是裸配置对象，由桥接层包成静态 resolver。
  const resolvedModelConfig = modelConfig === undefined
    ? undefined
    : typeof modelConfig.resolve === "function"
      ? modelConfig
      : createModelConfigResolver(modelConfig);

  return {
    ...passthrough,
    provider,
    executeTool: createErixToolExecutor({ executeTool }),
    ...(store === undefined ? {} : { store }),
    config: normalizeConfigTree(config, { signals, modelMetadata }),
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(resolvedModelConfig === undefined ? {} : { modelConfig: resolvedModelConfig }),
    ...(onEvent === undefined ? {} : { onEvent }),
  };
}

function adaptRoundRecord(record) {
  const source = record ?? {};
  return {
    ...source,
    round: source.round,
    ts: source.ts,
    messages: source.messages,
    ...(source.folded === undefined ? {} : { folded: source.folded }),
    ...(source.foldedPayload === undefined ? {} : { foldedPayload: source.foldedPayload }),
    ...(source.meta === undefined ? {} : { meta: source.meta }),
  };
}

/**
 * Adapt touwaka's MariaDB transcript store to the store methods consumed by
 * erix runToolLoop.
 *
 * issue #1134 + erix 0.12.0（#78 capability 分级）：必需能力 {appendRound, load}。
 * run-state / run snapshot / checkpoint 可选 capability 有意不实现——erix 每方法发一次
 * persistence_capability_degraded 诊断后跳过，run 正常执行（仅不支持中途 crash resume）。
 *
 * issue #1150 + erix 0.17.0（上游 #157）：**透传两条成对可选快路径探针**
 * （loadByDedupKey / loadMaxRound）。探针返回的是存储侧原始 record（与 load() 同源，
 * 不经 adaptRoundRecord——那是写侧形状适配），故 appendUserTurn 在宿主侧能走点查路径、
 * 在接收消息事务内不再全量 load。两者必须成对存在，缺一如缺二（引擎会回退全量 load）。
 *
 * @param {{db: object, requestContext?: object}} options
 *   requestContext: {topic_id, user_id, expert_id} 随拆行 messages 落库
 *   （messages.user_id NOT NULL，erix 只传 (runId, record) 拿不到归属）
 * @returns {{
 *   appendRound: Function, load: Function,
 *   loadByDedupKey: Function, loadMaxRound: Function
 * }}
 */
export function createErixStore({ db, requestContext } = {}) {
  const transcriptStore = createTouwakaTranscriptStore({ db, requestContext });

  return {
    async appendRound(runId, record) {
      return transcriptStore.appendRound(runId, adaptRoundRecord(record));
    },
    async load(runId) {
      return transcriptStore.load(runId);
    },
    // 探针直接转发底层 store：读侧不需要 adapt（与 load() 保持同一份 record 形状）
    loadByDedupKey: (runId, dedupKey) => transcriptStore.loadByDedupKey(runId, dedupKey),
    loadMaxRound: (runId) => transcriptStore.loadMaxRound(runId),
  };
}
