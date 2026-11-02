/**
 * issue #1263 防回归：erix-agent 的 **provider 契约里没有 `onEvent`**
 *
 * 事实（实测，不是猜）：`provider-runner.js:207-236` 构造给 provider 的 request 只有
 *   - 输入：`system` / `messages` / `tools` / `signal` / `maxTokens` / `temperature` / `topP`
 *   - 回调：`onDelta` / `onReasoningDelta` / `onToolCall` / `onUsage`
 * 宿主事件 `delta` / `reasoning_delta` / `tool_call` / `usage` 是**引擎**在 `queueEvent(...)` /
 * `dispatchAttemptEvent(...)` 里把上面四个回调包装出来的，provider 侧没有任何发宿主事件的入口。
 * `providers/openai.js:508` 的 `req.onEvent` 是内置 provider 自己的可选埋点，不是 loop 契约。
 *
 * 所以 `lib/llm-kit-adapters/provider-adapter.js` 里曾经那 5 处「往宿主推事件」的调用在引擎链路上
 * 恒为空转（被调用、但对象恒为 undefined）。本文件钉三件事：
 *   格① request 不带 `onEvent` 时 `chatStream` 不抛，四个契约回调按序到达宿主；
 *   格② 累积状态由适配器自己转出（删掉 `callOptions.onDelta` 的转发就红）；
 *   格③ 适配器源码里 `request.onEvent` 出现次数为 0（读文件硬钉，防止空转调用被加回来）。
 *
 * 本文件不连库、不发网络请求：`llmClient` 与 `resolveModel` 都是桩。
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTouwakaProvider } from "../../lib/llm-kit-adapters/provider-adapter.js";

const ADAPTER_PATH = fileURLToPath(
  new URL("../../lib/llm-kit-adapters/provider-adapter.js", import.meta.url),
);

/** 引擎给的 request：字段表照 `provider-runner.js:207-236`，**不带** `onEvent`。 */
function engineRequest(overrides = {}) {
  return {
    system: "You are helpful.",
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    tools: [],
    ...overrides,
  };
}

/**
 * 读 `request.onEvent` 就抛：把「适配器偷偷往宿主推事件」变成运行时红灯，
 * 而不是让它静默变成一次 undefined 调用。
 */
function guardNoOnEvent(request) {
  return new Proxy(request, {
    get(target, key, receiver) {
      if (key === "onEvent") {
        throw new Error(
          "[#1263] provider 契约里没有 onEvent（provider-runner.js:207-236），适配器不得读写 request.onEvent",
        );
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

/** llmClient 桩：按脚本顺序触发 callStream 收到的 options 上的四个回调。 */
function createMockClient(steps) {
  const calls = [];
  return {
    calls,
    async callStream(model, messages, options) {
      calls.push({ model, messages, options });
      for (const step of steps) {
        if (step.type === "delta") options.onDelta?.(step.value);
        if (step.type === "reasoning") options.onReasoningDelta?.(step.value, step.metadata);
        if (step.type === "tool_call") options.onToolCall?.(step.value);
        if (step.type === "usage") options.onUsage?.(step.value);
      }
      return undefined;
    },
  };
}

const STEPS = [
  { type: "delta", value: "hello " },
  { type: "reasoning", value: "think ", metadata: { source: "mock" } },
  {
    type: "tool_call",
    value: {
      index: 0,
      id: "call-1",
      function: { name: "lookup", arguments: '{"query":"touwaka"}' },
    },
  },
  { type: "usage", value: { prompt_tokens: 8, completion_tokens: 5 } },
];

function buildProvider(steps = STEPS) {
  const llmClient = createMockClient(steps);
  const provider = createTouwakaProvider({
    llmClient,
    resolveModel: async () => ({ model_name: "mock-model" }),
  });
  return { llmClient, provider };
}

test("格①：request 不带 onEvent 时 chatStream 不抛，四个契约回调按序到达宿主", async () => {
  const { provider } = buildProvider();
  const observed = [];
  const request = guardNoOnEvent(engineRequest({
    onDelta: (delta) => observed.push(["delta", delta]),
    onReasoningDelta: (delta, metadata) => observed.push(["reasoning_delta", delta, metadata]),
    onToolCall: (fragment) => observed.push(["tool_call", fragment]),
    onUsage: (usage) => observed.push(["usage", usage]),
  }));

  // 不抛就是断言的一部分：旧代码在这里读 request.onEvent（Proxy 会当场抛）。
  const response = await provider.chatStream(request);

  assert.deepEqual(observed, [
    ["delta", "hello "],
    ["reasoning_delta", "think ", { source: "mock" }],
    ["tool_call", { index: 0, id: "call-1", name: "lookup", argumentsDelta: '{"query":"touwaka"}' }],
    ["usage", { prompt_tokens: 8, completion_tokens: 5 }],
  ]);
  assert.equal(typeof response, "object");
  // provider 对象面：只有契约内的两个入口（`chatStream` + `chat`），没有 onEvent 之类的事件口子。
  // `chat` 在 llmClient 没有 `call` 时是个显式抛错的桩（本文件不传 call，所以是桩）。
  assert.deepEqual(Object.keys(provider).sort(), ["chat", "chatStream"]);
  assert.equal(provider.onEvent, undefined);
});

test("格②：适配器自己转出累积状态（删掉 callOptions.onDelta 的转发就红）", async () => {
  const { provider, llmClient } = buildProvider();
  const response = await provider.chatStream(guardNoOnEvent(engineRequest()));

  // 转发链：llmClient 的 options.onDelta → 适配器 callOptions.onDelta（累加 state.text）
  // → 再交给 request.onDelta。这里没有 request.onDelta，所以只剩适配器自己的累积可断言。
  assert.deepEqual(response, {
    content: [
      { type: "reasoning", text: "think " },
      { type: "text", text: "hello " },
      { type: "tool_use", id: "call-1", name: "lookup", input: { query: "touwaka" } },
    ],
    stopReason: "tool_use",
    usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 },
  });
  // llmClient 拿到的 options 必须是适配器包装过的四个回调（不是把 request 直通下去）。
  const [{ options }] = llmClient.calls;
  for (const key of ["onDelta", "onReasoningDelta", "onToolCall", "onUsage"]) {
    assert.equal(typeof options[key], "function", `callOptions.${key} 必须是适配器包装后的函数`);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(options, "onEvent"), false);
});

test("格③：适配器源码里 request.onEvent 出现次数为 0（读文件硬钉，防回归）", async () => {
  const source = await readFile(ADAPTER_PATH, "utf8");

  const literal = source.match(/request\.onEvent/g) ?? [];
  assert.equal(
    literal.length,
    0,
    `适配器里又出现了 ${literal.length} 处 request.onEvent：引擎从不给 provider 传 onEvent，`
      + "这是恒为空转的调用（issue #1263）。增量事件走 onDelta/onReasoningDelta/onToolCall/onUsage，"
      + "宿主事件由引擎包装产生。",
  );

  // 更宽的一网：任何接收者上的 `.onEvent?.()` 可选调用都不许回来（注释里也不许写成这种形状，
  // 否则读代码的人又会以为存在这条通道）。
  const optionalCalls = source.match(/\.onEvent\s*\?\./g) ?? [];
  assert.equal(
    optionalCalls.length,
    0,
    `适配器里出现了 ${optionalCalls.length} 处 .onEvent?.() 可选调用；provider 契约里没有 onEvent。`,
  );
});
