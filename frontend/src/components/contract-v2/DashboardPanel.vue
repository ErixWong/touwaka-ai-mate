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
</script>

<template>
  <div class="dashboard-panel" v-loading="store.dashboardLoading">
    <template v-if="store.dashboard">
      <div class="dashboard-cards">
        <el-card shadow="hover" class="dashboard-card">
          <div class="dashboard-card-value">{{ store.dashboard.total_contracts }}</div>
          <div class="dashboard-card-label">合同总数</div>
        </el-card>
        <el-card shadow="hover" class="dashboard-card">
          <div class="dashboard-card-value">{{ store.dashboard.total_versions }}</div>
          <div class="dashboard-card-label">版本总数</div>
        </el-card>
        <el-card shadow="hover" class="dashboard-card">
          <div class="dashboard-card-value">{{ store.dashboard.total_nodes }}</div>
          <div class="dashboard-card-label">组织节点</div>
        </el-card>
      </div>

      <el-row :gutter="20" style="margin-top: 20px;">
        <el-col :span="12">
          <el-card shadow="hover">
            <template #header>按状态分布</template>
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
            <template #header>按类型分布</template>
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
        <template #header>最近创建</template>
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
