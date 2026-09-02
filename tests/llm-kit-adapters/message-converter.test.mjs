import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalToLegacyMessages,
  legacyRowsToTranscript,
} from "../../lib/llm-kit-adapters/message-converter.js";

test("普通对话按 created_at/id 排序并生成 round 0 种子记录", () => {
  const { runId, records } = legacyRowsToTranscript("request-1", [
    { id: "b", role: "user", content: "", created_at: "2026-08-29T00:00:02.000Z" },
    { id: "a", role: "user", content: "先提供上下文", created_at: "2026-08-29T00:00:01.000Z" },
    { id: "c", role: "assistant", content: "收到", created_at: "2026-08-29T00:00:03.000Z" },
  ]);

  assert.equal(runId, "request-1");
  assert.deepEqual(records.map((record) => record.round), [0, 1]);
  assert.deepEqual(records[0].messages, [
    { role: "user", content: [{ type: "text", text: "先提供上下文" }] },
    { role: "user", content: [] },
  ]);
  assert.deepEqual(records[1].messages, [
    { role: "assistant", content: [{ type: "text", text: "收到" }] },
  ]);
  assert.equal(records[0].ts, "2026-08-29T00:00:01.000Z");
});

test("多轮 tool_calls、tool 结果和非法 arguments 都能转换", () => {
  const invalidCall = {
    id: "call-invalid",
    type: "function",
    function: { name: "broken", arguments: "{oops" },
  };
  const { records } = legacyRowsToTranscript("request-2", [
    {
      id: "u1",
      role: "user",
      content: "执行任务",
      created_at: "2026-08-29T00:01:00.000Z",
    },
    {
      id: "a1",
      role: "assistant",
      content: "开始",
      tool_calls: JSON.stringify([
        {
          id: "call-valid",
          type: "function",
          function: { name: "search", arguments: '{"query":"touwaka"}' },
        },
        invalidCall,
      ]),
      created_at: "2026-08-29T00:01:01.000Z",
    },
    {
      id: "t1",
      role: "tool",
      tool_call_id: "call-valid",
      content: "命中结果",
      created_at: "2026-08-29T00:01:02.000Z",
    },
    {
      id: "a2",
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call-next", function: { name: "done", arguments: "{}" } }],
      created_at: "2026-08-29T00:01:03.000Z",
    },
  ]);

  assert.equal(records.length, 3);
  assert.deepEqual(records[1].messages[1], {
    role: "user",
    content: [{
      type: "tool_result",
      tool_use_id: "call-valid",
      content: "命中结果",
    }],
  });
  assert.deepEqual(records[1].messages[0].content, [
    { type: "text", text: "开始" },
    { type: "tool_use", id: "call-valid", name: "search", input: { query: "touwaka" } },
    { type: "raw", protocol: "openai", payload: invalidCall },
  ]);
  assert.deepEqual(records[2].messages[0].content, [
    { type: "tool_use", id: "call-next", name: "done", input: {} },
  ]);

  const restored = canonicalToLegacyMessages(records);
  assert.deepEqual(
    restored.find((row) => row.role === "assistant" && row.tool_calls?.length === 2).tool_calls[1],
    invalidCall,
  );
});

test("reasoning、inner_voice、usage 和业务元数据进入同一轮", () => {
  const { records } = legacyRowsToTranscript("request-3", [
    {
      id: "a1",
      role: "assistant",
      content: "回答",
      reasoning_content: "先思考",
      inner_voice: "保持谨慎",
      prompt_tokens: 10,
      completion_tokens: 5,
      cost: "0.012300",
      topic_id: "topic-1",
      user_id: "user-1",
      expert_id: "expert-1",
      model_name: "model-1",
      provider_name: "provider-1",
      latency_ms: 321,
      error_info: '{"kind":"none"}',
      is_deleted: false,
      created_at: "2026-08-29T00:02:00.000Z",
    },
  ]);

  assert.deepEqual(records[0].meta, {
    topicId: "topic-1",
    userId: "user-1",
    expertId: "expert-1",
    modelName: "model-1",
    providerName: "provider-1",
    latencyMs: 321,
    isDeleted: false,
    errorInfo: { kind: "none" },
    usage: { prompt_tokens: 10, completion_tokens: 5, cost: "0.012300" },
  });
  assert.deepEqual(records[0].messages[0].content, [
    { type: "text", text: "回答" },
    { type: "reasoning", text: "先思考" },
    { type: "raw", protocol: "touwaka", payload: { kind: "inner_voice", text: "保持谨慎" } },
  ]);

  const incompleteUsage = legacyRowsToTranscript("request-3b", [{
    role: "assistant",
    content: "缺少 cost",
    prompt_tokens: 1,
    completion_tokens: 2,
    created_at: "2026-08-29T00:02:01.000Z",
  }]);
  assert.equal(Object.hasOwn(incompleteUsage.records[0].meta, "usage"), false);
});

