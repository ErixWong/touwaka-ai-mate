/**
 * Tests for AgentLoop.
 *
 * Usage:
 *   node tests/test-agent-loop.mjs
 */

import assert from 'node:assert/strict';
import { AgentLoop } from '../lib/agent/agent-loop.js';

function createLoop(overrides = {}) {
  return new AgentLoop({
    db: {
      getModel() {
        return {};
      },
    },
    execute_tools: async () => {
      throw new Error('execute_tools should not be called');
    },
    save_llm_payload: () => {},
    generate_tool_call_summary: () => 'summary',
    ...overrides,
  });
}

function createExpertService() {
  return {
    expertConfig: {
      expert: {
        max_tool_rounds: 3,
        context_strategy: 'full',
      },
    },
    llmClient: {
      getExpertLLMParams() {
        return {
          temperature: 0.7,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
        };
      },
      async callStream(_modelConfig, _messages, options) {
        options.onDelta('Hello');
        options.onReasoningDelta('Thinking');
        options.onUsage({
          prompt_tokens: 2,
          completion_tokens: 3,
          total_tokens: 5,
        });
      },
    },
  };
}

function createToolLoopExpertService() {
  let streamCalls = 0;
  const toolCall = {
    id: 'call_1',
    type: 'function',
    function: {
      name: 'demo_tool',
      arguments: '{}',
    },
  };

  return {
    expertConfig: {
      expert: {
        max_tool_rounds: 3,
        context_strategy: 'full',
      },
    },
    llmClient: {
      getExpertLLMParams() {
        return {
          temperature: 0.7,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
        };
      },
      async callStream(_modelConfig, _messages, options) {
        streamCalls += 1;
        if (streamCalls === 1) {
          options.onDelta('Need tool');
          options.onToolCall([toolCall]);
          return;
        }

        // 含 R16-3 完成信号，第 2 次调用后应判定任务完成
        options.onDelta('任务完成 Final answer');
      },
    },
    toolManager: {
      formatToolDisplay(toolId) {
        return `Tool: ${toolId}`;
      },
      formatToolResultsForLLM(toolResults) {
        return toolResults.map(result => ({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: JSON.stringify(result.data),
        }));
      },
    },
    _consumeDocRetrievalResult() {
      return { found: false };
    },
    getStreamCalls() {
      return streamCalls;
    },
  };
}

function createRunInput(overrides = {}) {
  return {
    modelConfig: {
      model_name: 'test-model',
      max_output_tokens: 2048,
    },
    thinkingConfig: {
      thinking: false,
      reasoning: null,
      reasoning_effort: null,
      enable_thinking: false,
      chat_template_kwargs: null,
    },
    tools: [],
    currentMessages: [{ role: 'user', content: 'hello' }],
    llmPayload: {
      _debug: {},
    },
    user_id: 'user_1',
    expert_id: 'expert_1',
    taskContext: null,
    topic_id: 'topic_1',
    task_id: null,
    session: {},
    request_id: 'request_1',
    ...overrides,
  };
}

async function testRunCompletesSingleRoundWithoutTools() {
  const deltas = [];
  const savedPayloads = [];
  const loop = createLoop({
    save_llm_payload: (...args) => savedPayloads.push(args),
  });

  const result = await loop.run(createExpertService(), createRunInput({
    onDelta: event => deltas.push(event),
  }));

  assert.equal(result.fullContent, 'Hello');
  assert.equal(result.fullReasoningContent, 'Thinking');
  assert.deepEqual(result.tokenUsage, {
    prompt_tokens: 2,
    completion_tokens: 3,
    total_tokens: 5,
  });
  assert.equal(result.llmCallsCount, 1);
  assert.deepEqual(result.allToolCalls, []);
  assert.deepEqual(deltas.map(event => event.type), ['delta', 'reasoning_delta']);
  assert.equal(savedPayloads.length, 1);
  assert.equal(savedPayloads[0][0], 'user_1');
  assert.equal(savedPayloads[0][1], 'expert_1');
  assert.equal(savedPayloads[0][2].messages.at(-1).content, 'Hello');
}

async function testRunCanBeStoppedBeforeLlmCall() {
  const loop = createLoop();

  await assert.rejects(() => loop.run(createExpertService(), createRunInput({
    shouldStop: () => true,
  })), /Request aborted by user/);
}

