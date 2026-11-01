/** #1238 —— 聊天区滚动锚定判定（纯函数 + reducer），见 `scrollAnchor.js` 顶部注释 */

export declare const SCROLL_ANCHOR: {
  readonly NEAR_BOTTOM_PX: number
  readonly PROGRAMMATIC_GUARD_MS: number
}

export declare const SCROLL_EVENT: {
  readonly USER_SCROLL: 'user-scroll'
  readonly PROGRAMMATIC_SCROLL: 'programmatic-scroll'
  readonly CONTENT_GROWTH: 'content-growth'
  readonly JUMP_TO_BOTTOM: 'jump-to-bottom'
  readonly RESET: 'reset'
}

export interface ScrollMetrics {
  scrollTop?: number
  scrollHeight?: number
  clientHeight?: number
}

export interface ScrollAnchorState {
  followMode: boolean
  atBottom: boolean
  guardUntil: number
}

export interface ScrollAnchorEvent {
  type: string
  now?: number
  metrics?: ScrollMetrics
  status?: string | null
  userInitiated?: boolean
}

export interface ScrollAnchorDecision {
  state: ScrollAnchorState
  scrollToBottom: boolean
}

export declare function distanceToBottom(metrics?: ScrollMetrics | null): number
export declare function isNearBottom(metrics?: ScrollMetrics | null, threshold?: number): boolean
export declare function isAutoScrollBlockedStatus(status?: string | null): boolean
export declare function createScrollAnchorState(): ScrollAnchorState
export declare function isGuardActive(state?: ScrollAnchorState | null, now?: number): boolean
export declare function reduceScrollAnchor(
  state: ScrollAnchorState | null | undefined,
  event: ScrollAnchorEvent
): ScrollAnchorDecision
