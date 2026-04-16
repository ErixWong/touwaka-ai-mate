<template>
  <div class="apps-view">
    <div class="view-header">
      <h1 class="view-title">{{ $t('apps.title', 'App 小程序') }}</h1>
    </div>

    <div v-if="isLoading" class="loading-state">
      {{ $t('common.loading', '加载中...') }}
    </div>

    <div v-else-if="apps.length === 0" class="empty-state">
      <div class="empty-icon">📱</div>
      <p>{{ $t('apps.noApps', '暂无可用的小程序') }}</p>
    </div>

    <div v-else class="apps-grid">
      <div
        v-for="app in apps"
        :key="app.id"
        class="app-card"
        @click="openApp(app)"
      >
        <div class="app-card-icon">{{ app.icon || '📱' }}</div>
        <div class="app-card-name">{{ app.name }}</div>
        <div class="app-card-desc" v-if="app.description">{{ app.description }}</div>
        <div class="app-card-type">{{ app.type }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getApps, type MiniApp } from '@/api/mini-apps'

const router = useRouter()
const apps = ref<MiniApp[]>([])
const isLoading = ref(true)

onMounted(async () => {
  try {
    apps.value = await getApps()
  } catch (error) {
    console.error('Failed to load apps:', error)
  } finally {
    isLoading.value = false
  }
})

function openApp(app: MiniApp) {
  router.push(`/apps/${app.id}`)
}
</script>

<style scoped>
.apps-view {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.view-header {
  margin-bottom: 24px;
}

.view-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--color-text-secondary, #666);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.apps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 20px;
}

.app-card {
  background: var(--color-bg-primary, #fff);
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 12px;
  padding: 24px;
  cursor: pointer;
  transition: all 0.2s;
}

.app-card:hover {
  border-color: var(--color-primary, #4a90d9);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.app-card-icon {
  font-size: 32px;
  margin-bottom: 12px;
}

.app-card-name {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}

.app-card-desc {
  font-size: 13px;
  color: var(--color-text-secondary, #666);
  margin-bottom: 12px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.app-card-type {
  font-size: 12px;
  color: var(--color-text-tertiary, #999);
  text-transform: uppercase;
}
</style>
