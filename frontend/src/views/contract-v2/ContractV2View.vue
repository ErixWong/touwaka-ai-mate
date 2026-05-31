<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useContractV2Store } from '@/stores/contract-v2'
import { getApp, type MiniApp } from '@/api/mini-apps'
import OrgTree from '@/components/contract-v2/OrgTree.vue'
import ContractList from '@/components/contract-v2/ContractList.vue'
import ContractDetail from '@/components/contract-v2/ContractDetail.vue'
import DashboardPanel from '@/components/contract-v2/DashboardPanel.vue'
import AppStepConfig from '@/components/apps/AppStepConfig.vue'

const APP_ID = 'contract-mgr-v2'

const store = useContractV2Store()
const activeTab = ref('list')
const showDetail = ref(false)
const showStepConfig = ref(false)
const appData = ref<MiniApp | null>(null)

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
  store.resetFilters()
  showDetail.value = false
}, { immediate: false })

function onContractClick(contractId: string) {
  store.loadContractDetail(contractId)
  showDetail.value = true
}

function onBackToList() {
  showDetail.value = false
}

async function openStepConfig() {
  appData.value = await getApp(APP_ID)
  showStepConfig.value = true
}
</script>

<template>
  <div class="contract-v2-page">
    <div class="cv2-sidebar">
      <OrgTree />
    </div>
    <div class="cv2-main">
      <div class="cv2-header">
        <el-tabs v-model="activeTab" class="cv2-tabs">
          <el-tab-pane label="合同列表" name="list" />
          <el-tab-pane label="统计概览" name="dashboard" />
        </el-tabs>
        <el-button text @click="openStepConfig" class="cv2-setting-btn">
          <el-icon><Setting /></el-icon>
        </el-button>
      </div>
      <div v-if="!showDetail" class="cv2-list-view">
        <ContractList v-if="activeTab === 'list'" @click-contract="onContractClick" />
        <DashboardPanel v-else />
      </div>
      <div v-else class="cv2-detail-view">
        <ContractDetail @back="onBackToList" />
      </div>
    </div>

    <AppStepConfig
      v-if="appData"
      :visible="showStepConfig"
      :app="appData"
      @close="showStepConfig = false"
      @saved="showStepConfig = false"
    />
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
  padding: 12px 16px;
}

.cv2-header {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  gap: 8px;
}

.cv2-tabs {
  flex: 1;
  height: auto;
}

.cv2-tabs :deep(.el-tabs__header) {
  margin: 0;
}

.cv2-tabs :deep(.el-tabs__item) {
  padding: 0 16px;
  height: 36px;
  line-height: 36px;
}

.cv2-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.cv2-setting-btn {
  padding: 6px 8px;
}

.cv2-list-view {
  height: calc(100% - 48px);
  overflow-y: auto;
}

.cv2-detail-view {
  height: 100%;
  overflow-y: auto;
}
</style>