async function testRunExecutesToolsAndContinuesToNextRound() {
  const executedToolInputs = [];
  const deltas = [];
  const savedPayloads = [];
  const expertService = createToolLoopExpertService();
  const loop = createLoop({
    execute_tools: async (_expertService, input) => {
      executedToolInputs.push(input);
      return [{
        success: true,
        data: { value: 42 },
        duration: 12,
        toolCallId: 'call_1',
        toolMessageId: 'tool_msg_1',
      }];
    },
    save_llm_payload: (user_id, expert_id, payload) => {
      savedPayloads.push([user_id, expert_id, JSON.parse(JSON.stringify(payload))]);
    },
  });

  const result = await loop.run(expertService, createRunInput({
    tools: [{ type: 'function', function: { name: 'demo_tool' } }],
    onDelta: event => deltas.push(event),
  }));

  assert.equal(expertService.getStreamCalls(), 2);
  assert.equal(executedToolInputs.length, 1);
  assert.equal(executedToolInputs[0].collectedToolCalls.length, 1);
  assert.equal(executedToolInputs[0].collectedToolCalls[0].function.name, 'demo_tool');
  assert.equal(result.fullContent, 'Need tool任务完成 Final answer');
  assert.equal(result.allToolCalls.length, 1);
  assert.equal(result.allToolCalls[0].result.data.value, 42);
  assert.deepEqual(deltas.map(event => event.type), ['delta', 'tool_call', 'delta']);
  assert.equal(deltas[1].toolCalls[0].displayName, 'Tool: demo_tool');
  assert.equal(savedPayloads.length, 2);
  assert.equal(savedPayloads[0][2].messages.at(-1).role, 'tool');
  assert.equal(savedPayloads[1][2].messages.at(-1).content, '任务完成 Final answer');
}

async function testRunRecoversRetryableStreamFailure() {
  const previousBaseDelay = process.env.CHAT_STREAM_RECOVERY_BASE_DELAY_MS;
  const previousMaxDelay = process.env.CHAT_STREAM_RECOVERY_MAX_DELAY_MS;
  process.env.CHAT_STREAM_RECOVERY_BASE_DELAY_MS = '0';
  process.env.CHAT_STREAM_RECOVERY_MAX_DELAY_MS = '0';

  try {
    let streamCalls = 0;
    const expertService = createExpertService();
    expertService.llmClient.callStream = async (_modelConfig, _messages, options) => {
      streamCalls += 1;
      if (streamCalls === 1) {
        options.onDelta('Partial');
        const error = new Error('socket hang up');
        error.code = 'ECONNRESET';
        throw error;
      }

      options.onDelta('Recovered');
    };

    const deltas = [];
    const loop = createLoop();
    const result = await loop.run(expertService, createRunInput({
      onDelta: event => deltas.push(event),
    }));

    assert.equal(streamCalls, 2);
    assert.equal(result.fullContent, 'Recovered');
    assert.deepEqual(deltas.map(event => event.type), [
      'delta',
      'recovering',
      'recovered',
      'delta',
    ]);
    assert.equal(deltas[1].content, '');
    assert.equal(deltas[1].reasoning_content, '');
  } finally {
    if (previousBaseDelay === undefined) {
      delete process.env.CHAT_STREAM_RECOVERY_BASE_DELAY_MS;
    } else {
      process.env.CHAT_STREAM_RECOVERY_BASE_DELAY_MS = previousBaseDelay;
    }
    if (previousMaxDelay === undefined) {
      delete process.env.CHAT_STREAM_RECOVERY_MAX_DELAY_MS;
    } else {
      process.env.CHAT_STREAM_RECOVERY_MAX_DELAY_MS = previousMaxDelay;
    }
  }
}

async function testRunInjectsDocumentEvidenceBeforeNextRound() {
  let streamCalls = 0;
  const secondRoundMessages = [];
  const expertService = createToolLoopExpertService();
  expertService.llmClient.callStream = async (_modelConfig, messages, options) => {
    streamCalls += 1;
    if (streamCalls === 1) {
      options.onToolCall([{
        id: 'call_doc',
        type: 'function',
        function: {
          name: 'search_documents',
          arguments: '{}',
        },
      }]);
      return;
    }

    secondRoundMessages.push(...messages);
    options.onDelta('任务完成 Answer with evidence');
  };
  expertService._consumeDocRetrievalResult = () => ({
    found: true,
    evidenceInjection: 'DOCUMENT EVIDENCE',
    docRetrievalResults: [{ tool_name: 'search_documents' }],
    chainHealth: { pattern: 'metadata_only' },
  });

  const loop = createLoop({
    execute_tools: async () => [{
      success: true,
      skill_namespace: 'document_retrieval',
      data: { items: [] },
      duration: 1,
      toolCallId: 'call_doc',
    }],
  });

  const result = await loop.run(expertService, createRunInput({
    tools: [{ type: 'function', function: { name: 'search_documents' } }],
  }));

  assert.equal(result.fullContent, '任务完成 Answer with evidence');
  assert.equal(secondRoundMessages[0].role, 'system');
  assert.equal(secondRoundMessages[0].content, 'DOCUMENT EVIDENCE');
}

