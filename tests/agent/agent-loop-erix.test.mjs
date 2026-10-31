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
  // #1156 Stage B：canonical 与展示面同事务写入，清理也要一起清
  await testDb.sequelize.query(
    'DELETE FROM agent_transcript_rounds WHERE request_id = :requestId',
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
    // issue #1227 阶段 1：erix 0.29 里 modelMetadata 的规范之家是 config.metadata.modelMetadata
    assert.deepEqual(engineOptions.config.metadata.modelMetadata, {
      contextWindowTokens: 32768,
      maxOutputTokens: 2048,
    });

    const result = await createLoop({ db: testDb }).runErix(
      createFakeExpertService({ toolCallId }),
      input,
    );
    assert.equal(result.llmCallsCount, 2);
    assert.equal(result.fullContent, 'Need tool任务完成 Final answer');

    // issue #1227：erix 0.23 起「一条消息一落盘」⇒ 展示表 agent_rounds **一轮多行**
    //（载体轮行 + 每条消息一行，见 erix-agent `src/store/message-rows.js` 文件头与
    // `docs/host-upgrade-guide-0.23.0_cn.md` §2/§6）。于是「行数 == 轮数」不再是账本形状，
    // 但**轮**仍然是账本的骨架：断言改成形状断言——行数可以随引擎分片策略变化，每轮却必须
    // 恰好一条载体行、消息行必须自带轮内序号、且不存在「只有消息行没有载体行」的轮
    //（那种形状折叠不回去，正文会掉）。
    // 口径：dedup_key 命名空间（引擎身份）与 record_json 里的 kind/seq（行形状）**互证**，
    // 只对一边照样能骗过断言。
    const [roundRows] = await testDb.sequelize.query(
      `SELECT id, round_no, dedup_key,
              JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.kind')) AS row_kind,
              CAST(JSON_EXTRACT(record_json, '$.seq') AS SIGNED) AS row_seq,
              JSON_LENGTH(JSON_EXTRACT(record_json, '$.messages')) AS inline_message_count
       FROM agent_rounds WHERE request_id = :requestId
       ORDER BY round_no ASC, id ASC`,
      { replacements: { requestId } },
    );

    // 1. 轮号集合恰为 {0,1,2}（种子轮 + 两个引擎轮）
    assert.deepEqual(
      [...new Set(roundRows.map(({ round_no: roundNo }) => roundNo))].sort((a, b) => a - b),
      [0, 1, 2],
      'agent_rounds 的轮号集合必须恰为 {0,1,2}',
    );

    // 2. 每一行要么是载体行、要么是消息行；没有第三种形态
    const carriersByRound = new Map();
    const messageRowsByRound = new Map();
    const pushTo = (map, roundNo, row) => {
      map.set(roundNo, [...(map.get(roundNo) ?? []), row]);
    };
    for (const row of roundRows) {
      const messageHit = /:msg:(\d+):(\d+)$/.exec(row.dedup_key);
      if (messageHit) {
        assert.equal(row.row_kind, 'message', `消息行必须带 kind:"message"：${row.dedup_key}`);
        assert.equal(
          Number(messageHit[1]), row.round_no,
          `消息行 dedup_key 的轮号与 round_no 不一致：${row.dedup_key}`,
        );
        assert.equal(
          Number(messageHit[2]), row.row_seq,
          `消息行 dedup_key 的轮内序号与 record_json.seq 不一致：${row.dedup_key}`,
        );
        assert.equal(
          row.inline_message_count ?? 0, 0,
          `消息行的正文只该在 messages 行里，record_json 不得再存一份：${row.dedup_key}`,
        );
        pushTo(messageRowsByRound, row.round_no, row);
        continue;
      }
      const carrierHit = /:round:(\d+)(?::(?:seed|resume))?$/.exec(row.dedup_key);
      assert.ok(carrierHit, `agent_rounds 里出现既非载体行也非消息行的记录：${row.dedup_key}`);
      assert.equal(
        Number(carrierHit[1]), row.round_no,
        `载体行 dedup_key 的轮号与 round_no 不一致：${row.dedup_key}`,
      );
      assert.equal(row.row_kind, null, `载体行不得带 kind（那是消息行的标记）：${row.dedup_key}`);
      assert.equal(row.row_seq, null, `载体行不得带轮内序号 seq：${row.dedup_key}`);
      if (/:seed$/.test(row.dedup_key)) {
        assert.equal(row.round_no, 0, `种子行只允许是第 0 轮：${row.dedup_key}`);
      }
      pushTo(carriersByRound, row.round_no, row);
    }

    // 3. 每轮**恰有一条**载体行（正文的落点唯一，否则折叠会把同一轮正文挂两遍）
    for (const roundNo of [0, 1, 2]) {
      assert.equal(
        (carriersByRound.get(roundNo) ?? []).length, 1,
        `第 ${roundNo} 轮必须恰有一条载体行`,
      );
    }

    // 4. 两个引擎轮都有消息行；轮内 seq 唯一且非负（0.23 起正文按消息行落盘）
    for (const roundNo of [1, 2]) {
      const rows = messageRowsByRound.get(roundNo) ?? [];
      assert.ok(rows.length >= 1, `第 ${roundNo} 轮缺消息行：0.23 起正文按消息行落盘`);
      const seqs = rows.map(({ row_seq: seq }) => seq);
      assert.deepEqual([...new Set(seqs)], seqs, `第 ${roundNo} 轮的消息行 seq 必须唯一：${seqs.join(',')}`);
      assert.ok(
        seqs.every((seq) => Number.isSafeInteger(seq) && seq >= 0),
        `第 ${roundNo} 轮的消息行 seq 必须是非负整数：${seqs.join(',')}`,
      );
    }

    // 5. 没有任何一轮「只有消息行、没有载体行」——那种形状折叠不回去，正文会掉
    for (const roundNo of messageRowsByRound.keys()) {
      assert.ok(
        carriersByRound.has(roundNo),
        `第 ${roundNo} 轮只有消息行、没有载体行（折叠会丢正文）`,
      );
    }

    // 6. 种子轮不拆行：round 0 的正文留在 record_json.messages（appendRound 的既有语义）
    assert.ok(
      (carriersByRound.get(0)[0].inline_message_count ?? 0) >= 1,
      'round 0 种子轮的正文必须留在 record_json.messages（appendRound 有意不拆种子行）',
    );

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

// ── #1227 阶段 2 切片 B2：同 key 异 payload 冲突的**宿主兜底** ────────────────────────────
// 引擎对 `store.appendRound` 抛错的反应是「重试 retry.attempts 次 → 仍失败 ⇒ persistence_failed
// 终局」（erix-agent `src/loop/orchestrator.js:1341-1370`）。对 dedup 冲突这两个反应都不对：
// 重试必然再撞同一条既有行，整轮失败更会把「canonical 里已有同身份键的事实」当成故障。
// 包装层 `createDedupConflictTolerantStore` 负责把它降级成「丢弃本次写入 + 记一笔」。

import { createDedupConflictTolerantStore } from '../../lib/agent/agent-loop.js';
import {
  DEDUP_CONFLICT_CODE,
  dedupConflictError,
  payloadFingerprint,
} from '../../lib/llm-kit-adapters/transcript-payload-fingerprint.js';

function makeConflictError() {
  const existing = { round: 1, messages: [{ role: 'user', content: [{ type: 'text', text: '甲' }] }] };
  const incoming = { round: 1, messages: [{ role: 'user', content: [{ type: 'text', text: '乙' }] }] };
  return dedupConflictError({
    runId: 'run-b2-host',
    key: 'run-b2-host:engine:round:1',
    existing,
    incoming,
    existingFingerprint: payloadFingerprint(existing),
    incomingFingerprint: payloadFingerprint(incoming),
  });
}

test('createDedupConflictTolerantStore：冲突被丢弃、只记一笔日志、绝不重试', async () => {
  const calls = [];
  const logs = [];
  const store = {
    appendRound: async (runId, record) => {
      calls.push({ runId, record });
      throw makeConflictError();
    },
    load: async () => ['loaded'],
    loadByDedupKey: async () => null,
    loadMaxRound: async () => 3,
  };
  const wrapped = createDedupConflictTolerantStore(store, {
    request_id: 'req-b2',
    logger: { error: (message, fields) => logs.push({ message, fields }) },
  });

  const outcome = await wrapped.appendRound('run-b2-host', { round: 1, messages: [] });

  assert.equal(outcome, undefined, '冲突必须被丢弃（不向上抛，也不返回伪结果）');
  assert.equal(calls.length, 1, '宿主包装层不得重试（重试由引擎做，这里必须一次都不多）');
  assert.equal(logs.length, 1, '必须恰好记一笔 error');
  assert.match(logs[0].message, /冲突/);
  const fields = logs[0].fields;
  assert.equal(fields.event, 'erix.transcript_dedup_conflict');
  assert.equal(fields.error_code, DEDUP_CONFLICT_CODE);
  assert.equal(fields.request_id, 'req-b2');
  assert.equal(fields.runId, 'run-b2-host');
  assert.equal(fields.key, 'run-b2-host:engine:round:1');
  assert.match(fields.existing_fingerprint, /^sha256:[0-9a-f]{24}$/u);
  assert.match(fields.incoming_fingerprint, /^sha256:[0-9a-f]{24}$/u);
  assert.deepEqual(fields.differing_fields, ['messages']);

  // 其余方法原样透传（包装层不得吞掉读面）
  assert.deepEqual(await wrapped.load('run-b2-host'), ['loaded']);
  assert.equal(await wrapped.loadByDedupKey('run-b2-host', 'k'), null);
  assert.equal(await wrapped.loadMaxRound('run-b2-host'), 3);
});

test('createDedupConflictTolerantStore：非冲突错误必须原样抛出（真故障不许被吃掉）', async () => {
  const boom = new Error('deadlock found when trying to get lock');
  boom.code = 'ER_LOCK_DEADLOCK';
  const wrapped = createDedupConflictTolerantStore({
    appendRound: async () => { throw boom; },
    load: async () => [],
  }, { request_id: 'req-b2', logger: { error: () => { throw new Error('日志实现抛错也不许掩盖原错'); } } });

  await assert.rejects(
    () => wrapped.appendRound('run-b2-host', { round: 1 }),
    (error) => {
      assert.equal(error, boom, '非冲突错误必须原样抛回引擎（走它自己的重试 + persistence_failed 路径）');
      return true;
    },
  );
});

test('createDedupConflictTolerantStore：日志实现抛错不得让 run 失败', async () => {
  const wrapped = createDedupConflictTolerantStore({
    appendRound: async () => { throw makeConflictError(); },
  }, {
    request_id: 'req-b2',
    logger: { error: () => { throw new Error('logger boom'); } },
  });

  const outcome = await wrapped.appendRound('run-b2-host', { round: 1 });
  assert.equal(outcome, undefined, '日志实现抛错也必须吞掉（记录失败不是 run 失败）');
});

test('createDedupConflictTolerantStore：没有 appendRound 的 store 原样返回', () => {
  const store = { load: async () => [] };
  assert.equal(createDedupConflictTolerantStore(store), store);
  assert.equal(createDedupConflictTolerantStore(undefined), undefined);
});

test('runErix 的 store 装配处包了冲突兜底（源码级接线断言）', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../lib/agent/agent-loop.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /createDedupConflictTolerantStore\(createErixStore\(/,
    'runErix 必须把 createErixStore 的产物交给 createDedupConflictTolerantStore 包装'
      + '（否则引擎的重试 + persistence_failed 会把一次冲突升级成整轮失败）',
  );
});

test('runErix 遇同 key 异 payload 冲突：丢弃本次写入、不重试、run 正常收尾', {
  skip: creds ? false : `缺少凭据 ${CREDS_PATH}`,
}, async () => {
  const requestId = `run-${randomUUID()}`;
  const conflictKey = `${requestId}:engine:round:1`;
  const seeded = {
    round: 1,
    dedupKey: conflictKey,
    roundKey: conflictKey,
    ts: '2026-10-31T00:00:00.000Z',
    messages: [{ role: 'user', content: [{ type: 'text', text: '盘上已有的那一版（伪造）' }] }],
  };

  const logged = [];
  const originalError = logger.error;
  try {
    // 先把「同一身份键、不同 payload」的事实塞进 canonical：引擎这一轮的写入必然冲突。
    await testDb.sequelize.query(
      `INSERT INTO agent_transcript_rounds
         (id, request_id, round_no, dedup_key, record_json, created_at, updated_at)
       VALUES
         (:id, :requestId, 1, :dedupKey, :recordJson, NOW(), NOW())`,
      {
        replacements: {
          id: `atr_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
          requestId,
          dedupKey: conflictKey,
          recordJson: JSON.stringify(seeded),
        },
      },
    );

    logger.error = (message, fields) => logged.push({ message, fields });
    const result = await createLoop({ db: testDb }).runErix(
      createFakeExpertService({ noTool: true }),
      createInput({
        user_id: testUserId,
        expert_id: testExpertId,
        topic_id: null,
        request_id: requestId,
        tools: [],
      }),
    );
    logger.error = originalError;

    // 1. run 正常收尾（不是 persistence_failed）
    assert.equal(result.fullContent, '任务完成 Final answer');
    assert.equal(result.llmCallsCount, 1);

    // 2. 恰好记了一笔 dedup 冲突日志（引擎没有因为「失败」而重试）
    const conflicts = logged.filter(
      (item) => item.fields?.event === 'erix.transcript_dedup_conflict',
    );
    assert.equal(conflicts.length, 1, `必须恰好一次冲突日志，实际=${JSON.stringify(logged.map((l) => l.fields?.event))}`);
    assert.equal(conflicts[0].fields.key, conflictKey);
    assert.equal(conflicts[0].fields.error_code, DEDUP_CONFLICT_CODE);
    // 差异字段清单由上游 differingTopLevelFields 算：这里是「伪造的既有行 vs 引擎真实一轮」，
    // 必然多于一个字段；只钉住最关键的那条（正文）。
    assert.ok(
      conflicts[0].fields.differing_fields.includes('messages'),
      `差异字段必须点名 messages，实际=${JSON.stringify(conflicts[0].fields.differing_fields)}`,
    );
    assert.ok(conflicts[0].fields.differing_fields.length <= 8, '差异字段清单最多 8 项（上游同口径）');
    assert.match(conflicts[0].fields.existing_fingerprint, /^sha256:[0-9a-f]{24}$/u);
    assert.match(conflicts[0].fields.incoming_fingerprint, /^sha256:[0-9a-f]{24}$/u);
    assert.equal(
      conflicts[0].fields.existing_fingerprint,
      payloadFingerprint(seeded),
      '日志里的既有指纹必须能由盘上那行重算出来',
    );

    // 3. 盘上原行一字未改（既不覆盖），且投影面没有为这条冲突键写下任何行
    const [canonicalRows] = await testDb.sequelize.query(
      'SELECT record_json FROM agent_transcript_rounds WHERE request_id = :requestId AND dedup_key = :dedupKey',
      { replacements: { requestId, dedupKey: conflictKey } },
    );
    assert.equal(canonicalRows.length, 1, '冲突不得落第二行');
    assert.deepEqual(JSON.parse(canonicalRows[0].record_json), seeded, '冲突不得覆盖原 record_json');

    const [roundRows] = await testDb.sequelize.query(
      'SELECT COUNT(*) AS n FROM agent_rounds WHERE request_id = :requestId AND dedup_key = :dedupKey',
      { replacements: { requestId, dedupKey: conflictKey } },
    );
    assert.equal(Number(roundRows[0].n), 0, '冲突先于投影写：agent_rounds 不得为这条键留下行');

    // 4. run 仍然可读（canonical 里那一行就是这一轮的账本）
    const [allRows] = await testDb.sequelize.query(
      'SELECT dedup_key FROM agent_transcript_rounds WHERE request_id = :requestId ORDER BY round_no ASC',
      { replacements: { requestId } },
    );
    assert.ok(allRows.length >= 1, 'canonical 至少要有这一轮的事实');
  } finally {
    logger.error = originalError;
    await cleanupRun(requestId);
  }
});
