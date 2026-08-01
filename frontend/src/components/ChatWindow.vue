<template>
  <div class="chat-window">
    <div
      v-if="props.expertAvatarLarge"
      class="messages-bg-avatar"
      :style="{ backgroundImage: `url(${props.expertAvatarLarge})` }"
    ></div>

    <MessageList
      ref="messageListRef"
      :messages="props.messages"
      :is-loading="props.isLoading"
      :has-more-messages="props.hasMoreMessages"
      :is-loading-more="props.isLoadingMore"
      :expert-avatar="props.expertAvatar"
      @load-more="$emit('loadMore')"
      @retry="$emit('retry', $event)"
    />

    <button
      v-if="messageListRef?.showScrollToBottom"
      class="scroll-to-bottom-btn"
      @click="messageListRef?.handleScrollToBottom()"
      :title="$t('chat.scrollToBottom') || '滚动到底部'"
    >
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 16L6 10H18L12 16Z" fill="currentColor"/>
      </svg>
    </button>

    <ChatInputArea
      :is-loading="props.isLoading"
      :disabled="props.disabled"
      :custom-placeholder="props.customPlaceholder"
      @send="$emit('send', $event)"
      @stop="$emit('stop')"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import MessageList from './MessageList.vue'
import ChatInputArea from './ChatInputArea.vue'
import type { Message } from '@/types'

export type ChatMessage = Pick<Message, 'id' | 'request_id' | 'role' | 'content' | 'status' | 'reasoning_content' | 'tool_calls'> & {
  created_at?: string
  updated_at?: string
  metadata?: {
    [key: string]: unknown
  }
}

const props = defineProps<{
  messages: ChatMessage[]
  isLoading?: boolean
  disabled?: boolean
  hasMoreMessages?: boolean
  isLoadingMore?: boolean
  expertAvatar?: string
  expertAvatarLarge?: string
  customPlaceholder?: string
}>()

defineEmits<{
  send: [content: string]
  retry: [message: ChatMessage]
  loadMore: []
  stop: []
}>()

const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)

onUnmounted(() => {
  messageListRef.value?.cleanup()
})

defineExpose({
  scrollToBottom: () => messageListRef.value?.scrollToBottom(),
})
</script>

<style scoped>
.chat-window {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--chat-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 0 0 12px 12px;
  overflow: hidden;
  position: relative;
}

.messages-bg-avatar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 65px;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  opacity: 0.15;
  filter: blur(2px);
  pointer-events: none;
  z-index: 0;
}

.scroll-to-bottom-btn {
  position: absolute;
  bottom: 90px;
  right: 24px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 10;
}

.scroll-to-bottom-btn:hover {
  background: var(--primary-color, #2196f3);
  border-color: var(--primary-color, #2196f3);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(33, 150, 243, 0.3);
}

.scroll-to-bottom-btn:hover svg {
  color: white;
}

.scroll-to-bottom-btn svg {
  width: 20px;
  height: 20px;
  color: var(--text-secondary, #666);
  transition: color 0.2s;
}

</style>
