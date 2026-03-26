<template>
  <div class="assistant-result">
    <!-- 结果头部 -->
    <div class="result-header">
      <div class="result-icon">
        {{ successIcon }}
      </div>
      <div class="result-title">
        <h4>{{ assistantName }}</h4>
        <span class="result-time">{{ formattedTime }}</span>
      </div>
    </div>

    <!-- 结果内容 -->
    <div class="result-body">
      <div v-if="isMarkdown" class="result-markdown" v-html="renderedContent"></div>
      <div v-else class="result-text">{{ content }}</div>
    </div>

    <!-- 统计信息 -->
    <div v-if="showStats" class="result-stats">
      <div v-if="tokensInput" class="stat-item">
        <span class="stat-label">{{ $t('assistant.tokensInput') }}:</span>
        <span class="stat-value">{{ tokensInput }}</span>
      </div>
      <div v-if="tokensOutput" class="stat-item">
        <span class="stat-label">{{ $t('assistant.tokensOutput') }}:</span>
        <span class="stat-value">{{ tokensOutput }}</span>
      </div>
      <div v-if="latency" class="stat-item">
        <span class="stat-label">{{ $t('assistant.latency') }}:</span>
        <span class="stat-value">{{ latency.toFixed(2) }}s</span>
      </div>
      <div v-if="modelUsed" class="stat-item">
        <span class="stat-label">{{ $t('assistant.modelUsed') }}:</span>
        <span class="stat-value">{{ modelUsed }}</span>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="result-actions">
      <button class="action-btn copy-btn" @click="handleCopy">
        📋 {{ $t('common.copy') }}
      </button>
      <button v-if="warning" class="action-btn warning-btn" @click="showWarning = true">
        ⚠️ {{ $t('assistant.warning') }}
      </button>
    </div>

    <!-- 警告弹窗 -->
    <Teleport to="body">
      <div v-if="showWarning" class="warning-modal-overlay">
        <div class="warning-modal">
          <div class="warning-header">
            <span class="warning-icon">⚠️</span>
            <h3>{{ $t('assistant.warningTitle') }}</h3>
          </div>
          <div class="warning-body">
            {{ warning }}
          </div>
          <div class="warning-footer">
            <button class="close-btn" @click="showWarning = false">
              {{ $t('common.close') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToastStore } from '@/stores/toast'

const props = withDefaults(
  defineProps<{
    assistantType: string
    content: string
    success?: boolean
    tokensInput?: number
    tokensOutput?: number
    latency?: number
    modelUsed?: string
    warning?: string
    completedAt?: string
    showStats?: boolean
    isMarkdown?: boolean
  }>(),
  {
    success: true,
    showStats: true,
    isMarkdown: false,
  }
)

const { t } = useI18n()
const toast = useToastStore()
const showWarning = ref(false)

// 成功图标
const successIcon = computed(() => {
  return props.success ? '✅' : '❌'
})

// 助理名称
const assistantName = computed(() => {
  return props.assistantType.toUpperCase() + ' Assistant'
})

// 格式化时间
const formattedTime = computed(() => {
  if (!props.completedAt) return ''
  const date = new Date(props.completedAt)
  return date.toLocaleString()
})

// 渲染 Markdown（简单实现）
const renderedContent = computed(() => {
  if (!props.isMarkdown) return props.content
  // 简单的 Markdown 渲染，实际项目中应使用 marked 或 markdown-it
  return props.content
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
})

// 复制内容
async function handleCopy() {
  try {
    await navigator.clipboard.writeText(props.content)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : t('assistant.copyFailed')
    toast.error(errorMsg)
  }
}
</script>

<style scoped>
.assistant-result {
  background: var(--card-bg, #fff);
  border-radius: 8px;
  padding: 16px;
  margin: 8px 0;
  border-left: 4px solid var(--success-color, #28a745);
}

.assistant-result:not(.success) {
  border-left-color: var(--danger-color, #dc3545);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.result-icon {
  font-size: 20px;
}

.result-title h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.result-time {
  font-size: 11px;
  color: var(--text-secondary, #666);
}

.result-body {
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 6px;
  margin-bottom: 12px;
}

.result-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.6;
}

.result-markdown {
  font-size: 14px;
  line-height: 1.6;
}

.result-markdown :deep(code) {
  background: var(--bg-tertiary, #e9e9e9);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: monospace;
}

.result-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 8px 0;
  border-top: 1px solid var(--border-color, #eee);
  border-bottom: 1px solid var(--border-color, #eee);
  margin-bottom: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.stat-label {
  color: var(--text-secondary, #666);
}

.stat-value {
  font-weight: 500;
}

.result-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  padding: 6px 12px;
  font-size: 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: var(--bg-secondary, #f5f5f5);
}

.action-btn:hover {
  background: var(--bg-tertiary, #e9e9e9);
}

.copy-btn {
  background: var(--primary-color, #007bff);
  color: white;
}

.warning-btn {
  background: var(--warning-color, #ffc107);
  color: #333;
}

/* Warning Modal */
.warning-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.warning-modal {
  background: var(--card-bg, #fff);
  border-radius: 8px;
  max-width: 400px;
  width: 90%;
}

.warning-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #eee);
}

.warning-header h3 {
  margin: 0;
  font-size: 16px;
}

.warning-icon {
  font-size: 20px;
}

.warning-body {
  padding: 16px;
  font-size: 14px;
  line-height: 1.6;
}

.warning-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border-color, #eee);
  text-align: right;
}

.close-btn {
  padding: 6px 16px;
  font-size: 13px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: var(--primary-color, #007bff);
  color: white;
}
</style>