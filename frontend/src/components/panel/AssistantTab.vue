<template>
  <div class="assistant-tab">
    <!-- 右上角刷新按钮 -->
    <button class="refresh-btn-fixed" @click="loadData" :title="$t('common.refresh') || '刷新'">
      🔄
    </button>

    <!-- 加载状态 -->
    <div v-if="assistantStore.isLoading && assistantStore.assistants.length === 0" class="loading-state">
      <span class="loading-spinner"></span>
      <span>{{ $t('common.loading') }}</span>
    </div>

    <!-- 主内容 -->
    <div v-else class="assistant-content">
      <!-- 可用助理列表 -->
      <section class="assistants-section">
        <h4 class="section-title">
          <span class="section-icon">🤖</span>
          {{ $t('assistant.availableAssistants') || '可用助理' }}
        </h4>
        <div class="assistants-list">
          <div
            v-for="assistant in assistantStore.activeAssistants"
            :key="assistant.id"
            class="assistant-card"
          >
            <div class="assistant-icon">{{ getAssistantIcon(assistant.id) }}</div>
            <div class="assistant-info">
              <span class="assistant-name">{{ assistant.name }}</span>
              <span class="assistant-meta">
                {{ assistant.execution_mode }} · {{ assistant.estimated_time }}s
              </span>
            </div>
            <span class="status-dot" :class="{ active: assistant.is_active }"></span>
          </div>
          <div v-if="assistantStore.activeAssistants.length === 0" class="empty-hint">
            {{ $t('assistant.noAssistants') || '暂无可用助理' }}
          </div>
        </div>
      </section>

      <!-- 当前委托列表 -->
      <section class="requests-section">
        <h4 class="section-title">
          <span class="section-icon">📋</span>
          {{ $t('assistant.currentRequests') || '当前委托' }}
          <span v-if="assistantStore.pendingRequests.length > 0" class="badge">
            {{ assistantStore.pendingRequests.length }}
          </span>
          <button
            v-if="showArchived"
            class="toggle-archive-btn active"
            @click="showArchived = false"
          >
            {{ $t('assistant.hideArchived') || '隐藏归档' }}
          </button>
          <button
            v-else
            class="toggle-archive-btn"
            @click="showArchived = true"
          >
            {{ $t('assistant.showArchived') || '显示归档' }}
          </button>
        </h4>
        <div class="requests-list">
          <div
            v-for="request in filteredRequests"
            :key="request.request_id"
            class="request-card"
            :class="{ active: selectedRequestId === request.request_id, archived: request.is_archived }"
            @click="selectRequest(request)"
          >
            <div class="request-header">
              <span class="request-icon">{{ getAssistantIcon(request.assistant_id) }}</span>
              <span class="request-type">{{ request.assistant_id }}</span>
              <span class="request-status" :class="request.status">
                {{ getStatusText(request.status) }}
              </span>
            </div>
            <div class="request-meta">
              <span class="request-time">{{ formatTime(request.created_at) }}</span>
              <span v-if="request.status === 'running'" class="elapsed">
                {{ elapsedTime(request) }}s
              </span>
              <span v-if="request.is_archived" class="archived-badge">
                {{ $t('assistant.archived') || '已归档' }}
              </span>
            </div>
            <div class="request-actions" @click.stop>
              <button
                v-if="canResendNotification(request)"
                class="action-btn resend"
                @click="handleResendNotification(request)"
                :title="$t('assistant.resendNotification') || '重发通知'"
              >
                📢
              </button>
              <button
                v-if="canRetry(request)"
                class="action-btn retry"
                @click="handleRetry(request)"
                :title="$t('assistant.retry') || '重试'"
              >
                🔄
              </button>
              <button
                v-if="canDelete(request)"
                class="action-btn delete"
                @click="handleDelete(request)"
                :title="$t('assistant.delete') || '删除'"
              >
                🗑️
              </button>
              <button
                v-if="canArchive(request) && !request.is_archived"
                class="action-btn archive"
                @click="handleArchive(request)"
                :title="$t('assistant.archive') || '归档'"
              >
                📦
              </button>
              <button
                v-if="request.is_archived"
                class="action-btn unarchive"
                @click="handleUnarchive(request)"
                :title="$t('assistant.unarchive') || '取消归档'"
              >
                📤
              </button>
            </div>
          </div>
          <div v-if="filteredRequests.length === 0" class="empty-hint">
            {{ $t('assistant.noRequests') || '暂无委托记录' }}
          </div>
        </div>
      </section>

      <!-- 委托详情 -->
      <section v-if="selectedRequest" class="detail-section">
        <div class="detail-header">
          <h4 class="section-title">
            <span class="section-icon">📝</span>
            {{ $t('assistant.requestDetail') || '委托详情' }}
          </h4>
          <button class="close-btn" @click="closeDetail">×</button>
        </div>

        <!-- 消息时间线 -->
        <div class="messages-timeline">
          <div
            v-for="message in assistantStore.activeRequestMessages"
            :key="message.id"
            class="message-item"
            :class="message.message_type"
          >
            <div class="message-icon">{{ getMessageIcon(message.message_type) }}</div>
            <div class="message-content">
              <div class="message-header">
                <span class="message-type">{{ getMessageTypeLabel(message.message_type) }}</span>
                <span class="message-time">{{ formatTime(message.created_at) }}</span>
              </div>
              <div class="message-body">
                <template v-if="message.message_type === 'tool_call'">
                  <span class="tool-name">{{ message.tool_name }}</span>
                </template>
                <template v-else-if="message.message_type === 'tool_result'">
                  <span class="tool-name">{{ message.tool_name }}</span>
                  <span class="tool-status" :class="message.status">{{ message.status }}</span>
                </template>
                <template v-else>
                  {{ message.content_preview || message.content }}
                </template>
              </div>
              <!-- 统计信息 -->
              <div v-if="message.tokens_input || message.latency_ms" class="message-stats">
                <span v-if="message.tokens_input">{{ $t('assistant.tokensInput') }}: {{ message.tokens_input }}</span>
                <span v-if="message.tokens_output">{{ $t('assistant.tokensOutput') }}: {{ message.tokens_output }}</span>
                <span v-if="message.latency_ms">{{ (message.latency_ms / 1000).toFixed(2) }}s</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAssistantStore } from '@/stores/assistant'
