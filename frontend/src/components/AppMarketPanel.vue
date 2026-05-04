<template>
  <div class="app-market-panel">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="category-filter">
        <button
          :class="['filter-btn', { active: selectedCategory === 'all' }]"
          @click="selectedCategory = 'all'"
        >
          {{ $t('appMarket.all', '全部') }}
        </button>
        <button
          v-for="cat in categories"
          :key="cat.id"
          :class="['filter-btn', { active: selectedCategory === cat.id }]"
          @click="selectedCategory = cat.id"
        >
          {{ cat.icon }} {{ cat.name }}
        </button>
      </div>

      <div class="search-box">
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="$t('appMarket.searchPlaceholder', '搜索应用...')"
          @input="handleSearch"
        />
        <button class="btn-refresh" @click="refreshIndex" :disabled="isLoading">
          {{ $t('common.refresh', '刷新') }}
        </button>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-state">
      <div class="spinner"></div>
      <span>{{ $t('common.loading', '加载中...') }}</span>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="error-state">
      <p>{{ error }}</p>
      <button class="btn-retry" @click="refreshIndex">
        {{ $t('common.retry', '重试') }}
      </button>
    </div>

    <!-- App 列表 -->
    <div v-else class="market-grid">
      <div
        v-for="app in filteredApps"
        :key="app.id"
        :class="['market-app-card', { installed: isInstalled(app.id) }]"
      >
        <div class="app-header">
          <div class="app-icon">{{ app.icon }}</div>
          <div class="app-version">v{{ app.version }}</div>
        </div>

        <h3 class="app-name">{{ app.name }}</h3>
        <p class="app-desc">{{ app.description }}</p>

        <div class="app-tags">
          <span v-for="tag in app.tags.slice(0, 3)" :key="tag" class="tag">
            {{ tag }}
          </span>
        </div>

        <div class="app-meta">
          <span class="app-author">{{ app.author }}</span>
          <span v-if="app.hasUpdate" class="update-badge">{{ $t('appMarket.updateAvailable', '有更新') }}</span>
        </div>

        <div class="app-actions">
          <button
            v-if="isInstalled(app.id)"
            class="btn-installed"
            disabled
          >
            <span class="icon">✓</span>
            {{ $t('appMarket.installed', '已安装') }}
          </button>
          <button
            v-else-if="isInstalling === app.id"
            class="btn-installing"
            disabled
          >
            <span class="spinner-small"></span>
            {{ $t('appMarket.installing', '安装中...') }}
          </button>
          <button
            v-else
            class="btn-install"
            @click="installApp(app)"
          >
            {{ $t('appMarket.install', '安装') }}
          </button>

          <button
            v-if="isInstalled(app.id)"
            class="btn-uninstall"
            @click="uninstallApp(app)"
          >
            {{ $t('appMarket.uninstall', '卸载') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <div v-if="showDetail" class="dialog-overlay" @click.self="closeDetail">
      <div class="dialog">
        <div class="dialog-header">
          <h3>{{ selectedApp?.name }}</h3>
          <button class="btn-close" @click="closeDetail">×</button>
        </div>

        <div class="dialog-body">
          <div class="app-info">
            <div class="app-icon-large">{{ selectedApp?.icon }}</div>
            <div class="app-meta-detail">
              <p class="version">v{{ selectedAppManifest?.version }}</p>
              <p class="author">{{ $t('appMarket.author', '作者') }}: {{ selectedApp?.author }}</p>
              <p class="license">{{ $t('appMarket.license', '许可证') }}: {{ selectedAppManifest?.license }}</p>
            </div>
          </div>

          <p class="description">{{ selectedApp?.description }}</p>

          <!-- 依赖检查 -->
          <div v-if="dependencyCheck" class="deps-section">
            <h4>{{ $t('appMarket.dependencies', '依赖检查') }}</h4>
            <div v-if="dependencyCheck.satisfied" class="deps-satisfied">
              <span class="icon">✓</span> {{ $t('appMarket.allDepsSatisfied', '所有依赖已满足') }}
            </div>
            <div v-else class="deps-missing">
              <p v-if="dependencyCheck.missing.mcp.length > 0">
                <strong>{{ $t('appMarket.missingMcp', '缺少 MCP 服务') }}:</strong>
                {{ dependencyCheck.missing.mcp.join(', ') }}
              </p>
            </div>
          </div>

          <!-- 字段列表 -->
          <div v-if="selectedAppManifest?.fields" class="fields-section">
            <h4>{{ $t('appMarket.fields', '字段定义') }} ({{ selectedAppManifest.fields.length }})</h4>
            <ul class="field-list">
              <li
                v-for="field in selectedAppManifest.fields.slice(0, 10)"
                :key="field.name"
              >
                {{ field.label }} ({{ field.type }})
                <span v-if="field.required" class="required">*</span>
                <span v-if="field.ai_extractable" class="ai-badge">AI</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeDetail">
            {{ $t('common.close', '关闭') }}
          </button>
          <button
            v-if="selectedApp && !isInstalled(selectedApp.id) && dependencyCheck?.satisfied"
            class="btn-primary"
            @click="installFromDetail"
          >
            {{ $t('appMarket.install', '安装') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  getAppMarketIndex,
  getAppManifest,
  checkAppDependencies,
  installAppFromMarket,
  uninstallAppFromMarket,
  type AppSummary,
  type Category,
  type AppManifest,
  type DependencyCheckResult
} from '@/api/app-market'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()

const props = defineProps<{
  installedApps: string[]
}>()

const emit = defineEmits<{
  installed: [appId: string]
  uninstalled: [appId: string]
}>()

// 状态
const isLoading = ref(false)
const error = ref<string | null>(null)
const index = ref<{ apps: AppSummary[]; categories: Category[] } | null>(null)
const selectedCategory = ref<string>('all')
const searchQuery = ref('')
const isInstalling = ref<string | null>(null)

// 详情弹窗
const showDetail = ref(false)
const selectedApp = ref<AppSummary | null>(null)
const selectedAppManifest = ref<AppManifest | null>(null)
const dependencyCheck = ref<DependencyCheckResult | null>(null)

// 计算属性
const categories = computed(() => index.value?.categories || [])

const filteredApps = computed(() => {
  let apps = index.value?.apps || []

  // 分类筛选
  if (selectedCategory.value !== 'all') {
    apps = apps.filter(a => a.type === selectedCategory.value)
  }

  // 搜索筛选
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    apps = apps.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.tags.some(t => t.toLowerCase().includes(q))
    )
  }

  // 标记已安装和有更新的
  return apps.map(app => ({
    ...app,
    hasUpdate: props.installedApps.includes(app.id) && appHasUpdate(app.id)
  }))
})

// 检查应用是否有更新（简化版，实际需要调用 API）
function appHasUpdate(appId: string): boolean {
  // 这里可以实现本地缓存的版本对比
  return false
}

function isInstalled(appId: string): boolean {
  return props.installedApps.includes(appId)
}

// 加载 Registry 索引
async function refreshIndex() {
  isLoading.value = true
  error.value = null
  try {
    index.value = await getAppMarketIndex()
  } catch (err: any) {
    error.value = err.message || 'Failed to load app market'
  } finally {
    isLoading.value = false
  }
}

// 搜索防抖
let searchTimeout: ReturnType<typeof setTimeout>
function handleSearch() {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    // 搜索逻辑已在 computed 中处理
  }, 300)
}

