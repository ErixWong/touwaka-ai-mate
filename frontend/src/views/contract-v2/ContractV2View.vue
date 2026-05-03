<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useContractV2Store } from '@/stores/contract-v2'
import OrgTree from '@/components/contract-v2/OrgTree.vue'
import ContractList from '@/components/contract-v2/ContractList.vue'
import ContractDetail from '@/components/contract-v2/ContractDetail.vue'
import DashboardPanel from '@/components/contract-v2/DashboardPanel.vue'

const store = useContractV2Store()
const activeTab = ref('list')
const showDetail = ref(false)

onMounted(async () => {
  await Promise.all([
    store.loadTree(),
    store.loadDashboard(),
  ])
  await store.loadContracts({ page: 1 })
})

watch(() => store.selectedNodeId, (nodeId) => {
  store.loadContracts({
    org_node_id: nodeId || undefined,
    include_children: true,
    page: 1,
  })
  showDetail.value = false
}, { immediate: false })

function onContractClick(contractId: string) {
  store.loadContractDetail(contractId)
  showDetail.value = true
}

function onBackToList() {
  showDetail.value = false
}
</script>

<template>
  <div class="contract-v2-page">
    <div class="cv2-sidebar">
      <OrgTree />
    </div>
    <div class="cv2-main">
      <div v-if="!showDetail" class="cv2-list-view">
        <el-tabs v-model="activeTab" class="cv2-tabs">
          <el-tab-pane label="合同列表" name="list">
            <ContractList
              @click-contract="onContractClick"
            />
          </el-tab-pane>
          <el-tab-pane label="统计概览" name="dashboard">
            <DashboardPanel />
          </el-tab-pane>
        </el-tabs>
      </div>
      <div v-else class="cv2-detail-view">
        <ContractDetail
          @back="onBackToList"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.contract-v2-page {
  display: flex;
  height: calc(100vh - 60px);
  overflow: hidden;
}

.cv2-sidebar {
  width: 280px;
  min-width: 280px;
  border-right: 1px solid var(--el-border-color-light);
  overflow-y: auto;
  background: var(--el-bg-color);
}

.cv2-main {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.cv2-tabs {
  height: 100%;
}

.cv2-tabs :deep(.el-tabs__content) {
  height: calc(100% - 50px);
  overflow-y: auto;
}

.cv2-tabs :deep(.el-tab-pane) {
  height: 100%;
}
</style>
