/**
 * issue #1277 —— 折叠策略**真的生效**（契约层 + runErix e2e）。
 *
 * 三格判据（工单「验收判据」的 2/3/5）：
 *   ① 策略生效后**不再**发 `compaction_strategy_fallback`，且 `compactionStats[].strategyName`
 *      报的是配置的那个策略名（0.30 的 #657 让归因说真话，这里反过来用它当判据）；
 *   ② 注入一次摘要器失败 ⇒ run 终局 `failed` + `errorCode=summarizer_failed`，我们这一面的
 *      日志/响应读得到 `details.kind` 与根因 `errorCode`，且**没有**降级处置；
 *   ③ **变异自证**：把策略名从配置里拿掉（＝本单之前的状态）⇒ ① 的判据必须变红；
 *      把摘要器换成恒成功 ⇒ ② 的判据必须变绿。否则这两条判据是空断言。
 *
 * 成本可见（判据 2 的另一半）：`fold-llm` 的摘要器由引擎用**本次 run 的 provider** 注入，
 * 本文件把 provider 造自 `createTouwakaProvider`（`lib/llm-kit-adapters/provider-adapter.js`，
 * 红线 §2.4 的唯一出口），于是「摘要器那一次调用」在我们自己的计数面上就是
 * `llmClient.call` 的调用次数与它报的 usage。断言里给出具体 token 量级。
 *
 * 不连库：`runErix` 在 `db` 没有 `sequelize` 时不给引擎 store（引擎按「可选端口未实现」跳过），
 * 折叠/摘要器/失败面全部与存储无关。所以本文件没有 `skip` 条件，也不需要 DB 凭据。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runToolLoop } from 'erix-agent';

import { AgentLoop } from '../../lib/agent/agent-loop.js';
import {
  DEFAULT_FOLDING_STRATEGY,
  FOLDING_STRATEGY_ENV,
  buildFoldingContext,
} from '../../lib/agent/folding-strategy.js';
import { buildErixRunOptions } from '../../lib/llm-kit-adapters/loop-bridge.js';
import { createTouwakaProvider } from '../../lib/llm-kit-adapters/provider-adapter.js';
import logger from '../../lib/logger.js';

const LOG_FILE = '/tmp/touwaka-1277-fold-strategy.log';
logger.logFile = LOG_FILE;

const SUMMARIZER_USAGE = { prompt_tokens: 777, completion_tokens: 33 };
const ROUND_USAGE = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 };

// ─────────────────────────────────────────────────────────────────────────────
// 造现场
// ─────────────────────────────────────────────────────────────────────────────

function toolCall(id = 'call_1') {
  return { id, type: 'function', function: { name: 'echo', arguments: '{"value":42}' } };
}

/**
 * 假 LLMClient：`callStream` 走主循环，`call` 走**非流式**路径——`fold-llm` 的摘要器就是
 * 经 `provider.chat` → `llmClient.call` 这一条路（`provider-adapter.js` 的 `chat`）。
 * 两个计数分开记，正好把「多出来的那次调用」量出来。
 */
function createFakeLLMClient({ summarizer = 'ok', toolRounds = 3 } = {}) {
  const streamCalls = [];
  const chatCalls = [];
  return {
    streamCalls,
    chatCalls,
    getExpertLLMParams() {
      return { temperature: 0.7, top_p: 1, frequency_penalty: 0, presence_penalty: 0 };
    },
    async callStream(_modelConfig, messages, options) {
      streamCalls.push(messages);
      options.onUsage({ ...ROUND_USAGE });
      if (streamCalls.length > toolRounds) {
        options.onDelta('任务完成 Final answer');
        return;
      }
      options.onDelta(`Need tool ${streamCalls.length}`);
      options.onToolCall([toolCall()]);
    },
    async call(_modelConfig, messages) {
      chatCalls.push(messages);
      if (summarizer === 'throw') {
        const error = new Error('summarizer upstream 500');
        error.code = 'server_error';
        throw error;
      }
      if (summarizer === 'empty') {
        return { content: '   ', usage: { ...SUMMARIZER_USAGE } };
      }
      return { content: '折叠摘要：前面几轮在 echo 同一批数据。', usage: { ...SUMMARIZER_USAGE } };
    },
  };
}

