<script setup lang="ts">
import { useContractV2Store } from '@/stores/contract-v2'
import Pagination from '@/components/Pagination.vue'

const emit = defineEmits<{
  'click-contract': [contractId: string]
}>()

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

const statusLabels: Record<string, { label: string; type: string }> = {
  draft: { label: '草稿', type: 'info' },
  active: { label: '生效', type: 'success' },
  expired: { label: '过期', type: 'warning' },
  terminated: { label: '终止', type: 'danger' },
}

function handlePageChange(page: number) {
  store.loadContracts({
    org_node_id: store.selectedNodeId || undefined,
    include_children: true,
    page,
    page_size: store.contractsPageSize,
  })
}
</script>

<template>
  <div class="contract-list">
    <div class="contract-list-header">
      <span class="contract-list-count">共 {{ store.contractsTotal }} 份合同</span>
    </div>

    <el-table
      :data="store.contracts"
      v-loading="store.contractsLoading"
      stripe
    >
      <el-table-column prop="contract_name" label="合同名称" min-width="200">
        <template #default="{ row }">
          <span class="contract-name-link" @click="emit('click-contract', row.id)">{{ row.contract_name }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="contract_type" label="类型" width="120">
        <template #default="{ row }">
          {{ contractTypeLabels[row.contract_type] || row.contract_type || '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="version_count" label="版本数" width="80" align="center" />
      <el-table-column prop="status" label="状态" width="80" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="(statusLabels[row.status]?.type as any) || 'info'" disable-transitions>
            {{ statusLabels[row.status]?.label || row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="updated_at" label="更新时间" width="170">
        <template #default="{ row }">
          {{ row.updated_at?.slice(0, 16)?.replace('T', ' ') }}
        </template>
      </el-table-column>
    </el-table>

    <div class="contract-list-pagination" v-if="store.contractsTotal > store.contractsPageSize">
      <Pagination
        :total="store.contractsTotal"
        :page="store.contractsPage"
        :page-size="store.contractsPageSize"
        @current-change="handlePageChange"
      />
    </div>
  </div>
</template>

<style scoped>
.contract-list {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.contract-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.contract-list-count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.contract-name-link {
  color: var(--el-color-primary);
  cursor: pointer;
}

.contract-name-link:hover {
  text-decoration: underline;
}

.contract-list-pagination {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
</style>
