/**
 * issue #1214：反思整次静默作废 —— ReflectionService 的 JSON 解析严格度 + 作废口径单测
 *
 * 钉死三件事：
 *   ① **真实失败形状**（13 次 `[ReflectionService] 反思失败: Unexpected non-whitespace character
 *      after JSON at position N`）必须能提取出正确的反思对象，而不是整次作废；
 *   ② **提取后仍解析失败 = 本次反思作废**：`reflect()` 返回 `null`，绝不把
 *      `parseJsonLikeContent` 的 `{ _parse_failed, _raw }` 哨兵、也绝不把「字段全默认值的
 *      假反思」当结果返回；作废日志必须带原文前 200 字（只打 error.message 看不出模型吐了什么）；
 *   ③ **作废不得伪装成成功**：MinimalContextOrganizer 拿到 null 时 `updateFromReflection`
 *      一次都不许调（旧行为是往里写一条假反思），也不许再打「反思完成 (source=psyche)」这条 P0 日志。
 *
 * 全部离线（注入假 llmClient / 假 psycheStore），不需要 MariaDB。
 *
 * Run:
 *   node --test tests/psyche-reflection-json-tolerance.test.mjs
 *   （已登记进 package.json 的 `npm run test:llm-kit` 显式文件清单）
 */

import assert from "node:assert/strict";
import test from "node:test";
import logger from "../lib/logger.js";
import { ReflectionService } from "../lib/psyche/reflection-service.js";
import { PsycheManager } from "../lib/psyche/psyche-manager.js";
import { MinimalContextOrganizer } from "../lib/context-organizer/minimal-organizer.js";

// ─────────────────────────────────────────────────────────────────────────────
// 测试脚手架
// ─────────────────────────────────────────────────────────────────────────────

/** 捕获 logger 输出（reflection-service / minimal-organizer 用的是同一个单例） */
async function withCapturedLogs(run) {
  const levels = ["debug", "info", "warn", "error"];
  const lines = [];
  const saved = levels.map((level) => [level, Object.getOwnPropertyDescriptor(logger, level)]);
  for (const level of levels) {
    logger[level] = (...args) => {
      lines.push(
        args
          .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
          .join(" ")
      );
    };
  }
  try {
    return { result: await run(), lines };
  } finally {
    for (const [level, descriptor] of saved) {
      if (descriptor) Object.defineProperty(logger, level, descriptor);
      else delete logger[level];
    }
  }
}

/** 只回吐一段文本的假 llmClient；error 用来模拟 LLM 调用本身失败（HTTP 404 那类） */
function createFakeLlmClient({ content, error }) {
  const calls = [];
  return {
    calls,
    async callReflective(messages, options) {
      calls.push({ messages, options });
      if (error) throw error;
      return { content };
    },
    async call() {
      throw new Error("ReflectionService 不该走 llmClient.call");
    },
  };
}

function createService(contentOrError) {
  const clientOptions =
    contentOrError instanceof Error ? { error: contentOrError } : { content: contentOrError };
  const llm = createFakeLlmClient(clientOptions);
  const service = new ReflectionService(llm, {
    maxTokens: 1200,
    reflectionContextSize: 8192,
    inputTokenRatio: 0.8,
  });
  return { service, llm };
}

const RECENT_MESSAGES = [
  { role: "user", content: "退款流程要改，先确认口径" },
  { role: "assistant", content: "好的，先确认退款是否只走原路退回" },
];

/** 模型该吐出来的反思对象（真实 schema 的最小子集） */
const REAL_REFLECTION = {
  session_meta: {
    current_topic: "退款流程改造",
    user_intent: "确认退款口径",
    conversation_round: 7,
  },
  methodology: { current_phase: "execution", next_action: "补齐退款单校验" },
  key_exchange: { round: 7, summary: "确认退款只走原路退回" },
  key_decisions: ["退款只走原路退回"],
};
const JSON_TEXT = JSON.stringify(REAL_REFLECTION, null, 2);

