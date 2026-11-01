import { ref, watch, nextTick, type Ref } from 'vue'
import type { ChatMessage } from '@/components/ChatWindow.vue'
import {
  SCROLL_EVENT,
  createScrollAnchorState,
  isNearBottom,
  reduceScrollAnchor,
  type ScrollAnchorDecision,
  type ScrollAnchorEvent,
  type ScrollAnchorState,
  type ScrollMetrics,
} from './scrollAnchor.js'

export interface UseScrollManagerOptions {
  messages: Ref<ChatMessage[]>
  hasMoreMessages: Ref<boolean>
  isLoadingMore: Ref<boolean>
  onLoadMore: () => Promise<unknown> | unknown
}

/**
 * 聊天区滚动管理器。
 *
 * **#1238**：是否允许自动滚底由 `scrollAnchor.js` 的纯 reducer 决定，本文件只负责
 * 「读 DOM 度量 → 派发事件 → 按结论执行滚动」。禁止在这里另写 `scrollTop = scrollHeight`
 * 的无条件滚底（那正是 issue 的缺陷）。
 */
export function useScrollManager(options: UseScrollManagerOptions) {
  const messagesContainer = ref<HTMLElement | null>(null)
  const bottomSentinel = ref<HTMLElement | null>(null)
  const isUserAtBottom = ref(true)
  const showScrollToBottom = ref(false)

  const isLoadingTriggered = ref(false)
  const historyAnchor = ref<{
    messageId: string
    offsetTop: number
    scrollHeight: number
  } | null>(null)

  let anchorState: ScrollAnchorState = createScrollAnchorState()
  let growthRaf: number | null = null
  let bottomObserver: IntersectionObserver | null = null
  let resizeObserver: ResizeObserver | null = null
  let gestureElement: HTMLElement | null = null
  let lastUserGestureAt = Number.NEGATIVE_INFINITY

  const now = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()

  const readMetrics = (): ScrollMetrics | null => {
    const container = messagesContainer.value
    if (!container) return null
    return {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    }
  }

  /** 用 'auto' 临时覆盖 CSS 的滚动行为：程序化滚动必须是一次到位的定位，不能是动画 */
  const setScrollTop = (value: number) => {
    const container = messagesContainer.value
    if (!container) return
    const original = container.style.scrollBehavior
    container.style.scrollBehavior = 'auto'
    container.scrollTop = value
    container.style.scrollBehavior = original
  }

  const scrollToBottom = () => {
    const container = messagesContainer.value
    if (!container) return
    setScrollTop(container.scrollHeight)
  }

  const applyDecision = (decision: ScrollAnchorDecision) => {
    anchorState = decision.state
    isUserAtBottom.value = decision.state.atBottom
    showScrollToBottom.value = !decision.state.atBottom
    if (decision.scrollToBottom) {
      scrollToBottom()
    }
    return decision
  }

  const dispatch = (event: ScrollAnchorEvent) => applyDecision(reduceScrollAnchor(anchorState, event))

  const checkIsAtBottom = () => isNearBottom(readMetrics() ?? {})

  // --- 用户手势识别 ---------------------------------------------------------
  // 保护窗（锚点跳转后的一段静默期）只该挡住“我们自己造成的”滚动余波，不能挡住用户。
  const markUserGesture = () => {
    lastUserGestureAt = now()
  }
  const USER_GESTURE_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const
  const isRecentUserGesture = () => now() - lastUserGestureAt < 400

  const bindGestureListeners = () => {
    const element = messagesContainer.value
    if (gestureElement === element) return
    if (gestureElement) {
      USER_GESTURE_EVENTS.forEach((name) => gestureElement?.removeEventListener(name, markUserGesture))
    }
    gestureElement = element
    if (gestureElement) {
      USER_GESTURE_EVENTS.forEach((name) =>
        gestureElement?.addEventListener(name, markUserGesture, { passive: true })
      )
    }
  }

  const unbindGestureListeners = () => {
    if (!gestureElement) return
    USER_GESTURE_EVENTS.forEach((name) => gestureElement?.removeEventListener(name, markUserGesture))
    gestureElement = null
  }

  // --- 历史消息加载（顶部锚点）---------------------------------------------
  const captureVisibleAnchor = () => {
    const container = messagesContainer.value
    if (!container) return null

    const containerTop = container.getBoundingClientRect().top
    const messageElements = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'))
    const firstVisible = messageElements.find((element) => {
      const rect = element.getBoundingClientRect()
      return rect.bottom >= containerTop
    })

    const messageId = firstVisible?.dataset.messageId
    if (!firstVisible || !messageId) {
      return {
        messageId: '',
        offsetTop: 0,
        scrollHeight: container.scrollHeight,
      }
    }

    return {
      messageId,
      offsetTop: firstVisible.getBoundingClientRect().top - containerTop,
      scrollHeight: container.scrollHeight,
    }
  }

  const restoreHistoryAnchor = () => {
    const container = messagesContainer.value
    const anchor = historyAnchor.value
    if (!container || !anchor) return

    if (anchor.messageId) {
      const target = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'))
        .find((element) => element.dataset.messageId === anchor.messageId)
      if (target) {
        const containerTop = container.getBoundingClientRect().top
        const currentOffsetTop = target.getBoundingClientRect().top - containerTop
        setScrollTop(container.scrollTop + currentOffsetTop - anchor.offsetTop)
        return
      }
    }

    setScrollTop(container.scrollTop + (container.scrollHeight - anchor.scrollHeight))
  }

  const releaseHistoryLoad = () => {
    isLoadingTriggered.value = false
    historyAnchor.value = null
  }

  const triggerLoadMore = () => {
    if (!messagesContainer.value || isLoadingTriggered.value) return

    isLoadingTriggered.value = true
    historyAnchor.value = captureVisibleAnchor()
    // 插入历史消息会改变 scrollHeight：这一段属于程序化定位，走保护窗，不许被跟随逻辑抢走
    dispatch({ type: SCROLL_EVENT.PROGRAMMATIC_SCROLL, now: now() })

    try {
      const result = options.onLoadMore()
      Promise.resolve(result).catch((error) => {
        console.warn('[useScrollManager] load more failed:', error)
        releaseHistoryLoad()
      })
    } catch (error) {
      console.warn('[useScrollManager] load more failed:', error)
      releaseHistoryLoad()
    }

    nextTick(() => {
      if (isLoadingTriggered.value && !options.isLoadingMore.value) {
        releaseHistoryLoad()
      }
    })
  }

  const lastMessageStatus = () => {
    const list = options.messages.value
    return list[list.length - 1]?.status ?? null
  }

  /** 内容增长（流式 delta / 消息追加 / 气泡高度变化）合并到一帧里判定一次 */
  const notifyContentGrowth = () => {
    if (growthRaf !== null) return
    growthRaf = requestAnimationFrame(() => {
      growthRaf = null
      dispatch({
        type: SCROLL_EVENT.CONTENT_GROWTH,
        status: lastMessageStatus(),
        metrics: readMetrics() ?? undefined,
        now: now(),
      })
    })
  }

  const setupBottomObserver = () => {
    bottomObserver?.disconnect()
    bottomObserver = null

    const container = messagesContainer.value
    const sentinel = bottomSentinel.value

    if (!container || !sentinel || typeof IntersectionObserver === 'undefined') {
      // 没有 IO 时的兜底：按当前度量判定一次（不滚底，只同步状态）
      const metrics = readMetrics()
      if (metrics) dispatch({ type: SCROLL_EVENT.USER_SCROLL, metrics, now: now() })
      return
    }

    bottomObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        // 哨兵重新可见 = 已经回到真正的底部。**只同步状态，绝不主动滚底**：
        // 旧实现在这里 `scheduleFollowScroll()`，导致“距底 1–100px”的死区每帧都被拽回底部（#1238）。
        const metrics = readMetrics()
        if (metrics) dispatch({ type: SCROLL_EVENT.USER_SCROLL, metrics, now: now() })
      },
      {
        root: container,
        threshold: 1,
      }
    )
    bottomObserver.observe(sentinel)
  }

  const handleScroll = () => {
    const metrics = readMetrics()
    if (!metrics) return

    dispatch({
      type: SCROLL_EVENT.USER_SCROLL,
      metrics,
      now: now(),
      userInitiated: isRecentUserGesture(),
    })

    if (!options.hasMoreMessages.value || options.isLoadingMore.value) return

    if ((metrics.scrollTop ?? 0) < 100 && !isLoadingTriggered.value) {
      void triggerLoadMore()
    }
  }

  const handleScrollToBottom = () => {
    dispatch({ type: SCROLL_EVENT.JUMP_TO_BOTTOM, now: now() })
  }

  const handleLoadMore = () => {
    if (!messagesContainer.value) return
    void triggerLoadMore()
  }

  /**
   * 锚点跳转：把目标消息滚到视口中间，并进入保护窗（跳转后一段时间内不被自动滚底覆盖）。
   *
   * @returns 目标元素是否存在
   */
  const jumpToMessage = (messageId: string) => {
    const container = messagesContainer.value
    if (!container) return false

    const target = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find((element) => element.dataset.messageId === messageId)
    if (!target) return false

    dispatch({ type: SCROLL_EVENT.PROGRAMMATIC_SCROLL, now: now() })

    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const offsetInContent = targetRect.top - containerRect.top + container.scrollTop
    const centered = offsetInContent - (container.clientHeight - targetRect.height) / 2
    const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
    setScrollTop(Math.min(Math.max(centered, 0), maxScrollTop))
    return true
  }

  watch(
    () => options.messages.value.length,
    (newLength, oldLength) => {
      nextTick(() => {
        if (!messagesContainer.value || newLength === 0) return

        if (isLoadingTriggered.value) {
          if (newLength > (oldLength || 0)) {
            restoreHistoryAnchor()
            releaseHistoryLoad()
          }
          return
        }

        if (newLength > (oldLength || 0)) {
          if (!oldLength) {
            // 首屏 / 切换主题：进入跟随并滚到底
            dispatch({ type: SCROLL_EVENT.RESET, now: now() })
          } else {
            notifyContentGrowth()
          }
        }
      })
    },
    { immediate: true }
  )

  watch(
    () => options.isLoadingMore.value,
    (isLoadingMore, wasLoadingMore) => {
      if (!isLoadingMore && wasLoadingMore && isLoadingTriggered.value) {
        nextTick(() => {
          releaseHistoryLoad()
        })
      }
    }
  )

  watch(
    [messagesContainer, bottomSentinel],
    () => {
      nextTick(() => {
        setupBottomObserver()
        bindGestureListeners()
      })
    },
    { flush: 'post' }
  )

  const setupResizeObserver = () => {
    resizeObserver?.disconnect()
    resizeObserver = null

    if (!messagesContainer.value || typeof ResizeObserver === 'undefined') {
      return
    }

    resizeObserver = new ResizeObserver(() => {
      if (isLoadingTriggered.value && historyAnchor.value) {
        restoreHistoryAnchor()
        return
      }
      notifyContentGrowth()
    })

    const observedElements = messagesContainer.value.querySelectorAll<HTMLElement>('[data-message-id]')
    observedElements.forEach((element) => resizeObserver?.observe(element))
  }

  watch(
    [messagesContainer, () => options.messages.value.length],
    () => {
      nextTick(setupResizeObserver)
    },
    { flush: 'post', immediate: true }
  )

  // 流式 delta：最后一条消息的正文增长（是否真的滚底交给 reducer 判定）
  watch(
    () => options.messages.value[options.messages.value.length - 1]?.content,
    () => {
      notifyContentGrowth()
    }
  )

  const cleanup = () => {
    bottomObserver?.disconnect()
    bottomObserver = null
    resizeObserver?.disconnect()
    resizeObserver = null
    unbindGestureListeners()
    if (growthRaf !== null) {
      cancelAnimationFrame(growthRaf)
      growthRaf = null
    }
  }

  return {
    messagesContainer,
    bottomSentinel,
    isUserAtBottom,
    showScrollToBottom,
    scrollToBottom,
    handleScroll,
    handleScrollToBottom,
    handleLoadMore,
    jumpToMessage,
    checkIsAtBottom,
    cleanup,
  }
}
