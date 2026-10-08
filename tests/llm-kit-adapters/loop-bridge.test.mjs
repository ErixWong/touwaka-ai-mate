import assert from "node:assert/strict";
import test from "node:test";

import { runToolLoop } from "erix-agent";
import {
  createErixEventHandler,
  createErixPersistenceErrorHandlers,
} from "../../lib/agent/agent-loop.js";
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
  // erix 0.12.0（#78 capability 分级）：snapshot 新名为 saveRunSnapshot，
  // checkpoint 旧名为兼容回退；这里实现全量面供调用观测。
  const calls = {
    appendRound: [],
    load: [],
    saveRunSnapshot: [],
    loadLatestRunSnapshot: [],
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
      saveRunSnapshot: record("saveRunSnapshot", async () => {}),
      loadLatestRunSnapshot: record("loadLatestRunSnapshot", async () => undefined),
      saveRunState: record("saveRunState", async () => {}),
      loadRunState: record("loadRunState", async () => undefined),
      markRunState: record("markRunState", async () => {}),
    },
  };
}

function createRecordingLogger({ throwInfo = false } = {}) {
  const entries = [];
  const record = (level) => (message, fields) => {
    if (level === "info" && throwInfo) throw new Error("logger info failed");
    entries.push({ level, message, fields });
  };
  return {
    entries,
    logger: {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    },
  };
}

async function runWith(options) {
  return runToolLoop(options);
}

test("unrecognized erix events are warned by type without logging their payload", () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({
    request_id: "request-unknown",
    logger,
  });

  onEvent({
    type: "future_event",
    payload: "sensitive event body",
    nested: { secret: "must not be logged" },
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, "warn");
  assert.equal(entries[0].fields.event, "erix.unhandled_event");
  assert.equal(entries[0].fields.type, "future_event");
  assert.equal(entries[0].fields.request_id, "request-unknown");
  assert.doesNotMatch(JSON.stringify(entries), /sensitive event body|must not be logged/);
});

test("persistence capability degradation is warned without calling it a failure", () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({
    request_id: "request-capability",
    logger,
  });

  onEvent({
    type: "persistence_capability_degraded",
    runId: "run-capability",
    method: "saveRunSnapshot",
    payload: "not for logging",
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, "warn");
  assert.equal(entries[0].fields.runId, "run-capability");
  assert.equal(entries[0].fields.method, "saveRunSnapshot");
  assert.doesNotMatch(JSON.stringify(entries), /失败|failure|not for logging/i);
});

test("tool output aggregation logs archived at info and terminated at error", () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({
    request_id: "request-aggregate",
    logger,
  });

  onEvent({
    type: "tool_output_aggregate",
    action: "archived",
    originalText: "sensitive archived body",
  });
  onEvent({
    type: "tool_output_aggregate",
    action: "terminated",
    originalText: "sensitive terminated body",
  });

  assert.deepEqual(entries.map(({ level }) => level), ["info", "error"]);
  assert.equal(entries[0].fields.action, "archived");
  assert.equal(entries[1].fields.action, "terminated");
  assert.match(entries[1].message, /原文已丢失/);
  assert.doesNotMatch(JSON.stringify(entries), /sensitive .* body/);
});

test("erix event handler exceptions are logged and never escape", () => {
  const { entries, logger } = createRecordingLogger({ throwInfo: true });
  const onEvent = createErixEventHandler({
    request_id: "request-handler-error",
    logger,
    onKnownEvent: () => logger.info("force handler failure"),
  });

  assert.doesNotThrow(() => onEvent({ type: "round_start" }));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, "error");
  assert.equal(entries[0].fields.event, "erix.callback_error");
  assert.equal(entries[0].fields.callback, "onEvent");
  assert.equal(entries[0].fields.type, "round_start");
  assert.equal(entries[0].fields.error_message, "logger info failed");
});

test("final guard, compaction, tool events, and replay decisions use safe summaries", () => {
  const { entries, logger } = createRecordingLogger();
  const onEvent = createErixEventHandler({
    request_id: "request-summary",
    logger,
  });

  onEvent({ type: "forced_final", reason: "round_limit" });
  onEvent({ type: "final_guard", action: "error", content: "private answer" });
  onEvent({ type: "final_guard", action: "degraded", content: "private answer" });
  onEvent({ type: "final_guard", action: "accept", content: "private answer" });
  onEvent({ type: "final_guard", action: "skip", content: "private answer" });
  onEvent({ type: "final_guard", action: "revise", content: "private answer" });
  onEvent({
    type: "compaction",
    foldedRounds: 2,
    tokensBefore: 1200,
    tokensAfter: 600,
    content: "private transcript",
  });
  onEvent({ type: "tool_use", input: { secret: "private tool args" } });
  onEvent({ type: "tool_result", result: "private tool result" });
  onEvent({ type: "tool_result", result: "another private tool result" });
  onEvent({ type: "tool_replay_decision_required", runId: "run-replay" });

  assert.deepEqual(entries.map(({ level }) => level), [
    "warn",
    "error",
    "warn",
    "info",
    "info",
    "info",
    "info",
    "debug",
    "debug",
    "debug",
    "warn",
  ]);
  assert.equal(entries[0].fields.reason, "round_limit");
  assert.deepEqual(entries.slice(1, 6).map(({ fields }) => fields.action), [
    "error",
    "degraded",
    "accept",
    "skip",
    "revise",
  ]);
  assert.equal(entries[6].fields.foldedRounds, 2);
  assert.equal(entries[7].fields.count, 1);
  assert.equal(entries[8].fields.count, 1);
  assert.equal(entries[9].fields.count, 2);
  assert.match(entries[10].message, /待宿主决策/);
  assert.match(entries[10].message, /未接 resume\/replayPolicy/);
  assert.doesNotMatch(JSON.stringify(entries), /private answer|private transcript|private tool/);
});

