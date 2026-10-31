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
    modelConfig: { context_window_tokens: 32768, max_output_tokens: 4096 },
    signals: ["done"],
    // issue #1227 阶段 1：runId / initialUserMessage / stream / toolContext 的规范之家
    // 全在 0.29 的命名空间里，扁平写法会被名称闸口当场拒。
    config: {
      input: { initialUserMessage: "say hi" },
      run: { runId: "run-bridge-1", stream: true },
      metadata: { toolContext: { trace_id: "trace-1" } },
    },
    onEvent: (event) => events.push(event),
  });

  assert.equal(options.executeTool.length, 1);
  assert.deepEqual(options.config.metadata.modelMetadata, {
    contextWindowTokens: 32768,
    maxOutputTokens: 4096,
  });
  assert.deepEqual(options.config.timing.retry, {
    attempts: 2,
    backoffBaseMs: 1500,
    backoffMaxMs: 10000,
  });
  assert.deepEqual(options.config.run.stallDetection, { window: 4 });
  assert.deepEqual(options.config.run.completion.signals, ["done"]);
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
    // erix 0.29（上游 #617，P0）：把当前 run 的身份也递进工具上下文——新增的**只有**
    // `runId` 一个键（派生工具据此自填父身份）。断言强度不降：仍是逐键 deepEqual，
    // 只是把上游新增的那一个键显式钉进来（0.23 的 baseToolContext 里没有它）。
    context: {
      trace_id: "trace-1",
      round: 1,
      runId: "run-bridge-1",
      reportPersistenceFailure: toolCalls[0].context.reportPersistenceFailure,
    },
    signal: toolCalls[0].signal,
  });
  assert.equal(typeof toolCalls[0].context.reportPersistenceFailure, "function");
  assert.ok(toolCalls[0].signal);
  assert.equal(result.rounds, 2);
  assert.equal(result.finalText, "done");
  assert.equal(toolResult.content, "echo: hi");
  // #1212 / erix-agent 0.20（上游 #284/#285 T2）：引擎 canonical 块的成败/耗时事实住在
  // erix.*，宿主 executor 扩展键住在 metadata.*，顶层摊平名已停写（实测块形：顶层只剩
  // type/tool_use_id/content(+is_error)）。断言逐键改读新命名空间，强度不降：
  // 断言的仍是同一个值，只换读点。
  assert.equal(toolResult.erix?.success, true, "成败事实读 erix.success（顶层 success 已停写）");
  assert.equal(Object.hasOwn(toolResult, "success"), false, "顶层旧名已停写：canonical 块不得再出现顶层 success");
  assert.deepEqual(toolResult.metadata?.atomic_steps, ["echo"], "宿主扩展键读 metadata.atomic_steps（顶层摊平已停写）");
  assert.equal(toolResult.metadata?.toolMessageId, "tool-message-1", "宿主扩展键读 metadata.toolMessageId");
  assert.equal(toolResult.metadata?.duration, 12, "宿主自报的 duration 只进 metadata.duration，不污染 erix.durationMs");
  // erix 0.18.0（issue #165）新增一次性终局汇总事件 run_outcome，排在 round_end
  // 之后 —— 这是 additive 的 semver minor，不是行为回归：round_end 本身仍按原形状
  // 透传。两条都钉住：round_end 形状不变 + run_outcome 作为最后一个事件透传下来。
  const lastRoundEnd = events.filter((event) => event.type === "round_end").at(-1);
  assert.equal(lastRoundEnd.stopReason, "end_turn");
  assert.equal(events.at(-1).type, "run_outcome");

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
    config: { run: { runId: "run-request-meta" } },
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
    config: {
      input: { initialUserMessage: "start" },
      run: { runId: "run-completion", stream: true },
    },
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
    config: {
      input: { initialUserMessage: "start" },
      run: { runId: "run-no-signal", stream: true },
    },
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
    config: {
      input: { initialUserMessage: "start" },
      run: { runId: "run-tool-error", stream: true },
    },
  }));

  const toolResult = result.messages
    .flatMap((message) => message.content ?? [])
    .find((block) => block.type === "tool_result");
  assert.equal(provider.calls.length, 2);
  assert.equal(result.finalText, "任务完成");
  // #1212：失败结果的成败事实同样只读 erix.success（0.20 起无条件写）
  assert.equal(toolResult.erix?.success, false, "失败结果读 erix.success === false");
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
    config: {
      input: { initialUserMessage: "start" },
      run: { runId: "run-tool-duration", stream: true },
    },
  }));

  const toolResult = result.messages
    .flatMap((message) => message.content ?? [])
    .find((block) => block.type === "tool_result");
  assert.equal(toolResult.is_error, true);
  // #1212：实测耗时读 erix.durationMs（executor settle 时刻捕获，六种返回形态都带）；
  // 断言强度不变：仍是「安全整数且 > 0」，只换读点。
  assert.equal(Number.isSafeInteger(toolResult.erix?.durationMs), true, "耗时事实读 erix.durationMs");
  assert.ok(toolResult.erix.durationMs > 0, "真实测得的耗时必须 > 0");

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
  assert.equal(savedToolResult.erix?.durationMs, toolResult.erix?.durationMs, "落库 RoundRecord 里的 erix.durationMs 与返回块一致");
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

