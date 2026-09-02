import assert from "node:assert/strict";
import test from "node:test";

import { createTouwakaProvider } from "../../lib/llm-kit-adapters/provider-adapter.js";

function createMockClient(sequence = []) {
  const calls = [];
  const llmClient = {
    calls,
    async callStream(model, messages, options) {
      calls.push({ model, messages, options });
      for (const step of sequence) {
        await Promise.resolve();
        if (step.type === "delta") options.onDelta?.(step.value);
        if (step.type === "reasoning") options.onReasoningDelta?.(step.value);
        if (step.type === "tool_call") options.onToolCall?.(step.value);
        if (step.type === "usage") options.onUsage?.(step.value);
      }
    },
  };
  return llmClient;
}

function resolveModelFactory(calls, model = { model_name: "mock-model" }) {
  return async (request, requestMeta) => {
    calls.push({ request, requestMeta });
    return model;
  };
}

test("canonical messages use erix OpenAI conversion and keep reasoning out of content", async () => {
  const resolved = [];
  const llmClient = createMockClient();
  const provider = createTouwakaProvider({
    llmClient,
    resolveModel: resolveModelFactory(resolved),
  });

  await provider.chatStream({
    system: "You are helpful.",
    messages: [
      { role: "user", content: [{ type: "text", text: "inspect" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "private reasoning" },
          { type: "text", text: "I will inspect." },
          {
            type: "raw",
            protocol: "vendor",
            payload: { trace_id: "trace-1" },
          },
        ],
      },
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "call-1",
          content: "result",
        }],
      },
    ],
  });

  const [call] = llmClient.calls;
  assert.deepEqual(call.messages, [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "inspect" },
    {
      role: "assistant",
      content: "I will inspect.",
      reasoning_content: "private reasoning",
      raw_blocks: [{
        type: "raw",
        protocol: "vendor",
        payload: { trace_id: "trace-1" },
      }],
    },
    { role: "tool", tool_call_id: "call-1", content: "result" },
  ]);
  assert.equal(call.messages[2].content.includes("private reasoning"), false);
  assert.deepEqual(resolved[0].requestMeta, { user_id: "anonymous" });
});

test("canonical tools are converted to OpenAI function tools", async () => {
  const llmClient = createMockClient();
  const provider = createTouwakaProvider({
    llmClient,
    resolveModel: resolveModelFactory([]),
  });

  await provider.chatStream({
    messages: [],
    tools: [{
      name: "lookup",
      description: "Find a value.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
    }],
  });

  assert.deepEqual(llmClient.calls[0].options.tools, [{
    type: "function",
    function: {
      name: "lookup",
      description: "Find a value.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
      },
    },
  }]);
});

test("stream callbacks and events preserve delta, reasoning, tool fragments, and usage order", async () => {
  const events = [];
  const callbacks = [];
  const llmClient = createMockClient([
    { type: "delta", value: "hello " },
    { type: "reasoning", value: "think " },
    {
      type: "tool_call",
      value: {
        index: 0,
        id: "call-1",
        function: { name: "lookup", arguments: '{"query":' },
      },
    },
    {
      type: "tool_call",
      value: {
        index: 0,
        function: { arguments: '"touwaka"}' },
      },
    },
    { type: "usage", value: { prompt_tokens: 8, completion_tokens: 5 } },
  ]);
  const provider = createTouwakaProvider({
    llmClient,
    resolveModel: resolveModelFactory([]),
  });

  const response = await provider.chatStream({
    messages: [],
    onDelta: (value) => callbacks.push(["delta", value]),
    onReasoningDelta: (value) => callbacks.push(["reasoning", value]),
    onToolCall: (value) => callbacks.push(["tool_call", value]),
    onUsage: (value) => callbacks.push(["usage", value]),
    onEvent: (event) => events.push(event),
  });

  assert.deepEqual(events.map((event) => event.type), [
    "delta",
    "reasoning_delta",
    "tool_call",
    "tool_call",
    "usage",
  ]);
  assert.deepEqual(callbacks, [
    ["delta", "hello "],
    ["reasoning", "think "],
    ["tool_call", {
      index: 0,
      id: "call-1",
      name: "lookup",
      argumentsDelta: '{"query":',
    }],
    ["tool_call", {
      index: 0,
      id: "call-1",
      argumentsDelta: '"touwaka"}',
    }],
    ["usage", { prompt_tokens: 8, completion_tokens: 5 }],
  ]);
  assert.deepEqual(response, {
    content: [
      { type: "reasoning", text: "think " },
      { type: "text", text: "hello " },
      {
        type: "tool_use",
        id: "call-1",
        name: "lookup",
        input: { query: "touwaka" },
      },
    ],
    stopReason: "tool_use",
    usage: { input_tokens: 8, output_tokens: 5 },
  });
});

