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

    <!-- 进程列表 -->
    <div v-else class="processes-list">
      <!-- 刷新按钮 -->
      <div class="toolbar">
        <button class="btn-refresh" @click="loadProcesses" :disabled="loading">
          🔄 {{ $t('common.refresh') }}
        </button>
      </div>

      <!-- 进程卡片 -->
      <div v-for="process in processes" :key="process.tool_id" class="process-card">
        <!-- 卡片头部 -->
        <div class="card-header">
          <div class="process-info">
            <h4 class="process-name">{{ process.tool_name }}</h4>
            <span class="skill-name">{{ process.skill_name }}</span>
          </div>
          <div class="process-status">
            <span :class="['status-badge', getStateClass(process.state)]">
              {{ $t(`settings.resident.states.${process.state}`) }}
            </span>
            <span v-if="process.pid" class="pid-info">PID: {{ process.pid }}</span>
          </div>
        </div>

        <!-- 卡片内容 -->
        <div class="card-body">
          <!-- 统计信息 -->
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-label">{{ $t('settings.resident.startedAt') }}</span>
              <span class="stat-value">{{ formatTime(process.started_at) || '-' }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">{{ $t('settings.resident.totalTasks') }}</span>
              <span class="stat-value">{{ process.total_tasks }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">{{ $t('settings.resident.successCount') }}</span>
              <span class="stat-value success">{{ process.success_count }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">{{ $t('settings.resident.errorCount') }}</span>
              <span class="stat-value error">{{ process.error_count }}</span>
            </div>
          </div>

          <!-- 通信记录展开按钮 -->
          <div class="communications-toggle">
            <button 
              class="btn-toggle" 
              @click="toggleCommunications(process.tool_id)"
            >
              <span class="toggle-icon">{{ expandedProcesses[process.tool_id] ? '▼' : '▶' }}</span>
              {{ $t('settings.resident.communicationRecords') }}
              <span class="count-badge">{{ process.communications?.length || 0 }}</span>
            </button>
          </div>

          <!-- 通信记录列表 -->
          <div v-if="expandedProcesses[process.tool_id]" class="communications-list">
            <div v-if="!process.communications || process.communications.length === 0" class="no-records">
              {{ $t('settings.resident.noCommunications') }}
            </div>
            <div 
              v-for="(comm, index) in process.communications" 
              :key="index" 
              :class="['communication-item', comm.type]"
            >
              <div class="comm-header">
                <span :class="['comm-type', comm.type]">
                  {{ comm.type === 'invoke' ? '📥' : '📤' }}
                  {{ $t(`settings.resident.commTypes.${comm.type}`) }}
                </span>
                <span class="comm-time">{{ formatTime(comm.timestamp) }}</span>
              </div>
              <div class="comm-summary">{{ comm.summary }}</div>
            </div>
          </div>
        </div>

        <!-- 卡片操作 -->
        <div class="card-actions">
          <button 
            class="btn-restart" 
            @click="confirmRestart(process)"
            :disabled="restartingProcesses[process.tool_id] || process.state === 'STARTING'"
          >
            {{ restartingProcesses[process.tool_id] ? $t('common.restarting') : $t('common.restart') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 重启确认对话框 -->
    <div v-if="showRestartDialog" class="restart-dialog-overlay" @click.self="closeRestartDialog">
      <div class="restart-dialog">
        <h3>{{ $t('settings.resident.confirmRestart') }}</h3>
        <p>{{ $t('settings.resident.restartWarning', { name: restartTarget?.tool_name }) }}</p>
        <div class="dialog-actions">
          <button class="btn-cancel" @click="closeRestartDialog">
            {{ $t('common.cancel') }}
          </button>
          <button class="btn-confirm" @click="executeRestart">
            {{ $t('common.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { debugApi, type ResidentProcessStatus } from '@/api/services'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()

// 状态
const loading = ref(false)
const processes = ref<ResidentProcessStatus[]>([])
const expandedProcesses = reactive<Record<string, boolean>>({})
const restartingProcesses = reactive<Record<string, boolean>>({})

// 重启对话框
const showRestartDialog = ref(false)
const restartTarget = ref<ResidentProcessStatus | null>(null)

// 自动刷新定时器
let refreshTimer: ReturnType<typeof setInterval> | null = null

// 加载进程列表
const loadProcesses = async () => {
  loading.value = true
  try {
    const result = await debugApi.getResidentStatus()
    // 将 recent_communications 映射为 communications 便于模板使用
    processes.value = (result.processes || []).map(p => ({
      ...p,
      communications: p.recent_communications || []
    }))
  } catch (error: any) {
    toast.error(t('settings.resident.loadFailed') + ': ' + error.message)
  } finally {
    loading.value = false
  }
}

// 切换通信记录展开状态
const toggleCommunications = (toolId: string) => {
  expandedProcesses[toolId] = !expandedProcesses[toolId]
}

// 获取状态样式类
const getStateClass = (state: string): string => {
  const classMap: Record<string, string> = {
    STARTING: 'state-starting',
    RUNNING: 'state-running',
    STOPPING: 'state-stopping',
    STOPPED: 'state-stopped',
    ERROR: 'state-error',
  }
  return classMap[state] || 'state-unknown'
}

// 格式化时间
const formatTime = (time: string | null): string => {
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
    // 刷新列表
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
  // 每 10 秒自动刷新
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
  padding: 20px;
  max-width: 800px;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #666);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.btn-refresh {
  padding: 8px 16px;
  font-size: 14px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-refresh:hover:not(:disabled) {
  background: var(--bg-tertiary, #eee);
}

.btn-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.processes-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.process-card {
  background: var(--card-bg, #fff);
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: var(--bg-secondary, #f8f9fa);
  border-bottom: 1px solid var(--border-light, #eee);
}

.process-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.process-name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.skill-name {
  font-size: 13px;
  color: var(--text-tertiary, #999);
}

.process-status {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-badge {
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 4px;
}

.state-starting {
  background: #fff3e0;
  color: #e65100;
}

.state-running {
  background: #e8f5e9;
  color: #2e7d32;
}

.state-stopping {
  background: #fce4ec;
  color: #c62828;
}

.state-stopped {
  background: #f5f5f5;
  color: #616161;
}

.state-error {
  background: #ffebee;
  color: #c62828;
}

.pid-info {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  font-family: monospace;
}

.card-body {
  padding: 16px 20px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  color: var(--text-tertiary, #999);
}

.stat-value {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.stat-value.success {
  color: #2e7d32;
}

.stat-value.error {
  color: #c62828;
}

.communications-toggle {
  margin-top: 12px;
}

.btn-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
  cursor: pointer;
  width: 100%;
}

.btn-toggle:hover {
  background: var(--bg-tertiary, #eee);
}

.toggle-icon {
  font-size: 10px;
}

.count-badge {
  padding: 2px 8px;
  font-size: 11px;
  background: var(--primary-color, #2196f3);
  color: white;
  border-radius: 10px;
}

.communications-list {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-secondary, #f8f9fa);
  border-radius: 6px;
  max-height: 300px;
  overflow-y: auto;
}

.no-records {
  text-align: center;
  color: var(--text-tertiary, #999);
  padding: 16px;
}

.communication-item {
  padding: 12px;
  margin-bottom: 8px;
  background: var(--card-bg, #fff);
  border-radius: 4px;
  border-left: 3px solid;
}

.communication-item.invoke {
  border-left-color: #2196f3;
}

.communication-item.result {
  border-left-color: #4caf50;
}

.comm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.comm-type {
  font-size: 12px;
  font-weight: 500;
}

.comm-type.invoke {
  color: #2196f3;
}

.comm-type.result {
  color: #4caf50;
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

.card-actions {
  padding: 12px 20px;
  background: var(--bg-secondary, #f8f9fa);
  border-top: 1px solid var(--border-light, #eee);
  display: flex;
  justify-content: flex-end;
}

.btn-restart {
  padding: 8px 16px;
  font-size: 14px;
  border: 1px solid #ff9800;
  border-radius: 6px;
  background: #fff3e0;
  color: #e65100;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-restart:hover:not(:disabled) {
  background: #ffe0b2;
}

.btn-restart:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
</style>