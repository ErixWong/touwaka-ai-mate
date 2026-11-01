/**
 * #1238 —— **聊天区滚动锚定判定（唯一实现）**
 *
 * 缺陷（真机实测，见报告「机制定位」）：`.messages-container` 的“自动滚到底”会抢滚动——
 * 任何**程序化**滚动（`scrollTop = X`、`scrollIntoView({block:'start'|'center'})`）都被立刻拽回底部。
 *
 * 根因不是“无条件滚底”，而是**三处判定用了不同的带宽**，形成自增强的钉子：
 *
 * 1. `handleScroll` 用 `scrollHeight - scrollTop - clientHeight < 100` 判“在底部附近” ⇒ 进入 follow；
 * 2. 底部哨兵（1px，threshold 1）的 IntersectionObserver 只要**离开视口 1px** 就报 not-intersecting，
 *    而它的回调里写着 `else if (followMode) scheduleFollowScroll()` ⇒ 主动滚底；
 * 3. 于是“距底 1–100px”这一段是**死区**：follow 还开着，但哨兵已不可见 ⇒ 每一帧都被拽回底部。
 *
 * 而 CSS `scroll-behavior: smooth` 让每次程序化滚动变成一段动画，动画的头几帧必然落在死区里 ⇒
 * 动画刚起步就被 `scrollToBottom(true)` 打断并钉回底部。用户用触控板/精细滚轮上翻（<100px/次）
 * 同样落在死区 ⇒ 也上不去。
 *
 * 本模块把判定抽成**纯函数 + 纯 reducer**（无 DOM、无 Vue），好让 `node --test` 逐格钉住
 * （`tests/scroll-anchor.test.mjs`）；DOM 侧的滚动只由 `useScrollManager` 按 reducer 的
 * `scrollToBottom` 结论执行。参考 #1237 切片 B 的 `components/assistantBubbleLayout.js` 做法。
 */

/** 判定参数（唯一来源，禁止在调用处另写字面量） */
export const SCROLL_ANCHOR = Object.freeze({
  /**
   * “在底部附近”的阈值（px）。
   *
   * 取 24 而不是旧值 100：100px 的带宽会让**一次精细上翻**（触控板 40px/次）仍被判为“在底部”，
   * 于是新内容一到就拽回底部——这正是 issue 里“手动上翻后被抢”的体感来源。24px 只吸收
   * 亚像素/行高抖动，超过一次正常滚动即视为“用户已经离开底部”。
   */
  NEAR_BOTTOM_PX: 24,
  /**
   * 程序化滚动保护窗（ms）。
   *
   * 时长依据：Chromium 的平滑滚动在长距离下约 400–700ms 走完（`scroll-behavior: smooth` 已在本单
   * 移除，但锚点跳转/历史锚点恢复仍可能在跳转后触发一次重排与内容增长），1200ms 给足余量，
   * 同时短于“用户下一次主动滚动”的典型间隔，不至于长时间吞掉用户意图（用户手势还能提前解除，
   * 见 `USER_SCROLL` 的 `userInitiated`）。
   */
  PROGRAMMATIC_GUARD_MS: 1200,
});

/** reducer 事件类型 */
export const SCROLL_EVENT = Object.freeze({
  /** 容器 scroll 事件（含用户手势与程序化滚动的副产物） */
  USER_SCROLL: 'user-scroll',
  /** 我们主动发起的滚动（锚点跳转 / 历史锚点恢复）：开启保护窗，并停止跟随 */
  PROGRAMMATIC_SCROLL: 'programmatic-scroll',
  /** 内容增长（流式 delta / 消息追加 / 气泡高度变化） */
  CONTENT_GROWTH: 'content-growth',
  /** 点“回到底部”按钮 */
  JUMP_TO_BOTTOM: 'jump-to-bottom',
  /** 首屏 / 切换主题：回到跟随态并滚到底 */
  RESET: 'reset',
});

/**
 * 这些状态下**不再自动滚底**：报错、超时、被停止、被取消之后继续把用户往下拽只会让人看不到
 * 错误文案与重试按钮。
 */
const AUTO_SCROLL_BLOCKED_STATUSES = new Set(['error', 'timeout', 'stopped', 'cancelled']);

