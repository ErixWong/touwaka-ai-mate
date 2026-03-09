<template>
  <div class="system-config-tab">
    <div v-if="systemSettingsStore.isLoading" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <template v-else>
      <!-- LLM 默认参数 -->
      <div class="config-section">
        <div class="section-header">
          <h3 class="section-title">📊 {{ $t('settings.llmDefaults') }}</h3>
          <button class="btn-reset-section" @click="resetSection('llm')">
            {{ $t('common.reset') }}
          </button>
        </div>

        <div class="config-grid">
          <div class="config-item">
            <label class="config-label">{{ $t('settings.contextThreshold') }}</label>
            <div class="config-input-group">
              <input
                type="number"
                v-model.number="form.llm.context_threshold"
                min="0"
                max="1"
                step="0.05"
                class="config-input"
              />
              <span class="config-hint">0-1</span>
            </div>
          </div>

          <div class="config-item">
            <label class="config-label">{{ $t('settings.temperature') }}</label>
            <div class="config-input-group">
              <input
                type="number"
                v-model.number="form.llm.temperature"
                min="0"
                max="2"
                step="0.1"
                class="config-input"
              />
              <span class="config-hint">0-2</span>
            </div>
          </div>

          <div class="config-item">
            <label class="config-label">{{ $t('settings.reflectiveTemperature') }}</label>
            <div class="config-input-group">
              <input
                type="number"
                v-model.number="form.llm.reflective_temperature"
                min="0"
                max="2"
                step="0.1"
                class="config-input"
              />
              <span class="config-hint">0-2</span>
            </div>
          </div>

          <div class="config-item">
            <label class="config-label">{{ $t('settings.topP') }}</label>
            <div class="config-input-group">
              <input
                type="number"
                v-model.number="form.llm.top_p"
                min="0"
                max="1"
                step="0.1"
                class="config-input"
              />
              <span class="config-hint">0-1</span>
            </div>
          </div>

          <div class="config-item">
            <label class="config-label">{{ $t('settings.frequencyPenalty') }}</label>
            <div class="config-input-group">
              <input
                type="number"
                v-model.number="form.llm.frequency_penalty"
                min="0"
                max="2"
                step="0.1"
                class="config-input"
              />
              <span class="config-hint">0-2</span>
            </div>
          </div>

          <div class="config-item">
            <label class="config-label">{{ $t('settings.presencePenalty') }}</label>
            <div class="config-input-group">
              <input
                type="number"
                v-model.number="form.llm.presence_penalty"
                min="0"
                max="2"
                step="0.1"
                class="config-input"
              />
              <span class="config-hint">0-2</span>
            </div>
          </div>

          <div class="config-item">
            <label class="config-label">{{ $t('settings.maxTokens') }}</label>
            <input
              type="number"
              v-model.number="form.llm.max_tokens"
              min="1"
              class="config-input"
            />
          </div>
        </div>
      </div>

      <!-- 连接限制 -->
      <div class="config-section">
        <div class="section-header">
          <h3 class="section-title">🔗 {{ $t('settings.connectionLimits') }}</h3>
          <button class="btn-reset-section" @click="resetSection('connection')">
            {{ $t('common.reset') }}
          </button>
        </div>

        <div class="config-grid">
          <div class="config-item">
            <label class="config-label">{{ $t('settings.maxConnectionsPerUser') }}</label>
            <input
              type="number"
              v-model.number="form.connection.max_per_user"
              min="1"
              class="config-input"
            />
          </div>

          <div class="config-item">
            <label class="config-label">{{ $t('settings.maxConnectionsPerExpert') }}</label>
            <input
              type="number"
              v-model.number="form.connection.max_per_expert"
              min="1"
              class="config-input"
            />
          </div>
        </div>
      </div>

      <!-- Token 配置 -->
      <div class="config-section">
        <div class="section-header">
          <h3 class="section-title">🔐 {{ $t('settings.tokenConfig') }}</h3>
          <button class="btn-reset-section" @click="resetSection('token')">
            {{ $t('common.reset') }}
          </button>
        </div>

        <div class="config-grid">
          <div class="config-item">
            <label class="config-label">{{ $t('settings.accessTokenExpiry') }}</label>
            <input
              type="text"
              v-model="form.token.access_expiry"
              class="config-input"
              placeholder="15m, 1h, 1d"
            />
          </div>

          <div class="config-item">
            <label class="config-label">{{ $t('settings.refreshTokenExpiry') }}</label>
            <input
              type="text"
              v-model="form.token.refresh_expiry"
              class="config-input"
              placeholder="1d, 7d, 30d"
            />
          </div>
        </div>
      </div>

      <!-- 分页配置 -->
      <div class="config-section">
        <div class="section-header">
          <h3 class="section-title">📄 {{ $t('settings.paginationConfig') }}</h3>
          <button class="btn-reset-section" @click="resetSection('pagination')">
            {{ $t('common.reset') }}
          </button>
        </div>

        <div class="config-grid">
          <div class="config-item">
            <label class="config-label">{{ $t('settings.defaultPageSize') }}</label>
            <input
              type="number"
              v-model.number="form.pagination.default_size"
              min="1"
              class="config-input"
            />
          </div>

          <div class="config-item">
            <label class="config-label">{{ $t('settings.maxPageSize') }}</label>
            <input
              type="number"
              v-model.number="form.pagination.max_size"
              min="1"
              class="config-input"
            />
          </div>
        </div>
      </div>

      <!-- 底部操作按钮 -->
      <div class="config-actions">
        <button class="btn-reset-all" @click="resetAll">
          {{ $t('settings.resetAll') }}
        </button>
        <button
          class="btn-save"
          @click="saveConfig"
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
import { useSystemSettingsStore } from '@/stores/systemSettings'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const systemSettingsStore = useSystemSettingsStore()