test("diagnostics.error and persistence callback pass through with structured failure fields", () => {
  const { entries, logger } = createRecordingLogger();
  const handlers = createErixPersistenceErrorHandlers({
    request_id: "request-persistence",
    logger,
  });
  const options = buildErixRunOptions({
    provider: {},
    executeTool: async () => "unused",
    diagnostics: handlers.diagnostics,
    onPersistenceError: handlers.onPersistenceError,
  });

  assert.strictEqual(options.diagnostics, handlers.diagnostics);
  assert.strictEqual(options.onPersistenceError, handlers.onPersistenceError);

  options.diagnostics.error({
    port: "transcriptStore",
    phase: "append",
    operation: "appendRound",
    runId: "run-diagnostics",
    fatal: true,
    sideEffect: false,
    ts: "2026-10-09T00:00:00.000Z",
    error: Object.assign(new Error("diagnostic write failed"), { code: "STORE_WRITE" }),
  });
  options.onPersistenceError(Object.assign(
    new Error("callback write failed"),
    {
      code: "STORE_CALLBACK",
      port: "transcriptStore",
      phase: "flush",
      operation: "appendRound",
      runId: "run-callback",
      fatal: false,
      sideEffect: true,
    },
  ));

  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.equal(entry.level, "error");
    assert.equal(entry.fields.event, "erix.persistence_error");
    assert.equal(entry.fields.request_id, "request-persistence");
    assert.equal(entry.fields.port, "transcriptStore");
    assert.equal(entry.fields.operation, "appendRound");
    assert.equal(entry.fields.error_code.startsWith("STORE_"), true);
  }
  assert.equal(entries[0].fields.source, "diagnostics.error");
  assert.equal(entries[0].fields.phase, "append");
  assert.equal(entries[0].fields.runId, "run-diagnostics");
  assert.equal(entries[0].fields.fatal, true);
  assert.equal(entries[0].fields.sideEffect, false);
  assert.equal(entries[0].fields.error_message, "diagnostic write failed");
  assert.equal(entries[1].fields.source, "onPersistenceError");
  assert.equal(entries[1].fields.phase, "flush");
  assert.equal(entries[1].fields.runId, "run-callback");
  assert.equal(entries[1].fields.fatal, false);
  assert.equal(entries[1].fields.sideEffect, true);
  assert.equal(entries[1].fields.error_message, "callback write failed");
});

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
    modelConfig: { context_window_tokens: 32768, max_output_tokens: 4096 },
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
  assert.ok(store.calls.saveRunSnapshot.length > 0);
  assert.ok(store.calls.markRunState.length > 0);
  for (const args of [
    ...store.calls.appendRound,
    ...store.calls.saveRunSnapshot,
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

test("measured duration is included in failed tool_result and persisted RoundRecord", async () => {
  const provider = createFakeProvider([
    toolResponse(),
    textResponse("任务完成"),
  ]);
  const { store, calls } = createRecordingStore();
  const result = await runWith(buildErixRunOptions({
    provider: provider.provider,
    executeTool: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { success: false, data: "tool failed", error: "tool failed" };
    },
    store,
    initialUserMessage: "start",
    stream: true,
    runId: "run-tool-duration",
  }));

  const toolResult = result.messages
    .flatMap((message) => message.content ?? [])
    .find((block) => block.type === "tool_result");
  assert.equal(toolResult.is_error, true);
  assert.equal(Number.isSafeInteger(toolResult.duration), true);
  assert.ok(toolResult.duration > 0);

  const savedRecord = calls.appendRound
    .map(([, record]) => record)
    .find((record) => record.messages?.some((message) => (
      message.content?.some((block) => (
        block.type === "tool_result" && block.tool_use_id === toolResult.tool_use_id
      ))
    )));
  assert.ok(savedRecord, "tool result reaches appendRound");
  assert.equal(Object.hasOwn(savedRecord, "duration"), false, "duration is not added to RoundRecord");
  const savedToolResult = savedRecord.messages
    .flatMap((message) => message.content ?? [])
    .find((block) => block.type === "tool_result");
  assert.equal(savedToolResult.duration, toolResult.duration);
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