// 安装应用
async function installApp(app: AppSummary) {
  isInstalling.value = app.id
  try {
    // 先检查依赖
    const deps = await checkAppDependencies(app.id)
    if (!deps.satisfied) {
      const missingMcp = deps.missing.mcp.join(' 或 ')
      toast.error(`${t('appMarket.missingMcp', '缺少以下任一 MCP 服务')}: ${missingMcp}`)
      return
    }

    // 安装
    await installAppFromMarket(app.id, 'all')
    emit('installed', app.id)
    toast.success(`${app.name} installed successfully`)
  } catch (err: any) {
    toast.error(`Installation failed: ${err.message}`)
  } finally {
    isInstalling.value = null
  }
}

// 卸载应用
async function uninstallApp(app: AppSummary) {
  const confirmed = window.confirm(
    `Are you sure you want to uninstall ${app.name}?\n\nData will be kept by default.`
  )
  if (!confirmed) return

  try {
    await uninstallAppFromMarket(app.id, true)
    emit('uninstalled', app.id)
    toast.success(`${app.name} uninstalled successfully`)
  } catch (err: any) {
    toast.error(`Uninstallation failed: ${err.message}`)
  }
}

// 查看详情
async function showAppDetail(app: AppSummary) {
  selectedApp.value = app
  showDetail.value = true
  try {
    selectedAppManifest.value = await getAppManifest(app.id)
    dependencyCheck.value = await checkAppDependencies(app.id)
  } catch (err: any) {
    console.error('Failed to load app detail:', err)
  }
}

function closeDetail() {
  showDetail.value = false
  selectedApp.value = null
  selectedAppManifest.value = null
  dependencyCheck.value = null
}

function installFromDetail() {
  if (selectedApp.value) {
    installApp(selectedApp.value)
    closeDetail()
  }
}

onMounted(() => {
  refreshIndex()
})
</script>

<style scoped>
.app-market-panel {
  padding: 0;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 16px;
}

