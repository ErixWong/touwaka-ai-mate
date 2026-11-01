/**
 * #1238 —— **聊天区滚动锚定判定逐格测试**（`frontend/src/composables/scrollAnchor.js`）
 *
 * 缺陷：`.messages-container` 的自动滚底会抢滚动。真机实测（报告「机制定位」）：
 * - `sc.scrollTop = 3000` 被钉回 `scrollHeight - clientHeight`（9545）；
 * - `scrollIntoView({behavior:'smooth', block:'center'})` 目标停在视口外（top = -4482）；
 * - 距底 50px 的**瞬时**定位同样被拽回底部（100px 判定带 + 哨兵 IntersectionObserver 主动滚底）；
 * - 距底 150px 以上才落得住。
 *
 * 本文件把「什么情况下允许自动滚底」逐格钉住；真机行为另见报告「真机验证流水」。
 *
 * 跑法：`node --test tests/scroll-anchor.test.mjs`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCROLL_ANCHOR,
  SCROLL_EVENT,
  createScrollAnchorState,
  distanceToBottom,
  isAutoScrollBlockedStatus,
  isGuardActive,
  isNearBottom,
  reduceScrollAnchor,
} from '../frontend/src/composables/scrollAnchor.js';

/** 造一份滚动度量：scrollHeight 固定 1000，clientHeight 400，scrollTop 由「距底」反推 */
const metricsAt = (distanceFromBottom) => ({
  scrollTop: 1000 - 400 - distanceFromBottom,
  scrollHeight: 1000,
  clientHeight: 400,
});

const userScroll = (distanceFromBottom, extra = {}) => ({
  type: SCROLL_EVENT.USER_SCROLL,
  metrics: metricsAt(distanceFromBottom),
  ...extra,
});

const growth = (status = 'streaming', extra = {}) => ({
  type: SCROLL_EVENT.CONTENT_GROWTH,
  status,
  metrics: metricsAt(0),
  ...extra,
});

/** 跑一串事件，返回最后一步的判定 */
const run = (events, initial) => {
  let state = initial || createScrollAnchorState();
  let decision = { state, scrollToBottom: false };
  for (const event of events) {
    decision = reduceScrollAnchor(decision.state, event);
  }
  return decision;
};

// ---------------------------------------------------------------------------
// 1. 度量与阈值
// ---------------------------------------------------------------------------

test('距底计算：贴底为 0', () => {
  assert.equal(distanceToBottom(metricsAt(0)), 0);
  assert.equal(distanceToBottom(metricsAt(137)), 137);
});

test('距底计算：超滚（scrollTop 越界）钳到 0，脏数据不产生 NaN', () => {
  assert.equal(distanceToBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 400 }), 0);
  assert.equal(distanceToBottom(null), 0);
  assert.equal(distanceToBottom({}), 0);
  assert.equal(distanceToBottom({ scrollTop: 'x', scrollHeight: 'y', clientHeight: 'z' }), 0);
});

test('阈值边界：距底 0 / 24（=阈值）/ 25（=阈值+1）', () => {
  assert.equal(SCROLL_ANCHOR.NEAR_BOTTOM_PX, 24);
  assert.equal(isNearBottom(metricsAt(0)), true);
  assert.equal(isNearBottom(metricsAt(24)), true);
  assert.equal(isNearBottom(metricsAt(25)), false);
});

test('阈值边界：旧的 100px 带宽不再算“在底部”（issue 里的死区）', () => {
  assert.equal(isNearBottom(metricsAt(50)), false);
  assert.equal(isNearBottom(metricsAt(99)), false);
  assert.equal(isNearBottom(metricsAt(100)), false);
});

// ---------------------------------------------------------------------------
// 2. 用户在底部附近 ⇒ 跟随
// ---------------------------------------------------------------------------

test('贴底 + 内容增长 ⇒ 滚到底', () => {
  const decision = run([userScroll(0), growth()]);
  assert.equal(decision.state.followMode, true);
  assert.equal(decision.scrollToBottom, true);
});

