<template>
  <div ref="messagesContainer" class="messages-container" @scroll="handleScroll">
    <div v-if="hasMoreMessages" class="load-more-top">
      <button
        class="btn-load-more"
        :disabled="isLoadingMore"
        @click="handleLoadMore"
      >
        {{ isLoadingMore ? $t('common.loading') : $t('chat.loadMoreHistory') }}
      </button>
    </div>

    <div v-if="messages.length === 0" class="empty-state">
      <p>{{ $t('chat.emptyState') }}</p>
    </div>

    <MessageItem
      v-for="message in messages"
      :key="message.id"
      :message="message"
      :all-messages="messages"
      :expert-avatar="expertAvatar"
      :highlighted="highlightedMessageId === message.id"
      @retry="$emit('retry', $event)"
      @jump-to-message="handleJumpToMessage"
    />

    <div v-if="isLoading" class="message assistant">
      <div class="message-avatar">
        <div
          class="avatar-image"
          :style="expertAvatar ? { backgroundImage: `url(${expertAvatar})` } : {}"
        >
          <span v-if="!expertAvatar">🤖</span>
        </div>
      </div>
      <div class="message-content">
        <div class="thinking-indicator">{{ $t('chat.thinking') }}</div>
      </div>
    </div>

    <div ref="bottomSentinel" class="bottom-sentinel" aria-hidden="true"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import MessageItem from './MessageItem.vue'
import { useScrollManager } from '@/composables/useScrollManager'
import type { ChatMessage } from './ChatWindow.vue'

const props = defineProps<{
  messages: ChatMessage[]
  isLoading?: boolean
  hasMoreMessages?: boolean
  isLoadingMore?: boolean
  expertAvatar?: string
}>()

const emit = defineEmits<{
  loadMore: []
  retry: [message: ChatMessage]
}>()

const highlightedMessageId = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | null = null

const handleJumpToMessage = (messageId: string) => {
  highlightedMessageId.value = messageId

  if (messagesContainer.value) {
    const target = messagesContainer.value.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  if (highlightTimer) {
    clearTimeout(highlightTimer)
  }

  highlightTimer = setTimeout(() => {
    highlightedMessageId.value = null
    highlightTimer = null
  }, 2000)
}

const {
  messagesContainer,
  bottomSentinel,
  showScrollToBottom,
  handleScroll,
  handleScrollToBottom,
  handleLoadMore,
  scrollToBottom,
  cleanup,
} = useScrollManager({
  messages: computed(() => props.messages),
  hasMoreMessages: computed(() => props.hasMoreMessages ?? false),
  isLoadingMore: computed(() => props.isLoadingMore ?? false),
  onLoadMore: () => emit('loadMore'),
})

defineExpose({
  scrollToBottom,
  handleScrollToBottom,
  messagesContainer,
  bottomSentinel,
  showScrollToBottom,
  cleanup,
})
</script>

<style scoped>
.messages-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  scroll-behavior: smooth;
  position: relative;
}

.load-more-top {
  display: flex;
  justify-content: center;
  padding: 8px 0 16px;
  margin-bottom: 8px;
  position: relative;
  z-index: 1;
}

.btn-load-more {
  padding: 8px 16px;
  background: var(--secondary-bg, #f5f5f5);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 16px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-load-more:hover:not(:disabled) {
  background: var(--hover-bg, #e8e8e8);
  color: var(--primary-color, #2196f3);
}

.btn-load-more:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary, #666);
  font-size: 14px;
  position: relative;
  z-index: 1;
}

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  position: relative;
  z-index: 1;
}

.message.assistant {
  flex-direction: row;
}

.message-avatar {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--avatar-bg, #f0f0f0);
  border-radius: 50%;
  font-size: 18px;
}

.avatar-image {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-content {
  max-width: 70%;
  padding: 12px 16px;
  border-radius: 16px;
  background: var(--message-bg, #f5f5f5);
  word-break: break-word;
  border-bottom-left-radius: 4px;
}

.thinking-indicator {
  color: var(--text-secondary, #666);
  font-style: italic;
}

.bottom-sentinel {
  width: 100%;
  height: 1px;
}
</style>
