import test from "node:test";
import assert from "node:assert/strict";

// 上游 v0.52.0 #422 的对应件：provider 只回 reasoning 时给出可判定的标记。
// 设计依据见 docs/design/2026-07-29-llm-kit-upstream-delta-2026-07-29.md 的 §2.7 / §3 Phase 1。

import { toChatResponse } from "../../lib/llm-kit-adapters/provider-adapter.js";

test("只回 reasoning ⇒ 打 providerThinkingOnly 标记，但 stopReason 不撒谎", () => {
  const res = toChatResponse(
    { choices: [{ message: { reasoning_content: "我在想……", content: "" } }] },
    "end_turn",
  );
  assert.equal(res.providerThinkingOnly, true);
  assert.equal(res.stopReason, "end_turn", "只加标记，不改 stopReason ⇒ 既有按 stopReason 分支的消费方零行为变化");
  assert.deepEqual(res.content, [{ type: "reasoning", text: "我在想……" }]);
});

test("空白正文（只有空格）也算没落地答案", () => {
  const res = toChatResponse(
    { choices: [{ message: { reasoning_content: "想", content: "   " } }] },
    "end_turn",
  );
  assert.equal(res.providerThinkingOnly, true, "provider 回了三个空格就当成答案，用户看到的是空白回复");
});

test("有真答案 / 有 tool_use ⇒ 不写这个键（不是写 false，既有 deepEqual 断言不受影响）", () => {
  const withText = toChatResponse({ choices: [{ message: { content: "答案是 42" } }] }, "end_turn");
  assert.equal("providerThinkingOnly" in withText, false);

  const withTool = toChatResponse({
    choices: [{ message: { content: "", tool_calls: [{ id: "t1", function: { name: "shell", arguments: '{"a":1}' } }] } }],
  }, "end_turn");
  assert.equal("providerThinkingOnly" in withTool, false);
  assert.equal(withTool.stopReason, "tool_use");
  assert.deepEqual(withTool.content[0].input, { a: 1 });
});

test("content 已是块数组时同样能判定（Anthropic 风格分块）", () => {
  const res = toChatResponse(
    { choices: [{ message: { content: [{ type: "reasoning", text: "想" }] } }] },
    "end_turn",
  );
  assert.equal(res.providerThinkingOnly, true);
});

test("既 reasoning 又落地下文 ⇒ 不打标记（不是「只有」思考）", () => {
  const res = toChatResponse(
    { choices: [{ message: { reasoning_content: "想", content: "所以答案是 42" } }] },
    "end_turn",
  );
  assert.equal("providerThinkingOnly" in res, false);
  assert.equal(res.content.length, 2);
});

test("顺带把 #463 串起来：响应里的 usage 一并派生 total", () => {
  const res = toChatResponse(
    { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
    "end_turn",
  );
  assert.equal(res.usage.total_tokens, 120);
});