/** 六类真实形状（①-⑥ 对应 issue #1214 验收判据 1）；needsRawLog=false 的是空响应，本身无原文可带 */
const SHAPES = [
  { name: "① JSON 后紧跟解释文字", content: `${JSON_TEXT}\n\n希望以上分析有帮助。`, recovers: true },
  { name: "② ```json 围栏之后还有话", content: "```json\n" + JSON_TEXT + "\n```\n\n以上，如需我可以继续拆解。", recovers: true },
  { name: "③ JSON 前多一句引导语", content: `好的，以下是分析：\n${JSON_TEXT}`, recovers: true },
  { name: "④ 前后都有话", content: `好的，以下是分析：\n${JSON_TEXT}\n\n希望以上分析有帮助。`, recovers: true },
  { name: "⑤ 纯文本完全没 JSON", content: "本次对话信息不足，无法给出心神更新，建议补充材料后再试。", recovers: false, needsRawLog: true },
  // ⑥a 走的是 reflect() 里「LLM 返回空内容」那条早退分支，本身没有原文可带
  { name: "⑥a 空串", content: "", recovers: false, needsRawLog: false },
  { name: "⑥b 只有空白", content: "   \n  ", recovers: false, needsRawLog: true },
  { name: "⑥c null", content: null, recovers: false, needsRawLog: false },
];

// ─────────────────────────────────────────────────────────────────────────────
// ① 可恢复形状 + 必须作废形状
// ─────────────────────────────────────────────────────────────────────────────

for (const shape of SHAPES) {
  test(`${shape.name} ⇒ ${shape.recovers ? "提取出正确反思对象" : "反思作废（null + 可诊断日志）"}`, async () => {
    const { service } = createService(shape.content);
    const { result, lines } = await withCapturedLogs(() =>
      service.reflect({}, RECENT_MESSAGES, [], { userId: "u1", expertId: "e1" })
    );

    if (shape.recovers) {
      assert.deepStrictEqual(result, REAL_REFLECTION, "必须提取到模型真正吐出的那个对象");
      assert.equal(result._parse_failed, undefined, "不得把 _parse_failed 哨兵当反思结果");
      assert.equal(result._raw, undefined, "不得把 _raw 哨兵当反思内容");
      assert.ok(!lines.some((line) => line.includes("反思作废")), "能提取就不该报作废");
      return;
    }

    assert.equal(result, null, "提取后仍解析失败 ⇒ 本次反思作废（null）");
    const invalidation = lines.filter((line) => line.includes("反思作废"));
    assert.ok(invalidation.length >= 1, "作废必须有可 grep 的日志，实收：" + JSON.stringify(lines));
    if (shape.needsRawLog) {
      assert.ok(
        invalidation.some((line) => line.includes("原文前 200 字")),
        "作废日志必须带原文片段，实收：" + invalidation.join(" | ")
      );
    }
    assert.ok(!lines.some((line) => line.includes("反思成功生成")), "作废不得同时打成功日志");
  });
}

test("⑤-细节 纯文本作废时，日志里能看到模型实际吐了什么（不只 error.message）", async () => {
  const content = "本次对话信息不足，无法给出心神更新，建议补充材料后再试。";
  const { service } = createService(content);
  const { lines } = await withCapturedLogs(() =>
    service.reflect({}, RECENT_MESSAGES, [], { userId: "u1", expertId: "e1" })
  );
  const invalidation = lines.find((line) => line.includes("反思作废"));
  assert.ok(invalidation.includes("本次对话信息不足"), "原文片段要真的落进日志：" + invalidation);
  assert.ok(invalidation.includes("响应长度="), "要能看出响应规模：" + invalidation);
});

test("①-细节 复现日志指纹：单行 JSON + 紧跟一行正文（logs/ 里 12 次都是 line 2 column 1）", async () => {
  const content = '{"conversation_round": 7}\n补充说明：本轮无需澄清。';
  // 报错位置的算法：JSON 本体结束后的第一个非空白字符——就是换行后的第一个字
  const expectedPosition = content.indexOf("\n") + 1;
  assert.throws(
    () => JSON.parse(content),
    new RegExp(
      `Unexpected non-whitespace character after JSON at position ${expectedPosition} \\(line 2 column 1\\)`
    ),
    "前提：这个形状在裸 JSON.parse 下就是那 13 次的报错形状"
  );
  const { service } = createService(content);
  const reflection = await service.reflect({}, RECENT_MESSAGES, [], { userId: "u1", expertId: "e1" });
  assert.deepStrictEqual(reflection, { conversation_round: 7 });
});

