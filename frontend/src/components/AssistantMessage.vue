<template>
  <div class="assistant-message">
    <div
      v-if="message.role === 'assistant' && message.tool_calls"
      class="tool-calls-section"
    >
      <ToolMessageCard
        v-for="(toolCall, index) in parsedToolCalls"
        :key="`${message.id}-tool-${index}`"
        :tool-name="toolCall.name || toolCall.tool_name || 'unknown_tool'"
        :success="toolCall.success !== false"
        :duration="toolCall.duration ?? null"
        :context="toolCall.context ?? null"
        :formatted-time="toolParser.formatToolCallTime(toolCall)"
        :arguments-formatted="toolParser.formatToolCallArguments(toolCall)"
        :result-formatted="toolParser.formatToolCallResult(toolCall)"
        :result-preview="toolCall.result_preview"
        :tool-message-id="toolCall.tool_message_id ? String(toolCall.tool_message_id) : undefined"
        :embedded="true"
        @jump-to-message="$emit('jumpToMessage', $event)"
      />
    </div>

    <div
      v-if="message.role === 'assistant' && message.reasoning_content"
      class="reasoning-section"
      :class="{ expanded: isReasoningExpanded }"
    >
      <div class="reasoning-header" @click="toggleReasoning">
        <span class="reasoning-icon">💭</span>
        <span class="reasoning-title">{{ $t('chat.thinkingProcess') || '思考过程' }}</span>
        <span class="reasoning-expand-btn" :class="{ expanded: isReasoningExpanded }">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
      <div v-if="isReasoningExpanded" class="reasoning-content">
        <pre class="reasoning-text">{{ message.reasoning_content }}</pre>
      </div>
    </div>

    <div
      class="message-text"
      :class="{ 'streaming-text': message.status === 'streaming' }"
      v-html="formattedHtml"
    ></div>

    <div v-if="isRecovering" class="recovering-indicator" data-testid="assistant-recovering-indicator">
      {{ recoveringText }}
    </div>

    <div v-if="message.status === 'streaming'" class="streaming-indicator">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>

    <div v-if="message.status === 'error' || message.status === 'timeout'" class="error-text">
      {{ $t('chat.sendError') }}
      <button class="retry-btn" @click="$emit('retry', message)">
        {{ $t('chat.retrySend') }}
      </button>
    </div>

    <div v-if="message.created_at && message.status !== 'streaming'" class="message-time">
      {{ formattedTime }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ToolMessageCard from './ToolMessageCard.vue'
import { useToolDataParser } from '@/composables/useToolDataParser'
import { useMarkdownFormatter } from '@/composables/useMarkdownFormatter'
import { formatRelativeTime } from '@/composables/useTimeFormatter'
import type { ChatMessage } from './ChatWindow.vue'
import type { ToolCallData } from '@/composables/useToolDataParser'

const props = defineProps<{
  message: ChatMessage
  allMessages: ChatMessage[]
}>()

defineEmits<{
  retry: [message: ChatMessage]
  jumpToMessage: [messageId: string]
}>()

const { t } = useI18n()
const toolParser = useToolDataParser()
const formatter = useMarkdownFormatter()

const isReasoningExpanded = ref(false)

const toggleReasoning = () => {
  isReasoningExpanded.value = !isReasoningExpanded.value
}

const parsedToolCalls = computed<ToolCallData[]>(() => {
  return toolParser.parseToolCallsToArray(props.message)
})

const filteredContent = computed(() => {
  return toolParser.filterAssistantContent(props.message, props.allMessages)
})

const formattedHtml = computed(() => {
  return formatter.formatStreamingMessage(props.message, filteredContent.value)
})

const isRecovering = computed(() => props.message.metadata?.recovering === true)

const recoveringText = computed(() => {
  const attempt = props.message.metadata?.recovery_attempt
  if (typeof attempt === 'number' && attempt > 0) {
    return t('chat.recoveringAttempt', { n: attempt }) || `连接中断，正在恢复生成（第 ${attempt} 次）`
  }
  return t('chat.recovering') || '连接中断，正在恢复生成'
})

const formattedTime = computed(() => {
  if (!props.message.created_at) return ''
  return formatRelativeTime(props.message.created_at, t)
})
</script>

<style scoped>
.assistant-message {
  flex: 1;
  min-width: 0;
}

.tool-calls-section {
  margin-bottom: 12px;
}

.reasoning-section {
  margin-bottom: 12px;
  background: var(--reasoning-bg, #f8f9fa);
  border-radius: 12px;
  border: 1px solid var(--reasoning-border, #e0e0e0);
  overflow: hidden;
}

.reasoning-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.reasoning-header:hover {
  background: var(--reasoning-header-hover, #f0f0f0);
}

.reasoning-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.reasoning-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #666);
  flex: 1;
}

.reasoning-expand-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #666);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.reasoning-expand-btn svg {
  width: 16px;
  height: 16px;
}

.reasoning-expand-btn.expanded {
  transform: rotate(180deg);
}

.reasoning-content {
  padding: 0 14px 12px 14px;
  animation: slideDown 0.2s ease;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.reasoning-text {
  margin: 0;
  padding: 12px;
  background: var(--code-bg, #fff);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
  color: var(--text-primary, #333);
  font-family: inherit;
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border-color, #e8e8e8);
}

.message-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #333);
}

.message-text.streaming-text {
  white-space: pre-wrap;
  word-wrap: break-word;
}

.streaming-indicator {
  display: inline-flex;
  gap: 4px;
  margin-left: 8px;
}

.recovering-indicator {
  margin-top: 8px;
  font-size: 12px;
  color: var(--warning-color, #c27c00);
}

.streaming-indicator .dot {
  width: 6px;
  height: 6px;
  background: var(--primary-color, #2196f3);
  border-radius: 50%;
  animation: pulse 1s infinite;
}

.streaming-indicator .dot:nth-child(2) { animation-delay: 0.2s; }
.streaming-indicator .dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.message-time {
  font-size: 11px;
  color: var(--text-hint, #999);
  margin-top: 6px;
  text-align: left;
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

/* ==================== Markdown 渲染深度样式 ==================== */
.message-text :deep(h1),
.message-text :deep(h2),
.message-text :deep(h3),
.message-text :deep(h4),
.message-text :deep(h5),
.message-text :deep(h6) {
  margin: 16px 0 8px 0;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary, #333);
}

.message-text :deep(h1) { font-size: 1.5em; border-bottom: 1px solid var(--border-color, #e0e0e0); padding-bottom: 8px; }
.message-text :deep(h2) { font-size: 1.35em; border-bottom: 1px solid var(--border-color, #e0e0e0); padding-bottom: 6px; }
.message-text :deep(h3) { font-size: 1.2em; }
.message-text :deep(h4) { font-size: 1.1em; }
.message-text :deep(h5) { font-size: 1em; }
.message-text :deep(h6) { font-size: 0.95em; color: var(--text-secondary, #666); }

.message-text :deep(p) { margin: 8px 0; }
.message-text :deep(p:first-child) { margin-top: 0; }
.message-text :deep(p:last-child) { margin-bottom: 0; }

.message-text :deep(ul),
.message-text :deep(ol) { margin: 8px 0; padding-left: 24px; }
.message-text :deep(li) { margin: 4px 0; }
.message-text :deep(ul) { list-style-type: disc; }
.message-text :deep(ol) { list-style-type: decimal; }
.message-text :deep(ul ul) { list-style-type: circle; }
.message-text :deep(ul ul ul) { list-style-type: square; }

.message-text :deep(blockquote) {
  margin: 8px 0;
  padding: 8px 16px;
  border-left: 4px solid var(--primary-color, #2196f3);
  background: var(--blockquote-bg, #f8f9fa);
  color: var(--text-secondary, #666);
  border-radius: 0 4px 4px 0;
}

.message-text :deep(blockquote p) { margin: 4px 0; }

.message-text :deep(pre) {
  background: var(--code-bg, #1e1e1e);
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
  position: relative;
}

.message-text :deep(pre code) {
  background: transparent;
  padding: 0;
  color: #d4d4d4;
  font-size: 13px;
  line-height: 1.5;
  display: block;
}

.message-text :deep(code) {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
}

.message-text :deep(code:not(pre code)) {
  background: var(--code-bg, #f0f0f0);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--code-color, #d63384);
}

.message-text :deep(table) {
  border-collapse: collapse;
  margin: 12px 0;
  width: 100%;
  font-size: 13px;
}

.message-text :deep(th),
.message-text :deep(td) {
  border: 1px solid var(--border-color, #e0e0e0);
  padding: 8px 12px;
  text-align: left;
}

.message-text :deep(th) {
  background: var(--table-header-bg, #f5f5f5);
  font-weight: 600;
}

.message-text :deep(tr:nth-child(even)) {
  background: var(--table-row-alt-bg, #fafafa);
}

.message-text :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color, #e0e0e0);
  margin: 16px 0;
}

.message-text :deep(a) {
  color: var(--primary-color, #2196f3);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.2s;
}

.message-text :deep(a:hover) {
  border-bottom-color: var(--primary-color, #2196f3);
}

.message-text :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 8px 0;
}

.message-text :deep(del),
.message-text :deep(s) {
  color: var(--text-secondary, #666);
  text-decoration: line-through;
}

.message-text :deep(strong) { font-weight: 600; }
.message-text :deep(em) { font-style: italic; }

/* Mermaid 图表样式 */
.message-text :deep(.mermaid-container) {
  margin: 12px 0;
  padding: 16px;
  background: var(--mermaid-bg, #f8f9fa);
  border-radius: 12px;
  overflow-x: auto;
  border: 1px solid var(--border-color, #e0e0e0);
}

.message-text :deep(.mermaid-container svg) {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto;
}

.message-text :deep(.mermaid-loading) {
  padding: 16px;
  text-align: center;
  color: var(--text-secondary, #666);
  font-style: italic;
  background: var(--mermaid-bg, #f8f9fa);
  border-radius: 8px;
}

.message-text :deep(.mermaid-error) {
  padding: 12px 16px;
  background: var(--error-bg, #fff5f5);
  border: 1px solid var(--error-border, #ffcdd2);
  border-radius: 8px;
  color: var(--error-color, #c62828);
}
</style>
