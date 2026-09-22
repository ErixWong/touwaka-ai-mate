import assert from "node:assert/strict";
import test from "node:test";

import { runToolLoop } from "erix-agent";
import {
  TOUWAKA_COMPLETION_SIGNALS,
  buildErixRunOptions,
  createErixToolExecutor,
} from "../../lib/llm-kit-adapters/loop-bridge.js";

function textResponse(text, stopReason = "end_turn") {
  return {
    content: [{ type: "text", text }],
    stopReason,
    usage: { input_tokens: 10, output_tokens: 4 },
  };
}

function toolResponse(input = { text: "hi" }) {
  return {
    content: [{
      type: "tool_use",
      id: "t1",
      name: "echo",
      input,
    }],
    stopReason: "tool_use",
    usage: { input_tokens: 12, output_tokens: 5 },
  };
}

function createFakeProvider(responses) {
  const calls = [];
  return {
    calls,
    provider: {
      async chatStream(request) {
        const index = calls.length;
        calls.push(request);
        const response = responses[Math.min(index, responses.length - 1)];
        for (const block of response.content ?? []) {
          if (block?.type === "text") request.onDelta?.(block.text);
          if (block?.type === "reasoning") {
            request.onReasoningDelta?.(block.text, { source: "fake" });
          }
        }
        request.onUsage?.(response.usage);
        return response;
      },
    },
  };
}

function createRecordingStore() {
  const calls = {
    appendRound: [],
    load: [],
    saveCheckpoint: [],
    appendCheckpoint: [],
    loadLatestCheckpoint: [],
    saveRunState: [],
    loadRunState: [],
    markRunState: [],
  };
  const record = (bucket, fn) => async (...args) => {
    calls[bucket].push(args);
    return fn(...args);
  };
  return {
    calls,
    store: {
      appendRound: record("appendRound", async () => {}),
      load: record("load", async () => []),
      saveCheckpoint: record("saveCheckpoint", async () => {}),
      appendCheckpoint: record("appendCheckpoint", async () => {}),
      loadLatestCheckpoint: record("loadLatestCheckpoint", async () => undefined),
      saveRunState: record("saveRunState", async () => {}),
      loadRunState: record("loadRunState", async () => undefined),
      markRunState: record("markRunState", async () => {}),
    },
  };
}

async function runWith(options) {
  return runToolLoop(options);
}

test("builds an erix loop with structured tool execution and canonical results", async () => {
  const provider = createFakeProvider([
    toolResponse(),
    textResponse("done"),
  ]);
  const toolCalls = [];
  const store = createRecordingStore();
  const events = [];
  const executeTool = async ({ id, name, input, context, signal }) => {
    toolCalls.push({ id, name, input, context, signal });
    return {
      success: true,
      data: "echo: hi",
      duration: 12,
      toolMessageId: "tool-message-1",
      atomic_steps: ["echo"],
      toolName: "echo",
    };
  };

  const options = buildErixRunOptions({
    provider: provider.provider,
    executeTool,
    store: store.store,
    runId: "run-bridge-1",
    initialUserMessage: "say hi",
    stream: true,
    toolContext: { trace_id: "trace-1" },
    modelConfig: { max_tokens: 32768, max_output_tokens: 4096 },
    signals: ["done"],
    onEvent: (event) => events.push(event),
  });

  assert.equal(options.executeTool.length, 1);
  assert.deepEqual(options.modelMetadata, {
    contextWindowTokens: 32768,
    maxOutputTokens: 4096,
  });
  assert.deepEqual(options.retry, {
    attempts: 2,
    backoffBaseMs: 1500,
    backoffMaxMs: 10000,
  });
  assert.deepEqual(options.stallDetection, { window: 4 });
  // erix 0.10.0 顶层选项白名单不再接受 user_id/expert_id/request_id 等宿主
  // 字段（provider 走 createTouwakaProvider 的 defaultUserId/defaultRequestId 闭包），
  // requestMeta 不得扩散到 runToolLoop 顶层选项。
  assert.equal(options.requestMeta, undefined);
  assert.equal(options.user_id, undefined);
  assert.equal(options.expert_id, undefined);

  const result = await runWith(options);
  const toolResultMessage = result.messages.find((message) => (
    message.role === "user"
    && message.content.some((block) => block.type === "tool_result")
  ));
  const [toolResult] = toolResultMessage.content;

  assert.equal(provider.calls.length, 2);
  assert.deepEqual(toolCalls[0], {
    id: "t1",
    name: "echo",
    input: { text: "hi" },
    // erix 0.10.0 向 executeTool context 注入宿主持久化失败上报端口。
    context: {
      trace_id: "trace-1",
      round: 1,
      reportPersistenceFailure: toolCalls[0].context.reportPersistenceFailure,
    },
    signal: toolCalls[0].signal,
  });
  assert.equal(typeof toolCalls[0].context.reportPersistenceFailure, "function");
  assert.ok(toolCalls[0].signal);
  assert.equal(result.rounds, 2);
  assert.equal(result.finalText, "done");
  assert.equal(toolResult.content, "echo: hi");
  assert.equal(toolResult.success, true);
  assert.deepEqual(toolResult.atomic_steps, ["echo"]);
  assert.equal(toolResult.toolMessageId, "tool-message-1");
  assert.equal(events.at(-1).type, "round_end");
  assert.equal(events.at(-1).stopReason, "end_turn");

  assert.ok(store.calls.appendRound.length > 0);
  assert.ok(store.calls.saveCheckpoint.length > 0);
  assert.ok(store.calls.markRunState.length > 0);
  for (const args of [
    ...store.calls.appendRound,
    ...store.calls.saveCheckpoint,
    ...store.calls.markRunState,
  ]) {
    assert.equal(args[0], "run-bridge-1");
  }
});

