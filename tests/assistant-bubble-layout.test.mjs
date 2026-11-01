/**
 * #1237 切片 B（c）—— **空气泡规则八格**（`frontend/src/components/assistantBubbleLayout.js`）
 *
 * 缺陷：erix 路径“每轮一行”，纯工具轮 / 纯思考轮的 `messages.content` 是空串；旧渲染对每行都
 * 输出完整气泡 ⇒ 界面上一串空气泡（生产实测该主题 12 个）。
 *
 * 本文件把八格（正文空/非空 × 思考空/非空 × 有无工具）逐格钉住，外加三种“必须仍是完整气泡”的
 * 例外（streaming / sending / error / timeout）。前端没有单测框架，规则抽成 `.js` 纯函数就是为了
 * 能被 `node --test` 直接跑；真机渲染结果另见报告里的 DOM 断言。
 *
 * 跑法：`node --test tests/assistant-bubble-layout.test.mjs`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSISTANT_LAYOUT,
  countToolCalls,
  resolveAssistantLayout,
} from '../frontend/src/components/assistantBubbleLayout.js';

const base = (overrides = {}) => ({
  id: 'msg-1',
  role: 'assistant',
  content: '',
  reasoning_content: null,
  run_reasoning_content: null,
  tool_calls: null,
  status: 'completed',
  ...overrides,
});

const layoutOf = (message, options) => resolveAssistantLayout(message, options);

test('格1 正文非空 + 思考非空 + 有工具 ⇒ 完整气泡', () => {
  const message = base({ content: '正文', reasoning_content: '思考', tool_calls: '[{"name":"x"}]' });
  assert.equal(layoutOf(message, { hasToolCalls: true }), ASSISTANT_LAYOUT.BUBBLE);
});

test('格2 正文非空 + 思考非空 + 无工具 ⇒ 完整气泡', () => {
  const message = base({ content: '正文', reasoning_content: '思考' });
  assert.equal(layoutOf(message), ASSISTANT_LAYOUT.BUBBLE);
});

test('格3 正文非空 + 思考为空 + 有工具 ⇒ 完整气泡', () => {
  const message = base({ content: '正文', tool_calls: '[{"name":"x"}]' });
  assert.equal(layoutOf(message, { hasToolCalls: true }), ASSISTANT_LAYOUT.BUBBLE);
});

test('格4 正文非空 + 思考为空 + 无工具 ⇒ 完整气泡', () => {
  assert.equal(layoutOf(base({ content: '正文' })), ASSISTANT_LAYOUT.BUBBLE);
});

test('格5 正文为空 + 思考非空 + 有工具 ⇒ 紧凑行（空气泡消失）', () => {
  const message = base({ reasoning_content: '思考', tool_calls: '[{"name":"x"}]' });
  assert.equal(layoutOf(message, { hasToolCalls: true }), ASSISTANT_LAYOUT.COMPACT);
});

test('格6 正文为空 + 思考非空 + 无工具 ⇒ 紧凑行（纯思考轮）', () => {
  assert.equal(layoutOf(base({ reasoning_content: '思考' })), ASSISTANT_LAYOUT.COMPACT);
});

test('格7 正文为空 + 思考为空 + 有工具 ⇒ 紧凑行（纯工具轮）', () => {
  const message = base({ tool_calls: '[{"name":"x"}]' });
  assert.equal(layoutOf(message, { hasToolCalls: true }), ASSISTANT_LAYOUT.COMPACT);
});

test('格8 正文为空 + 思考为空 + 无工具 ⇒ 不渲染（hidden）', () => {
  assert.equal(layoutOf(base()), ASSISTANT_LAYOUT.HIDDEN);
});

test('整段思考也算“有思考”：正文为空但只有 run_reasoning_content ⇒ 紧凑行而不是 hidden', () => {
  assert.equal(
    layoutOf(base({ run_reasoning_content: '整段思考' })),
    ASSISTANT_LAYOUT.COMPACT,
  );
});

test('纯空白正文按空正文处理（`"\\n\\n"` 不是正文）', () => {
  assert.equal(layoutOf(base({ content: '  \n\t ' })), ASSISTANT_LAYOUT.HIDDEN);
  assert.equal(
    layoutOf(base({ content: '  \n\t ', reasoning_content: '思考' })),
    ASSISTANT_LAYOUT.COMPACT,
  );
});

test('流式中（streaming/sending）即使正文为空也必须给完整气泡（要显示打字指示器）', () => {
  assert.equal(layoutOf(base({ status: 'streaming' })), ASSISTANT_LAYOUT.BUBBLE);
  assert.equal(layoutOf(base({ status: 'sending' })), ASSISTANT_LAYOUT.BUBBLE);
});

test('错误/超时态即使正文为空也必须给完整气泡（要显示错误文案与重试按钮）', () => {
  assert.equal(layoutOf(base({ status: 'error' })), ASSISTANT_LAYOUT.BUBBLE);
  assert.equal(layoutOf(base({ status: 'timeout' })), ASSISTANT_LAYOUT.BUBBLE);
});

test('非 assistant 角色（user/tool）永远走各自既有分支，不被本规则收成紧凑行', () => {
  assert.equal(layoutOf(base({ role: 'user', content: '' })), ASSISTANT_LAYOUT.BUBBLE);
  assert.equal(layoutOf(base({ role: 'tool', content: '' })), ASSISTANT_LAYOUT.BUBBLE);
});

// ============================================================================
// #1237 切片 C（审计 D2）：`tool_calls === '[]'` 不得绕过 hidden 规则
// ============================================================================
//
// 缺陷：旧判据是 `options.hasToolCalls === true || Boolean(message.tool_calls)`；`'[]'` 是非空
// 字符串 ⇒ 真 ⇒ 本该 hidden 的空行被留成一条空紧凑行（MessageItem 已经传了解析后的数量，
// 那个 `|| Boolean(...)` 是自伤兜底）。判据改为**解析后至少一个工具调用**。

/** 空正文、无思考、`tool_calls` 为空的 assistant 行必须真的不渲染。 */
const assertHiddenWithEmptyToolCalls = (toolCalls, label) => {
  // 不传 options（历史接口调用方 / 纯函数直接调用）
  assert.equal(layoutOf(base({ tool_calls: toolCalls })), ASSISTANT_LAYOUT.HIDDEN, `${label}：不传 options 也必须 hidden`);
  // 传显式“无工具”覆盖（MessageItem 的真实调用形状：`'[]'` 解析后是 0 个）
  assert.equal(
    layoutOf(base({ tool_calls: toolCalls }), { hasToolCalls: false }),
    ASSISTANT_LAYOUT.HIDDEN,
    `${label}：hasToolCalls=false 时必须 hidden`,
  );
};

