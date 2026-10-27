import {
  canonicalToOpenAIMessages,
  canonicalToolsToOpenAI,
} from "erix-agent";

const PASSTHROUGH_FIELDS = [
  ["thinking", "thinking"],
  ["reasoning", "reasoning"],
  ["reasoning_effort", "reasoning_effort"],
  ["enable_thinking", "enable_thinking"],
  ["chat_template_kwargs", "chat_template_kwargs"],
  ["frequency_penalty", "frequency_penalty", "frequencyPenalty"],
  ["presence_penalty", "presence_penalty", "presencePenalty"],
  ["response_format", "response_format", "responseFormat"],
  ["max_tokens", "max_tokens", "maxTokens", "max_output_tokens"],
  ["temperature", "temperature"],
  ["top_p", "top_p", "topP"],
];

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function firstDefined(source, keys) {
  for (const key of keys) {
    if (hasOwn(source, key) && source[key] !== undefined) return source[key];
  }
  return undefined;
}

function setIfDefined(target, key, value) {
  if (value !== undefined) target[key] = value;
}

/**
 * token 计数只认**有限非负数值**；字符串数字接受（部家 SSE 会发 "123"），NaN / 负数 / Infinity /
 * 布尔一律当「没报」（宁缺勿假：假 0 会把下游成本统计带成“本轮免费”）。
 */
function tokenCount(value) {
  const raw = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : undefined;
}

/**
 * usage 归一：除族名映射外，还负责上游 v0.53.0 #463 的「**provider 不报 `total` 时派生**」。
 * 为什么要我们派生：下游成本统计只读 total，provider 缺席时那条记录就变成“没花钱”，
 * 而账本里的 `usage` 列一旦带洞，事后无法重算。
 *
 * 两个家族口径不同，拿错就把缓存 token **算两遍**，所以族名按**原始键名**判、不按归一后的键名判：
 * - Anthropic 家族（带 `input_tokens`）：`input_tokens` **不含**缓存部分 ⇒ total = input + output + cache_read + cache_write。
 * - OpenAI 家族（只带 `prompt_tokens`）：`prompt_tokens` **已含** `cached_tokens` ⇒ total = prompt + completion，
 *   缓存只是它的子集，**不得**再加一道。
 * 此外 `total` 不参与 cache 计数（cache 两键永远只放分项），避免下游把 cacheRead+cacheWrite+total 叠加时重复计费。
 * 幂等：provider 自己给了 total 就照拄不覆盖，归一两次结果不眼胀。
 */
export function normalizeUsage(usage) {
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
    return undefined;
  }

  const anthropicFamily = hasOwn(usage, "input_tokens");
  const input = tokenCount(firstDefined(usage, [
    "input_tokens",
    "prompt_tokens",
  ]));
  const output = tokenCount(firstDefined(usage, [
    "output_tokens",
    "completion_tokens",
  ]));
  const cacheRead = tokenCount(firstDefined(usage, [
    "cache_read_input_tokens",
    "cacheReadInputTokens",
    "cached_tokens",
    "prompt_cache_hit_tokens",
  ]));
  const cacheWrite = tokenCount(firstDefined(usage, [
    "cache_creation_input_tokens",
    "cacheCreationInputTokens",
  ]));

  const normalized = {};
  setIfDefined(normalized, "input_tokens", input);
  setIfDefined(normalized, "output_tokens", output);
  setIfDefined(normalized, "cache_read_input_tokens", cacheRead);
  setIfDefined(normalized, "cache_creation_input_tokens", cacheWrite);

  const declared = tokenCount(firstDefined(usage, ["total_tokens", "totalTokens", "total"]));
  if (declared === undefined) {
    const parts = anthropicFamily
      ? [input, cacheRead, cacheWrite, output]
      : [input, output];
    const known = parts.filter((value) => value !== undefined);
    // 一个分项都没 ⇒ 不凭空造 total（造 0 会被当成“本轮零成本”而不是“没报”）。
    if (known.length > 0) {
      normalized.total_tokens = known.reduce((sum, value) => sum + value, 0);
    }
  } else {
    normalized.total_tokens = declared;
  }

  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function normalizeStopReason(reason, fallback) {
  if (reason == null) return fallback;
  return {
    stop: "end_turn",
    tool_calls: "tool_use",
    tool_use: "tool_use",
    length: "max_tokens",
  }[reason] ?? reason;
}

function parseToolArguments(rawArguments) {
  const value = rawArguments === undefined ? "{}" : rawArguments;
  if (value !== null && typeof value === "object") return value;

  try {
    return JSON.parse(String(value));
  } catch {
    return {
      _truncatedArguments: value,
      _raw: value,
    };
  }
}

