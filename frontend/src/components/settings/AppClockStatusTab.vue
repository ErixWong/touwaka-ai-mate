<template>
  <div class="app-clock-status-tab">
    <div v-if="loading" class="loading-state">{{ $t('common.loading') }}</div>

    <template v-else>
      <div class="section-header">
        <h3 class="section-title">{{ $t('appClock.statusPanel') }}</h3>
        <el-button @click="refresh">{{ $t('common.refresh') }}</el-button>
      </div>

      <div v-if="statusList.length === 0" class="empty-state">
        {{ $t('appClock.noApps') }}
      </div>

      <div v-else class="status-table-wrapper">
        <el-table :data="statusList" border stripe style="width: 100%">
          <el-table-column prop="app_id" :label="$t('appClock.appId')" width="200" />
          <el-table-column :label="$t('appClock.runStatus')" width="140">
            <template #default="{ row }">
              <el-tag v-if="row.run_status === 'running'" type="warning">
                {{ $t('appClock.statusRunning') }}
              </el-tag>
              <el-tag v-else-if="row.run_status === 'timed_out'" type="danger">
                {{ $t('appClock.statusTimedOut') }}
              </el-tag>
              <el-tag v-else-if="row.run_status === 'recovering'" type="info">
                {{ $t('appClock.statusRecovering') }}
              </el-tag>
              <el-tag v-else type="success">
                {{ $t('appClock.statusIdle') }}
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
          <el-table-column :label="$t('appClock.lastTimeoutAt')" width="180">
            <template #default="{ row }">
              {{ row.last_timeout_at ? formatTime(row.last_timeout_at) : '-' }}
            </template>
          </el-table-column>
          <el-table-column :label="$t('appClock.lastSuccessAt')" width="180">
            <template #default="{ row }">
              {{ row.last_success_at ? formatTime(row.last_success_at) : '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="last_error" :label="$t('appClock.lastError')" min-width="200">
            <template #default="{ row }">
              <span v-if="row.last_error" class="error-text">{{ row.last_error }}</span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('appClock.actions')" width="280" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="row.run_status === 'timed_out'"
                size="small"
                type="primary"
                :loading="actionLoading[row.app_id]"
                @click="handleClear(row.app_id)"
              >
                {{ $t('appClock.clearAndResume') }}
              </el-button>
              <el-button
                size="small"
                type="success"
                :loading="actionLoading[row.app_id]"
                :disabled="row.run_status === 'running' || row.run_status === 'recovering'"
                @click="handleForceTick(row.app_id)"
              >
                {{ $t('appClock.forceTick') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-if="timedOutCount > 0" class="warning-banner">
        <span>{{ $t('appClock.timedOutWarning', { count: timedOutCount }) }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToastStore } from '@/stores/toast'
import apiClient from '@/api/client'

const { t } = useI18n()
const toast = useToastStore()

interface AppClockStatus {
  app_id: string
  run_status: 'idle' | 'running' | 'timed_out' | 'recovering'
  started_at: string | null
  last_error: string | null
  last_timeout_at: string | null
  last_success_at: string | null
  duration_ms: number | null
  manual_clear_required: boolean
}

const statusList = ref<AppClockStatus[]>([])
const loading = ref(false)
const actionLoading = ref<Record<string, boolean>>({})

const timedOutCount = computed(() =>
  statusList.value.filter(s => s.run_status === 'timed_out').length
)

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
}

async function handleClear(appId: string) {
  actionLoading.value[appId] = true
  try {
    const response = await apiClient.post(`/app-clock/clear/${appId}`)
    const targetStatus = response.data.data?.target_status
    if (targetStatus === 'idle') {
      toast.success(t('appClock.clearSuccessIdle'))
    } else {
      toast.success(t('appClock.clearSuccessRecovering'))
    }
    await refresh()
  } catch (err: any) {
    toast.error(err?.response?.data?.message || t('appClock.clearFailed'))
  } finally {
    actionLoading.value[appId] = false
  }
}

async function handleForceTick(appId: string) {
  actionLoading.value[appId] = true
  try {
    await apiClient.post(`/app-clock/force-tick/${appId}`)
    toast.success(t('appClock.forceTickSuccess'))
    await refresh()
  } catch (err: any) {
    toast.error(err?.response?.data?.message || t('appClock.forceTickFailed'))
  } finally {
    actionLoading.value[appId] = false
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
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.section-title { margin: 0; font-size: 16px; font-weight: 600; }
.status-table-wrapper { margin-bottom: 16px; }
.error-text { color: var(--danger-color, #f56c6c); word-break: break-all; }
.warning-banner { display: flex; align-items: center; padding: 12px 16px; background: var(--warning-bg, #fdf6ec); border: 1px solid var(--warning-border, #e6a23c); border-radius: 8px; color: var(--warning-text, #b88230); margin-top: 16px; }
</style>