// ─────────────────────────────────────────────────────────────────────────────
// issue #1227 阶段 1：erix-agent 0.29 顶层选项面命名空间迁移的门禁
// ─────────────────────────────────────────────────────────────────────────────

/**
 * erix-agent 0.29.0 的 `runToolLoop` 顶层白名单，逐字抄自
 * `node_modules/erix-agent/src/loop/option-normalization.js` 的
 * `RUN_TOOL_LOOP_OPTION_NAMES`（该常量**未从包入口导出**——包 exports 只放
 * `.` / `./tools` / `./contract-tests`，深路径 import 会 ERR_PACKAGE_PATH_NOT_EXPORTED，
 * 所以这里只能钉一份快照）。
 *
 * 它的作用不是「猜引擎」，而是把「我们不再往顶层写配置键」变成一条**可断言的集合关系**；
 * 真正的执法者仍是引擎自己的名称闸口（下面那条 `runToolLoop` 最小 run 用例证明它不抛）。
 * 顺序与上游一致，便于升级时逐项对照。
 */
const RUN_TOOL_LOOP_OPTION_NAMES_0_29 = [
  "assemblyPort",
  "provider",
  "tools",
  "executeTool",
  "finalGuard",
  "todoStateProvider",
  "semanticStateProvider",
  "modelConfig",
  "session",
  "store",
  "onRound",
  "onJudge",
  "onToolResult",
  "onPersistenceError",
  "diagnostics",
  "onObserverError",
  "signal",
  "onDelta",
  "onReasoningDelta",
  "onToolCall",
  "onUsage",
  "onEvent",
  "deliverables",
  "onFoldSummary",
  "config",
  "capabilities",
];

/** 0.29 名称闸口会拒掉、本项目 agent-loop 曾经平铺在顶层的 15 个键（issue #1227）。 */
const MIGRATED_FLAT_KEYS = [
  "runId",
  "maxRounds",
  "completion",
  "retry",
  "stallDetection",
  "toolContext",
  "modelMetadata",
  "initialMessages",
  "maxTokens",
  "temperature",
  "topP",
  "wrapup",
  "reflection",
  "stream",
  "context",
];

/** 按 `config.run.maxRounds` 这种路径取树里的值（测试辅助）。 */
function readPath(tree, dottedPath) {
  return dottedPath.split(".").reduce(
    (node, key) => (node === undefined || node === null ? undefined : node[key]),
    tree,
  );
}