function asToolCallEntries(value, state) {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({ item, fallbackIndex: index }));
  }

  const existingIndexes = Object.keys(state.slots).map(Number);
  const fallbackIndex = existingIndexes.length === 1 ? existingIndexes[0] : 0;
  return [{ item: value, fallbackIndex }];
}

function toolCallParts(item) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return undefined;
  }

  const functionPart = item.function;
  const functionObject = functionPart !== null
    && typeof functionPart === "object"
    && !Array.isArray(functionPart)
    ? functionPart
    : undefined;
  const name = item.name ?? functionObject?.name;

  let argumentsValue;
  let hasArguments = false;
  for (const source of [item, functionObject]) {
    if (!source) continue;
    for (const key of ["argumentsDelta", "arguments"]) {
      if (hasOwn(source, key) && source[key] !== undefined) {
        argumentsValue = source[key];
        hasArguments = true;
        break;
      }
    }
    if (hasArguments) break;
  }
  if (!hasArguments && hasOwn(item, "input")) {
    argumentsValue = JSON.stringify(item.input ?? {});
    hasArguments = true;
  }

  return {
    index: item.index,
    id: item.id,
    name,
    argumentsValue,
    hasArguments,
  };
}

function appendToolCallFragments(value, state, request) {
  for (const { item, fallbackIndex } of asToolCallEntries(value, state)) {
    const parts = toolCallParts(item);
    if (!parts) continue;

    const requestedIndex = Number(parts.index);
    const index = Number.isInteger(requestedIndex) && requestedIndex >= 0
      ? requestedIndex
      : fallbackIndex;
    const slot = state.slots[index] ?? {
      id: undefined,
      name: undefined,
      arguments: "",
    };
    state.slots[index] = slot;

    if (parts.id !== undefined) slot.id = parts.id;
    if (parts.name !== undefined) slot.name = String(parts.name);
    if (parts.hasArguments) {
      const fragment = parts.argumentsValue !== null
        && typeof parts.argumentsValue === "object"
        ? JSON.stringify(parts.argumentsValue)
        : String(parts.argumentsValue);
      slot.arguments += fragment;
    }

    const emitted = {
      index,
      ...(slot.id === undefined ? {} : { id: slot.id }),
      ...(parts.name === undefined ? {} : { name: String(parts.name) }),
      ...(parts.hasArguments
        ? {
          argumentsDelta: parts.argumentsValue !== null
            && typeof parts.argumentsValue === "object"
            ? JSON.stringify(parts.argumentsValue)
            : String(parts.argumentsValue),
        }
        : {}),
    };
    request.onToolCall?.(emitted);
    request.onEvent?.({ type: "tool_call", ...emitted });
  }
}

function completedToolUseBlocks(state) {
  return Object.keys(state.slots)
    .map(Number)
    .sort((left, right) => left - right)
    .map((index) => state.slots[index])
    .filter(Boolean)
    .map((slot) => ({
      type: "tool_use",
      id: slot.id,
      name: slot.name,
      input: parseToolArguments(slot.arguments),
    }));
}

function responseMessage(response) {
  const choice = response?.choices?.[0];
  return choice?.message ?? response;
}

function responseToolCalls(response) {
  const message = responseMessage(response);
  return Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(response?.toolCalls)
      ? response.toolCalls
      : [];
}

function responseContent(response) {
  const message = responseMessage(response);
  return message?.content ?? response?.content;
}

