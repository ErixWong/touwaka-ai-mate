<script setup lang="ts">
import { ref, computed } from 'vue'
import { useContractV2Store } from '@/stores/contract-v2'
import Pagination from '@/components/Pagination.vue'

const emit = defineEmits<{
  'click-contract': [contractId: string]
}>()

const store = useContractV2Store()

const nodeTypeLabels: Record<string, string> = {
  group: '集团',
  party: '甲方',
  project: '项目',
}

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

const filterStatus = ref('')
const filterType = ref('')
const searchText = ref('')

const filteredContracts = computed(() => {
  let list = store.contracts
  if (searchText.value) {
    const q = searchText.value.toLowerCase()
    list = list.filter(c =>
      c.contract_name.toLowerCase().includes(q)
    )
  }
  if (filterStatus.value) {
    list = list.filter(c => c.status === filterStatus.value)
  }
  if (filterType.value) {
    list = list.filter(c => c.contract_type === filterType.value)
  }
  return list
})

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
    <div v-if="store.selectedNode" class="contract-list-node-header">
      <el-tag size="large" effect="plain">
        {{ nodeTypeLabels[store.selectedNode.node_type] || store.selectedNode.node_type }}
      </el-tag>
      <span class="contract-list-node-name">{{ store.selectedNode.name }}</span>
      <span class="contract-list-node-count">共 {{ store.contractsTotal }} 份合同</span>
    </div>
    <div v-else class="contract-list-node-header">
      <span class="contract-list-node-name">全部合同</span>
      <span class="contract-list-node-count">共 {{ store.contractsTotal }} 份</span>
    </div>

    <div class="contract-list-filters">
      <el-input
        v-model="searchText"
        placeholder="搜索合同名称"
        prefix-icon="Search"
        clearable
        style="width: 220px;"
      />
      <el-select v-model="filterStatus" placeholder="全部状态" clearable style="width: 120px;">
        <el-option v-for="(v, k) in statusLabels" :key="k" :label="v.label" :value="k" />
      </el-select>
      <el-select v-model="filterType" placeholder="全部类型" clearable style="width: 130px;">
        <el-option v-for="(v, k) in contractTypeLabels" :key="k" :label="v" :value="k" />
      </el-select>
    </div>

    <div class="contract-list-cards" v-loading="store.contractsLoading">
      <div v-if="filteredContracts.length === 0 && !store.contractsLoading" class="contract-list-empty">
        <el-empty description="暂无合同" />
      </div>
      <div
        v-for="contract in filteredContracts"
        :key="contract.id"
        class="contract-card"
        @click="emit('click-contract', contract.id)"
      >
        <div class="contract-card-header">
          <span class="contract-card-name">{{ contract.contract_name }}</span>
          <el-tag size="small" :type="(statusLabels[contract.status]?.type as any) || 'info'" disable-transitions>
            {{ statusLabels[contract.status]?.label || contract.status }}
          </el-tag>
        </div>
        <div class="contract-card-meta">
          <span class="contract-card-type">
            {{ contractTypeLabels[contract.contract_type] || contract.contract_type || '-' }}
          </span>
          <span class="contract-card-versions">{{ contract.version_count }} 个版本</span>
          <span class="contract-card-date">
            {{ contract.updated_at?.slice(0, 10) }}
          </span>
        </div>
      </div>
    </div>

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

.contract-list-node-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--el-border-color);
}

.contract-list-node-name {
  font-size: 18px;
  font-weight: 600;
}

.contract-list-node-count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-left: auto;
}

.contract-list-filters {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.contract-list-cards {
  flex: 1;
  overflow-y: auto;
}

.contract-list-empty {
  padding: 40px 0;
}

.contract-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 14px 18px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.contract-card:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.contract-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.contract-card-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.contract-card:hover .contract-card-name {
  color: var(--el-color-primary);
}

.contract-card-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.contract-card-type {
  background: var(--el-fill-color-light);
  padding: 2px 8px;
  border-radius: 4px;
}

.contract-card-versions {
  color: var(--el-color-primary);
}

.contract-card-date {
  margin-left: auto;
}

.contract-list-pagination {
  display: flex;
  justify-content: center;
  margin-top: 16px;
  padding-top: 12px;
}
</style>