test("request generation parameters and model resolution reach callStream", async () => {
  const resolved = [];
  const model = {
    model_name: "resolved-model",
    provider_name: "mock-provider",
    max_output_tokens: 2048,
    model_type: "text",
  };
  const llmClient = createMockClient();
  const provider = createTouwakaProvider({
    llmClient,
    resolveModel: resolveModelFactory(resolved, model),
    defaultUserId: "user-1",
    defaultRequestId: "request-1",
  });

  await provider.chatStream({
    messages: [],
    temperature: 0.25,
    topP: 0.4,
    maxTokens: 321,
    thinking: { type: "enabled" },
  });

  assert.equal(resolved.length, 1);
  assert.deepEqual(resolved[0].requestMeta, {
    user_id: "user-1",
    request_id: "request-1",
  });
  assert.equal(llmClient.calls[0].model, model);
  assert.equal(llmClient.calls[0].options.temperature, 0.25);
  assert.equal(llmClient.calls[0].options.top_p, 0.4);
  assert.equal(llmClient.calls[0].options.max_tokens, 321);
  assert.deepEqual(llmClient.calls[0].options.thinking, { type: "enabled" });
  assert.equal(llmClient.calls[0].options.user_id, "user-1");
  assert.equal(llmClient.calls[0].options.request_id, "request-1");
});

test("chat bridges the existing non-streaming LLMClient.call when available", async () => {
  const llmClient = createMockClient();
  llmClient.call = async (model, messages, options) => {
    llmClient.chatCall = { model, messages, options };
    return {
      content: "done",
      toolCalls: [{
        id: "call-1",
        function: { name: "finish", arguments: "{}" },
      }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    };
  };
  const provider = createTouwakaProvider({
    llmClient,
    resolveModel: resolveModelFactory([]),
  });

  const response = await provider.chat({
    messages: [{ role: "user", content: "start" }],
  });

  assert.deepEqual(response, {
    content: [
      { type: "text", text: "done" },
      { type: "tool_use", id: "call-1", name: "finish", input: {} },
    ],
    stopReason: "tool_use",
    usage: { input_tokens: 2, output_tokens: 3 },
  });
  assert.equal(llmClient.chatCall.messages[0].content, "start");
});

test("request.signal aborts the client request by request_id", async () => {
  const controller = new AbortController();
  const abortCalls = [];
  const llmClient = {
    callStream() {
      return new Promise(() => {});
    },
    abortRequest(requestId) {
      abortCalls.push(requestId);
    },
  };
  const provider = createTouwakaProvider({
    llmClient,
    resolveModel: resolveModelFactory([]),
    defaultUserId: "user-1",
    defaultRequestId: "request-1",
  });
  const pending = provider.chatStream({
    messages: [],
    signal: controller.signal,
  });
  const reason = new Error("cancelled");
  controller.abort(reason);

  await assert.rejects(pending, (error) => error === reason);
  assert.deepEqual(abortCalls, ["request-1"]);
});

