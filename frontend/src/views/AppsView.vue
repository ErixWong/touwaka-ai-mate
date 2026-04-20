<template>
  <div class="apps-view">
    <div class="view-header">
      <h1 class="view-title">{{ $t('apps.title', '应用中心') }}</h1>
      
      <!-- Tab 切换 -->
      <div v-if="userStore.isAdmin" class="tab-switcher">
        <button
          :class="['tab-btn', { active: currentTab === 'my-apps' }]"
          @click="currentTab = 'my-apps'"
        >
          {{ $t('apps.myApps', '我的应用') }}
        </button>
        <button
          :class="['tab-btn', { active: currentTab === 'market' }]"
          @click="currentTab = 'market'"
        >
          {{ $t('apps.appMarket', '应用市场') }}
          <span v-if="hasUpdates" class="update-badge">{{ updateCount }}</span>
        </button>
      </div>
    </div>

    <!-- Tab 1: 我的应用 -->
    <div v-show="currentTab === 'my-apps'" class="tab-content">
      <div v-if="isLoadingMyApps" class="loading-state">
        {{ $t('common.loading', '加载中...') }}
      </div>

      <div v-else-if="myApps.length === 0" class="empty-state">
        <div class="empty-icon">📱</div>
        <p>{{ $t('apps.noApps', '暂无可用的小程序') }}</p>
        <button
          v-if="userStore.isAdmin"
          class="btn-primary"
          @click="currentTab = 'market'"
        >
          {{ $t('apps.goToMarket', '去应用市场安装') }}
        </button>
      </div>

      <div v-else class="apps-grid">
        <div
          v-for="app in myApps"
          :key="app.id"
          class="app-card"
          @click="openApp(app)"
        >
          <div class="app-card-icon">{{ app.icon || '📱' }}</div>
          <div class="app-card-name">{{ app.name }}</div>
          <div class="app-card-desc" v-if="app.description">{{ app.description }}</div>
          <div class="app-card-meta">
            <span class="app-type">{{ app.type }}</span>
            <span v-if="(app as any).updateAvailable" class="update-tag">{{ $t('apps.hasUpdate', '有更新') }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 2: 应用市场（仅管理员可见） -->
    <div v-show="currentTab === 'market'" class="tab-content">
      <AppMarketPanel
        :installed-apps="myApps.map(a => a.id)"
        @installed="handleAppInstalled"
        @uninstalled="handleAppUninstalled"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { getApps, type MiniApp } from '@/api/mini-apps'
import { checkAppUpdate } from '@/api/app-market'
import AppMarketPanel from '@/components/AppMarketPanel.vue'

const router = useRouter()
const userStore = useUserStore()

// Tab 切换
const currentTab = ref<'my-apps' | 'market'>('my-apps')

// 我的应用
const myApps = ref<MiniApp[]>([])
const isLoadingMyApps = ref(true)
const hasUpdates = ref(false)
const updateCount = ref(0)

// 加载我的应用
async function loadMyApps() {
  isLoadingMyApps.value = true
  try {
    const apps = await getApps()
    
    // 检查更新（仅管理员）
    if (userStore.isAdmin) {
      const appsWithUpdate = await Promise.all(
        apps.map(async (app) => {
          try {
            const updateInfo = await checkAppUpdate(app.id)
            return { ...app, updateAvailable: updateInfo.has_update }
          } catch (e) {
            console.warn(`Failed to check update for ${app.id}:`, e)
            return { ...app, updateAvailable: false }
          }
        })
      )
      myApps.value = appsWithUpdate
      updateCount.value = appsWithUpdate.filter(a => a.updateAvailable).length
      hasUpdates.value = updateCount.value > 0
    } else {
      myApps.value = apps
    }
  } catch (error) {
    console.error('Failed to load apps:', error)
  } finally {
    isLoadingMyApps.value = false
  }
}

// 打开 App
function openApp(app: MiniApp) {
  router.push(`/apps/${app.id}`)
}

// 处理应用安装完成
function handleAppInstalled(appId: string) {
  loadMyApps()
  currentTab.value = 'my-apps'
}

// 处理应用卸载完成
function handleAppUninstalled(appId: string) {
  loadMyApps()
}

onMounted(() => {
  loadMyApps()
})

// 切换回我的应用时刷新
watch(currentTab, (tab) => {
  if (tab === 'my-apps') {
    loadMyApps()
  }
})
</script>

<style scoped>
.apps-view {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 16px;
}

.view-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
}

.tab-switcher {
  display: flex;
  gap: 8px;
  background: var(--color-bg-secondary, #f5f5f5);
  padding: 4px;
  border-radius: 8px;
}

.tab-btn {
  padding: 8px 16px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-secondary, #666);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tab-btn:hover {
  color: var(--color-text-primary, #333);
}

.tab-btn.active {
  background: var(--color-bg-primary, #fff);
  color: var(--color-primary, #4a90d9);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.update-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: #ff4d4f;
  color: white;
  font-size: 11px;
  font-weight: 600;
  border-radius: 9px;
}

.tab-content {
  min-height: 400px;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 80px 20px;
  color: var(--color-text-secondary, #666);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-state .btn-primary {
  margin-top: 16px;
  padding: 10px 20px;
  background: var(--color-primary, #4a90d9);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.empty-state .btn-primary:hover {
  background: var(--color-primary-dark, #3a7bc8);
}

.apps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
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

.app-card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.app-type {
  font-size: 12px;
  color: var(--color-text-tertiary, #999);
  text-transform: uppercase;
}

.update-tag {
  font-size: 11px;
  padding: 2px 8px;
  background: #fff2f0;
  color: #ff4d4f;
  border-radius: 4px;
  border: 1px solid #ffccc7;
}
</style>
