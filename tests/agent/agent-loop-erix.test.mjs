import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';

import { openTestDatabase, DEFAULT_CREDS_PATH } from '../helpers/test-db-guard.mjs';
import { AgentLoop } from '../../lib/agent/agent-loop.js';
import { buildErixRunOptions } from '../../lib/llm-kit-adapters/loop-bridge.js';
import logger from '../../lib/logger.js';

logger.logFile = '/tmp/touwaka-agent-loop-erix-test.log';

// issue #1167：目标库必须是测试库。openTestDatabase() 内部先跑硬断言
//（tests/helpers/test-db-guard.mjs），白名单（llm_kit_test）不命中就在**建连接之前**抛错终止，
// 不会静默把破坏性测试打到生产库。凭据文件缺失时返回 null → 用例 skip（保持原行为）。
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;
let testDb = null;
let testUserId = null;
let testExpertId = null;

if (dbCtx) {
  testDb = dbCtx.db;
  const [users] = await testDb.sequelize.query('SELECT id FROM users LIMIT 1');
  const [experts] = await testDb.sequelize.query('SELECT id FROM experts LIMIT 1');
  testUserId = users[0]?.id ?? 'test_user_agent_e2e';
  testExpertId = experts[0]?.id ?? null;
}

async function cleanupRun(requestId) {
  if (!testDb) return;
  const [rounds] = await testDb.sequelize.query(
    'SELECT id FROM agent_rounds WHERE request_id = :requestId',
    { replacements: { requestId } },
  );
  const roundIds = rounds.map((row) => row.id);
  if (roundIds.length > 0) {
    await testDb.sequelize.query(
      'DELETE FROM messages WHERE round_id IN (:roundIds)',
      { replacements: { roundIds } },
    );
    await testDb.sequelize.query(
      'DELETE FROM chat_tool_calls WHERE round_id IN (:roundIds)',
      { replacements: { roundIds } },
    );
  }
  await testDb.sequelize.query(
    'DELETE FROM agent_rounds WHERE request_id = :requestId',
    { replacements: { requestId } },
  );
}

after(async () => {
  if (testDb) await testDb.close();
});