test('距底 10px（阈值内）+ 内容增长 ⇒ 仍跟随滚底', () => {
  const decision = run([userScroll(10), growth()]);
  assert.equal(decision.state.followMode, true);
  assert.equal(decision.scrollToBottom, true);
});

// ---------------------------------------------------------------------------
// 3. 用户手动上翻 ⇒ 停止自动滚底
// ---------------------------------------------------------------------------

test('上翻到距底 200px ⇒ 退出跟随', () => {
  const decision = run([userScroll(0), userScroll(200)]);
  assert.equal(decision.state.followMode, false);
  assert.equal(decision.state.atBottom, false);
});

test('上翻后内容增长 ⇒ **不滚**（这是 issue 的核心症状）', () => {
  const decision = run([userScroll(0), userScroll(200), growth()]);
  assert.equal(decision.state.followMode, false);
  assert.equal(decision.scrollToBottom, false);
});

test('上翻 50px（旧 100px 带宽内的死区）⇒ 也必须退出跟随', () => {
  const decision = run([userScroll(0), userScroll(50), growth()]);
  assert.equal(decision.state.followMode, false);
  assert.equal(decision.scrollToBottom, false);
});

test('上翻后连续多次内容增长 ⇒ 一次都不滚', () => {
  const decision = run([
    userScroll(0),
    userScroll(400),
    growth(),
    growth(),
    growth(),
  ]);
  assert.equal(decision.scrollToBottom, false);
});

// ---------------------------------------------------------------------------
// 4. 用户自己回到底部 ⇒ 恢复跟随
// ---------------------------------------------------------------------------

test('上翻后自己滚回底部 ⇒ 恢复跟随并重新跟随增长', () => {
  const decision = run([userScroll(0), userScroll(800), userScroll(0), growth()]);
  assert.equal(decision.state.followMode, true);
  assert.equal(decision.state.atBottom, true);
  assert.equal(decision.scrollToBottom, true);
});

test('点“回到底部”按钮 ⇒ 立即滚底 + 恢复跟随（保护窗也被清掉）', () => {
  const decision = run([
    userScroll(0),
    userScroll(800),
    { type: SCROLL_EVENT.PROGRAMMATIC_SCROLL, now: 1000 },
    { type: SCROLL_EVENT.JUMP_TO_BOTTOM, now: 1200 },
  ]);
  assert.equal(decision.state.followMode, true);
  assert.equal(decision.state.atBottom, true);
  assert.equal(decision.state.guardUntil, 0);
  assert.equal(decision.scrollToBottom, true);
});

// ---------------------------------------------------------------------------
// 5. error / timeout / stopped / cancelled 之后不再滚
// ---------------------------------------------------------------------------

test('error / timeout / stopped / cancelled ⇒ 内容增长不滚底', () => {
  for (const status of ['error', 'timeout', 'stopped', 'cancelled']) {
    const decision = run([userScroll(0), growth(status)]);
    assert.equal(decision.scrollToBottom, false, `${status} 不该滚底`);
    assert.equal(isAutoScrollBlockedStatus(status), true);
  }
});

test('streaming / completed / pending ⇒ 内容增长照常滚底', () => {
  for (const status of ['streaming', 'completed', 'pending']) {
    const decision = run([userScroll(0), growth(status)]);
    assert.equal(decision.scrollToBottom, true, `${status} 应滚底`);
    assert.equal(isAutoScrollBlockedStatus(status), false);
  }
});

test('未知/缺省状态不阻塞（保守放行跟随）', () => {
  assert.equal(isAutoScrollBlockedStatus(undefined), false);
  assert.equal(isAutoScrollBlockedStatus(null), false);
  assert.equal(run([userScroll(0), { type: SCROLL_EVENT.CONTENT_GROWTH }]).scrollToBottom, true);
});

// ---------------------------------------------------------------------------
// 6. 程序化滚动保护窗（锚点跳转必须落得住）
// ---------------------------------------------------------------------------

