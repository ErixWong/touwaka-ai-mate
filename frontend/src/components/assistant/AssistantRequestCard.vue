<template>
  <div class="assistant-request-card" :class="`status-${request.status}`">
    <!-- 头部：助理信息 -->
    <div class="card-header">
      <div class="assistant-icon">
        {{ assistantIcon }}
      </div>
      <div class="assistant-info">
        <h4 class="assistant-name">{{ assistantName }}</h4>
        <span class="request-id">{{ request.request_id }}</span>
      </div>
      <div class="status-badge" :class="request.status">
        {{ statusText }}
      </div>
    </div>

    <!-- 进度区域 -->
    <div class="progress-section">
      <!-- pending 状态 -->
      <div v-if="request.status === 'pending'" class="status-pending">
        <span class="status-icon">⏳</span>
        <span class="status-label">{{ $t('assistant.statusPending') }}</span>
        <span class="estimated-time">
          {{ $t('assistant.estimatedWait', { time: estimatedTime }) }}
        </span>
      </div>

      <!-- running 状态 -->
      <div v-else-if="request.status === 'running'" class="status-running">
        <span class="status-icon spinning">🔄</span>
        <span class="status-label">{{ $t('assistant.statusRunning') }}</span>
        <span class="elapsed-time">
          {{ $t('assistant.elapsedTime', { elapsed: elapsedTime, estimated: estimatedTime }) }}
        </span>
        <button class="cancel-btn" @click="handleCancel">
          {{ $t('common.cancel') }}
        </button>
      </div>

      <!-- completed 状态 -->
      <div v-else-if="request.status === 'completed'" class="status-completed">
        <span class="status-icon">✅</span>
        <span class="status-label">
          {{ $t('assistant.statusCompleted', { time: completedTime }) }}
        </span>
        <button class="view-detail-btn" @click="showDetail = true">
          {{ $t('assistant.viewDetail') }}
        </button>
        <button class="retry-btn" @click="handleRetry">
          {{ $t('common.retry') }}
        </button>
      </div>

      <!-- failed 状态 -->
      <div v-else-if="request.status === 'failed'" class="status-failed">
        <span class="status-icon">❌</span>
        <span class="status-label">{{ $t('assistant.statusFailed') }}</span>
        <span v-if="request.error_message" class="error-message">
          {{ request.error_message }}
        </span>
        <button class="retry-btn" @click="handleRetry">
          {{ $t('common.retry') }}
        </button>
      </div>

      <!-- timeout 状态 -->
      <div v-else-if="request.status === 'timeout'" class="status-timeout">
        <span class="status-icon">⌛</span>
        <span class="status-label">{{ $t('assistant.statusTimeout') }}</span>
        <button class="retry-btn" @click="handleRetry">
          {{ $t('common.retry') }}
        </button>
      </div>
    </div>

    <!-- 结果详情弹窗 -->
    <Teleport to="body">
      <div v-if="showDetail" class="detail-modal-overlay" @click.self="showDetail = false">
        <div class="detail-modal">
          <div class="modal-header">
            <h3>{{ assistantName }} - {{ $t('assistant.resultTitle') }}</h3>
            <button class="close-btn" @click="showDetail = false">×</button>
          </div>
          <div class="modal-body">
            <div class="result-content">
              {{ request.result || $t('assistant.noResult') }}
            </div>
            <div class="result-stats">
              <span v-if="request.tokens_input">
                {{ $t('assistant.tokensInput') }}: {{ request.tokens_input }}
              </span>
              <span v-if="request.tokens_output">
                {{ $t('assistant.tokensOutput') }}: {{ request.tokens_output }}
              </span>
              <span v-if="request.latency_ms">
                {{ $t('assistant.latency') }}: {{ (request.latency_ms / 1000).toFixed(2) }}s
              </span>
              <span v-if="request.model_used">
                {{ $t('assistant.modelUsed') }}: {{ request.model_used }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AssistantRequest } from '@/types'
import { assistantApi } from '@/api/services'

const props = defineProps<{
  request: AssistantRequest
}>()

const emit = defineEmits<{
  (e: 'retry', request: AssistantRequest): void
  (e: 'cancel', request: AssistantRequest): void
  (e: 'update', request: AssistantRequest): void
}>()

const { t } = useI18n()
const showDetail = ref(false)
const elapsedSeconds = ref(0)
let pollTimer: ReturnType<typeof setInterval> | null = null
let elapsedTimer: ReturnType<typeof setInterval> | null = null