/**
 * 让**引擎自己**说出某个旧扁平键的新家：0.29 的未知键报错里带
 * `(its canonical home is config.<path>; the flat spelling is rejected)`。
 * 这样测试不需要第二张手写的「旧名 → 新家」映射表，升级时也不会两边各改各的。
 */
async function canonicalHomeOf(flatKey) {
  try {
    await runToolLoop({ [flatKey]: 1 });
  } catch (error) {
    const match = /canonical home is (config\.[a-zA-Z.]+)/.exec(String(error?.message ?? ""));
    assert.ok(match, `引擎报错没有点名新家：${error?.message}`);
    return match[1];
  }
  assert.fail(`0.29 的名称闸口没有拒绝扁平键 ${JSON.stringify(flatKey)}`);
}

test("载荷形状：buildErixRunOptions 的顶层键集合 ⊆ 0.29 白名单，15 个旧扁平键一个不留", () => {
  // 用 agent-loop 的真实载荷形状（含函数/端口/回调 + 全套命名空间配置）。
  const options = buildErixRunOptions({
    provider: {},
    executeTool: async () => "ok",
    store: { appendRound: async () => {}, load: async () => [] },
    modelConfig: { context_window_tokens: 32768, max_output_tokens: 4096 },
    signals: ["done"],
    config: {
      input: {
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        wrapup: false,
      },
      run: {
        runId: "run-shape",
        maxRounds: 12,
        stallDetection: false,
        completion: { maxNoToolRounds: 4 },
        reflection: { enabled: true, roundJudge: true },
        stream: true,
      },
      tuning: { maxTokens: 4096, temperature: 0.2, topP: 0.8 },
      timing: { retry: { attempts: 3, backoffBaseMs: 10, backoffMaxMs: 20 } },
      folding: { context: { budgetTokens: 80000, keepRounds: 6, stripHistoricalImages: true } },
      metadata: { toolContext: { trace_id: "trace-shape" } },
    },
    capabilities: {
      hooks: { onAfterFold: () => {} },
      ports: { judgeProvider: { chat: async () => ({}) } },
    },
    signal: new AbortController().signal,
    onDelta: () => {},
    onUsage: () => {},
    onEvent: () => {},
  });

  const allowed = new Set(RUN_TOOL_LOOP_OPTION_NAMES_0_29);
  const offending = Object.keys(options).filter((key) => !allowed.has(key));
  assert.deepEqual(
    offending,
    [],
    `顶层出现 0.29 白名单外的键（会被名称闸口以 unknown runToolLoop option 拒掉）：${offending}`,
  );
  for (const flatKey of MIGRATED_FLAT_KEYS) {
    assert.equal(
      Object.hasOwn(options, flatKey),
      false,
      `旧扁平键 ${flatKey} 不得再出现在 runToolLoop 顶层`,
    );
  }
  // 命名空间确实是「有货」的，不是「全清空所以没未知键」。
  assert.equal(readPath(options, "config.run.maxRounds"), 12);
  assert.equal(readPath(options, "config.input.wrapup"), false);
  assert.equal(readPath(options, "config.tuning.maxTokens"), 4096);
  assert.equal(readPath(options, "config.timing.retry.attempts"), 3);
  assert.equal(readPath(options, "config.folding.context.keepRounds"), 6);
  assert.equal(readPath(options, "config.metadata.toolContext.trace_id"), "trace-shape");
  assert.equal(typeof readPath(options, "capabilities.hooks.onAfterFold"), "function");
  assert.equal(typeof readPath(options, "capabilities.ports.judgeProvider"), "object");
});

