import test from "node:test";
import assert from "node:assert/strict";

// 上游 v0.54.0 #464「有界压缩」在本副本的落点：默认路径不变，显式 hardBudget 才继续往里折。
// 设计依据见 docs/design/2026-07-29-llm-kit-upstream-delta-2026-07-29.md 的 §2.5 / §3 Phase 1。
//
// issue #1307 —— 把「头部任务消息与保留轮次结构不被破坏」那条从位置快照改成结构不变量：
// commit 06d8d46（#1293）把折叠摘要插到「头部连续 system 段末尾」（history-compactor.js:179-187），
// 因为放会话中段会被上游 HTTP 400 System message must be at the beginning 打死。原来的三条快照
// （slice(0,2) 相等 / 摘要在 index2 / index3=assistant）钉的是具体下标，摘要一往前提就红、且红了也说不清钉的是什么。
// 现换成六条可判定不变量：原头部 system 在 index0 / system 全在开头连续段 / 摘要恰 1 条且在开头段 /
// 任务描述逐字仍在且在摘要之后保留轮次之前 / 保留轮次配对完整无孤儿且轮数不超 keepRounds / 整体 role 形状。

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

// ── #1307：把「位置快照」换成结构不变量（见文件头注释）──
const SUMMARY_MARK = "上下文压缩";
const isSummary = (m) => m.role === "system" && typeof m.content === "string" && m.content.includes(SUMMARY_MARK);

/** 复现原快照那条用例的固定场景：折到 keepRounds 仍超预算、hardBudget 继续往里折。 */
function compressed() {
  return compactHistory(history(5), { budgetTokens: 1000, keepRounds: 2, hardBudgetTokens: 20000 });
}

/** 开头连续 system 段的边界 k = 第一个非 system 的下标。 */
function leadingSystemEnd(messages) {
  let k = 0;
  while (k < messages.length && messages[k].role === "system") k += 1;
  return k;
}

// 不变量 1：原头部 system 逐字仍在 index 0。
test("不变量1：原头部 system 逐字仍在 index 0", () => {
  const input = history(5);
  const { messages } = compressed();
  assert.equal(messages[0].role, "system", "原头部 system 消息必须在 index 0，不许被动到");
  assert.equal(messages[0].content, input[0].content, "index 0 的 system 内容必须逐字仍是原始头部 system");
});

// 不变量 2：所有 system 都在开头连续段内——第一个非 system 之后不许再出现 system。
test("不变量2：system 只出现在开头连续段内（摘要落到会话中段会让上游 HTTP 400）", () => {
  const { messages } = compressed();
  const k = leadingSystemEnd(messages);
  for (let i = k; i < messages.length; i += 1) {
    assert.notEqual(messages[i].role, "system",
      `system 出现在会话中段（index ${i}）——上游 OpenAI 兼容 provider 会直接 HTTP 400 System message must be at the beginning`);
  }
});

// 不变量 3：折叠摘要恰好 1 条，且落在开头连续 system 段内。
test("不变量3：折叠摘要恰好 1 条且落在开头连续 system 段内", () => {
  const { messages } = compressed();
  const k = leadingSystemEnd(messages);
  const summaryIdx = messages.map((m, i) => (isSummary(m) ? i : -1)).filter((i) => i >= 0);
  assert.equal(summaryIdx.length, 1, "折叠摘要必须恰好 1 条，不许 0 条或多条");
  assert.ok(summaryIdx[0] < k,
    `折叠摘要（index ${summaryIdx[0]}）必须落在开头连续 system 段内（下标 < 第一个非 system 的 ${k}），不许落到会话中段`);
});

// 不变量 4：任务描述逐字仍在，且位于「摘要之后、保留轮次之前」。
test("不变量4：任务描述逐字仍在，且位于摘要之后、保留轮次之前", () => {
  const { messages } = compressed();
  const summaryIdx = messages.findIndex((m) => isSummary(m));
  const taskIdx = messages.findIndex((m) => m.role === "user" && m.content === "任务描述");
  assert.notEqual(taskIdx, -1, "任务描述必须逐字仍在压缩后的上下文里，不许被折叠吃掉");
  assert.ok(summaryIdx >= 0 && taskIdx > summaryIdx,
    `任务描述（index ${taskIdx}）必须在折叠摘要（index ${summaryIdx}）之后`);
  const keptStart = messages.findIndex((m, i) => i > taskIdx && (m.role === "assistant" || m.role === "tool"));
  assert.ok(keptStart > taskIdx,
    `任务描述（index ${taskIdx}）必须在保留轮次（起点 index ${keptStart}）之前`);
});

// 不变量 5：保留轮次 assistant/tool 配对完整无孤儿，保留轮数 = 总轮数 - 已折叠，且 <= keepRounds。
test("不变量5：保留轮次 assistant/tool 配对完整无孤儿，保留轮数不超 keepRounds", () => {
  const out = compressed();
  const { messages } = out;
  const taskIdx = messages.findIndex((m) => m.role === "user" && m.content === "任务描述");
  const kept = messages.slice(taskIdx + 1);
  const calledIds = [];
  for (const m of kept) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) for (const c of m.tool_calls) calledIds.push(c.id);
  }
  const answeredIds = kept.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
  for (const id of calledIds) {
    assert.ok(answeredIds.includes(id), `保留轮次里 assistant 的 tool_call ${id} 没有对应 tool 响应（孤儿请求），配对不完整`);
  }
  for (const m of kept) {
    if (m.role === "tool") {
      assert.ok(calledIds.includes(m.tool_call_id),
        `保留轮次里有孤儿 tool（tool_call_id=${m.tool_call_id}）没有对应的 assistant.tool_calls`);
    }
  }
  const keptRounds = calledIds.length; // fixture 每轮恰 1 个 tool_call，可作轮数代理
  assert.equal(keptRounds, 5 - out.foldedRounds,
    `保留轮数(${keptRounds}) 必须 = 总轮数(5) - 已折叠(${out.foldedRounds})`);
  assert.ok(keptRounds <= 2, `保留轮数(${keptRounds}) 不许超过 keepRounds=2（hardBudget 只会往里折、不会多保）`);
});

// 不变量 6：整体 role 形状 system* -> user -> (assistant|tool)*。
test("不变量6：整体 role 形状为 system* -> user -> (assistant|tool)*", () => {
  const { messages } = compressed();
  const k = leadingSystemEnd(messages);
  assert.ok(k >= 1, "开头必须是 system 段");
  assert.equal(messages[k].role, "user",
    `开头 system 段之后第一个必须紧接任务 user（index ${k} 收到 ${messages[k] && messages[k].role}）`);
  for (let i = k + 1; i < messages.length; i += 1) {
    assert.ok(messages[i].role === "assistant" || messages[i].role === "tool",
      `任务 user 之后只许 assistant/tool，index ${i} 收到 ${messages[i].role}`);
  }
});

test("未超预算时早退，返回形状不变（不因新字段被动到）", () => {
  const out = compactHistory(history(3), { budgetTokens: 10_000_000, keepRounds: 2 });
  assert.equal(out.compacted, false);
  assert.equal("stillOverBudget" in out, false, "没压过就不报这个键");
  assert.equal(estimateMessageTokens(out.messages), out.tokensAfter);
});
