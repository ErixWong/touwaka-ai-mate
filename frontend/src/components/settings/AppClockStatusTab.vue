<template>
  <div class="app-clock-status-tab">
    <div v-if="loading" class="loading-state">{{ $t('common.loading') }}</div>

    <template v-else>
      <div class="section-header">
        <h3 class="section-title">{{ $t('appClock.statusPanel') }}</h3>
        <el-button @click="refresh">{{ $t('common.refresh') }}</el-button>
      </div>

      <div v-if="statusList.length === 0" class="empty-state">
        {{ $t('appClock.noRunningApps') }}
      </div>

      <div v-else class="status-table-wrapper">
        <el-table :data="statusList" border stripe style="width: 100%">
          <el-table-column prop="app_id" :label="$t('appClock.appId')" width="200" />
          <el-table-column :label="$t('appClock.runStatus')" width="140">
            <template #default="{ row }">
              <el-tag :type="row.run_status === 'running' ? 'warning' : 'info'">
                {{ row.run_status === 'running' ? $t('appClock.statusRunning') : row.run_status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="$t('appClock.startedAt')" width="180">
            <template #default="{ row }">
              {{ row.started_at ? formatTime(row.started_at) : '-' }}
            </template>
          </el-table-column>
          <el-table-column :label="$t('appClock.duration')" width="120">
            <template #default="{ row }">
              {{ row.duration_ms != null ? formatDuration(row.duration_ms) : '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="final_message" :label="$t('appClock.message')" min-width="200">
            <template #default="{ row }">
              <span v-if="row.final_message" class="error-text">{{ row.final_message }}</span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('appClock.actions')" width="120" fixed="right">
            <template>
              <span class="status-hint">{{ $t('appClock.observeOnly') }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="section-header" style="margin-top: 24px">
        <h3 class="section-title">{{ $t('appClock.historyPanel') }}</h3>
        <el-button size="small" @click="loadHistory">{{ $t('common.refresh') }}</el-button>
      </div>

      <div v-if="historyList.length === 0" class="empty-state small">
        {{ $t('appClock.noHistory') }}
      </div>

      <div v-else class="status-table-wrapper">
        <el-table :data="historyList" border stripe style="width: 100%" size="small">
          <el-table-column prop="app_id" :label="$t('appClock.appId')" width="200" />
          <el-table-column :label="$t('appClock.runStatus')" width="140">
            <template #default="{ row }">
              <el-tag :type="historyTagType(row.status)" size="small">
                {{ row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="$t('appClock.startedAt')" width="180">
            <template #default="{ row }">
              {{ row.started_at ? formatTime(row.started_at) : '-' }}
            </template>
          </el-table-column>
          <el-table-column :label="$t('appClock.finishedAt')" width="180">
            <template #default="{ row }">
              {{ row.finished_at ? formatTime(row.finished_at) : '-' }}
            </template>
          </el-table-column>
          <el-table-column :label="$t('appClock.duration')" width="120">
            <template #default="{ row }">
              {{ row.duration_ms != null ? formatDuration(row.duration_ms) : '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="final_message" :label="$t('appClock.message')" min-width="200">
            <template #default="{ row }">
              <span v-if="row.final_message" class="message-text">{{ row.final_message }}</span>
              <span v-else>-</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToastStore } from '@/stores/toast'
import apiClient from '@/api/client'

const { t } = useI18n()
const toast = useToastStore()

interface AppClockStatus {
  id: string
  app_id: string
  run_status: string
  started_at: string | null
  duration_ms: number | null
  final_message: string | null
}

interface AppClockHistory {
  id: string
  app_id: string
  started_at: string | null
  finished_at: string | null
  status: string
  duration_ms: number | null
  final_message: string | null
}

const statusList = ref<AppClockStatus[]>([])
const historyList = ref<AppClockHistory[]>([])
const loading = ref(false)

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function historyTagType(status: string): string {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'interrupted_by_restart') return 'warning'
  if (status === 'terminated_by_admin') return 'info'
  return 'info'
}

async function refresh() {
  loading.value = true
  try {
    const response = await apiClient.get('/app-clock/status')
    statusList.value = response.data.data || []
  } catch (err) {
    toast.error(t('appClock.loadFailed'))
  } finally {
    loading.value = false
  }
  loadHistory()
}

async function loadHistory() {
  try {
    const response = await apiClient.get('/app-clock/status/history', { params: { limit: 10 } })
    historyList.value = response.data.data || []
  } catch {
    // silently fail for history
  }
}

onMounted(() => {
  refresh()
})
</script>

<style scoped>
.app-clock-status-tab { padding: 20px; }
.loading-state { text-align: center; padding: 40px; color: var(--text-secondary); }
.empty-state { text-align: center; padding: 40px; color: var(--text-secondary); }
.small { padding: 16px 0; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.section-title { margin: 0; font-size: 16px; font-weight: 600; }
.status-table-wrapper { margin-bottom: 16px; }
.error-text { color: var(--danger-color, #f56c6c); word-break: break-all; }
.message-text { color: var(--text-secondary); word-break: break-all; font-size: 12px; }
.status-hint { color: var(--text-secondary); font-size: 12px; }
</style>