export function toChatResponse(response, fallbackStopReason) {
  const message = responseMessage(response);
  const toolCalls = responseToolCalls(response);
  const content = [];
  const reasoning = message?.reasoningContent ?? message?.reasoning_content;

  if (Array.isArray(message?.content)) {
    content.push(...message.content);
  } else {
    if (typeof reasoning === "string" && reasoning.length > 0) {
      content.push({ type: "reasoning", text: reasoning });
    }
    const text = responseContent(response);
    if (typeof text === "string" && text.length > 0) {
      content.push({ type: "text", text });
    }
  }

  for (const toolCall of toolCalls) {
    const parts = toolCallParts(toolCall);
    if (!parts) continue;
    content.push({
      type: "tool_use",
      id: parts.id,
      name: parts.name,
      input: parseToolArguments(parts.argumentsValue),
    });
  }

  const rawStopReason = message?.stopReason
    ?? message?.stop_reason
    ?? response?.stopReason
    ?? response?.stop_reason
    ?? message?.finishReason
    ?? message?.finish_reason
    ?? response?.finishReason
    ?? response?.finish_reason;
  const stopReason = normalizeStopReason(
    rawStopReason,
    content.some((block) => block?.type === "tool_use")
      ? "tool_use"
      : fallbackStopReason,
  );
  const normalized = { content, stopReason };
  // 上游 v0.52.0 #422：provider **只回了 reasoning**（模型想了但没落地答案也没开工具）时，
  // 调用方按“空答案”直接收尾 ⇒ 用户看到一条空白回复，且没人知道是 provider 抽风。
  // 本副本的接法：**只加标记、不改 stopReason** ⇒ 现有按 stopReason 分支的消费方行为逐字节不变；
  // 需要兜底（重试 / 降级到不思考模型 / 提示用户）的调用方读 `providerThinkingOnly` 决定。
  // 且只在真命中时写键（不是命中时写 false）：既有对返回值做 deepEqual 的断言不会被动到。
  const hasAnswer = content.some((block) =>
    (block?.type === "text" && String(block?.text ?? "").trim() !== "")
    || block?.type === "tool_use");
  const hasReasoning = content.some((block) => block?.type === "reasoning" || block?.type === "thinking");
  if (!hasAnswer && hasReasoning) normalized.providerThinkingOnly = true;
  const usage = normalizeUsage(response?.usage);
  if (usage !== undefined) normalized.usage = usage;
  return normalized;
}

function abortReason(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error(
    signal?.reason === undefined ? "The operation was aborted" : String(signal.reason),
  );
  error.name = "AbortError";
  return error;
}

function abortClientRequest(llmClient, { user_id, request_id }) {
  if (request_id !== undefined && typeof llmClient.abortRequest === "function") {
    llmClient.abortRequest(request_id);
    return;
  }
  if (user_id !== undefined && typeof llmClient.abortUserRequest === "function") {
    llmClient.abortUserRequest(user_id);
  }
}

async function invokeWithAbort(
  operation,
  llmClient,
  requestMeta,
  onAbort,
) {
  const { signal } = requestMeta;
  if (!signal) return operation();
  if (signal.aborted) {
    onAbort?.();
    abortClientRequest(llmClient, requestMeta);
    throw abortReason(signal);
  }

  let rejectAbort;
  const abortPromise = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    onAbort?.();
    abortClientRequest(llmClient, requestMeta);
    rejectAbort(abortReason(signal));
  };
  signal.addEventListener("abort", abort, { once: true });

  const operationPromise = Promise.resolve().then(() => {
    if (signal.aborted) throw abortReason(signal);
    return operation();
  });
  try {
    return await Promise.race([operationPromise, abortPromise]);
  } finally {
    signal.removeEventListener?.("abort", abort);
  }
}

function resolveRequestMeta(request, opts, {
  defaultUserId,
  defaultRequestId,
}) {
  const user_id = request.user_id
    ?? opts.user_id
    ?? defaultUserId
    ?? "anonymous";
  const request_id = request.request_id
    ?? opts.request_id
    ?? defaultRequestId;
  const signal = request.signal ?? opts.signal;
  return {
    user_id,
    ...(request_id === undefined ? {} : { request_id }),
    ...(signal === undefined ? {} : { signal }),
  };
}

function buildCallOptions(request, requestMeta) {
  const options = {
    tools: canonicalToolsToOpenAI(request.tools),
    user_id: requestMeta.user_id,
  };

  if (requestMeta.request_id !== undefined) {
    options.request_id = requestMeta.request_id;
  }
  if (requestMeta.signal !== undefined) options.signal = requestMeta.signal;

  for (const [target, ...sourceKeys] of PASSTHROUGH_FIELDS) {
    setIfDefined(options, target, firstDefined(request, sourceKeys));
  }

  for (const [key, callback] of [
    ["onDelta", request.onDelta],
    ["onReasoningDelta", request.onReasoningDelta],
    ["onToolCall", request.onToolCall],
    ["onUsage", request.onUsage],
  ]) {
    if (typeof callback === "function") options[key] = callback;
  }
  return options;
}

function streamResponse(response, state, reportedUsage) {
  const content = [];
  if (state.reasoning.length > 0) {
    content.push({ type: "reasoning", text: state.reasoning });
  }
  if (state.text.length > 0) content.push({ type: "text", text: state.text });
  content.push(...completedToolUseBlocks(state));

  const returnedUsage = normalizeUsage(response?.usage);
  const usage = reportedUsage ?? returnedUsage;
  const normalized = {
    content,
    stopReason: normalizeStopReason(
      response?.stopReason ?? response?.stop_reason ?? response?.finishReason,
      Object.keys(state.slots).length > 0 ? "tool_use" : "end_turn",
    ),
  };
  if (usage !== undefined) normalized.usage = usage;
  return normalized;
}