test("未闭合围栏（```json 开头但没有结尾）也能取到对象", async () => {
  const { service } = createService("```json\n" + JSON_TEXT);
  assert.deepStrictEqual(
    await service.reflect({}, RECENT_MESSAGES, [], { userId: "u1", expertId: "e1" }),
    REAL_REFLECTION
  );
});

test("顶层数组不是反思对象 ⇒ 作废（updateFromReflection 对数组只会静默 no-op）", async () => {
  const { service } = createService('[{"session_meta":{"current_topic":"不该被采纳"}}]');
  const { result, lines } = await withCapturedLogs(() =>
    service.reflect({}, RECENT_MESSAGES, [], { userId: "u1", expertId: "e1" })
  );
  assert.equal(result, null);
  assert.ok(lines.some((line) => line.includes("反思作废")));
});

test("LLM 调用本身失败（#1214 里另外 4 次 HTTP 404）⇒ 同样作废，不造默认反思", async () => {
  const { service } = createService(
    new Error('[BaseLLM] Failed after 1 attempts: HTTP 404: {"error":{"code":"one_hub_error"}}')
  );
  const { result, lines } = await withCapturedLogs(() =>
    service.reflect({}, RECENT_MESSAGES, [], { userId: "u1", expertId: "e1" })
  );
  assert.equal(result, null, "调用失败也不得返回默认反思");
  assert.ok(
    lines.some((line) => line.includes("反思作废") && line.includes("one_hub_error")),
    "调用失败的作废日志要带上原始错误"
  );
});

