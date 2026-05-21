<script setup lang="ts">
import { ref } from 'vue'
import { getApp, type MiniApp } from '@/api/mini-apps'
import InvoiceList from '@/components/invoice/InvoiceList.vue'
import AppStepConfig from '@/components/apps/AppStepConfig.vue'

const APP_ID = 'invoice-mgr'

const showStepConfig = ref(false)
const appData = ref<MiniApp | null>(null)

async function openStepConfig() {
  appData.value = await getApp(APP_ID)
  showStepConfig.value = true
}
</script>

<template>
  <div class="invoice-view">
    <div class="cv-toolbar">
      <el-button text @click="openStepConfig">
        <el-icon><Setting /></el-icon>
        步骤配置
      </el-button>
    </div>
    <InvoiceList />

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
.invoice-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.cv-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 8px 20px 0;
}
</style>
