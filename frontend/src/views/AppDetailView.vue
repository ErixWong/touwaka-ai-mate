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
import { shallowRef, ref, onMounted, defineAsyncComponent, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getAppWithRuntime, type AppRuntimeFrontend, type MiniApp } from '@/api/mini-apps'

const RuntimeComponentModules = import.meta.glob('@apps/*/frontend/views/*.vue')

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

  const entry = frontend.entry.replace(/^\.?\//, '')
  const loader = [
    `@apps/${appId}/${entry}`,
    `../apps/${appId}/${entry}`,
  ].map((moduleKey) => RuntimeComponentModules[moduleKey]).find(Boolean)

  if (!loader) return null

  return defineAsyncComponent(loader as () => Promise<Component>)
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
