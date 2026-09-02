import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentLoop } from '../../lib/agent/agent-loop.js';
import logger from '../../lib/logger.js';

logger.logFile = '/tmp/touwaka-agent-loop-erix-test.log';

function createLoop(overrides = {}) {
  return new AgentLoop({
    db: {},
    execute_tools: async () => {
      throw new Error('execute_tools should not be called');
    },
    save_llm_payload: () => {},
    generate_tool_call_summary: () => 'summary',
    ...overrides,
  });
}

function createInput(overrides = {}) {
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
    tools: [{
      type: 'function',
      function: {
        name: 'echo',
        description: 'Echo input',
        parameters: { type: 'object' },
      },
    }],
    currentMessages: [{ role: 'user', content: 'hello' }],
    llmPayload: { _debug: {} },
    user_id: 'user_1',
    expert_id: 'expert_1',
    taskContext: { workspace_mode: 'test' },
    topic_id: 'topic_1',
    task_id: 'task_1',
    session: { accessToken: 'token' },
    request_id: 'request_1',
    ...overrides,
  };
}

function createFakeExpertService({ noTool = false, result = null } = {}) {
  let streamCalls = 0;
  const secondRoundMessages = [];
  const toolCall = {
    id: 'call_1',
    type: 'function',
    function: {
      name: 'echo',
      arguments: '{"value":42}',
    },
  };
  const toolResult = result || {
    success: true,
    data: { value: 42 },
    duration: 12,
    toolCallId: 'call_1',
    toolMessageId: 'tool_msg_1',
    toolName: 'echo',
  };

  const expertService = {
    expertConfig: {
      expert: {
        max_tool_rounds: 5,
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
      async callStream(_modelConfig, messages, options) {
        streamCalls += 1;
        if (streamCalls === 2) secondRoundMessages.push(...messages);
        options.onUsage({
          prompt_tokens: 2,
          completion_tokens: 3,
          total_tokens: 5,
        });
        if (noTool || streamCalls > 1) {
          options.onDelta('任务完成 Final answer');
          return;
        }
        options.onDelta('Need tool');
        options.onReasoningDelta('Thinking');
        options.onToolCall([toolCall]);
      },
    },
    toolManager: {
      formatToolDisplay(toolId) {
        return `Tool: ${toolId}`;
      },
      formatToolResultsForLLM(results) {
        return results.map(item => ({
          role: 'tool',
          tool_call_id: item.toolCallId,
          content: JSON.stringify({
            success: item.success,
            data: item.data,
            error: item.error,
          }),
        }));
      },
    },
    async handleToolCalls(_toolCalls, _userId, _accessToken, _taskContext, _topicId, onToolComplete) {
      await onToolComplete?.(toolResult);
      return [toolResult];
    },
    _consumeDocRetrievalResult() {
      return { found: false };
    },
    getStreamCalls() {
      return streamCalls;
    },
    getSecondRoundMessages() {
      return secondRoundMessages;
    },
  };

  return expertService;
}

test('runErix returns the established result shape after a tool round', async () => {
  const savedPayloads = [];
  const events = [];
  const loop = createLoop({
    save_llm_payload: (_userId, _expertId, payload) => {
      savedPayloads.push(structuredClone(payload));
    },
  });

  const result = await loop.runErix(createFakeExpertService(), createInput({
    onDelta: event => events.push(event),
  }));

  assert.equal(result.fullContent, 'Need tool任务完成 Final answer');
  assert.equal(result.fullReasoningContent, 'Thinking');
  assert.deepEqual(result.tokenUsage, {
    prompt_tokens: 4,
    completion_tokens: 6,
    total_tokens: 10,
  });
  assert.equal(result.allToolCalls.length, 1);
  assert.equal(result.allToolCalls[0].result.data.value, 42);
  assert.equal(result.allToolCalls[0].tool_message_id, 'tool_msg_1');
  assert.ok(result.finalMessages.length > 0);
  assert.equal(result.llmCallsCount, 2);
  assert.equal(savedPayloads.length, 2);
  assert.deepEqual(events.map(event => event.type), [
    'delta',
    'reasoning_delta',
    'tool_call',
    'tool_result',
    'delta',
  ]);
  assert.equal(events[2].toolCalls[0].displayName, 'Tool: echo');
});

test('runErix completion signals finish a no-tool request in one round', async () => {
  const expertService = createFakeExpertService({ noTool: true });
  const result = await createLoop().runErix(expertService, createInput({
    tools: [],
  }));

  assert.equal(expertService.getStreamCalls(), 1);
  assert.equal(result.fullContent, '任务完成 Final answer');
  assert.deepEqual(result.allToolCalls, []);
  assert.equal(result.llmCallsCount, 1);
});

test('runErix maps evidence and multimodal tool results before the next provider request', async () => {
  const evidenceExpert = createFakeExpertService();
  evidenceExpert._consumeDocRetrievalResult = () => ({
    found: true,
    evidenceInjection: 'DOCUMENT EVIDENCE',
    docRetrievalResults: [{ tool_name: 'echo' }],
  });
  const evidenceResult = await createLoop().runErix(evidenceExpert, createInput());
  assert.equal(evidenceResult.fullContent, 'Need tool任务完成 Final answer');
  assert.equal(evidenceExpert.getSecondRoundMessages()[0].role, 'system');
  assert.equal(evidenceExpert.getSecondRoundMessages()[0].content, 'DOCUMENT EVIDENCE');

  const imageExpert = createFakeExpertService({
    result: {
      success: true,
      data: {
        dataUrl: 'data:image/png;base64,aGVsbG8=',
        filename: 'demo.png',
      },
      duration: 1,
      toolCallId: 'call_1',
      toolName: 'echo',
    },
  });
  await createLoop().runErix(imageExpert, createInput({
    modelConfig: {
      model_name: 'vision-model',
      model_type: 'multimodal',
      max_output_tokens: 2048,
    },
  }));
  const syntheticMessage = imageExpert.getSecondRoundMessages().at(-1);
  assert.equal(syntheticMessage.role, 'user');
  assert.equal(syntheticMessage.content[0].type, 'text');
  assert.equal(syntheticMessage.content[1].type, 'image_url');
  assert.equal(
    syntheticMessage.content[1].image_url.url,
    'data:image/png;base64,aGVsbG8=',
  );
});

test('runErix rejects an already stopped request using the run error', async () => {
  await assert.rejects(
    () => createLoop().runErix(createFakeExpertService(), createInput({
      shouldStop: () => true,
    })),
    /Request aborted by user/,
  );
});

test('runErix maps a retryable provider failure to recovering and recovered SSE events', async () => {
  const previousBaseDelay = process.env.CHAT_STREAM_RECOVERY_BASE_DELAY_MS;
  const previousMaxDelay = process.env.CHAT_STREAM_RECOVERY_MAX_DELAY_MS;
  process.env.CHAT_STREAM_RECOVERY_BASE_DELAY_MS = '0';
  process.env.CHAT_STREAM_RECOVERY_MAX_DELAY_MS = '0';

  try {
    const expertService = createFakeExpertService({ noTool: true });
    let calls = 0;
    expertService.llmClient.callStream = async (_modelConfig, _messages, options) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('socket hang up');
        error.code = 'ECONNRESET';
        throw error;
      }
      options.onDelta('Recovered');
    };

    const events = [];
    const result = await createLoop().runErix(expertService, createInput({
      tools: [],
      onDelta: event => events.push(event),
    }));

    assert.equal(calls, 2);
    assert.equal(result.fullContent, 'Recovered');
    assert.deepEqual(events.map(event => event.type), [
      'recovering',
      'recovered',
      'delta',
    ]);
    assert.equal(events[0].max_attempts, 2);
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
});