// 助理图标（根据类型显示不同图标）
const assistantIcon = computed(() => {
  const icons: Record<string, string> = {
    ocr: '📝',
    drawing: '🎨',
    coding: '💻',
    math: '🔢',
    vision: '🖼️',
    translator: '🌐',
    default: '🤖',
  }
  return icons[props.request.assistant_id] || icons.default
})

// 助理名称
const assistantName = computed(() => {
  return props.request.assistant_id.toUpperCase() + ' Assistant'
})

// 预估时间（秒）
const estimatedTime = computed(() => {
  return 30 // 默认 30 秒
})

// 已运行时间
const elapsedTime = computed(() => {
  return elapsedSeconds.value
})

// 完成耗时
const completedTime = computed(() => {
  if (props.request.started_at && props.request.completed_at) {
    const start = new Date(props.request.started_at).getTime()
    const end = new Date(props.request.completed_at).getTime()
    return Math.round((end - start) / 1000)
  }
  return 0
})

// 状态文本
const statusText = computed(() => {
  const statusMap: Record<string, string> = {
    pending: t('assistant.statusPendingText'),
    running: t('assistant.statusRunningText'),
    completed: t('assistant.statusCompletedText'),
    failed: t('assistant.statusFailedText'),
    timeout: t('assistant.statusTimeoutText'),
  }
  return statusMap[props.request.status] || props.request.status
})

// 轮询更新状态
async function pollStatus() {
  if (props.request.status !== 'pending' && props.request.status !== 'running') {
    return
  }

  try {
    const updated = await assistantApi.getRequest(props.request.request_id)
    emit('update', updated)
  } catch (err) {
    // 轮询失败不需要弹窗提示，只记录日志
    console.error('Failed to poll assistant status:', err)
  }
}

// 更新已运行时间
function updateElapsed() {
  if (props.request.started_at) {
    const start = new Date(props.request.started_at).getTime()
    elapsedSeconds.value = Math.round((Date.now() - start) / 1000)
  }
}

function handleCancel() {
  emit('cancel', props.request)
}

function handleRetry() {
  emit('retry', props.request)
}

onMounted(() => {
  // 如果是进行中的状态，启动轮询
  if (props.request.status === 'pending' || props.request.status === 'running') {
    pollTimer = setInterval(pollStatus, 2000)
    elapsedTimer = setInterval(updateElapsed, 1000)
  }
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (elapsedTimer) clearInterval(elapsedTimer)
})
</script>

<style scoped>
.assistant-request-card {
  background: var(--card-bg, #fff);
  border-radius: 8px;
  padding: 12px;
  margin: 8px 0;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.assistant-icon {
  font-size: 24px;
}

.assistant-info {
  flex: 1;
}

.assistant-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.request-id {
  font-size: 11px;
  color: var(--text-secondary, #666);
}

.status-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.status-badge.pending {
  background: #fff3cd;
  color: #856404;
}

.status-badge.running {
  background: #cce5ff;
  color: #004085;
}

.status-badge.completed {
  background: #d4edda;
  color: #155724;
}

.status-badge.failed,
.status-badge.timeout {
  background: #f8d7da;
  color: #721c24;
}

.progress-section {
  margin-top: 10px;
  padding: 10px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 6px;
}

.status-pending,
.status-running,
.status-completed,
.status-failed,
.status-timeout {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.status-icon {
  font-size: 16px;
}

.status-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.status-label {
  font-size: 13px;
}

.estimated-time,
.elapsed-time {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.error-message {
  font-size: 12px;
  color: var(--danger-color, #dc3545);
}

.cancel-btn,
.retry-btn,
.view-detail-btn {
  padding: 4px 10px;
  font-size: 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.cancel-btn {
  background: var(--danger-color, #dc3545);
  color: white;
}

.retry-btn {
  background: var(--primary-color, #007bff);
  color: white;
}

.view-detail-btn {
  background: var(--success-color, #28a745);
  color: white;
}

/* Detail Modal */
.detail-modal-overlay {
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

.detail-modal {
  background: var(--card-bg, #fff);
  border-radius: 8px;
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #eee);
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
}

.modal-body {
  padding: 16px;
  overflow: auto;
}

.result-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.6;
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 6px;
}

.result-stats {
  margin-top: 12px;
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary, #666);
}
</style>