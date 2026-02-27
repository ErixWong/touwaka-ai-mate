<template>
  <div class="chat-window">
    <!-- 专家大头像背景 -->
    <div 
      v-if="props.expertAvatarLarge" 
      class="messages-bg-avatar"
      :style="{ backgroundImage: `url(${props.expertAvatarLarge})` }"
    ></div>
    <!-- 消息列表 -->
    <div ref="messagesContainer" class="messages-container" @scroll="handleScroll">
      <!-- 加载更多历史消息（顶部） -->
      <div v-if="props.hasMoreMessages" class="load-more-top">
        <button
          class="btn-load-more"
          :disabled="props.isLoadingMore"
          @click="handleLoadMore"
        >
          {{ props.isLoadingMore ? $t('common.loading') : $t('chat.loadMoreHistory') }}
        </button>
      </div>
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
          <div 
            v-else
            class="avatar-image"
            :style="props.expertAvatar ? { backgroundImage: `url(${props.expertAvatar})` } : {}"
          >
            <span v-if="!props.expertAvatar">🤖</span>
          </div>
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
          <div v-if="message.created_at && message.status !== 'streaming'" class="message-time">
            {{ formatTime(message.created_at) }}
          </div>
        </div>
      </div>
      <div v-if="isLoading" class="message assistant">
        <div class="message-avatar">
          <div 
            class="avatar-image"
            :style="props.expertAvatar ? { backgroundImage: `url(${props.expertAvatar})` } : {}"
          >
            <span v-if="!props.expertAvatar">🤖</span>
          </div>
        </div>
        <div class="message-content">
          <div class="thinking-indicator">{{ $t('chat.thinking') }}</div>
        </div>
      </div>
    </div>

    <!-- 快捷指令提示 (skill-studio 模式) -->
    <div v-if="showCommandHints && filteredCommands.length > 0" class="command-hints">
      <div 
        v-for="cmd in filteredCommands" 
        :key="cmd.command"
        class="command-item"
        @click="applyCommand(cmd)"
      >
        <span class="command-name">{{ cmd.command }}</span>
        <span class="command-desc">{{ cmd.description }}</span>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-area">
      <textarea
        ref="inputRef"
        v-model="inputText"
        :placeholder="placeholderText"
        :disabled="isLoading || disabled"
        @keydown.enter.exact.prevent="handleSend"
        @keydown.enter.shift.exact="() => {}"
        @input="handleInput"
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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '@/types'

export type ChatMessage = Pick<Message, 'id' | 'role' | 'content' | 'status'> & {
  created_at?: string
}

const props = defineProps<{
  messages: ChatMessage[]
  isLoading?: boolean
  disabled?: boolean
  hasMoreMessages?: boolean
  isLoadingMore?: boolean
  expertAvatar?: string
  expertAvatarLarge?: string
  showCommandHints?: boolean
  customPlaceholder?: string
}>()

const emit = defineEmits<{
  send: [content: string]
  retry: [message: ChatMessage]
  loadMore: []
}>()

const { t } = useI18n()
const inputText = ref('')
const messagesContainer = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)

// 快捷指令列表
const commands = [
  { command: '/import', description: t('commands.import') || '导入技能 (例: /import skills/searxng)', example: '/import skills/searxng' },
  { command: '/create', description: t('commands.create') || '创建新技能', example: '/create 天气查询技能' },
  { command: '/list', description: t('commands.list') || '列出所有技能', example: '/list' },
  { command: '/assign', description: t('commands.assign') || '分配技能给专家 (例: /assign weather 给助手)', example: '/assign weather to expert_name' },
  { command: '/help', description: t('commands.help') || '显示帮助信息', example: '/help' },
]

// 过滤后的指令
const filteredCommands = computed(() => {
  const text = inputText.value.trim()
  if (!text.startsWith('/')) return []
  
  const query = text.toLowerCase()
  return commands.filter(cmd => cmd.command.toLowerCase().startsWith(query))
})