function createFakeExpertService(llmClient) {
  return {
    expertConfig: { expert: { max_tool_rounds: 5, context_strategy: 'full' } },
    llmClient,
    toolManager: {
      formatToolDisplay: id => `Tool: ${id}`,
      formatToolResultsForLLM: results => results.map(item => ({
        role: 'tool',
        tool_call_id: item.toolCallId,
        content: JSON.stringify({ success: item.success, data: item.data, error: item.error }),
      })),
    },
    createToolResult(call) {
      return {
        success: true,
        data: { value: 'y'.repeat(400) },
        duration: 1,
        toolCallId: call.id,
        toolName: call.name,
        toolMessageId: 'tool_msg_1',
      };
    },
    _consumeDocRetrievalResult() {
      return { found: false };
    },
  };
}

/** 不连库的 AgentLoop（`db` 无 `sequelize` ⇒ 引擎不拿 store，见文件头）。 */
function createLoop() {
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
  });
}

function createRunInput({ requestId, onDelta } = {}) {
  return {
    modelConfig: { model_name: 'test-model', context_window_tokens: 32768, max_output_tokens: 2048 },
    thinkingConfig: { thinking: false },
    tools: [{
      type: 'function',
      function: { name: 'echo', description: 'Echo input', parameters: { type: 'object' } },
    }],
    currentMessages: [{ role: 'user', content: 'hello' }],
    llmPayload: { _debug: {} },
    user_id: 'user_1277',
    expert_id: 'expert_1277',
    taskContext: { workspace_mode: 'test' },
    topic_id: 'topic_1277',
    task_id: 'task_1277',
    session: { accessToken: 'token' },
    request_id: requestId,
    onDelta,
  };
}

/** 预算压到 300 / keepRounds=1 ⇒ 工具轮必然把上下文顶过预算，折叠一定发生。 */
const COMPACT_ENV = {
  CHAT_COMPACT_BUDGET_TOKENS: '300',
  CHAT_COMPACT_KEEP_ROUNDS: '1',
};