test('D2：`tool_calls: "[]"` ⇒ hidden（空工具集不是“有工具”）', () => {
  assertHiddenWithEmptyToolCalls('[]', "'[]'");
});

test('D2：空工具集的其他等价形状（`[]` / `"[ ]"` / `""`）⇒ hidden', () => {
  assertHiddenWithEmptyToolCalls([], '[]（已解析数组）');
  assertHiddenWithEmptyToolCalls('[ ]', "'[ ]'（带空格）");
  assertHiddenWithEmptyToolCalls('', "''（空串）");
  assertHiddenWithEmptyToolCalls(null, 'null');
  assertHiddenWithEmptyToolCalls(undefined, 'undefined');
});

test('D2：`tool_calls: "[{}]"` ⇒ compact（一个工具调用就算有工具，即便字段为空对象）', () => {
  assert.equal(layoutOf(base({ tool_calls: '[{}]' })), ASSISTANT_LAYOUT.COMPACT);
  assert.equal(
    layoutOf(base({ tool_calls: '[{}]' }), { hasToolCalls: true }),
    ASSISTANT_LAYOUT.COMPACT,
  );
  // 已解析数组 / 单个对象（历史行 `tool_calls` 是对象形状）同样算有工具
  assert.equal(layoutOf(base({ tool_calls: [{ name: 'x' }] })), ASSISTANT_LAYOUT.COMPACT);
  assert.equal(layoutOf(base({ tool_calls: { name: 'x' } })), ASSISTANT_LAYOUT.COMPACT);
});

test('D2：非法 JSON 字符串 ⇒ 不因工具而留行（hidden，解析失败按无工具）', () => {
  assertHiddenWithEmptyToolCalls('{not json', "'{not json'");
  assertHiddenWithEmptyToolCalls('undefined', "'undefined'（字符串）");
  assertHiddenWithEmptyToolCalls('null', "'null'（JSON null）");
  // 但正文/思考非空时，非法 tool_calls 也不能把它压成 hidden
  assert.equal(
    layoutOf(base({ content: '正文', tool_calls: '{not json' })),
    ASSISTANT_LAYOUT.BUBBLE,
  );
  assert.equal(
    layoutOf(base({ reasoning_content: '思考', tool_calls: '{not json' })),
    ASSISTANT_LAYOUT.COMPACT,
  );
});

test('D2：`options.hasToolCalls === true` 仍是显式覆盖（外部解析结果优先）', () => {
  assert.equal(
    layoutOf(base({ tool_calls: '[]' }), { hasToolCalls: true }),
    ASSISTANT_LAYOUT.COMPACT,
    '显式覆盖 true ⇒ 按有工具处理（即便 message.tool_calls 是空集）',
  );
  assert.equal(
    layoutOf(base({ tool_calls: '[]' }), { hasToolCalls: 'yes' }),
    ASSISTANT_LAYOUT.HIDDEN,
    '非严格 true 不生效（不做真值转换）',
  );
});

test('D2：`countToolCalls` 口径与 useToolDataParser.parseToolCallsToArray 一致', () => {
  assert.equal(countToolCalls(null), 0);
  assert.equal(countToolCalls('[]'), 0);
  assert.equal(countToolCalls('  [ ]  '), 0);
  assert.equal(countToolCalls(''), 0);
  assert.equal(countToolCalls('not json'), 0);
  assert.equal(countToolCalls([]), 0);
  assert.equal(countToolCalls('[{}]'), 1);
  assert.equal(countToolCalls([{}, {}]), 2);
  assert.equal(countToolCalls({ name: 'x' }), 1);
  assert.equal(countToolCalls('{"name":"x"}'), 1);
});