// 表单数据
const form = reactive({
  llm: {
    context_threshold: 0.70,
    temperature: 0.70,
    reflective_temperature: 0.30,
    top_p: 1.0,
    frequency_penalty: 0.0,
    presence_penalty: 0.0,
    max_tokens: 4096,
  },
  connection: {
    max_per_user: 5,
    max_per_expert: 100,
  },
  token: {
    access_expiry: '15m',
    refresh_expiry: '7d',
  },
  pagination: {
    default_size: 20,
    max_size: 100,
  },
})

const saving = ref(false)

// 检测是否有变更
const hasChanges = computed(() => {
  return JSON.stringify(form) !== JSON.stringify(systemSettingsStore.settings || systemSettingsStore.defaultSettings)
})

// 同步 store 数据到表单
const syncFromStore = () => {
  const settings = systemSettingsStore.settings || systemSettingsStore.defaultSettings
  Object.assign(form.llm, settings.llm)
  Object.assign(form.connection, settings.connection)
  Object.assign(form.token, settings.token)
  Object.assign(form.pagination, settings.pagination)
}

// 保存配置
const saveConfig = async () => {
  saving.value = true
  try {
    await systemSettingsStore.updateSettings({
      llm: { ...form.llm },
      connection: { ...form.connection },
      token: { ...form.token },
      pagination: { ...form.pagination },
    })
    alert(t('settings.saveSuccess'))
  } catch (error) {
    alert(t('settings.saveFailed') + ': ' + error)
  } finally {
    saving.value = false
  }
}

// 重置指定分区
const resetSection = async (section: string) => {
  const defaults = systemSettingsStore.defaultSettings
  if (section === 'llm') {
    Object.assign(form.llm, defaults.llm)
  } else if (section === 'connection') {
    Object.assign(form.connection, defaults.connection)
  } else if (section === 'token') {
    Object.assign(form.token, defaults.token)
  } else if (section === 'pagination') {
    Object.assign(form.pagination, defaults.pagination)
  }
}

// 重置全部
const resetAll = async () => {
  if (confirm(t('settings.confirmResetAll'))) {
    await systemSettingsStore.resetSettings()
    syncFromStore()
  }
}

// 监听 store 数据变化
watch(
  () => systemSettingsStore.settings,
  () => {
    if (systemSettingsStore.settings) {
      syncFromStore()
    }
  },
  { deep: true }
)

// 初始化
onMounted(async () => {
  await systemSettingsStore.loadSettings()
  syncFromStore()
})
</script>

<style scoped>
.system-config-tab {
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

.btn-reset-section {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-reset-section:hover {
  background: var(--bg-tertiary, #eee);
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.config-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.config-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #666);
}

.config-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  font-size: 14px;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #333);
}

.config-input:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.config-input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-input-group .config-input {
  flex: 1;
}

.config-hint {
  font-size: 11px;
  color: var(--text-tertiary, #999);
  min-width: 30px;
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