async function withEnv(overrides, callback) {
  const previous = new Map();
  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/**
 * 契约层：只用 `buildFoldingContext` 造 `config.folding.context`，provider 走**我们的适配器**。
 * 返回值里带上引擎给的全部事件与结果，供各格断言。
 */
async function runContractScenario({ strategy, summarizer = 'ok', omitStrategy = false } = {}) {
  const llmClient = createFakeLLMClient({ summarizer });
  const provider = createTouwakaProvider({
    llmClient,
    resolveModel: async () => ({ model_name: 'test-model' }),
  });
  // `omitStrategy` = **改造前**（#1277 之前）的 `config.folding.context` 形状：只有三格数据、
  // 没有 `strategy`。变异自证专用——它必须能把「不再发兜底告警」那条判据变红。
  const foldingContext = omitStrategy
    ? { budgetTokens: 300, keepRounds: 1, stripHistoricalImages: true }
    : buildFoldingContext({
      budgetTokens: 300,
      keepRounds: 1,
      env: strategy === undefined ? {} : { [FOLDING_STRATEGY_ENV]: strategy },
    });
  const events = [];
  const options = buildErixRunOptions({
    provider,
    executeTool: async () => ({ success: true, data: 'y'.repeat(400) }),
    modelConfig: { context_window_tokens: 1000, max_output_tokens: 100 },
    config: {
      input: { initialUserMessage: 'go' },
      run: {
        runId: 'run-1277-contract',
        maxRounds: 6,
        completion: { maxNoToolRounds: 2 },
        stream: true,
      },
      folding: { context: foldingContext },
    },
    onEvent: event => events.push(event),
  });

  let result;
  let error;
  try {
    result = await runToolLoop(options);
  } catch (caught) {
    error = caught;
  }
  return { llmClient, foldingContext, events, result, error };
}

function countEvent(events, type) {
  return events.filter(event => event.type === type).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 策略生效：不再发 compaction_strategy_fallback，且归因报的是配置的策略名
// ─────────────────────────────────────────────────────────────────────────────

test('#1277 三档策略都能配起来并被引擎真的执行（无兜底告警 + 归因报配置名）', async () => {
  for (const strategy of ['fold-llm', 'fold-statistical', 'sliding-window']) {
    const { llmClient, events, result, error } = await runContractScenario({ strategy });

    assert.equal(error, undefined, `${strategy} 档不该抛错：${error?.message}`);
    assert.equal(
      countEvent(events, 'compaction_strategy_fallback'), 0,
      `${strategy} 档下 compaction_strategy_fallback 必须为 0（它一出现就说明策略没生效＝配置错误）`,
    );
    assert.ok(result.compactionStats.length > 0, `${strategy} 档必须真的发生过折叠`);
    assert.ok(
      result.compactionStats.some(stat => stat.strategyName === strategy),
      `${strategy} 档必须有一折的 strategyName 报配置的那个名字，实际 `
      + JSON.stringify(result.compactionStats.map(stat => stat.strategyName)),
    );
    // 零 LLM 的两档不许有摘要器调用；fold-llm 必须有（且只经 llmClient.call 这一条路）
    if (strategy === 'fold-llm') {
      assert.ok(llmClient.chatCalls.length >= 1, 'fold-llm 档必须真的调过摘要器');
    } else {
      assert.equal(llmClient.chatCalls.length, 0, `${strategy} 是零 LLM 档，不许有非流式调用`);
    }
  }
});

test('#1277 变异自证：把 strategy 从配置里拿掉（本单之前的状态）⇒ 兜底告警必须变红', async () => {
  const { events, result } = await runContractScenario({ omitStrategy: true });

  // 这就是改造前的现场：只有预算、没有策略 ⇒ 引擎走库层兜底并发一次告警。
  assert.equal(
    countEvent(events, 'compaction_strategy_fallback'), 1,
    '没有 strategy 时引擎必须发 compaction_strategy_fallback——否则上面那条「为 0」的判据是空断言',
  );
  const names = result.compactionStats.map(stat => stat.strategyName);
  assert.ok(names.length > 0 && names.every(name => name === 'sliding-window'),
    `没有策略时归因只能是库层兜底 sliding-window，实际 ${JSON.stringify(names)}`);
});

test('#1277 成本可见：fold-llm 那一次摘要调用走我们的 provider 适配器，且 token 量级入账', async () => {
  const { llmClient, result } = await runContractScenario({ strategy: 'fold-llm' });

  // 1) 摘要器真的被调了（每折一次多一发）——调用点是 provider-adapter 的 chat → llmClient.call，
  //    所以「我们的观测面」= 这个计数 + 它报的 usage。
  const foldCalls = llmClient.chatCalls.length;
  assert.ok(foldCalls >= 1, 'fold-llm 至少一折 ⇒ 至少一次非流式调用');
  // 2) 主循环仍然只走流式（红线：不为折叠另开 provider 出口）
  const streamCalls = llmClient.streamCalls.length;

  // 3) 引擎把摘要那几发的用量记进 engine 桶，run 总账 = model + engine（#438 分账）
  const { usage, modelUsage, engineUsage } = result;
  assert.deepEqual(
    { input: engineUsage.input_tokens, output: engineUsage.output_tokens },
    { input: foldCalls * SUMMARIZER_USAGE.prompt_tokens, output: foldCalls * SUMMARIZER_USAGE.completion_tokens },
    `engine 桶必须恰好是摘要那 ${foldCalls} 发的用量（每发 777 prompt / 33 completion）`,
  );
  assert.equal(usage.input_tokens, modelUsage.input_tokens + engineUsage.input_tokens,
    'run 总账必须包含摘要那几发（不是只算主循环）');
  assert.equal(usage.output_tokens, modelUsage.output_tokens + engineUsage.output_tokens);
  assert.equal(modelUsage.input_tokens, streamCalls * ROUND_USAGE.prompt_tokens, 'model 桶只算主循环那几发');
  assert.ok(engineUsage.input_tokens > 0, '摘要那一次调用必须在我们能读到的用量里看得见');
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 摘要器失败：终局 failed + 可读（日志面 + 响应面都读得到 kind 与根因）
// ─────────────────────────────────────────────────────────────────────────────

function readLogEntries(requestId) {
  let raw = '';
  try {
    raw = readFileSync(LOG_FILE, 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.includes(requestId)) continue;
    const start = line.indexOf('{');
    if (start < 0) continue;
    try {
      entries.push(JSON.parse(line.slice(start)));
    } catch {
      // 非结构化行（比如带尾注的截断行）跳过：本用例只认 JSON 载荷。
    }
  }
  return entries;
}

test('#1277 摘要器抛错 ⇒ run 终局 failed / summarizer_failed，日志与响应都能读到 kind 与根因', async () => {
  const llmClient = createFakeLLMClient({ summarizer: 'throw' });
  const requestId = `req-1277-summarizer-throw-${Date.now()}`;
  const deltas = [];

  const error = await withEnv({ ...COMPACT_ENV, [FOLDING_STRATEGY_ENV]: undefined }, async () => {
    try {
      await createLoop().runErix(createFakeExpertService(llmClient), createRunInput({
        requestId,
        onDelta: delta => deltas.push(delta),
      }));
      return null;
    } catch (caught) {
      return caught;
    }
  });

  // 1) 失败必须冒出来（不许吞成成功）
  assert.ok(error, '摘要器失败必须让 runErix 抛错——吞成成功是本单明确禁止的降级处置');
  // 2) 终局语义不改：failed + summarizer_failed
  assert.equal(error.code, 'summarizer_failed');
  assert.equal(error.termination?.reason, 'failed');
  assert.equal(error.termination?.errorCode, 'summarizer_failed');
  // 3) 响应面（HTTP error 帧 / 非流式 error 字段读的就是 message）可判读：kind + 根因
  assert.match(error.message, /上下文折叠失败/, `message 必须说明是折叠失败：${error.message}`);
  assert.match(error.message, /kind=error/, `message 必须带 details.kind：${error.message}`);
  assert.match(error.message, /errorCode=server_error/, `message 必须带根因 errorCode：${error.message}`);
  assert.equal(error.cause?.code, 'summarizer_failed', '原始引擎错误必须挂在 cause 上（排查要拿引擎对象）');
  assert.equal(error.cause?.cause?.code, 'server_error', '根因（上游网关错）必须还能在 cause 链上找到');

  // 4) 日志面：结构化一条 ERROR，字段里 kind / 根因 / 策略名 / host_degraded=false 都在
  const entries = readLogEntries(requestId);
  const failureEntry = entries.find(entry => entry.event === 'erix.summarizer_failed');
  assert.ok(failureEntry, `日志里必须有 event=erix.summarizer_failed，实际 ${JSON.stringify(entries.map(e => e.event))}`);
  assert.equal(failureEntry.details_kind, 'error');
  assert.equal(failureEntry.root_error_code, 'server_error');
  assert.equal(failureEntry.strategy, 'fold-llm');
  assert.equal(failureEntry.termination_reason, 'failed');
  assert.equal(failureEntry.termination_error_code, 'summarizer_failed');
  assert.equal(failureEntry.host_degraded, false, '没有自动降级/重试/改终局');
  // 引擎自己的终局记录也在（既有观测面，未改动）
  assert.ok(entries.some(entry => entry.event === 'erix.run_outcome'
    && entry.termination?.reason === 'failed'
    && entry.termination?.errorCode === 'summarizer_failed'));

  // 5) 失败发生在折叠上：没有 history_compacted（折叠没成功），主循环 2 轮后即停
  assert.equal(deltas.filter(delta => delta.type === 'history_compacted').length, 0);
  assert.equal(llmClient.chatCalls.length, 1, '只试了一次（不自动重试是裁决的一部分）');
});

test('#1277 变异自证：摘要器换成恒成功 ⇒ 同一格判据必须变绿（终局不是 failed）', async () => {
  const llmClient = createFakeLLMClient({ summarizer: 'ok' });
  const requestId = `req-1277-summarizer-ok-${Date.now()}`;

  const result = await withEnv({ ...COMPACT_ENV, [FOLDING_STRATEGY_ENV]: undefined }, async () => (
    createLoop().runErix(createFakeExpertService(llmClient), createRunInput({ requestId }))
  ));

  assert.equal(result.fullContent, '任务完成 Final answer');
  // 默认档 fold-llm 真的生效了：摘要器被调用过（这条同时钉住「默认值落到了引擎」）
  assert.ok(llmClient.chatCalls.length >= 1, '默认档 fold-llm 必须真的调用摘要器');
  // 没有 erix.summarizer_failed 日志（对照组）
  const entries = readLogEntries(requestId);
  assert.equal(entries.filter(entry => entry.event === 'erix.summarizer_failed').length, 0);

  // 生产观测面（issue #1277 顺手修的那条一直是 null 的日志）：
  // `erix.compaction` 现在能读出「哪个策略折的」+「折了多少」+「摘要那一发烧了多少 token」。
  const compactionEntries = entries.filter(entry => entry.event === 'erix.compaction');
  assert.ok(compactionEntries.length >= 1, '折叠发生时必须留 erix.compaction 日志');
  for (const entry of compactionEntries) {
    assert.equal(entry.strategyName, 'fold-llm', '日志里的归因必须是配置的策略名');
    assert.equal(entry.compacted, true);
    assert.ok(entry.foldedRounds >= 1, `foldedRounds 不许再是 null：${JSON.stringify(entry)}`);
    assert.equal(typeof entry.tokensBefore, 'number', 'tokensBefore 不许再是 null');
    assert.equal(typeof entry.tokensAfter, 'number', 'tokensAfter 不许再是 null');
  }
  assert.ok(
    compactionEntries.some(entry => entry.summarizerInputTokens === SUMMARIZER_USAGE.prompt_tokens
      && entry.summarizerOutputTokens === SUMMARIZER_USAGE.completion_tokens),
    `摘要那一发的 token 量级必须能从日志读到（期望 ${SUMMARIZER_USAGE.prompt_tokens}/`
    + `${SUMMARIZER_USAGE.completion_tokens}）：${JSON.stringify(compactionEntries)}`,
  );
  // 折叠成功 ⇒ 用户可见的压缩提示照旧发（既有事件面不动）
  // （提示走 onDelta，这里不断言具体次数，只钉「至少折过一次且没失败」）
});

test('#1277 空摘要（empty_summary）同样是硬失败，kind 原样透出', async () => {
  const llmClient = createFakeLLMClient({ summarizer: 'empty' });
  const requestId = `req-1277-summarizer-empty-${Date.now()}`;

  const error = await withEnv({ ...COMPACT_ENV, [FOLDING_STRATEGY_ENV]: undefined }, async () => {
    try {
      await createLoop().runErix(createFakeExpertService(llmClient), createRunInput({ requestId }));
      return null;
    } catch (caught) {
      return caught;
    }
  });

  assert.ok(error, '空摘要必须让 run 失败（0.30 起不再降级成统计摘要）');
  assert.equal(error.code, 'summarizer_failed');
  assert.equal(error.details?.kind, 'empty_summary');
  assert.equal(error.errorCode, 'summarizer_empty_summary');
  assert.match(error.message, /kind=empty_summary/);
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ 配置面 e2e：三档经环境变量真的改得动；非法值在**任何 provider 调用之前**就抛
// ─────────────────────────────────────────────────────────────────────────────

test('#1277 环境变量三档：默认 fold-llm 会调摘要器，零 LLM 两档一次都不调', async () => {
  for (const [strategy, expectedChatCalls] of [
    [undefined, 1],
    ['fold-llm', 1],
    ['fold-statistical', 0],
    ['sliding-window', 0],
  ]) {
    const llmClient = createFakeLLMClient({ summarizer: 'ok' });
    const requestId = `req-1277-env-${strategy ?? 'unset'}-${Date.now()}`;
    const result = await withEnv(
      { ...COMPACT_ENV, [FOLDING_STRATEGY_ENV]: strategy },
      async () => createLoop().runErix(createFakeExpertService(llmClient), createRunInput({ requestId })),
    );

    assert.equal(result.fullContent, '任务完成 Final answer', `${strategy ?? 'unset'} 档必须正常收尾`);
    assert.ok(llmClient.chatCalls.length >= expectedChatCalls,
      `${strategy ?? `unset（默认 ${DEFAULT_FOLDING_STRATEGY}）`} 档的摘要器调用次数下限`);
    if (expectedChatCalls === 0) {
      assert.equal(llmClient.chatCalls.length, 0,
        `${strategy} 是零 LLM 档：折叠一次模型调用都不许有`);
    }
  }
});

test('#1277 非法环境变量：装配处当场抛（点名值/合法清单/变量名），一次 provider 调用都不发', async () => {
  const llmClient = createFakeLLMClient({ summarizer: 'ok' });

  const error = await withEnv(
    { ...COMPACT_ENV, [FOLDING_STRATEGY_ENV]: 'fold-llm2' },
    async () => {
      try {
        await createLoop().runErix(createFakeExpertService(llmClient), createRunInput({
          requestId: `req-1277-invalid-${Date.now()}`,
        }));
        return null;
      } catch (caught) {
        return caught;
      }
    },
  );

  assert.ok(error, '非法值必须抛，不许静默退回默认档');
  assert.equal(error.code, 'invalid_folding_strategy');
  assert.match(error.message, /fold-llm2/, '必须点名收到的值');
  assert.match(error.message, /ERIX_FOLDING_STRATEGY/, '必须点名环境变量');
  for (const name of ['sliding-window', 'fold-statistical', 'fold-llm']) {
    assert.ok(error.message.includes(name), `必须列全合法值（缺 ${name}）`);
  }
  // 配置错误在**发请求之前**暴露：0 次流式 / 0 次非流式（不烧 token、不产生半截 run）
  assert.equal(llmClient.streamCalls.length, 0);
  assert.equal(llmClient.chatCalls.length, 0);
});
