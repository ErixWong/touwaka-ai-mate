<template>
  <div
    :data-message-id="message.id"
    class="message"
    :class="[message.role, { 'message-highlighted': highlighted }]"
  >
    <template v-if="message.role === 'tool'">
      <ToolMessageCard
        :tool-name="toolParser.getToolName(message)"
        :success="toolParser.getToolData(message).success"
        :duration="toolParser.getToolData(message).duration"
        :context="toolParser.getToolData(message).context"
        :formatted-time="toolParser.formatToolTime(message)"
        :arguments-formatted="toolParser.formatToolArguments(message)"
        :result-formatted="toolParser.formatToolResult(message)"
      />
    </template>

    <template v-else>
      <div class="message-avatar">
        <span v-if="message.role === 'user'">👤</span>
        <div
          v-else
          class="avatar-image"
          :style="expertAvatar ? { backgroundImage: `url(${expertAvatar})` } : {}"
        >
          <span v-if="!expertAvatar">🤖</span>
        </div>
      </div>

      <div class="message-content">
        <AssistantMessage
          v-if="message.role === 'assistant'"
          :message="message"
          :all-messages="allMessages"
          @retry="$emit('retry', $event)"
          @jump-to-message="$emit('jumpToMessage', $event)"
        />

        <div v-else class="message-text">
          {{ message.content }}
        </div>

        <div v-if="message.role === 'user' && message.created_at" class="message-time">
          {{ formatTime(message.created_at) }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ToolMessageCard from './ToolMessageCard.vue'
import AssistantMessage from './AssistantMessage.vue'
import { useToolDataParser } from '@/composables/useToolDataParser'
import { formatRelativeTime } from '@/composables/useTimeFormatter'
import type { ChatMessage } from './ChatWindow.vue'

const props = defineProps<{
  message: ChatMessage
  allMessages: ChatMessage[]
  expertAvatar?: string
  highlighted?: boolean
}>()

defineEmits<{
  retry: [message: ChatMessage]
  jumpToMessage: [messageId: string]
}>()

const { t } = useI18n()
const toolParser = useToolDataParser()

const formatTime = (dateStr: string) => formatRelativeTime(dateStr, t)
</script>

<style scoped>
.message {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  position: relative;
  z-index: 1;
}

.message.user {
  flex-direction: row-reverse;
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

.message-avatar .avatar-image {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message.user .message-avatar {
  background: var(--primary-color, #2196f3);
}

.message-content {
  max-width: 70%;
  padding: 12px 16px;
  border-radius: 16px;
  background: var(--message-bg, #f5f5f5);
  word-break: break-word;
  min-width: 0;
}

.message.user .message-content {
  background: var(--user-message-bg, #e3f2fd);
  border-bottom-right-radius: 4px;
}

.message.assistant .message-content {
  border-bottom-left-radius: 4px;
}

.message-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #333);
}

.message-time {
  font-size: 11px;
  color: var(--text-hint, #999);
  margin-top: 6px;
  text-align: right;
}

.message.user .message-time {
  text-align: right;
}

.message-highlighted {
  animation: message-highlight-fade 2s ease;
}

@keyframes message-highlight-fade {
  0% { background: rgba(37, 99, 235, 0.16); }
  100% { background: transparent; }
}
</style>