test("兼容读取旧 reasoning raw 包装", () => {
  const restored = canonicalToLegacyMessages([{
    round: 1,
    messages: [{
      role: "assistant",
      content: [
        { type: "text", text: "回答" },
        {
          type: "raw",
          protocol: "touwaka",
          payload: { kind: "reasoning", text: "历史思考" },
        },
      ],
    }],
  }]);

  assert.equal(restored[0].reasoning_content, "历史思考");
});

test("孤儿 tool 行归入 round 0", () => {
  const { records } = legacyRowsToTranscript("request-4", [{
    id: "tool-1",
    role: "tool",
    tool_call_id: "missing-assistant",
    content: "孤儿结果",
    created_at: "2026-08-29T00:03:00.000Z",
  }]);

  assert.equal(records.length, 1);
  assert.equal(records[0].round, 0);
  assert.deepEqual(records[0].messages[0], {
    role: "user",
    content: [{
      type: "tool_result",
      tool_use_id: "missing-assistant",
      content: "孤儿结果",
    }],
  });
});

test("legacy → canonical → legacy 保留关键字段", () => {
  const legacyRows = [
    {
      id: "u1",
      role: "user",
      content: "问题",
      topic_id: "topic-roundtrip",
      user_id: "user-roundtrip",
      created_at: "2026-08-29T00:04:00.000Z",
    },
    {
      id: "a1",
      role: "assistant",
      content: "我来处理",
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { name: "lookup", arguments: '{"id":42}' },
      }],
      reasoning_content: "分析参数",
      inner_voice: "需要核实",
      prompt_tokens: 12,
      completion_tokens: 8,
      cost: 0.25,
      topic_id: "topic-roundtrip",
      user_id: "user-roundtrip",
      expert_id: "expert-roundtrip",
      model_name: "model-roundtrip",
      provider_name: "provider-roundtrip",
      latency_ms: 88,
      error_info: { retryable: true },
      is_deleted: false,
      created_at: "2026-08-29T00:04:01.000Z",
    },
    {
      id: "t1",
      role: "tool",
      tool_call_id: "call-1",
      content: "结果",
      created_at: "2026-08-29T00:04:02.000Z",
    },
  ];

  const transcript = legacyRowsToTranscript("request-roundtrip", legacyRows);
  const restored = canonicalToLegacyMessages(transcript.records);
  const restoredAssistant = restored.find((row) => row.role === "assistant");
  const restoredTool = restored.find((row) => row.role === "tool");

  assert.equal(restored.find((row) => row.role === "user").content, "问题");
  assert.equal(restoredAssistant.content, "我来处理");
  assert.deepEqual(restoredAssistant.tool_calls, legacyRows[1].tool_calls);
  assert.equal(restoredAssistant.reasoning_content, "分析参数");
  assert.equal(restoredAssistant.inner_voice, "需要核实");
  assert.equal(restoredAssistant.prompt_tokens, 12);
  assert.equal(restoredAssistant.completion_tokens, 8);
  assert.equal(restoredAssistant.cost, 0.25);
  assert.equal(restoredAssistant.topic_id, "topic-roundtrip");
  assert.deepEqual(restoredAssistant.error_info, { retryable: true });
  assert.equal(restoredTool.tool_call_id, "call-1");
  assert.equal(restoredTool.content, "结果");
});
