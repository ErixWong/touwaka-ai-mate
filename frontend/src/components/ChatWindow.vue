<template>
  <div class="chat-window">
    <!-- 消息列表 -->
    <div ref="messagesContainer" class="messages-container">
      <div v-if="messages.length === 0" class="empty-state">
        <p>{{ $t('chat.emptyState') }}</p>
      </div>
      <div
        v-for="message in messages"
        :key="message.id"
        class="message"
        :class="message.role"
      >
        <div class="message-avatar">
          <span v-if="message.role === 'user'">👤</span>
          <span v-else>🤖</span>
        </div>
        <div class="message-content">
          <div class="message-text" v-html="formatMessage(message.content)"></div>
          <div v-if="message.status === 'streaming'" class="streaming-indicator">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </div>
          <div v-if="message.status === 'error'" class="error-text">
            {{ $t('chat.sendError') }}
            <button class="retry-btn" @click="$emit('retry', message)">
              {{ $t('chat.retrySend') }}
            </button>
          </div>
        </div>
      </div>
      <div v-if="isLoading" class="message assistant">
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="thinking-indicator">{{ $t('chat.thinking') }}</div>
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-area">
      <textarea
        ref="inputRef"
        v-model="inputText"
        :placeholder="$t('chat.placeholder')"
        :disabled="isLoading || disabled"
        @keydown.enter.exact.prevent="handleSend"
        @keydown.enter.shift.exact="() => {}"
        rows="1"
        class="message-input"
      ></textarea>
      <button
        class="send-button"
        :disabled="!inputText.trim() || isLoading || disabled"
        @click="handleSend"
      >
        <span v-if="isLoading" class="loading-spinner"></span>
        <span v-else>📤</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '@/types'

export type ChatMessage = Pick<Message, 'id' | 'role' | 'content' | 'status'> & {
  created_at?: string
}

const props = defineProps<{
  messages: ChatMessage[]
  isLoading?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  send: [content: string]
  retry: [message: ChatMessage]
}>()

const { t } = useI18n()
const inputText = ref('')
const messagesContainer = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)

// 自动滚动到底部
const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

// 监听消息变化，自动滚动
watch(
  () => props.messages,
  () => {
    scrollToBottom()
  },
  { deep: true }
)

// 发送消息
const handleSend = () => {
  const content = inputText.value.trim()
  if (!content || props.isLoading || props.disabled) return

  emit('send', content)
  inputText.value = ''
  
  // 调整输入框高度
  if (inputRef.value) {
    inputRef.value.style.height = 'auto'
  }
}

// 格式化消息（支持简单的 markdown）
const formatMessage = (content: string) => {
  if (!content) return ''
  
  // 转义 HTML
  let formatted = content
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
  
  // 代码块
  formatted = formatted.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
  
  // 行内代码
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>')
  
  // 粗体
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  
  // 斜体
  formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  
  // 换行
  formatted = formatted.replace(/\n/g, '<br>')
  
  return formatted
}

// 自动调整输入框高度
const adjustTextareaHeight = () => {
  if (inputRef.value) {
    inputRef.value.style.height = 'auto'
    inputRef.value.style.height = Math.min(inputRef.value.scrollHeight, 150) + 'px'
  }
}

watch(inputText, adjustTextareaHeight)

onMounted(() => {
  scrollToBottom()
})

defineExpose({
  scrollToBottom
})
</script>

<style scoped>
.chat-window {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--chat-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
  overflow: hidden;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  scroll-behavior: smooth;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary, #666);
  font-size: 14px;
}

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
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

.message.user .message-avatar {
  background: var(--primary-color, #2196f3);
}

.message-content {
  max-width: 70%;
  padding: 12px 16px;
  border-radius: 16px;
  background: var(--message-bg, #f5f5f5);
  word-break: break-word;
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

.message-text :deep(pre) {
  background: var(--code-bg, #f0f0f0);
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}

.message-text :deep(code) {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
}

.message-text :deep(code:not(pre code)) {
  background: var(--code-bg, #f0f0f0);
  padding: 2px 6px;
  border-radius: 4px;
}

.streaming-indicator {
  display: inline-flex;
  gap: 4px;
  margin-left: 8px;
}

.streaming-indicator .dot {
  width: 6px;
  height: 6px;
  background: var(--primary-color, #2196f3);
  border-radius: 50%;
  animation: pulse 1s infinite;
}

.streaming-indicator .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.streaming-indicator .dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.thinking-indicator {
  color: var(--text-secondary, #666);
  font-style: italic;
}

.error-text {
  color: var(--error-color, #c62828);
  font-size: 12px;
  margin-top: 8px;
}

.retry-btn {
  background: none;
  border: none;
  color: var(--primary-color, #2196f3);
  cursor: pointer;
  text-decoration: underline;
  font-size: 12px;
  margin-left: 8px;
}

.input-area {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  background: var(--input-area-bg, #fafafa);
}

.message-input {
  flex: 1;
  padding: 12px 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 24px;
  font-size: 14px;
  resize: none;
  outline: none;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #333);
  font-family: inherit;
  line-height: 1.5;
  max-height: 150px;
  overflow-y: auto;
}

.message-input:focus {
  border-color: var(--primary-color, #2196f3);
}

.message-input:disabled {
  background: var(--disabled-bg, #f5f5f5);
  cursor: not-allowed;
}

.message-input::placeholder {
  color: var(--text-secondary, #999);
}

.send-button {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-color, #2196f3);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 18px;
  transition: background 0.2s;
}

.send-button:hover:not(:disabled) {
  background: var(--primary-hover, #1976d2);
}

.send-button:disabled {
  background: var(--disabled-bg, #ccc);
  cursor: not-allowed;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
