import { ref, watch, nextTick, type Ref } from 'vue'
import type { ChatMessage } from '@/components/ChatWindow.vue'

export interface UseScrollManagerOptions {
  messages: Ref<ChatMessage[]>
  hasMoreMessages: Ref<boolean>
  isLoadingMore: Ref<boolean>
  onLoadMore: () => Promise<unknown> | unknown
}

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

  let streamingScrollRaf: number | null = null
  let bottomObserver: IntersectionObserver | null = null

  const setBottomState = (atBottom: boolean) => {
    isUserAtBottom.value = atBottom
    showScrollToBottom.value = !atBottom
  }

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
        container.scrollTop += currentOffsetTop - anchor.offsetTop
        return
      }
    }

    container.scrollTop = container.scrollHeight - anchor.scrollHeight
  }

  const releaseHistoryLoad = () => {
    isLoadingTriggered.value = false
    historyAnchor.value = null
  }

  const triggerLoadMore = () => {
    if (!messagesContainer.value || isLoadingTriggered.value) return

    isLoadingTriggered.value = true
    historyAnchor.value = captureVisibleAnchor()

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

  const checkIsAtBottom = () => {
    if (!messagesContainer.value) return true
    const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value
    return scrollHeight - scrollTop - clientHeight < 100
  }

  const setupBottomObserver = () => {
    bottomObserver?.disconnect()
    bottomObserver = null

    if (!messagesContainer.value || !bottomSentinel.value || typeof IntersectionObserver === 'undefined') {
      setBottomState(checkIsAtBottom())
      return
    }

    bottomObserver = new IntersectionObserver(
      ([entry]) => {
        setBottomState(entry?.isIntersecting || false)
      },
      {
        root: messagesContainer.value,
        threshold: 1,
      }
    )
    bottomObserver.observe(bottomSentinel.value)
  }

  const scrollToBottom = (instant = false) => {
    if (!messagesContainer.value) return

    if (instant) {
      const original = messagesContainer.value.style.scrollBehavior
      messagesContainer.value.style.scrollBehavior = 'auto'
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
      messagesContainer.value.style.scrollBehavior = original
    } else {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  }

  const handleScroll = () => {
    if (!messagesContainer.value) return

    if (!bottomObserver) {
      setBottomState(checkIsAtBottom())
    }

    if (!options.hasMoreMessages.value || options.isLoadingMore.value) return

    const { scrollTop } = messagesContainer.value

    if (scrollTop < 100 && !isLoadingTriggered.value) {
      void triggerLoadMore()
    }
  }

  const handleScrollToBottom = () => {
    setBottomState(true)
    scrollToBottom()
  }

  const handleLoadMore = () => {
    if (!messagesContainer.value) return
    void triggerLoadMore()
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
            setBottomState(checkIsAtBottom())
          }
          return
        }

        if (newLength > (oldLength || 0)) {
          if (oldLength === 0 || oldLength === undefined) {
            scrollToBottom()
            setBottomState(true)
          } else {
            if (isUserAtBottom.value) {
              scrollToBottom()
            }
          }
          if (!bottomObserver) {
            setBottomState(checkIsAtBottom())
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
      nextTick(setupBottomObserver)
    },
    { flush: 'post' }
  )

  watch(
    () => options.messages.value[options.messages.value.length - 1]?.content,
    () => {
      if (isUserAtBottom.value) {
        if (streamingScrollRaf === null) {
          streamingScrollRaf = requestAnimationFrame(() => {
            streamingScrollRaf = null
            scrollToBottom(true)
          })
        }
      }
    }
  )

  const cleanup = () => {
    bottomObserver?.disconnect()
    bottomObserver = null
    if (streamingScrollRaf !== null) {
      cancelAnimationFrame(streamingScrollRaf)
      streamingScrollRaf = null
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
    checkIsAtBottom,
    cleanup,
  }
}
