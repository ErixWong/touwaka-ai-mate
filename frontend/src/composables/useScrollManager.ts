import { ref, watch, nextTick, type Ref } from 'vue'
import type { ChatMessage } from '@/components/ChatWindow.vue'

export interface UseScrollManagerOptions {
  messages: Ref<ChatMessage[]>
  hasMoreMessages: Ref<boolean>
  isLoadingMore: Ref<boolean>
  onLoadMore: () => void
}

export function useScrollManager(options: UseScrollManagerOptions) {
  const messagesContainer = ref<HTMLElement | null>(null)
  const isUserAtBottom = ref(true)
  const showScrollToBottom = ref(false)
  const showNewMessagesHint = ref(false)
  const pendingNewMessageCount = ref(0)

  const scrollHeightBeforeLoad = ref(0)
  const isLoadingTriggered = ref(false)

  let streamingScrollRaf: number | null = null

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

    if (isUserAtBottom.value) {
      showNewMessagesHint.value = false
      pendingNewMessageCount.value = 0
    }

    if (!options.hasMoreMessages.value || options.isLoadingMore.value) return

    const { scrollTop } = messagesContainer.value

    if (scrollTop < 100 && !isLoadingTriggered.value) {
      isLoadingTriggered.value = true
      scrollHeightBeforeLoad.value = messagesContainer.value.scrollHeight
      options.onLoadMore()
    }
  }

  const handleScrollToBottom = () => {
    isUserAtBottom.value = true
    scrollToBottom()
    showScrollToBottom.value = false
    showNewMessagesHint.value = false
    pendingNewMessageCount.value = 0
  }

  const handleLoadMore = () => {
    if (!messagesContainer.value) return
    scrollHeightBeforeLoad.value = messagesContainer.value.scrollHeight
    isLoadingTriggered.value = true
    options.onLoadMore()
  }

  watch(
    () => options.messages.value.length,
    (newLength, oldLength) => {
      nextTick(() => {
        if (!messagesContainer.value || newLength === 0) return

        if (isLoadingTriggered.value && options.isLoadingMore.value === false && newLength > (oldLength || 0)) {
          const newScrollHeight = messagesContainer.value.scrollHeight
          messagesContainer.value.scrollTop = newScrollHeight - scrollHeightBeforeLoad.value
          isLoadingTriggered.value = false
          isUserAtBottom.value = checkIsAtBottom()
          return
        }

        if (newLength > (oldLength || 0)) {
          if (oldLength === 0 || oldLength === undefined) {
            scrollToBottom()
            isUserAtBottom.value = true
            showNewMessagesHint.value = false
            pendingNewMessageCount.value = 0
          } else {
            if (isUserAtBottom.value) {
              scrollToBottom()
              showNewMessagesHint.value = false
              pendingNewMessageCount.value = 0
            } else {
              pendingNewMessageCount.value += Math.max(newLength - (oldLength || 0), 1)
              showNewMessagesHint.value = true
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
    showNewMessagesHint,
    pendingNewMessageCount,
    scrollToBottom,
    handleScroll,
    handleScrollToBottom,
    handleLoadMore,
    checkIsAtBottom,
    cleanup,
  }
}
