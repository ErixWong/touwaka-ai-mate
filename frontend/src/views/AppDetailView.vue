<template>
  <div class="app-detail-view">
    <div v-if="isLoading" class="loading-state">加载中...</div>
    <div v-else-if="!currentApp" class="empty-state">
      <p>小程序未找到</p>
      <button class="btn-back" @click="goBack">← 返回</button>
    </div>
    <template v-else>
      <div class="app-header">
        <button class="btn-back" @click="goBack">← {{ $t('apps.back', '返回') }}</button>
        <div class="app-info">
          <span class="app-icon">{{ currentApp.icon }}</span>
          <h1 class="app-name">{{ currentApp.name }}</h1>
        </div>
      </div>

      <GenericMiniApp :app="currentApp" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getApp, type MiniApp } from '@/api/mini-apps'
import GenericMiniApp from '@/components/apps/GenericMiniApp.vue'

const route = useRoute()
const router = useRouter()
const currentApp = ref<MiniApp | null>(null)
const isLoading = ref(true)

onMounted(async () => {
  try {
    const appId = route.params.appId as string
    currentApp.value = await getApp(appId)
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
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--color-text-secondary, #666);
}

.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.btn-back {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-primary, #4a90d9);
  padding: 4px 8px;
}

.btn-back:hover {
  text-decoration: underline;
}

.app-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-icon {
  font-size: 28px;
}

.app-name {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}
</style>