test('run and runErix preserve key behavior for the same mock input', async () => {
  const oldEvents = [];
  const oldExpert = createFakeExpertService();
  const oldLoop = createLoop({
    db: {
      getModel() {
        return {};
      },
    },
    execute_tools: async (_expertService, input) => {
      const result = {
        success: true,
        data: { value: 42 },
        duration: 12,
        toolCallId: 'call_1',
        toolMessageId: 'tool_msg_1',
        toolName: 'echo',
      };
      input.onDelta?.({ type: 'tool_result', result });
      return [result];
    },
  });
  const oldResult = await oldLoop.run(oldExpert, createInput({
    onDelta: event => oldEvents.push(event),
  }));

  const erixEvents = [];
  const erixResult = await createLoop().runErix(
    createFakeExpertService(),
    createInput({ onDelta: event => erixEvents.push(event) }),
  );

  assert.equal(erixResult.fullContent, oldResult.fullContent);
  assert.equal(erixResult.fullReasoningContent, oldResult.fullReasoningContent);
  assert.deepEqual(erixResult.tokenUsage, oldResult.tokenUsage);
  assert.equal(erixResult.llmCallsCount, oldResult.llmCallsCount);
  assert.deepEqual(
    erixResult.allToolCalls.map(call => ({
      id: call.id,
      name: call.function.name,
      data: call.result.data,
      duration: call.duration,
      tool_message_id: call.tool_message_id,
    })),
    oldResult.allToolCalls.map(call => ({
      id: call.id,
      name: call.function.name,
      data: call.result.data,
      duration: call.duration,
      tool_message_id: call.tool_message_id,
    })),
  );
  assert.deepEqual(erixEvents.map(event => event.type), oldEvents.map(event => event.type));
  assert.ok(erixResult.finalMessages.length > 0);
});
