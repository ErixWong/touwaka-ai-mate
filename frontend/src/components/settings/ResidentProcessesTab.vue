<template>
  <div class="resident-processes-tab">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <!-- 空状态 -->
    <div v-else-if="processes.length === 0" class="empty-state">
      <div class="empty-icon">📭</div>
      <p>{{ $t('settings.resident.noProcesses') }}</p>
    </div>

    <!-- 左右布局 -->
    <div v-else class="split-layout">
      <!-- 左侧：进程列表 -->
      <div class="left-panel">
        <div class="panel-header">
          <h3>{{ $t('settings.resident.processList') }}</h3>
          <el-button @click="loadProcesses" :disabled="loading" :title="$t('settings.resident.refresh')">
            🔄
          </el-button>
        </div>

        <div class="process-list-content">
          <div
            v-for="process in processes"
            :key="process.tool_id"
            :class="['process-list-item', { active: selectedProcess?.tool_id === process.tool_id }]"
            @click="selectProcess(process)"
          >
            <div class="item-main">
              <span class="item-name">{{ process.tool_name }}</span>
              <span class="item-skill">{{ process.skill_name }}</span>
            </div>
            <div class="item-meta">
              <span :class="['item-status', getStateClass(process.state)]">
                {{ $t(`settings.resident.states.${process.state}`) }}
              </span>
              <span v-if="process.pending_tasks > 0" class="item-pending">
                {{ process.pending_tasks }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：详情面板 -->
      <div class="right-panel">
        <div v-if="!selectedProcess" class="no-selection">
          <p>{{ $t('settings.resident.noProcessSelected') }}</p>
        </div>

        <template v-else>
          <!-- 操作栏 -->
          <div class="detail-header">
            <div class="detail-title">
              <h2>{{ selectedProcess.tool_name }}</h2>
              <span class="detail-subtitle">{{ selectedProcess.skill_name }}</span>
            </div>
            <div class="detail-actions">
              <el-button
                type="warning"
                size="small"
                @click="confirmRestart(selectedProcess)"
                :disabled="restartingProcesses[selectedProcess.tool_id] || selectedProcess.state === 'starting'"
              >
                {{ restartingProcesses[selectedProcess.tool_id] ? $t('common.restarting') : $t('settings.resident.restart') }}
              </el-button>
            </div>
          </div>

          <!-- 统计卡片 -->
          <div class="stats-cards">
            <div class="stat-card">
              <div class="stat-icon status">
                <span :class="['status-indicator', getStateClass(selectedProcess.state)]"></span>
              </div>
              <div class="stat-info">
                <span class="stat-label">{{ $t('settings.resident.status') }}</span>
                <span class="stat-value">{{ $t(`settings.resident.states.${selectedProcess.state}`) }}</span>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon">🆔</div>
              <div class="stat-info">
                <span class="stat-label">{{ $t('settings.resident.pid') }}</span>
                <span class="stat-value">{{ selectedProcess.pid || '-' }}</span>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon">🕐</div>
              <div class="stat-info">
                <span class="stat-label">{{ $t('settings.resident.startedAt') }}</span>
                <span class="stat-value">{{ formatTime(selectedProcess.started_at) || '-' }}</span>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon">📊</div>
              <div class="stat-info">
                <span class="stat-label">{{ $t('settings.resident.totalTasks') }}</span>
                <span class="stat-value">{{ selectedProcess.total_tasks }}</span>
              </div>
            </div>

            <div class="stat-card success">
              <div class="stat-icon">✅</div>
              <div class="stat-info">
                <span class="stat-label">{{ $t('settings.resident.successCount') }}</span>
                <span class="stat-value">{{ selectedProcess.success_count }}</span>
              </div>
            </div>

            <div class="stat-card error">
              <div class="stat-icon">❌</div>
              <div class="stat-info">
                <span class="stat-label">{{ $t('settings.resident.errorCount') }}</span>
                <span class="stat-value">{{ selectedProcess.error_count }}</span>
              </div>
            </div>

            <div v-if="selectedProcess.pending_tasks > 0" class="stat-card pending">
              <div class="stat-icon">⏳</div>
              <div class="stat-info">
                <span class="stat-label">{{ $t('settings.resident.pendingTasks') }}</span>
                <span class="stat-value">{{ selectedProcess.pending_tasks }}</span>
              </div>
            </div>
          </div>

          <!-- 通信记录 -->
          <div class="communications-section">
            <div class="section-header">
              <h3>{{ $t('settings.resident.communicationRecords') }}</h3>
              <span class="section-count">{{ pairedCommunications.length }}</span>
            </div>

            <div v-if="pairedCommunications.length === 0" class="no-communications">
              {{ $t('settings.resident.noCommunications') }}
            </div>

            <div v-else class="communications-list">
              <div
                v-for="(pair, index) in pairedCommunications"
                :key="index"
                :class="['communication-pair', getPairStatusClass(pair)]"
              >
                <!-- 任务ID和耗时 -->
                <div class="pair-header">
                  <span class="task-id">{{ pair.task_id }}</span>
                  <span v-if="pair.duration" class="duration">{{ pair.duration }}ms</span>
                </div>

                <!-- 调用记录 -->
                <div class="comm-row invoke">
                  <div class="comm-badge">
                    <span class="badge-icon">📤</span>
                    <span class="badge-text">{{ $t('settings.resident.commTypes.invoke') }}</span>
                  </div>
                  <div class="comm-content">
                    <div class="comm-time">{{ formatTime(pair.invoke?.timestamp) }}</div>
                    <div class="comm-summary">{{ pair.invoke?.summary || '-' }}</div>
                  </div>
                </div>

                <!-- 响应记录 -->
                <div v-if="pair.response" class="comm-row response">
                  <div class="comm-badge">
                    <span class="badge-icon">📥</span>
                    <span class="badge-text">{{ $t('settings.resident.commTypes.response') }}</span>
                  </div>
                  <div class="comm-content">
                    <div class="comm-time">{{ formatTime(pair.response.timestamp) }}</div>
                    <div class="comm-summary">{{ pair.response.summary || '-' }}</div>
                    <div :class="['comm-status', pair.response.status]">
                      {{ $t(`settings.resident.${pair.response.status}`) }}
                    </div>
                  </div>
                </div>

                <!-- 等待响应状态 -->
                <div v-else class="comm-row waiting">
                  <div class="comm-badge">
                    <span class="badge-icon">⏳</span>
                    <span class="badge-text">{{ $t('settings.resident.pending') }}</span>
                  </div>
                  <div class="comm-content">
                    <span class="waiting-text">{{ $t('settings.resident.pending') }}...</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 重启确认对话框 -->
    <div v-if="showRestartDialog" class="restart-dialog-overlay" @click.self="closeRestartDialog">
      <div class="restart-dialog">
        <h3>{{ $t('settings.resident.confirmRestart') }}</h3>
        <p>{{ $t('settings.resident.restartWarning', { name: restartTarget?.tool_name }) }}</p>
        <div class="dialog-actions">
          <el-button @click="closeRestartDialog">
            {{ $t('common.cancel') }}
          </el-button>
          <el-button type="primary" @click="executeRestart">
            {{ $t('common.confirm') }}
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { debugApi, type ResidentProcessStatus, type ResidentCommunication } from '@/api/services'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()

// 状态
const loading = ref(false)
const processes = ref<ResidentProcessStatus[]>([])
const selectedProcess = ref<ResidentProcessStatus | null>(null)
const restartingProcesses = reactive<Record<string, boolean>>({})

// 重启对话框
const showRestartDialog = ref(false)
const restartTarget = ref<ResidentProcessStatus | null>(null)

// 自动刷新定时器
let refreshTimer: ReturnType<typeof setInterval> | null = null

// 配对的通信记录
interface PairedCommunication {
  task_id: string
  invoke?: ResidentCommunication
  response?: ResidentCommunication
  duration?: number
}

const pairedCommunications = computed((): PairedCommunication[] => {
  if (!selectedProcess.value?.communications) return []

  const comms = selectedProcess.value.communications
  const pairs: PairedCommunication[] = []
  const invokeMap = new Map<string, ResidentCommunication>()
  const responseMap = new Map<string, ResidentCommunication>()

  // 分类记录
  for (const comm of comms) {
    if (comm.direction === 'out' && comm.type === 'invoke') {
      invokeMap.set(comm.task_id, comm)
    } else if (comm.direction === 'in' && comm.type === 'response') {
      responseMap.set(comm.task_id, comm)
    }
  }

  // 按时间倒序排列所有任务ID
  const allTaskIds = Array.from(new Set([...invokeMap.keys(), ...responseMap.keys()]))
    .sort((a, b) => {
      const timeA = new Date(invokeMap.get(a)?.timestamp || responseMap.get(a)?.timestamp || 0).getTime()
      const timeB = new Date(invokeMap.get(b)?.timestamp || responseMap.get(b)?.timestamp || 0).getTime()
      return timeB - timeA
    })

  // 配对
  for (const taskId of allTaskIds) {
    const invoke = invokeMap.get(taskId)
    const response = responseMap.get(taskId)
    let duration: number | undefined

    if (invoke && response) {
      const startTime = new Date(invoke.timestamp).getTime()
      const endTime = new Date(response.timestamp).getTime()
      duration = endTime - startTime
    }

    pairs.push({
      task_id: taskId,
      invoke,
      response,
      duration
    })
  }

  return pairs
})

// 加载进程列表
const loadProcesses = async () => {
  loading.value = true
  try {
    const result = await debugApi.getResidentStatus()
    processes.value = (result.processes || []).map(p => ({
      ...p,
      communications: p.recent_communications || []
    }))

    // 默认选中第一个
    if (processes.value.length > 0 && !selectedProcess.value) {
      selectedProcess.value = processes.value[0]!
    }
  } catch (error: any) {
    toast.error(t('settings.resident.loadFailed') + ': ' + error.message)
  } finally {
    loading.value = false
  }
}

// 选择进程
const selectProcess = (process: ResidentProcessStatus) => {
  selectedProcess.value = process
}

// 获取状态样式类
const getStateClass = (state: string): string => {
  const classMap: Record<string, string> = {
    starting: 'state-starting',
    running: 'state-running',
    stopping: 'state-stopping',
    stopped: 'state-stopped',
    error: 'state-error',
  }
  return classMap[state] || 'state-unknown'
}

// 获取配对状态样式
const getPairStatusClass = (pair: PairedCommunication): string => {
  if (!pair.response) return 'waiting'
  if (pair.response.status === 'error') return 'error'
  return 'success'
}

// 格式化时间
const formatTime = (time: string | null | undefined): string => {
  if (!time) return ''
  const date = new Date(time)
  return date.toLocaleString()
}

// 确认重启
const confirmRestart = (process: ResidentProcessStatus) => {
  restartTarget.value = process
  showRestartDialog.value = true
}

// 关闭重启对话框
const closeRestartDialog = () => {
  showRestartDialog.value = false
  restartTarget.value = null
}

// 执行重启
const executeRestart = async () => {
  if (!restartTarget.value) return

  const toolId = restartTarget.value.tool_id
  restartingProcesses[toolId] = true
  showRestartDialog.value = false

  try {
    const result = await debugApi.restartResidentProcess(toolId)
    toast.success(result.message || t('settings.resident.restartSuccess'))
    await loadProcesses()
  } catch (error: any) {
    toast.error(t('settings.resident.restartFailed') + ': ' + error.message)
  } finally {
    restartingProcesses[toolId] = false
    restartTarget.value = null
  }
}

// 初始化
onMounted(async () => {
  await loadProcesses()
  refreshTimer = setInterval(loadProcesses, 10000)
})

// 清理
onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
  }
})
</script>

