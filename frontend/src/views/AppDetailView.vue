<template>
  <div class="app-detail-view">
    <div v-if="isLoading" class="loading-state">加载中...</div>
    <div v-else-if="!currentApp" class="empty-state">
      <p>小程序未找到</p>
      <button class="btn-back" @click="goBack">← 返回</button>
    </div>
    <div v-else-if="!AppComponent" class="empty-state">
      <p>该应用尚未配置前端组件</p>
      <p class="empty-hint">请在应用 manifest 中配置 runtime.frontend.entry</p>
      <button class="btn-back" @click="goBack">← 返回</button>
    </div>
    <component v-else :is="AppComponent" :app="currentApp" />
  </div>
</template>

<script setup lang="ts">
import { shallowRef, ref, onMounted, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getAppWithRuntime, type AppRuntimeFrontend, type MiniApp } from '@/api/mini-apps'

// 注意：这里用顶层静态 import（不能用 import.meta.glob / 动态 import），
// 因为 script setup 编译后的虚拟模块中 alias 与 glob 均不可靠；
// 静态 import 走标准 resolve（与 '@/api/...' 同机制）。
import ContractMgrRuntimeView from '@apps/contract-mgr/frontend/views/AppRuntimeView.vue'
import ContractMgrV2RuntimeView from '@apps/contract-mgr-v2/frontend/views/AppRuntimeView.vue'
import CurrentFeatureAnalyzerRuntimeView from '@apps/current-feature-analyzer/frontend/views/CurrentFeatureAnalyzerView.vue'
import DowntimeAnalyzerRuntimeView from '@apps/downtime-analyzer/frontend/views/AppRuntimeView.vue'
import ElsRuntimeView from '@apps/els/frontend/views/AppRuntimeView.vue'
import InvoiceMgrRuntimeView from '@apps/invoice-mgr/frontend/views/AppRuntimeView.vue'
import OcrToolRuntimeView from '@apps/ocr-tool/frontend/views/AppRuntimeView.vue'
import ResumeFastScreeningRuntimeView from '@apps/resume-fast-screening/frontend/views/AppRuntimeView.vue'
import StandardMgrRuntimeView from '@apps/standard-mgr/frontend/views/AppRuntimeView.vue'

const RuntimeComponentModules: Record<string, Component> = {
  'contract-mgr': ContractMgrRuntimeView,
  'contract-mgr-v2': ContractMgrV2RuntimeView,
  'current-feature-analyzer': CurrentFeatureAnalyzerRuntimeView,
  'downtime-analyzer': DowntimeAnalyzerRuntimeView,
  'els': ElsRuntimeView,
  'invoice-mgr': InvoiceMgrRuntimeView,
  'ocr-tool': OcrToolRuntimeView,
  'resume-fast-screening': ResumeFastScreeningRuntimeView,
  'standard-mgr': StandardMgrRuntimeView,
}

const route = useRoute()
const router = useRouter()
const currentApp = shallowRef<MiniApp | null>(null)
const AppComponent = shallowRef<Component | null>(null)
const isLoading = ref(true)

onMounted(async () => {
  try {
    const appId = route.params.appId as string
    currentApp.value = await getAppWithRuntime(appId)
    AppComponent.value = resolveAppComponent(currentApp.value)
  } catch (error) {
    console.error('Failed to load app:', error)
  } finally {
    isLoading.value = false
  }
})

function resolveAppComponent(app: MiniApp | null): Component | null {
  if (!app) return null

  return resolveRuntimeFrontendComponent(app.id, app.runtime?.frontend)
}

function resolveRuntimeFrontendComponent(appId: string, frontend?: AppRuntimeFrontend | null): Component | null {
  if (!frontend?.entry) return null

  const loader = RuntimeComponentModules[appId]
  if (!loader) return null

  return loader
}

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