.category-filter {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-btn {
  padding: 8px 16px;
  border: 1px solid var(--color-border, #e0e0e0);
  background: var(--color-bg-primary, #fff);
  border-radius: 20px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.filter-btn:hover {
  border-color: var(--color-primary, #4a90d9);
}

.filter-btn.active {
  background: var(--color-primary, #4a90d9);
  color: white;
  border-color: var(--color-primary, #4a90d9);
}

.search-box {
  display: flex;
  gap: 8px;
}

.search-box input {
  padding: 8px 12px;
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 6px;
  width: 200px;
  font-size: 13px;
}

.btn-refresh {
  padding: 8px 16px;
  background: var(--color-bg-secondary, #f5f5f5);
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.btn-refresh:hover:not(:disabled) {
  background: var(--color-bg-tertiary, #eee);
}

.loading-state,
.error-state {
  text-align: center;
  padding: 80px 20px;
  color: var(--color-text-secondary, #666);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e0e0e0;
  border-top-color: var(--color-primary, #4a90d9);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.btn-retry {
  margin-top: 16px;
  padding: 8px 16px;
  background: var(--color-primary, #4a90d9);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.market-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.market-app-card {
  background: var(--color-bg-primary, #fff);
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 12px;
  padding: 20px;
  transition: all 0.2s;
}

.market-app-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.market-app-card.installed {
  border-color: #52c41a;
  background: #f6ffed;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.app-icon {
  font-size: 36px;
}

.app-version {
  font-size: 12px;
  color: var(--color-text-tertiary, #999);
}

.app-name {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 8px;
}

.app-desc {
  font-size: 13px;
  color: var(--color-text-secondary, #666);
  margin-bottom: 12px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.app-tags {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.tag {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--color-bg-secondary, #f5f5f5);
  color: var(--color-text-secondary, #666);
  border-radius: 4px;
}

.app-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.app-author {
  font-size: 12px;
  color: var(--color-text-tertiary, #999);
}

.update-badge {
  font-size: 11px;
  padding: 2px 8px;
  background: #fff2f0;
  color: #ff4d4f;
  border-radius: 4px;
}

.app-actions {
  display: flex;
  gap: 8px;
}

.app-actions button {
  flex: 1;
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  border: none;
  transition: all 0.2s;
}

.btn-install {
  background: var(--color-primary, #4a90d9);
  color: white;
}

.btn-install:hover {
  background: var(--color-primary-dark, #3a7bc8);
}

.btn-installing {
  background: #f5f5f5;
  color: #999;
  cursor: not-allowed;
}

.spinner-small {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid #e0e0e0;
  border-top-color: var(--color-primary, #4a90d9);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-right: 6px;
}

.btn-installed {
  background: #f6ffed;
  color: #52c41a;
  border: 1px solid #52c41a;
  cursor: default;
}

.btn-uninstall {
  background: #fff2f0;
  color: #ff4d4f;
  border: 1px solid #ffccc7;
}

.btn-uninstall:hover {
  background: #ff4d4f;
  color: white;
}

/* 弹窗样式 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.dialog {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 560px;
  max-height: 80vh;
  overflow-y: auto;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border, #e0e0e0);
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
}

.btn-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--color-text-secondary, #666);
}

.dialog-body {
  padding: 24px;
}

.app-info {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.app-icon-large {
  font-size: 56px;
}

.app-meta-detail p {
  margin: 4px 0;
  font-size: 13px;
  color: var(--color-text-secondary, #666);
}

.description {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-primary, #333);
  margin-bottom: 20px;
}

.deps-section,
.fields-section {
  margin-bottom: 20px;
}

.deps-section h4,
.fields-section h4 {
  font-size: 14px;
  margin: 0 0 12px;
  color: var(--color-text-primary, #333);
}

.deps-satisfied {
  color: #52c41a;
  font-size: 13px;
}

.deps-missing {
  color: #ff4d4f;
  font-size: 13px;
}

.field-list {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 13px;
}

.field-list li {
  padding: 6px 0;
  border-bottom: 1px solid var(--color-border-light, #f0f0f0);
}

.required {
  color: #ff4d4f;
  margin-left: 4px;
}

.ai-badge {
  font-size: 10px;
  padding: 1px 4px;
  background: var(--color-primary, #4a90d9);
  color: white;
  border-radius: 3px;
  margin-left: 4px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--color-border, #e0e0e0);
}

.btn-cancel {
  padding: 10px 20px;
  background: var(--color-bg-secondary, #f5f5f5);
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.btn-primary {
  padding: 10px 20px;
  background: var(--color-primary, #4a90d9);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.btn-primary:hover {
  background: var(--color-primary-dark, #3a7bc8);
}
</style>