<style scoped>
.resident-processes-tab {
  height: 100%;
  min-height: 600px;
  background: var(--card-bg, #fff);
}

/* 加载和空状态 */
.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 400px;
  color: var(--text-secondary, #666);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

/* 左右布局 */
.split-layout {
  display: flex;
  height: 100%;
  min-height: 600px;
}

/* 左侧面板 */
.left-panel {
  flex: 0 0 320px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-color, #e0e0e0);
  background: var(--bg-secondary, #f8f9fa);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.btn-icon {
  padding: 6px 10px;
  font-size: 14px;
  background: none;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover:not(:disabled) {
  background: var(--bg-secondary, #f5f5f5);
}

.btn-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.process-list-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.process-list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  margin-bottom: 8px;
  background: var(--card-bg, #fff);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.process-list-item:hover {
  border-color: var(--primary-color, #2196f3);
  box-shadow: 0 2px 4px rgba(33, 150, 243, 0.1);
}

.process-list-item.active {
  background: var(--primary-light, #e3f2fd);
  border-color: var(--primary-color, #2196f3);
}

.item-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.item-skill {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-status {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
}

.item-status.state-running {
  background: #e8f5e9;
  color: #2e7d32;
}

.item-status.state-starting {
  background: #fff3e0;
  color: #e65100;
}

.item-status.state-stopping,
.item-status.state-stopped {
  background: #f5f5f5;
  color: #616161;
}

.item-status.state-error {
  background: #ffebee;
  color: #c62828;
}

.item-pending {
  padding: 2px 6px;
  font-size: 11px;
  background: #fff3e0;
  color: #e65100;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

/* 右侧面板 */
.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.no-selection {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary, #999);
  font-size: 14px;
}

/* 详情头部 */
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.detail-title h2 {
  margin: 0 0 4px 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.detail-subtitle {
  font-size: 14px;
  color: var(--text-secondary, #666);
}

.detail-actions {
  display: flex;
  gap: 12px;
}

.btn-action {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-action.restart {
  border: 1px solid #ff9800;
  background: #fff3e0;
  color: #e65100;
}

.btn-action.restart:hover:not(:disabled) {
  background: #ffe0b2;
}

.btn-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 统计卡片 */
.stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px;
  padding: 20px 24px;
  background: var(--bg-secondary, #f8f9fa);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--card-bg, #fff);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.stat-icon {
  font-size: 20px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 8px;
}

.stat-icon.status {
  background: transparent;
}

.status-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.status-indicator.state-running {
  background: #4caf50;
}

.status-indicator.state-starting {
  background: #ff9800;
}

.status-indicator.state-stopping,
.status-indicator.state-stopped {
  background: #9e9e9e;
}

.status-indicator.state-error {
  background: #f44336;
}

.stat-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.stat-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.stat-card.success .stat-value {
  color: #4caf50;
}

.stat-card.error .stat-value {
  color: #f44336;
}

.stat-card.pending .stat-value {
  color: #ff9800;
}

/* 通信记录区域 */
.communications-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.section-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.section-count {
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 500;
  background: var(--primary-color, #2196f3);
  color: white;
  border-radius: 10px;
}

.no-communications {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-secondary, #999);
  font-size: 14px;
}

.communications-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  background: var(--bg-secondary, #f8f9fa);
}

/* 通信配对卡片 */
.communication-pair {
  margin-bottom: 16px;
  background: var(--card-bg, #fff);
  border-radius: 8px;
  border-left: 4px solid;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.communication-pair.success {
  border-left-color: #4caf50;
}

.communication-pair.error {
  border-left-color: #f44336;
}

.communication-pair.waiting {
  border-left-color: #ff9800;
}

.pair-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: var(--bg-tertiary, #f5f5f5);
  border-bottom: 1px solid var(--border-light, #eee);
}

.task-id {
  font-size: 12px;
  font-family: monospace;
  color: var(--text-secondary, #666);
}

.duration {
  font-size: 12px;
  font-weight: 500;
  color: var(--primary-color, #2196f3);
}

.comm-row {
  display: flex;
  padding: 12px 16px;
  gap: 12px;
  border-bottom: 1px solid var(--border-light, #eee);
}

.comm-row:last-child {
  border-bottom: none;
}

.comm-row.invoke {
  background: #f8fafc;
}

.comm-row.response {
  background: #fff;
}

.comm-row.waiting {
  background: #fff8e1;
  justify-content: center;
}

.comm-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 70px;
}

.badge-icon {
  font-size: 14px;
}

.badge-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #666);
}

.comm-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.comm-time {
  font-size: 11px;
  color: var(--text-tertiary, #999);
  font-family: monospace;
}

.comm-summary {
  font-size: 13px;
  color: var(--text-primary, #333);
  word-break: break-word;
}

.comm-status {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  align-self: flex-start;
  margin-top: 4px;
}

.comm-status.success {
  background: #e8f5e9;
  color: #2e7d32;
}

.comm-status.error {
  background: #ffebee;
  color: #c62828;
}

.comm-status.pending {
  background: #fff3e0;
  color: #e65100;
}

.waiting-text {
  font-size: 13px;
  color: #e65100;
}

/* 重启确认对话框 */
.restart-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.restart-dialog {
  background: var(--card-bg, #fff);
  border-radius: 8px;
  padding: 24px;
  max-width: 400px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.restart-dialog h3 {
  margin: 0 0 16px 0;
  font-size: 18px;
  color: var(--text-primary, #333);
}

.restart-dialog p {
  margin: 0 0 24px 0;
  font-size: 14px;
  color: var(--text-secondary, #666);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn-cancel {
  padding: 8px 16px;
  font-size: 14px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-confirm {
  padding: 8px 16px;
  font-size: 14px;
  border: none;
  border-radius: 6px;
  background: #ff9800;
  color: white;
  cursor: pointer;
}

.btn-confirm:hover {
  background: #f57c00;
}

/* 响应式 */
@media (max-width: 1024px) {
  .split-layout {
    flex-direction: column;
  }

  .left-panel {
    flex: none;
    height: auto;
    max-height: 300px;
    border-right: none;
    border-bottom: 1px solid var(--border-color, #e0e0e0);
  }

  .process-list-content {
    display: flex;
    flex-direction: row;
    gap: 8px;
    padding: 8px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .process-list-item {
    min-width: 200px;
    margin-bottom: 0;
  }

  .right-panel {
    min-height: 400px;
  }

  .stats-cards {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .stats-cards {
    grid-template-columns: repeat(2, 1fr);
  }

  .detail-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
}
</style>
