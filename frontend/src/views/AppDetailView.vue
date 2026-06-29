<template>
  <div class="app-detail-view">
    <div v-if="isLoading" class="loading-state">加载中...</div>
    <div v-else-if="!currentApp" class="empty-state">
      <p>小程序未找到</p>
      <button class="btn-back" @click="goBack">← 返回</button>
    </div>
    <div v-else-if="!AppComponent" class="empty-state">
      <p>该应用尚未配置前端组件</p>
      <p class="empty-hint">请在应用管理中配置 component 字段</p>
      <button class="btn-back" @click="goBack">← 返回</button>
    </div>
    <component v-else :is="AppComponent" :app="currentApp" />
  </div>
</template>

<script setup lang="ts">
import { shallowRef, ref, onMounted, defineAsyncComponent, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getApp, type MiniApp } from '@/api/mini-apps'

const AppComponentMap: Record<string, Component> = {
  'ContractMgrView': defineAsyncComponent(() => import('@/views/contract-mgr/ContractMgrView.vue')),
  'ContractV2View': defineAsyncComponent(() => import('@/views/contract-v2/ContractV2View.vue')),
  'DowntimeAnalyzer': defineAsyncComponent(() => import('@/views/downtime-analyzer/DowntimeAnalyzer.vue')),
  'ELSStudyView': defineAsyncComponent(() => import('@/views/els/ELSStudyView.vue')),
  'InvoiceView': defineAsyncComponent(() => import('@/views/invoice/InvoiceView.vue')),
  'OcrToolView': defineAsyncComponent(() => import('@/views/ocr-tool/OcrToolView.vue')),
  'ResumeScreeningView': defineAsyncComponent(() => import('@/views/resume-fast-screening/ResumeScreeningView.vue')),
  'CurrentFeatureAnalyzerView': defineAsyncComponent(() => import('@apps/current-feature-analyzer/frontend/views/CurrentFeatureAnalyzerView.vue')),
}

const route = useRoute()
const router = useRouter()
const currentApp = shallowRef<MiniApp | null>(null)
const AppComponent = shallowRef<Component | null>(null)
const isLoading = ref(true)

onMounted(async () => {
  try {
    const appId = route.params.appId as string
    currentApp.value = await getApp(appId)
    const componentKey = currentApp.value?.component
    if (componentKey && componentKey in AppComponentMap) {
      AppComponent.value = AppComponentMap[componentKey]!
    }
    // 如果 componentKey 不存在于 AppComponentMap 中，AppComponent 保持 null，显示空状态
  } catch (error) {
    console.error('Failed to load app:', error)
  } finally {
    isLoading.value = false
  }
})

function goBack() {
  router.push('/apps')
}
</script>

<style scoped>
.app-detail-view {
  padding: 0;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--color-text-secondary, #666);
}

.empty-hint {
  font-size: 13px;
  color: #999;
  margin-top: 8px;
}
</style>
