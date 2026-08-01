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
  const isUserAtBottom = ref(true)
  const showScrollToBottom = ref(false)

  const scrollHeightBeforeLoad = ref(0)
  const isLoadingTriggered = ref(false)

  let streamingScrollRaf: number | null = null

  const triggerLoadMore = async () => {
    if (!messagesContainer.value || isLoadingTriggered.value) return

    isLoadingTriggered.value = true
    scrollHeightBeforeLoad.value = messagesContainer.value.scrollHeight

    try {
      const oldLength = options.messages.value.length
      await options.onLoadMore()
      await nextTick()

      if (!messagesContainer.value) return
      if (options.messages.value.length > oldLength) {
        const newScrollHeight = messagesContainer.value.scrollHeight
        messagesContainer.value.scrollTop = newScrollHeight - scrollHeightBeforeLoad.value
        isUserAtBottom.value = checkIsAtBottom()
      }
    } catch (error) {
      console.warn('[useScrollManager] load more failed:', error)
    } finally {
      isLoadingTriggered.value = false
    }
  }

  const checkIsAtBottom = () => {
    if (!messagesContainer.value) return true
    const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value
    return scrollHeight - scrollTop - clientHeight < 100
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

    isUserAtBottom.value = checkIsAtBottom()
    showScrollToBottom.value = !isUserAtBottom.value

    if (!options.hasMoreMessages.value || options.isLoadingMore.value) return

    const { scrollTop } = messagesContainer.value

    if (scrollTop < 100 && !isLoadingTriggered.value) {
      void triggerLoadMore()
    }
  }

  const handleScrollToBottom = () => {
    isUserAtBottom.value = true
    scrollToBottom()
    showScrollToBottom.value = false
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
          return
        }

        if (newLength > (oldLength || 0)) {
          if (oldLength === 0 || oldLength === undefined) {
            scrollToBottom()
            isUserAtBottom.value = true
          } else {
            if (isUserAtBottom.value) {
              scrollToBottom()
            }
          }
          showScrollToBottom.value = !checkIsAtBottom()
        }
      })
    },
    { immediate: true }
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
    if (streamingScrollRaf !== null) {
      cancelAnimationFrame(streamingScrollRaf)
      streamingScrollRaf = null
    }
  }

  return {
    messagesContainer,
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