test("requestMeta is dropped instead of leaking into top-level run options", () => {
  // 回归：erix 0.10.0 顶层选项白名单不再接受 requestMeta 及其内部宿主字段，
  // 若放任其落入 ...passthrough 会以未知键透传进 runToolLoop 触发 TypeError。
  const options = buildErixRunOptions({
    provider: {},
    executeTool: async () => "ok",
    runId: "run-request-meta",
    requestMeta: {
      user_id: "user-1",
      expert_id: "expert-1",
      request_id: "req-1",
    },
  });

  assert.equal(options.requestMeta, undefined);
  assert.equal(options.user_id, undefined);
  assert.equal(options.expert_id, undefined);
  assert.equal(options.request_id, undefined);
});

test("completion signals stop immediately, while missing signals use the no-tool limit", async () => {
  const completionProvider = createFakeProvider([
    toolResponse(),
    textResponse(`工作${TOUWAKA_COMPLETION_SIGNALS[0]}`),
    textResponse("should not be called"),
  ]);
  const completionResult = await runWith(buildErixRunOptions({
    provider: completionProvider.provider,
    executeTool: async () => "ok",
    initialUserMessage: "start",
    stream: true,
    runId: "run-completion",
  }));

  assert.equal(completionProvider.calls.length, 2);
  assert.equal(completionResult.finalText, `工作${TOUWAKA_COMPLETION_SIGNALS[0]}`);

  const noSignalProvider = createFakeProvider([
    toolResponse(),
    textResponse("progress 1"),
    textResponse("progress 2"),
    textResponse("progress 3"),
    textResponse("should not be called"),
  ]);
  const noSignalResult = await runWith(buildErixRunOptions({
    provider: noSignalProvider.provider,
    executeTool: async () => "ok",
    initialUserMessage: "start",
    stream: true,
    runId: "run-no-signal",
  }));

  assert.equal(noSignalProvider.calls.length, 4);
  assert.equal(noSignalResult.rounds, 4);
  assert.equal(noSignalResult.finalText, "progress 3");
});

test("failed tool execution becomes an error tool_result without breaking the loop", async () => {
  const provider = createFakeProvider([
    toolResponse(),
    textResponse("任务完成"),
  ]);
  const result = await runWith(buildErixRunOptions({
    provider: provider.provider,
    executeTool: async () => {
      throw new Error("tool exploded");
    },
    initialUserMessage: "start",
    stream: true,
    runId: "run-tool-error",
  }));

  const toolResult = result.messages
    .flatMap((message) => message.content ?? [])
    .find((block) => block.type === "tool_result");
  assert.equal(provider.calls.length, 2);
  assert.equal(result.finalText, "任务完成");
  assert.equal(toolResult.success, false);
  assert.equal(toolResult.is_error, true);
  assert.equal(toolResult.content, "tool exploded");
});

test("supports the positional executor and forwards the result hook", async () => {
  const calls = [];
  const hookCalls = [];
  const positionalExecutor = async (name, input) => {
    calls.push([name, input]);
    return { success: true, data: "positional", atomic_steps: ["step-1"] };
  };
  const executor = createErixToolExecutor({
    executeTool: positionalExecutor,
    onToolResult: async (result) => {
      hookCalls.push(result);
    },
  });

  const result = await executor({
    id: "t-positional",
    name: "echo",
    input: { value: 1 },
    context: { round: 2 },
    signal: new AbortController().signal,
  });

  assert.equal(executor.length, 1);
  assert.deepEqual(calls, [["echo", { value: 1 }]]);
  assert.equal(hookCalls.length, 1);
  assert.equal(result.success, true);
  assert.equal(result.data, "positional");
  assert.deepEqual(result.atomic_steps, ["step-1"]);
});