import { useToastStore } from '@/stores/toast'
import type { AssistantRequest, AssistantMessageType } from '@/types'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const route = useRoute()
const assistantStore = useAssistantStore()
const toast = useToastStore()

// 当前专家ID
const currentExpertId = computed(() => route.params.expertId as string)

// 选中的委托ID
const selectedRequestId = ref<string | null>(null)

// 是否显示已归档
const showArchived = ref(false)

// 选中的委托
const selectedRequest = computed(() => {
  if (!selectedRequestId.value) return null
  return assistantStore.requests.find(r => r.request_id === selectedRequestId.value) || null
})

// 排序后的委托列表（最新的在前）
const sortedRequests = computed(() => {
  return [...assistantStore.requests].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
})

// 过滤后的委托列表（根据归档状态）
const filteredRequests = computed(() => {
  if (showArchived.value) {
    return sortedRequests.value
  }
  return sortedRequests.value.filter(r => !r.is_archived)
})

// 获取助理图标
function getAssistantIcon(type: string): string {
  const icons: Record<string, string> = {
    ocr: '📝',
    drawing: '🎨',
    coding: '💻',
    math: '🔢',
    vision: '🖼️',
    translator: '🌐',
    default: '🤖',
  }
  return icons[type] ?? icons.default ?? '🤖'
}

// 获取状态文本
function getStatusText(status: string): string {
  const map: Record<string, string> = {
    pending: t('assistant.statusPendingText') || '等待中',
    running: t('assistant.statusRunningText') || '执行中',
    completed: t('assistant.statusCompletedText') || '已完成',
    failed: t('assistant.statusFailedText') || '失败',
    timeout: t('assistant.statusTimeoutText') || '超时',
  }
  return map[status] || status
}

// 获取消息图标
function getMessageIcon(type: AssistantMessageType): string {
  const icons: Record<AssistantMessageType, string> = {
    task: '📌',
    status: '🔄',
    tool_call: '🔧',
    tool_result: '📤',
    final: '✅',
    error: '❌',
  }
  return icons[type] || '📝'
}

// 获取消息类型标签
function getMessageTypeLabel(type: AssistantMessageType): string {
  const labels: Record<AssistantMessageType, string> = {
    task: t('assistant.msgTask') || '任务',
    status: t('assistant.msgStatus') || '状态',
    tool_call: t('assistant.msgToolCall') || '工具调用',
    tool_result: t('assistant.msgToolResult') || '工具结果',
    final: t('assistant.msgFinal') || '完成',
    error: t('assistant.msgError') || '错误',
  }
  return labels[type] || type
}

