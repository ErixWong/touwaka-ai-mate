<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useContractV2Store } from '@/stores/contract-v2'

const store = useContractV2Store()

const contractTypeLabels: Record<string, string> = {
  strategy: '战略合同',
  framework: '框架合同',
  development: '开发合同',
  supply: '供应合同',
  purchase: '采购合同',
  quality: '质量合同',
  nda: '保密协议',
  technical: '技术合同',
  other: '其他',
}

onMounted(() => {
  if (!store.dashboard) {
    store.loadDashboard()
  }
})

const statusTotal = computed(() => {
  if (!store.dashboard) return 0
  return Object.values(store.dashboard.by_status).reduce((sum: number, v) => sum + (v as number), 0)
})

const typeTotal = computed(() => {
  if (!store.dashboard) return 0
  return Object.values(store.dashboard.by_type).reduce((sum: number, v) => sum + (v as number), 0)
})

const processingStats = computed(() => {
  let processing = 0
  let ready = 0
  let error = 0
  for (const contract of store.contracts) {
    if (!contract.document_id) continue
    const map = store.processingStatusMap
    const entry = map[contract.document_id]
    const status = entry?.status || contract.processing_status
    if (!status) continue
    if (status === 'ready') {
      ready++
    } else if (status === 'error') {
      error++
    } else {
      processing++
    }
  }
  return { processing, ready, error }
})

async function handleRefresh() {
  await store.loadDashboard()
  if (store.contracts.length > 0) {
    store.startPolling()
  }
}
</script>

<template>
  <div class="dashboard-panel" v-loading="store.dashboardLoading">
    <div class="dashboard-refresh-bar">
      <el-button size="small" text @click="handleRefresh">
        <el-icon><Refresh /></el-icon> {{ $t('contractV2.dashboard.refresh') }}
      </el-button>
    </div>

    <template v-if="store.dashboard">
      <div class="dashboard-cards">
        <el-card shadow="hover" class="dashboard-card">
          <div class="dashboard-card-value">{{ store.dashboard.total_contracts }}</div>
          <div class="dashboard-card-label">{{ $t('contractV2.dashboard.contractTotal') }}</div>
        </el-card>
        <el-card shadow="hover" class="dashboard-card">
          <div class="dashboard-card-value">{{ processingStats.ready }}</div>
          <div class="dashboard-card-label">{{ $t('contractV2.dashboard.completed') }}</div>
        </el-card>
        <el-card shadow="hover" class="dashboard-card">
          <div class="dashboard-card-value processing">{{ processingStats.processing }}</div>
          <div class="dashboard-card-label">{{ $t('contractV2.dashboard.processing') }}</div>
        </el-card>
        <el-card shadow="hover" class="dashboard-card">
          <div class="dashboard-card-value error">{{ processingStats.error }}</div>
          <div class="dashboard-card-label">
            {{ $t('contractV2.dashboard.failed') }}
            <el-tooltip v-if="processingStats.error > 0" :content="$t('contractV2.dashboard.failedHint')" placement="top">
              <el-icon style="vertical-align: middle; cursor: help; font-size: 13px;"><QuestionFilled /></el-icon>
            </el-tooltip>
          </div>
        </el-card>
      </div>

      <el-row :gutter="20" style="margin-top: 20px;">
        <el-col :span="12">
          <el-card shadow="hover">
            <template #header>{{ $t('contractV2.dashboard.byStatus') }}</template>
            <div class="dashboard-bar" v-for="(count, status) in store.dashboard.by_status" :key="status">
              <span class="dashboard-bar-label">{{ status }}</span>
              <el-progress :percentage="statusTotal ? Math.round((count as number) / statusTotal * 100) : 0" :stroke-width="16" :text-inside="true">
                <span>{{ count }}</span>
              </el-progress>
            </div>
          </el-card>
        </el-col>
        <el-col :span="12">
          <el-card shadow="hover">
            <template #header>{{ $t('contractV2.dashboard.byType') }}</template>
            <div class="dashboard-bar" v-for="(count, type) in store.dashboard.by_type" :key="type">
              <span class="dashboard-bar-label">{{ contractTypeLabels[type] || type }}</span>
              <el-progress :percentage="typeTotal ? Math.round((count as number) / typeTotal * 100) : 0" :stroke-width="16" :text-inside="true">
                <span>{{ count }}</span>
              </el-progress>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <el-card shadow="hover" style="margin-top: 20px;">
        <template #header>{{ $t('contractV2.dashboard.recentCreated') }}</template>
        <el-table :data="store.dashboard.recent_contracts" stripe size="small">
          <el-table-column prop="contract_name" label="合同名称" min-width="200" />
          <el-table-column prop="contract_type" label="类型" width="120">
            <template #default="{ row }">
              {{ contractTypeLabels[row.contract_type] || row.contract_type || '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="80" />
          <el-table-column prop="created_at" label="创建时间" width="170">
            <template #default="{ row }">
              {{ row.created_at?.slice(0, 16)?.replace('T', ' ') }}
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.dashboard-refresh-bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.dashboard-cards {
  display: flex;
  gap: 16px;
}

.dashboard-card {
  flex: 1;
  text-align: center;
}

.dashboard-card-value {
  font-size: 32px;
  font-weight: 700;
  color: var(--el-color-primary);
}

.dashboard-card-value.processing {
  color: var(--el-color-warning);
}

.dashboard-card-value.error {
  color: var(--el-color-danger);
}

.dashboard-card-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.dashboard-bar {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.dashboard-bar-label {
  width: 80px;
  font-size: 13px;
  flex-shrink: 0;
}

.dashboard-bar .el-progress {
  flex: 1;
}
</style>