test("载荷形状：每个旧扁平键的取值都落在引擎自己点名的那个新家里", async () => {
  const options = buildErixRunOptions({
    provider: {},
    executeTool: async () => "ok",
    modelConfig: { context_window_tokens: 32768, max_output_tokens: 4096 },
    config: {
      input: {
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        wrapup: false,
      },
      run: {
        runId: "run-home",
        maxRounds: 7,
        stallDetection: false,
        completion: { maxNoToolRounds: 2 },
        reflection: { enabled: false },
        stream: true,
      },
      tuning: { maxTokens: 1234, temperature: 0.1, topP: 0.7 },
      timing: { retry: { attempts: 2 } },
      folding: { context: { budgetTokens: 4321, keepRounds: 3, stripHistoricalImages: true } },
      metadata: { toolContext: { trace_id: "trace-home" } },
    },
  });

  // 期望值按「引擎点名的家」逐键钉住：路径来自引擎报错，值来自我们写进去的载荷。
  const expected = {
    runId: "run-home",
    maxRounds: 7,
    completion: { signals: TOUWAKA_COMPLETION_SIGNALS, maxNoToolRounds: 2 },
    retry: { attempts: 2, backoffBaseMs: 1500, backoffMaxMs: 10000 },
    // 本用例显式给了 stallDetection: false（agent-loop 的实际取值），归一后仍是 false。
    stallDetection: false,
    toolContext: { trace_id: "trace-home" },
    modelMetadata: { contextWindowTokens: 32768, maxOutputTokens: 4096 },
    initialMessages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
    maxTokens: 1234,
    temperature: 0.1,
    topP: 0.7,
    wrapup: false,
    reflection: { enabled: false },
    stream: true,
    context: { budgetTokens: 4321, keepRounds: 3, stripHistoricalImages: true },
  };
  assert.deepEqual(Object.keys(expected).sort(), [...MIGRATED_FLAT_KEYS].sort());

  for (const [flatKey, value] of Object.entries(expected)) {
    const home = await canonicalHomeOf(flatKey);
    assert.deepEqual(
      readPath(options, home),
      value,
      `${flatKey} 的取值必须落在引擎点名的 ${home}`,
    );
  }
});

/**
 * 带非流式 `chat` 的假 provider：撞到轮数上界时引擎会走 `forceFinalIfNeeded`（终稿兜底），
 * 那条路径调 `provider.chat`。流式与非流式分别计数，免得「上界是否生效」的断言被兜底调用搅浑。
 */
function createFakeProviderWithChat(streamResponses, chatResponses) {
  const base = createFakeProvider(streamResponses);
  const chatCalls = [];
  base.chatCalls = chatCalls;
  base.provider.chat = async (request) => {
    const index = chatCalls.length;
    chatCalls.push(request);
    const response = (chatResponses ?? streamResponses)[
      Math.min(index, (chatResponses ?? streamResponses).length - 1)
    ];
    return response;
  };
  return base;
}

test("引擎侧生效：config.run.maxRounds 就是引擎的循环上界（不是只没报错）", async () => {
  const provider = createFakeProviderWithChat([
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
  ], [textResponse("收尾")]);
  const events = [];
  const options = buildErixRunOptions({
    provider: provider.provider,
    executeTool: async () => "ok",
    modelConfig: { context_window_tokens: 32768, max_output_tokens: 4096 },
    config: {
      input: { initialUserMessage: "go" },
      run: {
        runId: "run-max-rounds",
        maxRounds: 2,
        completion: { maxNoToolRounds: 2 },
        stream: true,
      },
    },
    onEvent: (event) => events.push(event),
  });

  const result = await runToolLoop(options);

  // provider 每轮都要工具 ⇒ 唯一能停下来的原因是轮数上界。
  assert.equal(result.rounds, 2, "config.run.maxRounds 必须成为引擎的循环上界");
  assert.equal(provider.calls.length, 2, "流式调用次数必须被 config.run.maxRounds=2 卡住");
  // 引擎在上界处发出的裁决事件（撞到 maxRounds 后发 forced_final，reason 点名是轮数上界）。
  const forcedFinal = events.find((event) => event.type === "forced_final");
  assert.ok(forcedFinal, "撞上 maxRounds 必须由引擎自己发 forced_final");
  assert.equal(forcedFinal.reason, "max_rounds_cap", "上界截断的停因必须来自引擎");
});