test("response_format 语义未动（红线）：仍然要求 json_object 且透传 max_output_tokens", async () => {
  const { service, llm } = createService(JSON_TEXT);
  await service.reflect({}, RECENT_MESSAGES, [], { userId: "u1", expertId: "e1" });
  assert.equal(llm.calls.length, 1);
  assert.deepStrictEqual(llm.calls[0].options.response_format, { type: "json_object" });
  assert.equal(llm.calls[0].options.max_output_tokens, 1200);
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ 作废在调用方是真的作废（不写假反思、不谎报成功）
// ─────────────────────────────────────────────────────────────────────────────

function createOfflineOrganizer(content) {
  const organizer = new MinimalContextOrganizer(
    {
      expert: { id: "expert_1", prompt_template: "你是测试专家。" },
      expressiveModel: { max_tokens: 8192 },
      reflectiveModel: { model_name: "reflective-test" },
    },
    { enableNotes: false }
  );

  const store = {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    exists: async () => false,
  };
  const psycheManager = new PsycheManager(store, null, {});
  const updates = [];
  const originalUpdate = psycheManager.updateFromReflection.bind(psycheManager);
  psycheManager.updateFromReflection = (psyche, reflection) => {
    updates.push(reflection);
    return originalUpdate(psyche, reflection);
  };

  // _psycheManager 已就位 ⇒ _initialize() 直接返回，不碰 StoreFactory / NotesFacade
  organizer._psycheManager = psycheManager;
  organizer._reflectionService = createService(content).service;
  organizer._getRecentMessages = async () => ({
    messages: RECENT_MESSAGES,
    topics: [{ id: "topic_1", title: "退款流程", message_count: 2 }],
    dialogCount: 2,
  });

  return { organizer, updates };
}

test("反思成功（带尾部解释文字的形状）⇒ updateFromReflection 调一次， Psyche 真被更新", async () => {
  const { organizer, updates } = createOfflineOrganizer(SHAPES[0].content);
  const { result, lines } = await withCapturedLogs(() =>
    organizer.organize({}, "user_1", { expertId: "expert_1", currentMessage: "继续", maxTokens: 4096 })
  );

  assert.equal(updates.length, 1, "有效反思必须落到 updateFromReflection");
  assert.equal(updates[0].session_meta.current_topic, "退款流程改造");
  assert.equal(result.hiddenContext.psyche.session_meta.current_topic, "退款流程改造");
  assert.ok(lines.some((line) => line.includes("反思完成 (source=psyche)")), "成功时才允许报反思完成");
});

test("反思作废（纯文本）⇒ updateFromReflection 一次都没调，且不谎报「反思完成」", async () => {
  const { organizer, updates } = createOfflineOrganizer(SHAPES[4].content);
  const { result, lines } = await withCapturedLogs(() =>
    organizer.organize({}, "user_1", { expertId: "expert_1", currentMessage: "继续", maxTokens: 4096 })
  );

  assert.equal(updates.length, 0, "作废时一次都不许写 psyche（旧行为在这里写了一条假反思）");
  assert.equal(result.hiddenContext.psyche.session_meta.conversation_round, 0, "本轮计数不得被推进");
  assert.equal(result.hiddenContext.psyche.conversation_digest.key_exchanges.length, 0);
  assert.ok(
    lines.some((line) => line.includes("反思作废") && line.includes("本轮不更新 Psyche")),
    "organizer 侧要有自己的作废日志，实收：" + JSON.stringify(lines)
  );
  assert.ok(
    !lines.some((line) => line.includes("反思完成 (source=psyche)")),
    "作废时不得再打 P0 的「反思完成」日志（会谎报成功）"
  );
});

test("反思作废（LLM 调用失败）⇒ 同样一次都不写 psyche", async () => {
  const { organizer, updates } = createOfflineOrganizer(new Error("HTTP 404 one_hub_error"));
  await withCapturedLogs(() =>
    organizer.organize({}, "user_1", { expertId: "expert_1", currentMessage: "继续", maxTokens: 4096 })
  );
  assert.equal(updates.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ reflectBatch：null 占位 + 种子回退
// ─────────────────────────────────────────────────────────────────────────────

test("reflectBatch：作废批次保留 null 占位，下一批种子回退到上一个非空反思", async () => {
  const batchA = JSON.stringify({ session_meta: { current_topic: "批次 A" } });
  const seeds = [];
  let index = 0;
  const outputs = [batchA, "完全没说 JSON 的一批", JSON.stringify({ session_meta: { current_topic: "批次 C" } })];
  const service = new ReflectionService(
    {
      async callReflective(messages) {
        seeds.push(messages[0].content);
        const content = outputs[Math.min(index++, outputs.length - 1)];
        return { content };
      },
    },
    { reflectionContextSize: 8192 }
  );

  const reflections = await service.reflectBatch(
    [
      { role: "user", content: "第一批" },
      { role: "assistant", content: "第一批回复" },
      { role: "user", content: "第二批" },
      { role: "assistant", content: "第二批回复" },
      { role: "user", content: "第三批" },
      { role: "assistant", content: "第三批回复" },
    ],
    2
  );

  assert.equal(reflections.length, 3, "批次数不能因为作废而缩水");
  assert.equal(reflections[1], null, "作废批次必须是 null 占位，不是空对象");
  assert.ok(seeds[1].includes("批次 A"), "第 2 批种子 = 第 1 批的反思");
  assert.ok(seeds[2].includes("批次 A"), "第 2 批作废 ⇒ 第 3 批种子回退到上一个非空反思");
  assert.ok(!seeds[0].includes("批次 A"), "首批种子是空 psyche");
});

// ─────────────────────────────────────────────────────────────────────────────
// 原「已知残留：贪婪花括号匹配」——已由 #1216 平衡扫描修复，断言从「判作废」翻成「解析成功」
// ─────────────────────────────────────────────────────────────────────────────

test("残留已修（#1216）：尾部解释文字里带花括号时提取出正确反思对象，而不是判作废", async () => {
  // 旧断言（#1215 钉住）：`{"score":7,…}\n补充：字段 {next_action} 需要人工确认。`
  // 在贪婪正则下取不出 ⇒ result === null + 「反思作废」日志。
  // #1216 把 lib/json-parse-utils.js 的提取换成字符串感知平衡扫描，这正是本单目标行为：
  // 同一个输入现在必须提取出模型真正吐出的反思对象，且不再报作废。
  const { service } = createService(`${JSON_TEXT}\n补充：字段 {next_action} 需要人工确认。`);
  const { result, lines } = await withCapturedLogs(() =>
    service.reflect({}, RECENT_MESSAGES, [], { userId: "u1", expertId: "e1" })
  );
  assert.deepStrictEqual(result, REAL_REFLECTION, "平衡扫描后这种形状必须提取出正确反思对象，不能再作废");
  assert.equal(result._parse_failed, undefined, "不得把 _parse_failed 哨兵当反思结果");
  assert.ok(!lines.some((line) => line.includes("反思作废")), "能提取就不该报作废");
});