// 格式化时间
function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 60000) return t('assistant.justNow') || '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}${t('assistant.minutesAgo') || '分钟前'}`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}${t('assistant.hoursAgo') || '小时前'}`

  return date.toLocaleDateString()
}

// 计算已运行时间
function elapsedTime(request: AssistantRequest): number {
  if (!request.started_at) return 0
  const start = new Date(request.started_at).getTime()
  return Math.floor((Date.now() - start) / 1000)
}

// 选择委托
async function selectRequest(request: AssistantRequest) {
  selectedRequestId.value = request.request_id
  await assistantStore.fetchRequestMessages(request.request_id)
}

// 关闭详情
function closeDetail() {
  selectedRequestId.value = null
  assistantStore.clearActiveRequest()
}

// 判断是否可以删除
function canDelete(request: AssistantRequest): boolean {
  // 已归档的委托不允许删除
  if (request.is_archived) return false
  return ['completed', 'failed', 'timeout', 'cancelled'].includes(request.status)
}

// 判断是否可以归档
function canArchive(request: AssistantRequest): boolean {
  return ['completed', 'failed', 'timeout', 'cancelled'].includes(request.status)
}

// 判断是否可以重试
function canRetry(request: AssistantRequest): boolean {
  // 已归档的委托不允许重试
  if (request.is_archived) return false
  // 只允许失败的执行重试
  return ['failed', 'timeout'].includes(request.status)
}

// 判断是否可以重发通知（始终显示重发按钮给已完成的委托）
function canResendNotification(request: AssistantRequest): boolean {
  // 只有已完成的委托才显示重发按钮
  if (request.status !== 'completed') return false
  // 已归档的委托不允许重发
  if (request.is_archived) return false
  return true
}

// 处理重发通知
async function handleResendNotification(request: AssistantRequest) {
  console.log(`[重发通知] 开始重发: request_id=${request.request_id}`)
  try {
    const result = await assistantStore.resendNotification(request.request_id)
    console.log(`[重发通知] 成功:`, result)
    toast.success(t('assistant.resendNotificationSuccess') || '通知已重发，请在控制台查看详情')
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : t('assistant.resendNotificationFailed')
    console.error(`[重发通知] 失败:`, errorMsg)
    toast.error(errorMsg)
  }
}

// 处理删除
async function handleDelete(request: AssistantRequest) {
  if (!confirm(t('assistant.confirmDelete') || '确定要删除此委托吗？')) {
    return
  }
  try {
    await assistantStore.deleteRequest(request.request_id)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : t('assistant.deleteFailed')
    toast.error(errorMsg)
  }
}

// 处理归档
async function handleArchive(request: AssistantRequest) {
  try {
    await assistantStore.archiveRequest(request.request_id)
    // 归档成功后关闭委托详情
    closeDetail()
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : t('assistant.archiveFailed')
    toast.error(errorMsg)
  }
}

// 处理取消归档
async function handleUnarchive(request: AssistantRequest) {
  try {
    await assistantStore.unarchiveRequest(request.request_id)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : t('assistant.unarchiveFailed')
    toast.error(errorMsg)
  }
}