test('程序化滚动开启保护窗：followMode 立刻关掉、窗口 1200ms', () => {
  const decision = run([{ type: SCROLL_EVENT.PROGRAMMATIC_SCROLL, now: 1000 }]);
  assert.equal(decision.state.followMode, false);
  assert.equal(decision.state.guardUntil, 1000 + SCROLL_ANCHOR.PROGRAMMATIC_GUARD_MS);
  assert.equal(decision.scrollToBottom, false);
  assert.equal(isGuardActive(decision.state, 1000), true);
  assert.equal(isGuardActive(decision.state, 2199), true);
  assert.equal(isGuardActive(decision.state, 2200), false);
});

test('保护窗内：跳转余波（scroll 事件）不得改判 followMode', () => {
  // 跳转后容器会发出 scroll 事件；若位置恰好仍落在“近底部”带内，旧实现会重新进入 follow
  // 并立刻拽回底部 —— 这正是锚点跳转落不住的那条路径。
  const decision = run([
    { type: SCROLL_EVENT.PROGRAMMATIC_SCROLL, now: 1000 },
    userScroll(10, { now: 1010 }),
  ]);
  assert.equal(decision.state.followMode, false);
  assert.equal(decision.scrollToBottom, false);
});

test('保护窗内：流式内容增长不得把视口拽回底部', () => {
  const decision = run([
    { type: SCROLL_EVENT.PROGRAMMATIC_SCROLL, now: 1000 },
    growth('streaming', { now: 1500 }),
    growth('streaming', { now: 2199 }),
  ]);
  assert.equal(decision.scrollToBottom, false);
});

test('保护窗过期后：仍不自动滚（followMode 已关），直到用户回到底部', () => {
  const decision = run([
    { type: SCROLL_EVENT.PROGRAMMATIC_SCROLL, now: 1000 },
    growth('streaming', { now: 5000 }),
  ]);
  assert.equal(decision.scrollToBottom, false);
  assert.equal(decision.state.followMode, false);
});

test('用户手势可以立刻解除保护窗（保护窗不能吞掉用户意图）', () => {
  const decision = run([
    { type: SCROLL_EVENT.PROGRAMMATIC_SCROLL, now: 1000 },
    userScroll(600, { now: 1050, userInitiated: true }),
    growth('streaming', { now: 1100 }),
  ]);
  assert.equal(decision.state.guardUntil, 0);
  assert.equal(decision.state.followMode, false);
  assert.equal(decision.scrollToBottom, false);
});

// ---------------------------------------------------------------------------
// 7. 首屏 / 主题切换 / 未知事件
// ---------------------------------------------------------------------------

test('首屏 RESET ⇒ 滚到底并进入跟随', () => {
  const decision = run([{ type: SCROLL_EVENT.RESET, now: 0 }]);
  assert.equal(decision.state.followMode, true);
  assert.equal(decision.scrollToBottom, true);
});

test('RESET 会把上翻 + 保护窗一并复位', () => {
  const decision = run([
    userScroll(0),
    userScroll(700),
    { type: SCROLL_EVENT.PROGRAMMATIC_SCROLL, now: 100 },
    { type: SCROLL_EVENT.RESET, now: 200 },
  ]);
  assert.equal(decision.state.followMode, true);
  assert.equal(decision.state.guardUntil, 0);
  assert.equal(decision.scrollToBottom, true);
});

test('未知事件不改状态、不滚底', () => {
  const initial = run([userScroll(0)]).state;
  const decision = run([{ type: 'nope' }], initial);
  assert.deepEqual(decision.state, initial);
  assert.equal(decision.scrollToBottom, false);
});

test('reducer 是纯函数：不改入参', () => {
  const initial = createScrollAnchorState();
  const snapshot = { ...initial };
  reduceScrollAnchor(initial, { type: SCROLL_EVENT.PROGRAMMATIC_SCROLL, now: 500 });
  reduceScrollAnchor(initial, growth());
  assert.deepEqual(initial, snapshot);
});

test('缺省 state 也能跑（undefined 入参不炸）', () => {
  const decision = reduceScrollAnchor(undefined, { type: SCROLL_EVENT.RESET, now: 0 });
  assert.equal(decision.state.followMode, true);
  assert.equal(decision.scrollToBottom, true);
});
