import test from "node:test";
import assert from "node:assert/strict";

// 上游 v0.54.0 #464「有界压缩」在本副本的落点：默认路径不变，显式 hardBudget 才继续往里折。
// 设计依据见 docs/design/2026-07-29-llm-kit-upstream-delta-2026-07-29.md 的 §2.5 / §3 Phase 1。

import { compactHistory, estimateMessageTokens } from "../../lib/agent/history-compactor.js";

const BIG = "x".repeat(20000); // 一条大工具输出 ≈ 14700 估算 token

/** system + user + N 轮（assistant + 一条大 tool 输出），构造「折到 keepRounds 仍超预算」的场景。 */
function history(rounds = 5) {
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "任务描述" },
  ];
  for (let i = 0; i < rounds; i += 1) {
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [{ id: `t${i}`, type: "function", function: { name: "read_file", arguments: "{}" } }],
    });
    messages.push({ role: "tool", tool_call_id: `t${i}`, name: "read_file", content: BIG });
  }
  return messages;
}

test("默认（不给 hardBudget）：只折到 keepRounds，与既有行为一致", () => {
  const input = history(5);
  const out = compactHistory(input, { budgetTokens: 1000, keepRounds: 2 });
  assert.equal(out.compacted, true);
  assert.equal(out.foldedRounds, 3, "5 轮保 2 ⇒ 折 3，不因为加了能力就默改生产行为");
  assert.equal(out.stillOverBudget, true, "折完仍超预算 ⇒ 如实报，不再给「已压缩」这个假绿灯");
});

test("给了 hardBudget：继续往里折直到进预算，且保住 1 轮的下界", () => {
  const input = history(5);
  const out = compactHistory(input, { budgetTokens: 1000, keepRounds: 2, hardBudgetTokens: 20000 });
  assert.equal(out.foldedRounds, 4, "保 2 轮仍 29k > 20k ⇒ 再折一轮");
  assert.ok(out.tokensAfter <= 20000, `tokensAfter=${out.tokensAfter} 应进 hardBudget`);
  assert.equal(out.stillOverBudget, false);
  assert.equal(out.messages.filter((m) => m.role === "tool").length, 1, "保留轮次仍是完整配对，不留孤儿 tool");
});

test("hardBudget 不可达：折到只剩 1 轮就停（必然终止，不打转）", () => {
  const input = history(5);
  const out = compactHistory(input, { budgetTokens: 1000, keepRounds: 2, hardBudgetTokens: 1 });
  assert.equal(out.foldedRounds, 4, "下界是保 1 轮，不会把最近状态也吃掉");
  assert.equal(out.stillOverBudget, true, "到不了预算就如实说，让调用方决定截断/中止");
  assert.equal(out.messages[out.messages.length - 1].role, "tool");
});

test("头部任务消息与保留轮次结构不被破坏", () => {
  const input = history(5);
  const out = compactHistory(input, { budgetTokens: 1000, keepRounds: 2, hardBudgetTokens: 20000 });
  assert.deepEqual(out.messages.slice(0, 2), input.slice(0, 2), "system + 首条 user 永不折叠");
  assert.equal(out.messages[2].role, "system", "摘要以 system 注入在保留头部之后");
  assert.equal(out.messages[3].role, "assistant", "摘要之后紧接保留轮次，assistant 先于其 tool");
});

test("未超预算时早退，返回形状不变（不因新字段被动到）", () => {
  const out = compactHistory(history(3), { budgetTokens: 10_000_000, keepRounds: 2 });
  assert.equal(out.compacted, false);
  assert.equal("stillOverBudget" in out, false, "没压过就不报这个键");
  assert.equal(estimateMessageTokens(out.messages), out.tokensAfter);
});