test("引擎侧生效：config.folding.context 的预算真的驱动折叠，回调走 capabilities.hooks", async () => {
  const provider = createFakeProviderWithChat([
    toolResponse({ blob: "x".repeat(400) }),
    toolResponse({ blob: "x".repeat(400) }),
    toolResponse({ blob: "x".repeat(400) }),
    textResponse("done"),
  ], [textResponse("收尾")]);
  const folds = [];
  const options = buildErixRunOptions({
    provider: provider.provider,
    executeTool: async () => ({ success: true, data: "y".repeat(400) }),
    modelConfig: { context_window_tokens: 1000, max_output_tokens: 100 },
    config: {
      input: { initialUserMessage: "go" },
      run: {
        runId: "run-folding",
        maxRounds: 6,
        completion: { maxNoToolRounds: 2 },
        stream: true,
      },
      // 预算 300 ⇒ 工具轮把上下文顶过预算后必然折叠；keepRounds=1 决定每次折几轮。
      folding: { context: { budgetTokens: 300, keepRounds: 1, stripHistoricalImages: true } },
    },
    capabilities: { hooks: { onAfterFold: (payload) => folds.push(payload) } },
  });

  await runToolLoop(options);

  assert.ok(
    folds.length > 0,
    "config.folding.context + capabilities.hooks.onAfterFold 必须让折叠真的发生",
  );
  const fold = folds[0];
  assert.ok(
    fold.tokensBefore > 300,
    `折叠前 tokens 必须超过 config 里的预算 300，实际 ${fold.tokensBefore}`,
  );
  assert.ok(
    fold.tokensAfter <= 300,
    `折叠后 tokens 必须落回预算内，实际 ${fold.tokensAfter}`,
  );
  assert.equal(fold.foldedRounds, 1, "keepRounds=1 时每次折叠 1 轮");
  assert.ok(Array.isArray(fold.messages) && fold.messages.length > 0, "onAfterFold 必须拿到折叠后的消息");
});

test("引擎侧生效：capabilities.ports.judgeProvider 是 reflection.judge.provider 的能力槽位", async () => {
  const provider = createFakeProviderWithChat([
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
    toolResponse(),
  ], [textResponse("收尾")]);
  const judgeCalls = [];
  const options = buildErixRunOptions({
    provider: provider.provider,
    executeTool: async () => "ok",
    modelConfig: { context_window_tokens: 32768, max_output_tokens: 100 },
    config: {
      input: { initialUserMessage: "go" },
      run: {
        runId: "run-judge-port",
        maxRounds: 20,
        stream: true,
        reflection: { enabled: true, roundJudge: true },
      },
    },
    capabilities: {
      ports: {
        judgeProvider: {
          async chat(request) {
            judgeCalls.push(request);
            return { content: [{ type: "text", text: "{\"action\":\"accept\",\"reason\":\"ok\"}" }] };
          },
        },
      },
    },
  });

  const result = await runToolLoop(options);
  assert.ok(result.rounds > 0);
  assert.ok(
    judgeCalls.length > 0,
    "capabilities.ports.judgeProvider 必须真的被引擎当成 judge 端口调用",
  );
});

test("旧扁平写法被引擎当场拒，且报错点名新家（迁移不是「悄悄生效」）", async () => {
  for (const flatKey of MIGRATED_FLAT_KEYS) {
    await assert.rejects(
      () => runToolLoop({ [flatKey]: 1 }),
      (error) => {
        assert.match(String(error?.message), /unknown runToolLoop option/);
        assert.match(String(error?.message), /canonical home is config\./);
        return true;
      },
      `扁平键 ${flatKey} 必须被 0.29 的名称闸口拒绝`,
    );
  }
});