function createLoop(overrides = {}) {
  return new AgentLoop({
    db: {},
    execute_tools: async (expertService, input) => {
      const call = input.collectedToolCalls[0];
      const result = expertService.createToolResult(call);
      input.onDelta?.({ type: 'tool_result', result });
      return [result];
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
      context_window_tokens: 32768,
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

async function withEnv(name, value, callback) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

function createFakeExpertService({ noTool = false, result = null, toolCallId = 'call_1' } = {}) {
  let streamCalls = 0;
  const secondRoundMessages = [];
  const toolCall = {
    id: toolCallId,
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
    createToolResult(call) {
      return {
        ...toolResult,
        toolCallId: call.id,
        toolName: call.name,
      };
    },
    async handleToolCalls() {
      throw new Error('runErix should use execute_tools');
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

test('runErix persists a real tool round in all transcript tables', {
  skip: creds ? false : `缺少凭据 ${CREDS_PATH}`,
}, async () => {
  const requestId = `run-${randomUUID()}`;
  const toolCallId = `tool-${randomUUID().slice(0, 8)}`;

  try {
    const input = createInput({
      user_id: testUserId,
      expert_id: testExpertId,
      topic_id: null,
      request_id: requestId,
    });
    const engineOptions = buildErixRunOptions({
      provider: {},
      executeTool: async () => 'unused',
      modelConfig: input.modelConfig,
    });
    assert.deepEqual(engineOptions.modelMetadata, {
      contextWindowTokens: 32768,
      maxOutputTokens: 2048,
    });

    const result = await createLoop({ db: testDb }).runErix(
      createFakeExpertService({ toolCallId }),
      input,
    );
    assert.equal(result.llmCallsCount, 2);
    assert.equal(result.fullContent, 'Need tool任务完成 Final answer');

    const [rounds] = await testDb.sequelize.query(
      'SELECT id, round_no FROM agent_rounds WHERE request_id = :requestId ORDER BY round_no ASC',
      { replacements: { requestId } },
    );
    assert.equal(rounds.length, 3, 'the seed and both engine rounds must be persisted');
    assert.deepEqual(rounds.map(({ round_no }) => round_no), [0, 1, 2]);

    const [messages] = await testDb.sequelize.query(
      `SELECT m.role, m.content
       FROM messages AS m
       JOIN agent_rounds AS r ON r.id = m.round_id
       WHERE r.request_id = :requestId
       ORDER BY r.round_no ASC, m.sequence_no ASC`,
      { replacements: { requestId } },
    );
    assert.deepEqual(messages.map(({ role, content }) => ({ role, content })), [
      { role: 'assistant', content: 'Need tool' },
      { role: 'assistant', content: '任务完成 Final answer' },
    ]);

    const [toolCalls] = await testDb.sequelize.query(
      'SELECT tool_use_id, name FROM chat_tool_calls WHERE request_id = :requestId',
      { replacements: { requestId } },
    );
    assert.equal(toolCalls.length, 1, 'the executed tool call must be persisted');
    assert.equal(toolCalls[0].tool_use_id, toolCallId);
    assert.equal(toolCalls[0].name, 'echo');
  } finally {
    await cleanupRun(requestId);
  }
});

function createScriptedExpertService({
  scripts,
  maxToolRounds = 10,
  toolResult = {},
} = {}) {
  let streamCalls = 0;
  const expertService = {
    expertConfig: {
      expert: {
        max_tool_rounds: maxToolRounds,
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
        const script = scripts[streamCalls] || scripts.at(-1) || {};
        streamCalls += 1;
        if (script.usage) options.onUsage(script.usage);
        if (script.reasoning) options.onReasoningDelta(script.reasoning);
        if (script.content) options.onDelta(script.content);
        if (script.toolCalls) options.onToolCall(script.toolCalls);
      },
      // erix 0.12 forceFinalIfNeeded（max_rounds_cap 等无终稿场景）走非流式
      // provider.chat → llmClient.call；生产 LLMClient 始终有 call，fake 补同形实现
      async call(_modelConfig, _messages) {
        const script = scripts.at(-1) || {};
        return { content: script.content ?? '任务完成 forced final' };
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
    createToolResult(call) {
      return {
        success: true,
        data: { value: 42 },
        duration: 1,
        ...toolResult,
        toolCallId: call.id,
        toolName: call.name,
      };
    },
    async handleToolCalls() {
      throw new Error('runErix should use execute_tools');
    },
    _consumeDocRetrievalResult() {
      return { found: false };
    },
    getStreamCalls() {
      return streamCalls;
    },
  };

  return expertService;
}

function createJudgeCapableExpertService({
  maxToolRounds = 20,
  reflectiveModel = { model_name: 'reflective-model' },
} = {}) {
  const expertService = createScriptedExpertService({
    maxToolRounds,
    scripts: [{
      content: '任务完成 Final answer',
      usage: {
        input_tokens: 11,
        output_tokens: 5,
      },
    }],
  });
  const resolvedMinds = [];
  const judgeCalls = [];
  expertService.llmClient.getModelForMind = async mindType => {
    resolvedMinds.push(mindType);
    return reflectiveModel;
  };
  expertService.llmClient.call = async (modelConfig, messages) => {
    judgeCalls.push({ modelConfig, messages });
    return {
      content: [{
        type: 'text',
        text: '{"done":true,"confidence":0.95,"reason":"任务已完成","evidence":"已返回最终结果"}',
      }],
      usage: {
        prompt_tokens: 7,
        completion_tokens: 3,
      },
    };
  };
  expertService.getResolvedMinds = () => resolvedMinds;
  expertService.getJudgeCalls = () => judgeCalls;
  return expertService;
}

test('runErix returns the established result shape after a tool round', async () => {
  const savedPayloads = [];
  const events = [];
  const executeToolCalls = [];
  const loop = createLoop({
    execute_tools: async (expertService, input) => {
      executeToolCalls.push(input);
      const call = input.collectedToolCalls[0];
      const result = expertService.createToolResult(call);
      input.onDelta?.({ type: 'tool_result', result });
      return [result];
    },
    save_llm_payload: (_userId, _expertId, payload) => {
      savedPayloads.push(structuredClone(payload));
    },
  });

  const expertService = createFakeExpertService();
  const result = await loop.runErix(expertService, createInput({
    onDelta: event => events.push(event),
  }));

  assert.equal(executeToolCalls.length, 1);
  assert.equal(executeToolCalls[0].collectedToolCalls.length, 1);
  assert.equal(executeToolCalls[0].collectedToolCalls[0].id, 'call_1');
  assert.equal(executeToolCalls[0].collectedToolCalls[0].name, 'echo');
  assert.equal(executeToolCalls[0].collectedToolCalls[0].arguments, '{"value":42}');
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
  const evidenceMessage = evidenceExpert.getSecondRoundMessages().find(message => (
    message.role === 'system' && message.content === 'DOCUMENT EVIDENCE'
  ));
  assert.ok(evidenceMessage);
  assert.equal(
    evidenceExpert.getSecondRoundMessages().some(message => (
      typeof message.content === 'string'
      && (
        message.content.includes('任务完成或需要给出结论时')
        || message.content.includes('{"done":true')
      )
    )),
    false,
  );

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
    assert.equal(events[0].attempt, 1);
    assert.equal(events[1].attempt, 1);
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
  const oldResult = await withEnv('ERIX_LOOP', '0', async () => {
    return oldLoop.run(oldExpert, createInput({
      onDelta: event => oldEvents.push(event),
    }));
  });

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

test('runErix stops after four consecutive no-tool transition rounds', async () => {
  const toolCall = {
    id: 'call_1',
    type: 'function',
    function: {
      name: 'echo',
      arguments: '{}',
    },
  };
  const expertService = createScriptedExpertService({
    scripts: [
      { content: 'Need tool', toolCalls: [toolCall] },
      { content: '过渡文本 1' },
      { content: '过渡文本 2' },
      { content: '过渡文本 3' },
      { content: '过渡文本 4' },
    ],
  });
  const result = await createLoop().runErix(expertService, createInput({
    onDelta: () => {},
  }));

  assert.equal(expertService.getStreamCalls(), 5);
  assert.equal(result.llmCallsCount, 5);
  assert.equal(
    result.fullContent,
    'Need tool过渡文本 1过渡文本 2过渡文本 3过渡文本 4',
  );
});

test('runErix emits the tool limit event when every round uses a tool', async () => {
  const expertService = createScriptedExpertService({
    maxToolRounds: 3,
    scripts: [1, 2, 3].map(round => ({
      content: `Tool round ${round}`,
      toolCalls: [{
        id: `call_${round}`,
        type: 'function',
        function: {
          name: 'echo',
          arguments: JSON.stringify({ round }),
        },
      }],
    })),
  });
  const events = [];
  await createLoop().runErix(expertService, createInput({
    onDelta: event => events.push(event),
  }));

  const limitEvent = events.find(event => event.type === 'tool_limit_reached');
  assert.ok(limitEvent);
  assert.equal(limitEvent.totalRounds, 3);
  assert.equal(limitEvent.executedRounds, 3);
  assert.equal(limitEvent.summary, 'summary');
  assert.match(limitEvent.message, /最大工具调用次数/);
});

test('runErix emits history_compacted with the compaction shape', async () => {
  const expertService = createScriptedExpertService({
    maxToolRounds: 3,
    scripts: [{ content: '任务完成 Compacted answer' }],
  });
  const events = [];
  const historicalMessages = [
    { role: 'user', content: 'original task' },
    { role: 'assistant', content: 'history one' },
    { role: 'user', content: 'follow-up one' },
    { role: 'assistant', content: 'history two' },
    { role: 'user', content: 'follow-up two' },
    { role: 'assistant', content: 'history three' },
  ];

  await withEnv('CHAT_COMPACT_BUDGET_TOKENS', '1', async () => {
    await withEnv('CHAT_COMPACT_KEEP_ROUNDS', '0', async () => {
      await createLoop().runErix(expertService, createInput({
        tools: [],
        currentMessages: historicalMessages,
        onDelta: event => events.push(event),
      }));
    });
  });

  const compactedEvent = events.find(event => event.type === 'history_compacted');
  assert.ok(compactedEvent);
  assert.equal(compactedEvent.round, 1);
  assert.ok(compactedEvent.foldedRounds > 0);
  assert.ok(compactedEvent.tokensBefore > compactedEvent.tokensAfter);
  assert.match(compactedEvent.content, /自动压缩/);
});

test('runErix judge falls back to the primary model when reflective config is unavailable', async () => {
  const input = createInput();
  const expertService = createJudgeCapableExpertService();
  delete expertService.llmClient.getModelForMind;

  const result = await withEnv('ERIX_NO_REFLECTION', undefined, () => (
    withEnv('ERIX_NO_ROUND_JUDGE', undefined, () => (
      createLoop().runErix(expertService, {
        ...input,
        onDelta: () => {},
      })
    ))
  ));

  assert.equal(expertService.getJudgeCalls().length, 1);
  assert.equal(expertService.getJudgeCalls()[0].modelConfig, input.modelConfig);
  assert.deepEqual(result.tokenUsage, {
    prompt_tokens: 18,
    completion_tokens: 8,
    total_tokens: 26,
  });
});

test('runErix uses the reflective model for long-task judge calls', async () => {
  const reflectiveModel = { model_name: 'marked-reflective-model' };
  const expertService = createJudgeCapableExpertService({ reflectiveModel });

  await withEnv('ERIX_NO_REFLECTION', undefined, () => (
    withEnv('ERIX_NO_ROUND_JUDGE', undefined, () => (
      createLoop().runErix(expertService, createInput({
        onDelta: () => {},
      }))
    ))
  ));

  assert.deepEqual(expertService.getResolvedMinds(), ['reflective']);
  assert.equal(expertService.getJudgeCalls().length, 1);
  assert.equal(expertService.getJudgeCalls()[0].modelConfig, reflectiveModel);
});

test('runErix disables long-task judge calls when ERIX_NO_REFLECTION is enabled', async () => {
  const expertService = createJudgeCapableExpertService();

  await withEnv('ERIX_NO_REFLECTION', '1', () => (
    withEnv('ERIX_NO_ROUND_JUDGE', undefined, () => (
      createLoop().runErix(expertService, createInput({
        onDelta: () => {},
      }))
    ))
  ));

  assert.deepEqual(expertService.getResolvedMinds(), []);
  assert.deepEqual(expertService.getJudgeCalls(), []);
});

test('run routes to runErix by default and to the legacy loop with ERIX_LOOP=0', async () => {
  const loop = createLoop();
  const erixCalls = [];
  loop.runErix = async (...args) => {
    erixCalls.push(args);
    return { route: 'erix' };
  };
  const expertService = createFakeExpertService({ noTool: true });

  await withEnv('ERIX_LOOP', '1', async () => {
    const result = await loop.run(expertService, createInput({ tools: [] }));
    assert.deepEqual(result, { route: 'erix' });
  });
  assert.equal(erixCalls.length, 1);
  assert.equal(erixCalls[0][0], expertService);

  const legacyLoop = createLoop({
    db: {
      getModel() {
        return {};
      },
    },
  });
  legacyLoop.runErix = async () => {
    throw new Error('runErix should not be called for ERIX_LOOP=0');
  };
  const legacyResult = await withEnv('ERIX_LOOP', '0', () => (
    legacyLoop.run(expertService, createInput({ tools: [] }))
  ));
  assert.equal(legacyResult.fullContent, '任务完成 Final answer');
});
