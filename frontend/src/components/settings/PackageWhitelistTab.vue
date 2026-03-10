<template>
  <div class="package-whitelist-tab">
    <div v-if="store.isLoading" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <template v-else>
      <!-- Tab 切换 -->
      <div class="tab-header">
        <button 
          class="tab-button" 
          :class="{ active: activeTab === 'nodejs' }"
          @click="activeTab = 'nodejs'"
        >
          📦 Node.js
        </button>
        <button 
          class="tab-button" 
          :class="{ active: activeTab === 'python' }"
          @click="activeTab = 'python'"
        >
          🐍 Python
        </button>
      </div>

      <!-- Node.js 模块白名单 -->
      <div v-show="activeTab === 'nodejs'" class="config-section">
        <div class="section-header">
          <h3 class="section-title">{{ $t('settings.moduleWhitelist') }}</h3>
          <div class="section-actions">
            <button class="btn-select-all" @click="selectAllNode">
              {{ $t('settings.selectAll') }}
            </button>
            <button class="btn-default" @click="selectDefaultNode">
              {{ $t('settings.selectDefault') }}
            </button>
            <button class="btn-clear" @click="clearNode">
              {{ $t('settings.clearAll') }}
            </button>
          </div>
        </div>

        <div class="whitelist-editor">
          <div class="package-list">
            <div class="package-search">
              <input
                type="text"
                v-model="nodeSearch"
                :placeholder="$t('settings.searchPackages')"
                class="search-input"
              />
            </div>
            
            <div class="packages-grid">
              <label 
                v-for="pkg in filteredNodePackages" 
                :key="pkg.name"
                class="package-item"
                :class="{ selected: form.allowed_node_modules.includes(pkg.name) }"
              >
                <input
                  type="checkbox"
                  :value="pkg.name"
                  v-model="form.allowed_node_modules"
                  class="package-checkbox"
                />
                <span class="package-name">{{ pkg.name }}</span>
                <span class="package-version" :class="{ 'built-in': pkg.version === 'built-in' }">
                  {{ pkg.version }}
                </span>
              </label>
            </div>
          </div>

          <div class="custom-input">
            <label class="custom-label">{{ $t('settings.customModules') }}:</label>
            <input
              type="text"
              v-model="customNodeModule"
              :placeholder="$t('settings.customModulePlaceholder')"
              class="custom-input-field"
              @keyup.enter="addCustomNodeModule"
            />
            <button class="btn-add" @click="addCustomNodeModule">
              {{ $t('common.add') }}
            </button>
          </div>
        </div>

        <div class="selected-count">
          {{ $t('settings.selectedCount') }}: {{ form.allowed_node_modules.length }}
        </div>
      </div>

      <!-- Python 包白名单 -->
      <div v-show="activeTab === 'python'" class="config-section">
        <div class="section-header">
          <h3 class="section-title">{{ $t('settings.packageWhitelist') }}</h3>
          <div class="section-actions">
            <button class="btn-select-all" @click="selectAllPython">
              {{ $t('settings.selectAll') }}
            </button>
            <button class="btn-default" @click="selectDefaultPython">
              {{ $t('settings.selectDefault') }}
            </button>
            <button class="btn-clear" @click="clearPython">
              {{ $t('settings.clearAll') }}
            </button>
          </div>
        </div>

        <div class="whitelist-editor">
          <div class="package-list">
            <div class="package-search">
              <input
                type="text"
                v-model="pythonSearch"
                :placeholder="$t('settings.searchPackages')"
                class="search-input"
              />
            </div>
            
            <div class="packages-grid">
              <label 
                v-for="pkg in filteredPythonPackages" 
                :key="pkg.name"
                class="package-item"
                :class="{ selected: form.allowed_python_packages.includes(pkg.name) }"
              >
                <input
                  type="checkbox"
                  :value="pkg.name"
                  v-model="form.allowed_python_packages"
                  class="package-checkbox"
                />
                <span class="package-name">{{ pkg.name }}</span>
                <span class="package-version" :class="{ 'built-in': pkg.version === 'built-in' }">
                  {{ pkg.version }}
                </span>
              </label>
            </div>
          </div>

          <div class="custom-input">
            <label class="custom-label">{{ $t('settings.customPackages') }}:</label>
            <input
              type="text"
              v-model="customPythonPackage"
              :placeholder="$t('settings.customPackagePlaceholder')"
              class="custom-input-field"
              @keyup.enter="addCustomPythonPackage"
            />
            <button class="btn-add" @click="addCustomPythonPackage">
              {{ $t('common.add') }}
            </button>
          </div>
        </div>

        <div class="selected-count">
          {{ $t('settings.selectedCount') }}: {{ form.allowed_python_packages.length }}
        </div>
      </div>

      <!-- 底部操作按钮 -->
      <div class="config-actions">
        <button class="btn-reset-all" @click="resetWhitelist">
          {{ $t('settings.resetToDefault') }}
        </button>
        <button
          class="btn-save"
          @click="saveWhitelist"
          :disabled="!hasChanges || saving"
        >
          {{ saving ? $t('common.saving') : $t('settings.saveChanges') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { usePackageWhitelistStore } from '@/stores/packageWhitelist'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const store = usePackageWhitelistStore()

// 当前激活的 tab
const activeTab = ref<'nodejs' | 'python'>('nodejs')

// 表单数据
const form = reactive({
  allowed_node_modules: [] as string[],
  allowed_python_packages: [] as string[],
})

// 搜索关键词
const nodeSearch = ref('')
const pythonSearch = ref('')

// 自定义模块/包输入
const customNodeModule = ref('')
const customPythonPackage = ref('')

const saving = ref(false)

// 过滤后的 Node.js 包列表（合并内置模块和已安装包）
const filteredNodePackages = computed(() => {
  const search = nodeSearch.value.toLowerCase()
  const installedNames = new Set(store.nodePackages.map(p => p.name))
  
  // 内置模块列表（带 built-in 标记）
  const builtInPackages = defaultNodeModules
    .filter(name => !installedNames.has(name)) // 排除已安装的
    .map(name => ({ name, version: 'built-in' }))
  
  // 合并已安装包和内置模块
  const allPackages = [...store.nodePackages, ...builtInPackages]
  
  return allPackages.filter(pkg => 
    pkg.name.toLowerCase().includes(search)
  ).sort((a, b) => a.name.localeCompare(b.name))
})

// 过滤后的 Python 包列表（合并内置包和已安装包）
const filteredPythonPackages = computed(() => {
  const search = pythonSearch.value.toLowerCase()
  const installedNames = new Set(store.pythonPackages.map(p => p.name))
  
  // 内置包列表（带 built-in 标记）
  const builtInPackages = defaultPythonPackages
    .filter(name => !installedNames.has(name)) // 排除已安装的
    .map(name => ({ name, version: 'built-in' }))
  
  // 合并已安装包和内置包
  const allPackages = [...store.pythonPackages, ...builtInPackages]
  
  return allPackages.filter(pkg => 
    pkg.name.toLowerCase().includes(search)
  ).sort((a, b) => a.name.localeCompare(b.name))
})

// 检测是否有变更
const hasChanges = computed(() => {
  return JSON.stringify(form.allowed_node_modules) !== JSON.stringify(store.allowedNodeModules) ||
         JSON.stringify(form.allowed_python_packages) !== JSON.stringify(store.allowedPythonPackages)
})

// 同步 store 数据到表单
const syncFromStore = () => {
  form.allowed_node_modules = [...store.allowedNodeModules]
  form.allowed_python_packages = [...store.allowedPythonPackages]
}

// 默认 Node.js 模块列表
const defaultNodeModules = [
  'fs', 'path', 'url', 'querystring', 'crypto',
  'util', 'stream', 'http', 'https', 'zlib',
  'string_decoder', 'buffer', 'events', 'os',
]

// 默认 Python 包列表
const defaultPythonPackages = [
  'os', 'sys', 'json', 're', 'pathlib', 'typing',
  'datetime', 'collections', 'itertools', 'functools',
  'io', 'math', 'copy', 'tempfile', 'shutil',
]

// 全选 Node.js 模块（合并内置模块和已安装包）
const selectAllNode = () => {
  const allNames = filteredNodePackages.value.map(pkg => pkg.name)
  form.allowed_node_modules = [...new Set(allNames)]
}

// 选择默认 Node.js 模块
const selectDefaultNode = () => {
  form.allowed_node_modules = [...new Set([...defaultNodeModules, ...form.allowed_node_modules])]
}

// 清空 Node.js 模块
const clearNode = () => {
  form.allowed_node_modules = []
}

// 全选 Python 包（合并内置包和已安装包）
const selectAllPython = () => {
  const allNames = filteredPythonPackages.value.map(pkg => pkg.name)
  form.allowed_python_packages = [...new Set(allNames)]
}

// 选择默认 Python 包
const selectDefaultPython = () => {
  form.allowed_python_packages = [...new Set([...defaultPythonPackages, ...form.allowed_python_packages])]
}

// 清空 Python 包
const clearPython = () => {
  form.allowed_python_packages = []
}

// 添加自定义 Node.js 模块
const addCustomNodeModule = () => {
  const name = customNodeModule.value.trim()
  if (name && !form.allowed_node_modules.includes(name)) {
    form.allowed_node_modules.push(name)
    customNodeModule.value = ''
  }
}

// 添加自定义 Python 包
const addCustomPythonPackage = () => {
  const name = customPythonPackage.value.trim()
  if (name && !form.allowed_python_packages.includes(name)) {
    form.allowed_python_packages.push(name)
    customPythonPackage.value = ''
  }
}

// 保存配置
const saveWhitelist = async () => {
  saving.value = true
  try {
    const success = await store.updateWhitelist({
      allowed_node_modules: [...form.allowed_node_modules],
      allowed_python_packages: [...form.allowed_python_packages],
    })
    if (success) {
      alert(t('settings.saveSuccess'))
    } else {
      alert(t('settings.saveFailed'))
    }
  } catch (error) {
    alert(t('settings.saveFailed') + ': ' + error)
  } finally {
    saving.value = false
  }
}

// 重置为默认值
const resetWhitelist = async () => {
  if (confirm(t('settings.confirmResetWhitelist'))) {
    const success = await store.resetWhitelist()
    if (success) {
      syncFromStore()
    }
  }
}

// 监听 store 数据变化
watch(
  () => store.whitelist,
  () => {
    syncFromStore()
  },
  { deep: true }
)

// 初始化
onMounted(async () => {
  await Promise.all([
    store.loadPackages(),
    store.loadWhitelist(),
  ])
  syncFromStore()
})
</script>

<style scoped>
.package-whitelist-tab {
  padding: 20px;
  max-width: 800px;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}

.loading-state {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #666);
}

/* Tab 切换样式 */
.tab-header {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-color, #ddd);
  padding-bottom: 0;
}

.tab-button {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.tab-button:hover {
  color: var(--text-primary, #333);
  background: var(--bg-secondary, #f5f5f5);
}

.tab-button.active {
  color: var(--primary-color, #2196f3);
  border-bottom-color: var(--primary-color, #2196f3);
}

.config-section {
  background: var(--card-bg, #fff);
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-light, #eee);
}

.section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.section-actions {
  display: flex;
  gap: 8px;
}

.btn-select-all,
.btn-default,
.btn-clear {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-select-all:hover,
.btn-default:hover,
.btn-clear:hover {
  background: var(--bg-tertiary, #eee);
}

.btn-default {
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.whitelist-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.package-list {
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
  overflow: hidden;
}

.package-search {
  padding: 8px;
  background: var(--bg-secondary, #f9f9f9);
  border-bottom: 1px solid var(--border-color, #ddd);
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  font-size: 14px;
  background: var(--input-bg, #fff);
}

.search-input:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.packages-grid {
  max-height: 200px;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.package-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.package-item:hover {
  background: var(--bg-secondary, #f5f5f5);
}

.package-item.selected {
  background: var(--primary-light, #e3f2fd);
}

.package-checkbox {
  width: 16px;
  height: 16px;
}

.package-name {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary, #333);
}

.package-version {
  font-size: 11px;
  color: var(--text-tertiary, #999);
}

.package-version.built-in {
  color: var(--success-color, #4caf50);
  font-weight: 500;
}

.custom-input {
  display: flex;
  align-items: center;
  gap: 8px;
}

.custom-label {
  font-size: 13px;
  color: var(--text-secondary, #666);
  white-space: nowrap;
}

.custom-input-field {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  font-size: 14px;
}

.custom-input-field:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.btn-add {
  padding: 8px 16px;
  font-size: 13px;
  border: 1px solid var(--primary-color, #2196f3);
  border-radius: 6px;
  background: var(--primary-color, #2196f3);
  color: white;
  cursor: pointer;
}

.btn-add:hover {
  background: var(--primary-hover, #1976d2);
}

.selected-count {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  text-align: right;
}

.config-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border-light, #eee);
}

.btn-reset-all {
  padding: 8px 16px;
  font-size: 14px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-reset-all:hover {
  background: var(--bg-tertiary, #eee);
}

.btn-save {
  padding: 8px 24px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  background: var(--primary-color, #2196f3);
  color: white;
  cursor: pointer;
}

.btn-save:hover:not(:disabled) {
  background: var(--primary-hover, #1976d2);
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>