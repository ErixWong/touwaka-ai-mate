import { COMPLETION_SIGNALS } from "../agent/agent-loop.js";
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
 * Build the complete erix runToolLoop option envelope without binding the
 * loop to touwaka's database or request runtime.
 *
 * @param {{
 *   provider: object,
 *   executeTool: Function,
 *   store?: object,
 *   runId?: string,
 *   maxRounds?: number,
 *   signals?: string[],
 *   modelConfig?: object,
 *   context?: object,
 *   retry?: object|false,
 *   stallDetection?: object|false,
 *   toolContext?: object,
 *   requestMeta?: object,
 *   onEvent?: Function,
 *   stream?: boolean,
 *   [key:string]: any,
 * }} options
 * @returns {object}
 */
export function buildErixRunOptions({
  provider,
  executeTool,
  store,
  runId,
  maxRounds,
  signals,
  modelConfig,
  context,
  retry,
  stallDetection,
  toolContext,
  requestMeta,
  onEvent,
  stream,
  ...passthrough
} = {}) {
  const derivedModelMetadata = modelMetadataFor(modelConfig);
  const suppliedModelMetadata = isRecord(passthrough.modelMetadata)
    ? passthrough.modelMetadata
    : {};
  const modelMetadata = Object.keys({
    ...derivedModelMetadata,
    ...suppliedModelMetadata,
  }).length > 0
    ? { ...derivedModelMetadata, ...suppliedModelMetadata }
    : undefined;

  return {
    ...(isRecord(requestMeta) ? requestMeta : {}),
    ...passthrough,
    provider,
    executeTool: createErixToolExecutor({ executeTool }),
    ...(store === undefined ? {} : { store }),
    ...(runId === undefined ? {} : { runId }),
    maxRounds: maxRounds === undefined ? 8 : maxRounds,
    completion: {
      signals: signals ?? TOUWAKA_COMPLETION_SIGNALS,
      maxNoToolRounds: 3,
    },
    retry: buildRetryOptions(retry),
    stallDetection: buildStallDetection(stallDetection),
    ...(modelConfig === undefined ? {} : { modelConfig }),
    ...(modelMetadata === undefined ? {} : { modelMetadata }),
    ...(context === undefined ? {} : { context }),
    ...(toolContext === undefined ? {} : { toolContext }),
    ...(onEvent === undefined ? {} : { onEvent }),
    ...(stream === undefined ? {} : { stream }),
  };
}

function adaptRoundRecord(record) {
  const source = record ?? {};
  return {
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
 * erix runToolLoop. Checkpoint objects are passed through unchanged.
 *
 * @param {{db: object, tableName?: string}} options
 * @returns {{
 *   appendRound: Function,
 *   saveCheckpoint: Function,
 *   appendCheckpoint: Function,
 *   loadLatestCheckpoint: Function,
 *   markRunState: Function,
 * }}
 */
export function createErixStore({ db, tableName } = {}) {
  const transcriptStore = createTouwakaTranscriptStore({
    db,
    ...(tableName === undefined ? {} : { tableName }),
  });

  return {
    async appendRound(runId, record) {
      return transcriptStore.appendRound(runId, adaptRoundRecord(record));
    },
    async saveCheckpoint(runId, checkpoint) {
      return transcriptStore.saveCheckpoint(runId, checkpoint);
    },
    async appendCheckpoint(runId, checkpoint) {
      return transcriptStore.appendCheckpoint(runId, checkpoint);
    },
    async loadLatestCheckpoint(runId) {
      return transcriptStore.loadLatestCheckpoint(runId);
    },
    async markRunState(runId, state) {
      return transcriptStore.markRunState(runId, state);
    },
  };
}
