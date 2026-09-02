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

function normalizeUsage(usage) {
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
    return undefined;
  }

  const normalized = {};
  setIfDefined(normalized, "input_tokens", firstDefined(usage, [
    "input_tokens",
    "prompt_tokens",
  ]));
  setIfDefined(normalized, "output_tokens", firstDefined(usage, [
    "output_tokens",
    "completion_tokens",
  ]));
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

function toChatResponse(response, fallbackStopReason) {
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