async function testRunInjectsImageUserMessageBeforeNextRound() {
  let streamCalls = 0;
  const secondRoundMessages = [];
  const expertService = createToolLoopExpertService();
  expertService.llmClient.callStream = async (_modelConfig, messages, options) => {
    streamCalls += 1;
    if (streamCalls === 1) {
      options.onToolCall([{
        id: 'call_image',
        type: 'function',
        function: {
          name: 'draw_image',
          arguments: '{}',
        },
      }]);
      return;
    }

    secondRoundMessages.push(...messages);
    options.onDelta('任务完成 Image analyzed');
  };

  const loop = createLoop({
    execute_tools: async () => [{
      success: true,
      toolName: 'draw_image',
      data: {
        dataUrl: 'data:image/png;base64,aGVsbG8=',
        filename: 'demo.png',
      },
      duration: 1,
      toolCallId: 'call_image',
    }],
  });

  const result = await loop.run(expertService, createRunInput({
    modelConfig: {
      model_name: 'vision-model',
      model_type: 'multimodal',
      max_output_tokens: 2048,
    },
    tools: [{ type: 'function', function: { name: 'draw_image' } }],
  }));

  assert.equal(result.fullContent, '任务完成 Image analyzed');
  const syntheticMessage = secondRoundMessages.at(-1);
  assert.equal(syntheticMessage.role, 'user');
  assert.equal(syntheticMessage._synthetic, true);
  assert.equal(syntheticMessage.content[0].type, 'text');
  assert.equal(syntheticMessage.content[1].type, 'image_url');
  assert.equal(syntheticMessage.content[1].image_url.url, 'data:image/png;base64,aGVsbG8=');
}

async function testRunMergesAdjacentAssistantMessages() {
  // R16-3: 已有工具调用后连续出现"无工具调用且无完成信号"的过渡文本轮时，
  // 追加 assistant 前应合并到上一轮 assistant 消息，避免消息列表末尾出现
  // 相邻 assistant（OpenAI 兼容 provider 报 400）。
  let streamCalls = 0;
  let lastPayload = null;
  const expertService = createToolLoopExpertService();
  expertService.llmClient.callStream = async (_modelConfig, messages, options) => {
    streamCalls += 1;
    if (streamCalls === 1) {
      options.onToolCall([{
        id: 'call_1',
        type: 'function',
        function: { name: 'demo_tool', arguments: '{}' },
      }]);
      return;
    }
    // 后续轮：过渡文本，不调用工具、不含完成信号
    options.onDelta(`Transition text ${streamCalls}`);
  };
  expertService.expertConfig.expert.max_tool_rounds = 10;

  const loop = createLoop({
    execute_tools: async () => [{
      success: true,
      data: { value: 42 },
      duration: 12,
      toolCallId: 'call_1',
      toolMessageId: 'tool_msg_1',
    }],
    save_llm_payload: (_user_id, _expert_id, payload) => {
      lastPayload = JSON.parse(JSON.stringify(payload));
    },
  });

  const result = await loop.run(expertService, createRunInput({
    tools: [{ type: 'function', function: { name: 'demo_tool' } }],
  }));

  // 1 工具轮 + 4 轮过渡文本（consecutiveNoToolRounds 在判断后才递增，
  // 第 4 轮进入时计数=3 触发 MAX_CONSECUTIVE_NO_TOOL_ROUNDS=3 强制结束）
  assert.equal(result.llmCallsCount, 5);
  assert.ok(lastPayload, '应有 payload 保存');

  const msgs = lastPayload.messages;
  // 相邻 assistant 必须合并：任何位置都不应有两条相邻的 assistant 消息
  for (let i = 1; i < msgs.length; i++) {
    assert.ok(
      !(msgs[i].role === 'assistant' && msgs[i - 1].role === 'assistant'),
      `不应存在相邻 assistant 消息 @${i - 1}-${i}`
    );
  }
  // 尾部应是合并后的单条 assistant（含全部过渡文本）
  assert.equal(msgs.at(-1).role, 'assistant');
  assert.match(msgs.at(-1).content, /Transition text 2/);
  assert.match(msgs.at(-1).content, /Transition text 3/);
  assert.match(msgs.at(-1).content, /Transition text 4/);
  assert.match(msgs.at(-1).content, /Transition text 5/);
}

async function main() {
  await testRunCompletesSingleRoundWithoutTools();
  await testRunCanBeStoppedBeforeLlmCall();
  await testRunExecutesToolsAndContinuesToNextRound();
  await testRunRecoversRetryableStreamFailure();
  await testRunInjectsDocumentEvidenceBeforeNextRound();
  await testRunInjectsImageUserMessageBeforeNextRound();
  await testRunMergesAdjacentAssistantMessages();

  console.log('Agent loop tests passed.');
}

main();