/**
 * Bridge erix-agent's provider contract to Touwaka's LLMClient.
 *
 * `resolveModel` receives the original canonical request and
 * `{user_id, request_id, signal}` metadata. The returned model config is
 * passed unchanged to `llmClient.callStream`/`call`.
 *
 * @param {{
 *   llmClient: object,
 *   resolveModel: (request: object, requestMeta: object) => Promise<object>,
 *   defaultUserId?: string,
 *   defaultRequestId?: string,
 * }} options
 * @returns {{chat?: Function, chatStream: Function}}
 */
export function createTouwakaProvider({
  llmClient,
  resolveModel,
  defaultUserId,
  defaultRequestId,
} = {}) {
  if (!llmClient || typeof llmClient.callStream !== "function") {
    throw new TypeError("[llm-kit-adapters] llmClient.callStream is required");
  }
  if (typeof resolveModel !== "function") {
    throw new TypeError("[llm-kit-adapters] resolveModel is required");
  }

  async function chatStream(request = {}, opts = {}) {
    const requestMeta = resolveRequestMeta(request, opts, {
      defaultUserId,
      defaultRequestId,
    });
    const modelConfig = await resolveModel(request, requestMeta);

    const state = {
      active: true,
      text: "",
      reasoning: "",
      slots: {},
    };
    let reportedUsage;
    const callOptions = buildCallOptions(request, requestMeta);
    callOptions.onDelta = (delta) => {
      if (!state.active) return;
      if (typeof delta === "string") state.text += delta;
      request.onDelta?.(delta);
      request.onEvent?.({ type: "delta", delta });
    };
    callOptions.onReasoningDelta = (delta, metadata) => {
      if (!state.active) return;
      if (typeof delta === "string") state.reasoning += delta;
      request.onReasoningDelta?.(delta, metadata);
      request.onEvent?.({
        type: "reasoning_delta",
        delta,
        ...(metadata === undefined ? {} : { metadata }),
      });
    };
    callOptions.onToolCall = (toolCall) => {
      if (!state.active) return;
      appendToolCallFragments(toolCall, state, request);
    };
    callOptions.onUsage = (usage) => {
      if (!state.active) return;
      reportedUsage = usage;
      request.onUsage?.(usage);
      request.onEvent?.({ type: "usage", usage });
    };

    let response;
    try {
      response = await invokeWithAbort(
        () => llmClient.callStream(modelConfig, canonicalToOpenAIMessages(
          request.system,
          request.messages,
        ), callOptions),
        llmClient,
        requestMeta,
        () => {
          state.active = false;
        },
      );
    } finally {
      state.active = false;
    }

    if (state.slots && Object.keys(state.slots).length === 0) {
      const returnedToolCalls = responseToolCalls(response);
      if (returnedToolCalls.length > 0) {
        appendToolCallFragments(returnedToolCalls, state, request);
      }
    }
    if (reportedUsage === undefined && response?.usage !== undefined) {
      reportedUsage = response.usage;
      request.onUsage?.(reportedUsage);
      request.onEvent?.({ type: "usage", usage: reportedUsage });
    }
    return streamResponse(response, state, normalizeUsage(reportedUsage));
  }

  const provider = { chatStream };
  if (typeof llmClient.call === "function") {
    provider.chat = async (request = {}, opts = {}) => {
      const requestMeta = resolveRequestMeta(request, opts, {
        defaultUserId,
        defaultRequestId,
      });
      const modelConfig = await resolveModel(request, requestMeta);
      const callOptions = buildCallOptions(request, requestMeta);
      delete callOptions.onDelta;
      delete callOptions.onReasoningDelta;
      delete callOptions.onToolCall;
      delete callOptions.onUsage;
      const response = await invokeWithAbort(
        () => llmClient.call(modelConfig, canonicalToOpenAIMessages(
          request.system,
          request.messages,
        ), callOptions),
        llmClient,
        requestMeta,
      );
      return toChatResponse(
        response,
        responseToolCalls(response).length > 0 ? "tool_use" : "end_turn",
      );
    };
  } else {
    provider.chat = async () => {
      // M1 only guarantees the streaming path; non-stream orchestration remains
      // unavailable until the later AgentLoop integration phase.
      throw new Error("[llm-kit-adapters] chat is not implemented in M1; use chatStream");
    };
  }
  return provider;
}