// 占位符文本
const placeholderText = computed(() => {
  return props.customPlaceholder || t('chat.placeholder')
})

// 输入处理
const handleInput = () => {
  // 自动调整高度
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.style.height = 'auto'
      inputRef.value.style.height = inputRef.value.scrollHeight + 'px'
    }
  })
}

// 应用指令
const applyCommand = (cmd: typeof commands[0]) => {
  inputText.value = cmd.example
  inputRef.value?.focus()
}

// 记录滚动位置，用于加载更多后恢复
const scrollHeightBeforeLoad = ref(0)
const isLoadingTriggered = ref(false)

// 自动滚动到底部
const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

// 滚动处理：检测是否滚动到顶部
const handleScroll = () => {
  if (!messagesContainer.value || !props.hasMoreMessages || props.isLoadingMore) return
  
  const { scrollTop } = messagesContainer.value
  
  // 距离顶部 100px 以内时自动触发加载
  if (scrollTop < 100 && !isLoadingTriggered.value) {
    isLoadingTriggered.value = true
    // 记录当前滚动高度，用于加载后恢复位置
    scrollHeightBeforeLoad.value = messagesContainer.value.scrollHeight
    emit('loadMore')
  }
}

// 手动点击加载更多
const handleLoadMore = () => {
  if (!messagesContainer.value) return
  scrollHeightBeforeLoad.value = messagesContainer.value.scrollHeight
  emit('loadMore')
}

// 监听消息变化
watch(
  () => props.messages,
  (newMessages, oldMessages) => {
    nextTick(() => {
      if (!messagesContainer.value) return
      
      // 如果是加载更多（消息数量增加且之前正在加载）
      if (props.isLoadingMore === false && isLoadingTriggered.value && newMessages.length > (oldMessages?.length || 0)) {
        // 恢复滚动位置（保持在原来的消息位置）
        const newScrollHeight = messagesContainer.value.scrollHeight
        messagesContainer.value.scrollTop = newScrollHeight - scrollHeightBeforeLoad.value
        isLoadingTriggered.value = false
      } else {
        // 新消息时滚动到底部
        scrollToBottom()
      }
    })
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

// 格式化时间显示
const formatTime = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  // 1分钟内显示"刚刚"
  if (diffMins < 1) return t('chat.timeJustNow') || '刚刚'
  // 1小时内显示"X分钟前"
  if (diffHours < 1) return t('chat.timeMinutesAgo', { n: diffMins }) || `${diffMins}分钟前`
  // 今天显示"HH:mm"
  if (diffDays < 1) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  // 昨天显示"昨天 HH:mm"
  if (diffDays === 1) {
    return t('chat.timeYesterday') + ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  // 一周内显示"X天前"
  if (diffDays < 7) {
    return t('chat.timeDaysAgo', { n: diffDays }) || `${diffDays}天前`
  }
  // 更早显示"MM-DD HH:mm"
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
         date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
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
  position: relative;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  scroll-behavior: smooth;
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

.message-time {
  font-size: 11px;
  color: var(--text-hint, #999);
  margin-top: 6px;
  text-align: right;
}

.message.assistant .message-time {
  text-align: left;
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

/* 快捷指令提示 */
.command-hints {
  position: absolute;
  bottom: 100%;
  left: 16px;
  right: 16px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.1);
  max-height: 200px;
  overflow-y: auto;
  z-index: 10;
  margin-bottom: 4px;
}

.command-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.command-item:hover {
  background: var(--bg-hover, #f0f0f0);
}

.command-item:first-child {
  border-radius: 8px 8px 0 0;
}

.command-item:last-child {
  border-radius: 0 0 8px 8px;
}

.command-name {
  font-family: monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-color, #2196f3);
  min-width: 80px;
}

.command-desc {
  font-size: 13px;
  color: var(--text-secondary, #666);
}
</style>
