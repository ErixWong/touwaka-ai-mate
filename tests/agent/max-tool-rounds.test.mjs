/**
 * max_tool_rounds 运行时防御夹取（issue #1166）
 *
 * 覆盖两层，两层都必须有牙：
 *
 *   A. 共享 helper `resolveEffectiveMaxToolRounds`（lib/agent/max-tool-rounds.js）
 *      的取值语义：脏数据 5000 / -5 / 2.7 / 'abc' / null / 0 各自的最终生效值，
 *      `null` 与 `0` 仍然回系统默认（既有语义，不许改成 0 或 1），负数/巨大值必须留痕。
 *
 *   B. 两个运行时消费点**真的**在用这个 helper（不是只测了 helper 自己）：
 *        - 旧循环 `AgentLoop.run()`（ERIX_LOOP=0）里的 MAX_TOOL_ROUNDS
 *        - 新循环 `AgentLoop.runErix()` 里的 maxRounds
 *      判别量是循环自己吐出来的事件字段（totalRounds / maxRounds 就是生效值），
 *      因此把 helper 短路成"原值返回"时，这里用 `-5` / `5000` 造的两条脏数据用例
 *      必须 fail；把消费点退回裸 `||` 也同样会 fail。
 *
 * 纯内存假象（假 expertService + 假 system_setting 模型），不连数据库。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import logger from '../../lib/logger.js';

/** logger.warn 捕获（同时静音其余级别，保持测试输出干净） */
let warnings = [];
const originalLogger = {
  warn: logger.warn,
  info: logger.info,
  error: logger.error,
  debug: logger.debug,
};
logger.warn = (message) => { warnings.push(String(message)); };
logger.info = () => {};
logger.error = () => {};
logger.debug = () => {};

const {
  MAX_TOOL_ROUNDS_MIN,
  MAX_TOOL_ROUNDS_MAX,
  isValidMaxToolRounds,
  resolveEffectiveMaxToolRounds,
} = await import('../../lib/agent/max-tool-rounds.js');
const { AgentLoop } = await import('../../lib/agent/agent-loop.js');

// 系统默认（tool.max_rounds）取一个 1–50 内、且和约定上下界都不相等的值：
// 「null/0 → 系统默认」要能被判别，就不能让默认值恰好等于边界。
const FAKE_SYSTEM_DEFAULT_MAX_ROUNDS = 7;

/**
 * 只喂得出 `tool.max_rounds` 的假 db：形状对齐 SystemSettingService 的用法
 * （getModel('system_setting').findAll({raw}) + 补默认记录用的 create）。
 * getSystemSettingService 是进程级单例，本文件所有用例共用这一个假 db。
 */
const fakeSystemSettingDb = {
  getModel(name) {
    if (name !== 'system_setting') return {};
    return {
      async findAll() {
        return [{
          setting_key: 'tool.max_rounds',
          setting_value: String(FAKE_SYSTEM_DEFAULT_MAX_ROUNDS),
          value_type: 'number',
        }];
      },
      async create() { return {}; },
    };
  },
};