/**
 * 距底部的像素数（负值/脏数据钳到 0）。
 *
 * @param {{scrollTop?: number, scrollHeight?: number, clientHeight?: number}} metrics
 * @returns {number}
 */
export function distanceToBottom(metrics) {
  const scrollTop = Number(metrics?.scrollTop) || 0;
  const scrollHeight = Number(metrics?.scrollHeight) || 0;
  const clientHeight = Number(metrics?.clientHeight) || 0;
  const distance = scrollHeight - clientHeight - scrollTop;
  if (!Number.isFinite(distance)) return 0;
  return distance > 0 ? distance : 0;
}

/**
 * 是否“在底部附近”。
 *
 * @param {{scrollTop?: number, scrollHeight?: number, clientHeight?: number}} metrics
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function isNearBottom(metrics, threshold = SCROLL_ANCHOR.NEAR_BOTTOM_PX) {
  return distanceToBottom(metrics) <= threshold;
}

/**
 * 该状态是否禁止自动滚底。
 *
 * @param {string | null | undefined} status
 * @returns {boolean}
 */
export function isAutoScrollBlockedStatus(status) {
  return typeof status === 'string' && AUTO_SCROLL_BLOCKED_STATUSES.has(status);
}

/**
 * 初始状态：跟随 + 视为在底部 + 无保护窗。
 *
 * @returns {{followMode: boolean, atBottom: boolean, guardUntil: number}}
 */
export function createScrollAnchorState() {
  return { followMode: true, atBottom: true, guardUntil: 0 };
}

/**
 * 保护窗是否生效（`now` 取同一个时钟，通常是 `performance.now()` 或 `Date.now()`）。
 *
 * @param {{guardUntil?: number}} state
 * @param {number} now
 * @returns {boolean}
 */
export function isGuardActive(state, now) {
  const guardUntil = Number(state?.guardUntil) || 0;
  return (Number(now) || 0) < guardUntil;
}

/**
 * 滚动锚定状态机（纯函数：同样的输入必得同样的输出，不改入参）。
 *
 * @param {{followMode?: boolean, atBottom?: boolean, guardUntil?: number}} state
 * @param {{type: string, now?: number, metrics?: object, status?: string | null, userInitiated?: boolean}} event
 * @returns {{state: {followMode: boolean, atBottom: boolean, guardUntil: number}, scrollToBottom: boolean}}
 */
export function reduceScrollAnchor(state, event) {
  const current = state || createScrollAnchorState();
  const now = Number(event?.now) || 0;
  const next = (patch, scrollToBottom) => ({
    state: {
      followMode: patch.followMode ?? current.followMode,
      atBottom: patch.atBottom ?? current.atBottom,
      guardUntil: patch.guardUntil ?? current.guardUntil,
    },
    scrollToBottom: scrollToBottom === true,
  });

  switch (event?.type) {
    case SCROLL_EVENT.USER_SCROLL: {
      // 用户手势（wheel / touch / key）优先：立刻解除保护窗，交还给用户。
      if (event.userInitiated === true) {
        const atBottom = isNearBottom(event.metrics);
        return next({ atBottom, followMode: atBottom, guardUntil: 0 }, false);
      }
      // 保护窗内的 scroll 事件多半是我们自己那次跳转的余波，不能拿来改判 followMode。
      if (isGuardActive(current, now)) return next({}, false);
      const atBottom = isNearBottom(event.metrics);
      return next({ atBottom, followMode: atBottom }, false);
    }

    case SCROLL_EVENT.PROGRAMMATIC_SCROLL:
      return next(
        {
          followMode: false,
          atBottom: false,
          guardUntil: now + SCROLL_ANCHOR.PROGRAMMATIC_GUARD_MS,
        },
        false
      );

    case SCROLL_EVENT.CONTENT_GROWTH: {
      if (isAutoScrollBlockedStatus(event.status)) return next({}, false);
      if (!current.followMode) return next({}, false);
      if (isGuardActive(current, now)) return next({}, false);
      return next({ atBottom: true }, true);
    }

    case SCROLL_EVENT.JUMP_TO_BOTTOM:
      return next({ followMode: true, atBottom: true, guardUntil: 0 }, true);

    case SCROLL_EVENT.RESET:
      return next({ followMode: true, atBottom: true, guardUntil: 0 }, true);

    default:
      return next({}, false);
  }
}
