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