function createLoop(overrides = {}) {
  return new AgentLoop({
    db: fakeSystemSettingDb,
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
      function: { name: 'echo', description: 'Echo input', parameters: { type: 'object' } },
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

/**
 * 每轮都调用工具的假专家：循环只能停在「生效的 max_tool_rounds」上，
 * 于是它吐出来的 totalRounds / maxRounds 就是生效值本身。
 */
function createEndlessToolExpertService(configuredMaxToolRounds) {
  let streamCalls = 0;
  const expertService = {
    expertConfig: {
      expert: { max_tool_rounds: configuredMaxToolRounds, context_strategy: 'full' },
    },
    llmClient: {
      getExpertLLMParams() {
        return { temperature: 0.7, top_p: 1, frequency_penalty: 0, presence_penalty: 0 };
      },
      async callStream(_modelConfig, _messages, options) {
        streamCalls += 1;
        options.onUsage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
        options.onDelta(`第 ${streamCalls} 轮`);
        options.onToolCall([{
          id: `call_${streamCalls}`,
          type: 'function',
          function: { name: 'echo', arguments: '{}' },
        }]);
      },
      // erix 到轮数上限后 forceFinalIfNeeded 走非流式 provider.chat → llmClient.call
      async call() {
        return { content: [{ type: 'text', text: '已达上限的终稿' }] };
      },
    },
    toolManager: {
      formatToolDisplay(toolId) { return `Tool: ${toolId}`; },
      formatToolResultsForLLM(results) {
        return results.map(item => ({
          role: 'tool',
          tool_call_id: item.toolCallId,
          content: JSON.stringify({ success: item.success, data: item.data }),
        }));
      },
    },
    createToolResult(call) {
      return {
        success: true,
        data: { value: 1 },
        duration: 1,
        toolCallId: call.id,
        toolMessageId: `tool_msg_${call.id}`,
        toolName: call.name,
      };
    },
    async handleToolCalls() { throw new Error('should use execute_tools'); },
    _consumeDocRetrievalResult() { return { found: false }; },
    getStreamCalls() { return streamCalls; },
  };
  return expertService;
}

async function withEnv(name, value, callback) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

async function collectRun(loop, expertService, inputOverrides = {}) {
  const events = [];
  const result = await loop.runErix(expertService, createInput({
    onDelta: event => events.push(event),
    ...inputOverrides,
  }));
  return { events, result };
}

function limitEvents(events) {
  return {
    reached: events.filter(event => event.type === 'tool_limit_reached'),
    warning: events.filter(event => event.type === 'tool_limit_warning'),
  };
}

/** 只看本议题的告警：AgentLoop 自己也会 warn（强制收尾等），不能拿全量 warn 当判别量。 */
function clampWarnings(warnSnapshot) {
  return warnSnapshot.filter(message => message.includes('[MaxToolRounds]'));
}

/** 判别量自证：脏值必须真的被夹取并留痕，否则整条用例是空跑。 */
function assertClampWarned(warnSnapshot, rawValue, effective) {
  const hit = clampWarnings(warnSnapshot).filter(message => message.includes('max_tool_rounds')
    && message.includes(`${rawValue} -> ${effective}`));
  assert.equal(hit.length, 1,
    `期望恰好一条「${rawValue} -> ${effective}」夹取告警，实际 ${warnSnapshot.length} 条告警`);
  assert.ok(hit[0].includes(`${MAX_TOOL_ROUNDS_MIN}-${MAX_TOOL_ROUNDS_MAX}`),
    '夹取告警必须写明允许范围');
  assert.ok(/expert_id=expert_1/.test(hit[0]), '夹取告警必须带 expert_id 上下文');
  assert.ok(/request_id=request_1/.test(hit[0]), '夹取告警必须带 request_id 上下文');
}

// ─────────────────────────────────────────────────────────────────────────────
// A. helper 取值语义
// ─────────────────────────────────────────────────────────────────────────────

test('helper: 1-50 内的整数原样采用，且不误告警', async () => {
  for (const value of [MAX_TOOL_ROUNDS_MIN, 12, MAX_TOOL_ROUNDS_MAX]) {
    warnings = [];
    const effective = await resolveEffectiveMaxToolRounds({
      configured: value,
      resolveSystemDefault: async () => FAKE_SYSTEM_DEFAULT_MAX_ROUNDS,
      expert_id: 'expert_1',
      request_id: 'request_1',
      source: 'unit',
    });
    assert.equal(effective, value, `合法值 ${value} 不该被动过`);
    assert.deepEqual(clampWarnings(warnings), [], `合法值 ${value} 不该产生夹取告警`);
  }
});

test('helper: null 与 0 仍然继承系统默认（既有语义，既不是 0 也不是 1）', async () => {
  for (const configured of [null, 0, undefined]) {
    warnings = [];
    const effective = await resolveEffectiveMaxToolRounds({
      configured,
      resolveSystemDefault: async () => FAKE_SYSTEM_DEFAULT_MAX_ROUNDS,
      expert_id: 'expert_1',
      request_id: 'request_1',
      source: 'unit',
    });
    assert.equal(effective, FAKE_SYSTEM_DEFAULT_MAX_ROUNDS,
      `${JSON.stringify(configured)} 必须回落到系统默认 ${FAKE_SYSTEM_DEFAULT_MAX_ROUNDS}`);
    assert.notEqual(effective, MAX_TOOL_ROUNDS_MIN,
      `${JSON.stringify(configured)} 不许被当成 1`);
    assert.deepEqual(clampWarnings(warnings), [],
      `${JSON.stringify(configured)} 是既有正常语义，不该告警`);
  }
});

test('helper: 继承时根本不去读系统设置以外的东西 —— 短路语义保持不变', async () => {
  let systemReads = 0;
  const countingResolve = async () => { systemReads += 1; return FAKE_SYSTEM_DEFAULT_MAX_ROUNDS; };

  await resolveEffectiveMaxToolRounds({ configured: 12, resolveSystemDefault: countingResolve });
  assert.equal(systemReads, 0, '专家已显式配置时不该再读系统默认（改造前的 || 短路语义）');

  await resolveEffectiveMaxToolRounds({ configured: null, resolveSystemDefault: countingResolve });
  assert.equal(systemReads, 1, '只有真要继承时才读一次系统默认');
});

test('helper: 脏数据 5000 夹成上界并留痕', async () => {
  warnings = [];
  const effective = await resolveEffectiveMaxToolRounds({
    configured: 5000,
    resolveSystemDefault: async () => FAKE_SYSTEM_DEFAULT_MAX_ROUNDS,
    expert_id: 'expert_1',
    request_id: 'request_1',
    source: 'unit',
  });
  assert.equal(effective, MAX_TOOL_ROUNDS_MAX);
  assertClampWarned(warnings, 5000, MAX_TOOL_ROUNDS_MAX);
});

test('helper: 脏数据 -5 夹成下界，且不静默（有告警）', async () => {
  warnings = [];
  const effective = await resolveEffectiveMaxToolRounds({
    configured: -5,
    resolveSystemDefault: async () => FAKE_SYSTEM_DEFAULT_MAX_ROUNDS,
    expert_id: 'expert_1',
    request_id: 'request_1',
    source: 'unit',
  });
  assert.equal(effective, MAX_TOOL_ROUNDS_MIN);
  assertClampWarned(warnings, -5, MAX_TOOL_ROUNDS_MIN);
});

test('helper: 小数 / 数字字符串被归一；非有限数字按「继承系统默认」处理并告警', async () => {
  const cases = [
    // [原值, 期望生效值, 是否必须告警]
    [2.7, 2, true],
    ['30', 30, false],
    ['abc', FAKE_SYSTEM_DEFAULT_MAX_ROUNDS, true],
    [Number.POSITIVE_INFINITY, FAKE_SYSTEM_DEFAULT_MAX_ROUNDS, true],
    [Number.NaN, FAKE_SYSTEM_DEFAULT_MAX_ROUNDS, true],
  ];
  for (const [configured, expected, mustWarn] of cases) {
    warnings = [];
    const effective = await resolveEffectiveMaxToolRounds({
      configured,
      resolveSystemDefault: async () => FAKE_SYSTEM_DEFAULT_MAX_ROUNDS,
      expert_id: 'expert_1',
      request_id: 'request_1',
      source: 'unit',
    });
    assert.equal(effective, expected, `${JSON.stringify(configured)} 的生效值`);
    assert.ok(Number.isInteger(effective)
      && effective >= MAX_TOOL_ROUNDS_MIN && effective <= MAX_TOOL_ROUNDS_MAX,
      `生效值必须是范围内的整数，实际 ${effective}`);
    assert.equal(clampWarnings(warnings).length > 0, mustWarn,
      `${JSON.stringify(configured)} 的留痕预期不符：${JSON.stringify(warnings)}`);
  }

  // 系统默认本身是脏值（历史行 / 直接写库）也要夹进范围并告警
  warnings = [];
  const dirtyDefault = await resolveEffectiveMaxToolRounds({
    configured: null,
    resolveSystemDefault: async () => -1,
    expert_id: 'expert_1',
    request_id: 'request_1',
    source: 'unit',
  });
  assert.equal(dirtyDefault, MAX_TOOL_ROUNDS_MIN);
  assertClampWarned(warnings, -1, MAX_TOOL_ROUNDS_MIN);
});

test('helper: 系统默认读取抛错时不炸循环，退回兜底值并告警', async () => {
  warnings = [];
  const effective = await resolveEffectiveMaxToolRounds({
    configured: null,
    resolveSystemDefault: async () => { throw new Error('db down'); },
    systemDefaultFallback: MAX_TOOL_ROUNDS_MAX,
    expert_id: 'expert_1',
    request_id: 'request_1',
    source: 'unit',
  });
  assert.equal(effective, MAX_TOOL_ROUNDS_MAX);
  assert.ok(warnings.some(message => message.includes('读取系统默认 tool.max_rounds 失败')),
    `读取失败必须告警，实际：${JSON.stringify(warnings)}`);
});

test('写入侧判据与运行时范围是同一份常量（防漂移）', () => {
  assert.equal(MAX_TOOL_ROUNDS_MIN, 1);
  assert.equal(MAX_TOOL_ROUNDS_MAX, 50);
  assert.ok(isValidMaxToolRounds(1) && isValidMaxToolRounds(50));
  assert.ok(!isValidMaxToolRounds(0) && !isValidMaxToolRounds(51)
    && !isValidMaxToolRounds(-5) && !isValidMaxToolRounds(2.5) && !isValidMaxToolRounds('10'));
});

// ─────────────────────────────────────────────────────────────────────────────
// B. 两个消费点真的用这个 helper
// ─────────────────────────────────────────────────────────────────────────────

test('runErix 消费点：脏值 -5 被夹成 1（工具轮仍执行），并留下夹取告警', async () => {
  // 轮数上限相关：把 reflection 关掉，避免为造脏值多用 judge
  await withEnv('ERIX_NO_REFLECTION', '1', async () => {
    warnings = [];
    const expertService = createEndlessToolExpertService(-5);
    const { events, result } = await collectRun(createLoop(), expertService);
    const { reached } = limitEvents(events);

    assert.equal(reached.length, 1, `期望一条 tool_limit_reached，实际 ${reached.length}`);
    assert.equal(reached[0].totalRounds, MAX_TOOL_ROUNDS_MIN,
      '负数脏值必须被夹成下界 1（裸 || 会让上界为负、一轮工具都不跑）');
    assert.equal(reached[0].executedRounds, MAX_TOOL_ROUNDS_MIN);
    assert.ok(result.llmCallsCount >= 1, '工具轮必须真的执行过');
    assertClampWarned(warnings, -5, MAX_TOOL_ROUNDS_MIN);
  });
});

test('runErix 消费点：脏值 5000 被夹成 50（巨大值不再等于资源上界）', async () => {
  await withEnv('ERIX_NO_REFLECTION', '1', async () => {
    warnings = [];
    const expertService = createEndlessToolExpertService(5000);
    const { events } = await collectRun(createLoop(), expertService);
    const { reached } = limitEvents(events);

    assert.equal(reached.length, 1, `期望一条 tool_limit_reached，实际 ${reached.length}`);
    assert.equal(reached[0].totalRounds, MAX_TOOL_ROUNDS_MAX,
      '5000 必须被夹成 50：事件里的 totalRounds 就是循环生效上界');
    assert.ok(expertService.getStreamCalls() <= MAX_TOOL_ROUNDS_MAX + 1,
      `LLM 调用次数必须被夹取后的上界卡住，实际 ${expertService.getStreamCalls()}`);
    assertClampWarned(warnings, 5000, MAX_TOOL_ROUNDS_MAX);
  });
});

test('runErix 消费点：null / 0 仍回系统默认，且不误告警', async () => {
  await withEnv('ERIX_NO_REFLECTION', '1', async () => {
    for (const configured of [null, 0]) {
      warnings = [];
      const expertService = createEndlessToolExpertService(configured);
      const { events } = await collectRun(createLoop(), expertService);
      const { reached } = limitEvents(events);

      assert.equal(reached.length, 1, `${configured} 场景期望一条 tool_limit_reached`);
      assert.equal(reached[0].totalRounds, FAKE_SYSTEM_DEFAULT_MAX_ROUNDS,
        `${configured} 必须回落到系统默认 ${FAKE_SYSTEM_DEFAULT_MAX_ROUNDS}`);
      assert.deepEqual(clampWarnings(warnings), [], `${configured} 是既有正常语义，不该有夹取告警`);
    }
  });
});

test('旧循环 run(ERIX_LOOP=0) 消费点：同一个 helper 生效（-5 → 1、5000 → 50、0 → 系统默认）', async () => {
  await withEnv('ERIX_LOOP', '0', async () => {
    warnings = [];
    const negative = createEndlessToolExpertService(-5);
    const negativeEvents = [];
    await createLoop().run(negative, createInput({ onDelta: event => negativeEvents.push(event) }));
    const negativeReached = negativeEvents.filter(event => event.type === 'tool_limit_reached');
    assert.equal(negativeReached.length, 1, '旧循环也要吐 tool_limit_reached');
    assert.equal(negativeReached[0].totalRounds, MAX_TOOL_ROUNDS_MIN,
      '旧循环的 MAX_TOOL_ROUNDS 也必须被夹成 1（裸 || 时为 -5，循环一次都不进）');
    assert.ok(negative.getStreamCalls() >= 1, '旧循环里工具轮必须真的执行过');
    assertClampWarned(warnings, -5, MAX_TOOL_ROUNDS_MIN);

    warnings = [];
    const huge = createEndlessToolExpertService(5000);
    const hugeEvents = [];
    await createLoop().run(huge, createInput({ onDelta: event => hugeEvents.push(event) }));
    const hugeReached = hugeEvents.filter(event => event.type === 'tool_limit_reached');
    assert.equal(hugeReached.length, 1, '旧循环在 50 轮上限处也要吐 tool_limit_reached');
    assert.equal(hugeReached[0].totalRounds, MAX_TOOL_ROUNDS_MAX,
      '旧循环同样不许把 5000 当成循环上界');
    assertClampWarned(warnings, 5000, MAX_TOOL_ROUNDS_MAX);

    warnings = [];
    const inherited = createEndlessToolExpertService(0);
    const inheritedEvents = [];
    await createLoop().run(inherited, createInput({ onDelta: event => inheritedEvents.push(event) }));
    const inheritedReached = inheritedEvents.filter(event => event.type === 'tool_limit_reached');
    assert.equal(inheritedReached.length, 1);
    assert.equal(inheritedReached[0].totalRounds, FAKE_SYSTEM_DEFAULT_MAX_ROUNDS,
      '旧循环里 0 也必须回系统默认');
    assert.deepEqual(clampWarnings(warnings), [], '0 是既有正常语义，不该有告警');
  });
});

test('消费点不误伤：合法值 3 在两条循环里都原样生效且无告警', async () => {
  warnings = [];
  const { events } = await collectRun(
    createLoop(),
    createEndlessToolExpertService(3),
  );
  const { reached } = limitEvents(events);
  assert.equal(reached[0].totalRounds, 3);
  assert.deepEqual(clampWarnings(warnings), [], '合法值不该触发夹取告警');

  await withEnv('ERIX_LOOP', '0', async () => {
    warnings = [];
    const legacyEvents = [];
    await createLoop().run(
      createEndlessToolExpertService(3),
      createInput({ onDelta: event => legacyEvents.push(event) }),
    );
    const legacyReached = legacyEvents.filter(event => event.type === 'tool_limit_reached');
    assert.equal(legacyReached[0].totalRounds, 3);
    assert.deepEqual(clampWarnings(warnings), [], '合法值不该触发夹取告警');
  });
});

// ==================== 种子侧边界（issue #1176）====================

/**
 * 两处「锚点清洗专家」种子写入的 max_tool_rounds 必须落在约定区间内。
 *
 * 历史上它们是硬编码的 60：越界值在 #1166 之前能直接落库，之后靠运行时
 * `resolveEffectiveMaxToolRounds` 夹回 50 —— 功能没坏，但每次清洗都刷一条
 * `[MaxToolRounds] 已夹取` 告警（dev 库里那一行就是这么来的）。Eric 拍板改成 50。
 *
 * 断言刻意不用 grep 断字符串：数值是从源码里**解析**出来的，标识符则解析出名字后
 * 按**真实导入的常量值**判定 —— 把 60 改回来、或换成一个未知变量，都会红。
 */
const SEED_SITES = [
  { file: 'scripts/setup-anchor-expert.mjs', label: '命令行建专家（POST /api/experts 的 body）' },
  { file: 'apps/standard-mgr/server/service.js', label: 'standard-mgr 自动建锚点清洗专家（Expert.create）' },
];

test('两处种子的 max_tool_rounds 解析出来都落在 1–50（#1176：历史上是硬编码 60）', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../..', import.meta.url));
  // 常量本身走真实 import（脚本自己有主模块守卫，import 不会发起任何 HTTP 调用）
  const { ANCHOR_EXPERT_MAX_TOOL_ROUNDS } = await import('../../scripts/setup-anchor-expert.mjs');
  const knownValues = { ANCHOR_EXPERT_MAX_TOOL_ROUNDS };

  for (const { file, label } of SEED_SITES) {
    const source = readFileSync(root + file, 'utf8');
    const matches = [...source.matchAll(
      /\bmax_tool_rounds\s*:\s*(\$\{\s*([A-Za-z_$][\w$]*)\s*\}|[A-Za-z_$][\w$]*|-?\d+(?:\.\d+)?)/g,
    )];
    assert.ok(matches.length >= 1, `${file} 里找不到 max_tool_rounds 种子（${label}）—— 种子被删了？`);

    for (const match of matches) {
      const raw = match[1];
      const identifier = match[2] ?? (/^[A-Za-z_$]/.test(raw) ? raw : null);
      let value;
      if (identifier) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(knownValues, identifier),
          `${file} 的 max_tool_rounds 引用了未知标识符 ${identifier}：` +
            '请把它的真实值加进本用例的 knownValues，别把种子退回字面量',
        );
        value = knownValues[identifier];
      } else {
        value = Number(raw);
      }

      assert.ok(
        Number.isInteger(value),
        `${file} 的 max_tool_rounds=${raw} 解析出 ${value}，必须是整数`,
      );
      assert.ok(
        value >= MAX_TOOL_ROUNDS_MIN && value <= MAX_TOOL_ROUNDS_MAX,
        `${file} 的 max_tool_rounds=${raw} 解析出 ${value}，越出约定区间 `
          + `${MAX_TOOL_ROUNDS_MIN}-${MAX_TOOL_ROUNDS_MAX}（写入侧会被 ctx.error 拒绝、`
          + '运行时会被夹取并刷告警）',
      );
      // 与写入侧判据同源：能直接落库的值才配当种子
      assert.ok(isValidMaxToolRounds(value), `${file} 的 max_tool_rounds=${value} 不是合法种子值`);
    }
  }
});

