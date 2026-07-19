<template>
  <div class="tool-message-card" :class="{ expanded: isExpanded, embedded }">
    <div class="tool-header" @click="toggleExpand">
      <div class="tool-header-main">
        <span class="tool-icon">🔧</span>
        <span class="tool-name">{{ toolName }}</span>
        <span class="tool-meta">
          <span class="tool-time">{{ formattedTime }}</span>
          <span v-if="duration" class="tool-duration">{{ duration }}ms</span>
        </span>
        <span class="tool-status" :class="success ? 'success' : 'error'">
          {{ success ? '✓' : '✗' }}
        </span>
        <span class="tool-expand-btn" :class="{ expanded: isExpanded }">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
      <div v-if="atomicSteps && atomicSteps.length > 0" class="tool-atomic-trail">
        <span class="atomic-trail-label">⛓️</span>
        <span
          v-for="(step, si) in atomicSteps"
          :key="`step-${si}`"
          class="atomic-step-chip"
        >{{ step }}<span v-if="si < atomicSteps.length - 1" class="atomic-sep">→</span></span>
      </div>
      <div v-if="context" class="tool-context-line">
        <span class="tool-context-icon">💭</span>
        <span class="tool-context-text">{{ context }}</span>
      </div>
    </div>
    <div v-if="isExpanded" class="tool-details">
      <div v-if="argumentsFormatted" class="tool-section">
        <div class="tool-section-title">{{ $t('chat.toolArguments') || '参数' }}</div>
        <pre class="tool-section-content">{{ argumentsFormatted }}</pre>
      </div>
      <div v-if="resultFormatted" class="tool-section">
        <div class="tool-section-title">{{ $t('chat.toolResult') || '结果' }}</div>
        <pre class="tool-section-content">{{ resultFormatted }}</pre>
      </div>
      <div v-if="resultPreview && !resultFormatted" class="tool-section">
        <div class="tool-section-title">{{ $t('chat.toolResult') || '结果摘要' }}</div>
        <pre class="tool-section-content">{{ addLineNumbers(String(resultPreview)) }}</pre>
      </div>
      <button
        v-if="toolMessageId"
        class="tool-message-link"
        @click.stop="$emit('jumpToMessage', toolMessageId)"
      >
        定位 tool message: {{ toolMessageId }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  toolName: string
  success?: boolean
  duration?: number | null
  context?: string | null
  formattedTime?: string
  argumentsFormatted?: string
  resultFormatted?: string
  resultPreview?: string
  toolMessageId?: string
  embedded?: boolean
  /** round03：原子工具执行步骤列表（仅 document_retrieval skill） */
  atomicSteps?: string[]
}>()

defineEmits<{
  jumpToMessage: [messageId: string]
}>()

const isExpanded = ref(false)

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value
}

const addLineNumbers = (code: string): string => {
  if (!code) return ''
  const lines = code.split('\n')
  const lineNumberWidth = String(lines.length).length
  return lines
    .map((line, index) => {
      const lineNum = String(index + 1).padStart(lineNumberWidth, ' ')
      return `${lineNum} | ${line}`
    })
    .join('\n')
}
</script>

<style scoped>
.tool-message-card {
  background: var(--message-bg, #f5f5f5);
  border-radius: 16px;
  padding: 12px 16px;
  max-width: 70%;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #333);
  word-break: break-word;
}

.tool-message-card.expanded {
  background: var(--message-bg, #f5f5f5);
}

.tool-header {
  cursor: pointer;
  user-select: none;
}

.tool-header-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.tool-name {
  font-weight: 500;
  color: var(--text-primary, #333);
  font-family: 'Consolas', 'Monaco', monospace;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.tool-time {
  font-family: 'Consolas', 'Monaco', monospace;
}

.tool-duration {
  color: var(--text-hint, #999);
}

.tool-status {
  font-size: 14px;
  flex-shrink: 0;
  font-weight: 500;
}

.tool-status.success {
  color: var(--success-color, #4caf50);
}

.tool-status.error {
  color: var(--error-color, #f44336);
}

.tool-expand-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #666);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.tool-expand-btn svg {
  width: 16px;
  height: 16px;
}

.tool-expand-btn.expanded {
  transform: rotate(180deg);
}

/* round03：原子工具执行轨迹 */
.tool-atomic-trail {
  margin-top: 6px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 11px;
}

.atomic-trail-label {
  flex-shrink: 0;
  font-size: 11px;
  opacity: 0.6;
}

.atomic-step-chip {
  display: inline-flex;
  align-items: center;
  background: var(--code-bg, #2d2d2d);
  color: #a0d9f7;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: nowrap;
}

.atomic-sep {
  color: var(--text-hint, #999);
  margin-left: 4px;
  font-size: 10px;
}

.tool-context-line {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  font-size: 14px;
  color: var(--text-primary, #333);
  line-height: 1.6;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.tool-context-icon {
  flex-shrink: 0;
  font-size: 14px;
  margin-top: 1px;
}

.tool-context-text {
  white-space: pre-wrap;
  word-wrap: break-word;
  flex: 1;
}

.tool-details {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  animation: slideDown 0.2s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.tool-section {
  margin-bottom: 12px;
}

.tool-section:last-child {
  margin-bottom: 0;
}

.tool-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #666);
  margin-bottom: 8px;
}

.tool-section-content {
  background: var(--code-bg, #1e1e1e);
  border-radius: 8px;
  padding: 10px 12px;
  color: #d4d4d4;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre;
  word-wrap: normal;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

.tool-message-link {
  margin-top: 8px;
  color: var(--text-secondary, #666);
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.tool-message-link:hover {
  color: var(--primary-color, #2196f3);
  text-decoration: underline;
}

.tool-message-card.embedded {
  background: var(--tool-card-bg, #f8f9fa);
  border: 1px solid var(--tool-card-border, #e0e0e0);
  border-radius: 12px;
  padding: 10px 14px;
  margin-bottom: 8px;
  max-width: 100%;
}

.tool-message-card.embedded:last-child {
  margin-bottom: 0;
}

.tool-message-card.embedded .tool-header-main {
  flex-wrap: wrap;
}

.tool-message-card.embedded .tool-name {
  font-size: 13px;
}

.tool-message-card.embedded .tool-expand-btn {
  width: 18px;
  height: 18px;
}

.tool-message-card.embedded .tool-expand-btn svg {
  width: 14px;
  height: 14px;
}

.tool-message-card.embedded .tool-context-line {
  font-size: 13px;
}

.tool-message-card.embedded .tool-details {
  margin-top: 10px;
  padding-top: 10px;
}

.tool-message-card.embedded .tool-section-content {
  font-size: 11px;
  padding: 8px 10px;
  max-height: 150px;
}
</style>