// 处理重试
async function handleRetry(request: AssistantRequest) {
  try {
    const result = await assistantStore.retryRequest(request.request_id)
    toast.success(t('assistant.retrySuccess') || '已重新执行委托')
    // 选中新创建的委托
    if (result && result.request_id) {
      selectedRequestId.value = result.request_id
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : t('assistant.retryFailed')
    toast.error(errorMsg)
  }
}

// 加载数据
async function loadData() {
  await assistantStore.fetchAssistants()
  if (currentExpertId.value) {
    await assistantStore.fetchRequests(currentExpertId.value)
  }
}

// 监听专家ID变化
watch(currentExpertId, (newId) => {
  if (newId) {
    assistantStore.fetchRequests(newId)
  }
}, { immediate: true })

onMounted(() => {
  loadData()
  // 启动轮询
  assistantStore.startPolling(currentExpertId.value, 5000)
})

onUnmounted(() => {
  assistantStore.stopPolling()
})
</script>

<style scoped>
.assistant-tab {
  position: relative;
  height: 100%;
  overflow-y: auto;
  padding: 12px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 150px;
  gap: 12px;
  color: var(--text-secondary, #666);
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border-color, #e0e0e0);
  border-top-color: var(--primary-color, #2196f3);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.assistant-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Section 样式 */
.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #333);
  margin: 0 0 10px 0;
}

.section-icon {
  font-size: 14px;
}

.badge {
  background: var(--primary-color, #2196f3);
  color: white;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 10px;
  margin-left: auto;
}

/* 助理列表 */
.assistants-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.assistant-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--card-bg, #fff);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e0e0e0);
}

.assistant-icon {
  font-size: 20px;
}

.assistant-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.assistant-name {
  font-size: 13px;
  font-weight: 500;
}

.assistant-meta {
  font-size: 11px;
  color: var(--text-secondary, #666);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-color, #e0e0e0);
}

.status-dot.active {
  background: var(--success-color, #4caf50);
}

/* 委托列表 */
.requests-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.request-card {
  padding: 10px 12px;
  background: var(--card-bg, #fff);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e0e0e0);
  cursor: pointer;
  transition: all 0.2s;
}

.request-card:hover {
  border-color: var(--primary-color, #2196f3);
}

.request-card.active {
  border-color: var(--primary-color, #2196f3);
  background: var(--primary-light, #e3f2fd);
}

.request-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.request-icon {
  font-size: 16px;
}

.request-type {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
}

.request-status {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
}

.request-status.pending {
  background: #fff3cd;
  color: #856404;
}

.request-status.running {
  background: #cce5ff;
  color: #004085;
}

.request-status.completed {
  background: #d4edda;
  color: #155724;
}

.request-status.failed,
.request-status.timeout {
  background: #f8d7da;
  color: #721c24;
}

.request-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary, #666);
}

.elapsed {
  color: var(--primary-color, #2196f3);
  font-weight: 500;
}

.archived-badge {
  background: var(--border-color, #e0e0e0);
  color: var(--text-secondary, #666);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
}

.toggle-archive-btn {
  margin-left: auto;
  padding: 2px 8px;
  font-size: 11px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  color: var(--text-secondary, #666);
}

.toggle-archive-btn.active {
  background: var(--primary-color, #2196f3);
  color: white;
  border-color: var(--primary-color, #2196f3);
}

.refresh-btn-fixed {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 4px 8px;
  font-size: 16px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  opacity: 0.6;
  z-index: 10;
}

.refresh-btn-fixed:hover {
  opacity: 1;
}

.request-card.archived {
  opacity: 0.7;
  background: var(--bg-secondary, #f9f9f9);
}

.request-actions {
  display: flex;
  gap: 4px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color, #eee);
}

.action-btn {
  padding: 4px 8px;
  font-size: 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: transparent;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.action-btn:hover {
  opacity: 1;
}

.action-btn.delete:hover {
  background: var(--error-bg, #ffebee);
}

.action-btn.retry:hover {
  background: var(--primary-light, #e3f2fd);
}

.action-btn.resend:hover {
  background: var(--info-bg, #e1f5fe);
}

.action-btn.archive:hover {
  background: var(--warning-bg, #fff8e1);
}

.action-btn.unarchive:hover {
  background: var(--success-bg, #e8f5e9);
}

.empty-hint {
  text-align: center;
  color: var(--text-secondary, #666);
  font-size: 13px;
  padding: 20px;
}

/* 详情区域 */
.detail-section {
  border-top: 1px solid var(--border-color, #e0e0e0);
  padding-top: 16px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-secondary, #666);
  padding: 4px 8px;
}

.close-btn:hover {
  color: var(--text-primary, #333);
}

/* 消息时间线 */
.messages-timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-item {
  display: flex;
  gap: 10px;
  padding: 10px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 6px;
}

.message-item.final {
  background: var(--success-bg, #e8f5e9);
}

.message-item.error {
  background: var(--error-bg, #ffebee);
}

.message-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  min-width: 0;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.message-type {
  font-size: 12px;
  font-weight: 500;
}

.message-time {
  font-size: 11px;
  color: var(--text-secondary, #666);
}

.message-body {
  font-size: 12px;
  color: var(--text-primary, #333);
  word-break: break-word;
  max-height: 150px;
  overflow-y: auto;
}

.tool-name {
  font-family: monospace;
  background: var(--hover-bg, #eee);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.tool-status {
  margin-left: 8px;
  font-size: 11px;
}

.tool-status.success {
  color: var(--success-color, #4caf50);
}

.tool-status.error {
  color: var(--error-color, #f44336);
}

.message-stats {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-secondary, #666);
}

/* 滚动条 */
.assistant-tab::-webkit-scrollbar {
  width: 6px;
}

.assistant-tab::-webkit-scrollbar-track {
  background: transparent;
}

.assistant-tab::-webkit-scrollbar-thumb {
  background: var(--border-color, #e0e0e0);
  border-radius: 3px;
}

.assistant-tab::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary, #999);
}
</style>