test('种子常量与运行时边界常量不互相漂移：ANCHOR_EXPERT_MAX_TOOL_ROUNDS 就是区间上界（#1176）', async () => {
  const { ANCHOR_EXPERT_MAX_TOOL_ROUNDS } = await import('../../scripts/setup-anchor-expert.mjs');
  assert.ok(
    ANCHOR_EXPERT_MAX_TOOL_ROUNDS <= MAX_TOOL_ROUNDS_MAX,
    `种子 ${ANCHOR_EXPERT_MAX_TOOL_ROUNDS} 超过 MAX_TOOL_ROUNDS_MAX=${MAX_TOOL_ROUNDS_MAX}`,
  );
  assert.ok(
    ANCHOR_EXPERT_MAX_TOOL_ROUNDS >= MAX_TOOL_ROUNDS_MIN,
    `种子 ${ANCHOR_EXPERT_MAX_TOOL_ROUNDS} 低于 MAX_TOOL_ROUNDS_MIN=${MAX_TOOL_ROUNDS_MIN}`,
  );
  assert.equal(
    ANCHOR_EXPERT_MAX_TOOL_ROUNDS,
    MAX_TOOL_ROUNDS_MAX,
    '锚点清洗专家要的是"能给的最多轮数"，取区间上界；若有人调低上界，这条会提醒复核种子',
  );
});
