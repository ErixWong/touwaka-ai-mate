<template>
  <div class="system-config-tab">
    <div v-if="systemSettingsStore.isLoading" class="loading-state">{{ $t('common.loading') }}</div>

    <template v-else>
      <div v-if="hasChanges" class="unsaved-banner">
        <span>{{ $t('settings.unsavedChangesNotice') }}</span>
      </div>

      <div class="sub-tabs">
        <el-button :type="activeSubTab === 'general' ? 'primary' : ''" @click="activeSubTab = 'general'">🤖 {{ $t('settings.generalConfig') }}</el-button>
        <el-button :type="activeSubTab === 'registration' ? 'primary' : ''" @click="activeSubTab = 'registration'">🎫 {{ $t('settings.registrationConfig') }}</el-button>
        <el-button :type="activeSubTab === 'connection' ? 'primary' : ''" @click="activeSubTab = 'connection'">🔗 {{ $t('settings.connectionLimits') }}</el-button>
        <el-button :type="activeSubTab === 'token' ? 'primary' : ''" @click="activeSubTab = 'token'">🔑 {{ $t('settings.tokenConfig') }}</el-button>
        <el-button :type="activeSubTab === 'timeout' ? 'primary' : ''" @click="activeSubTab = 'timeout'">⏱️ {{ $t('settings.timeoutConfig') }}</el-button>
        <el-button :type="activeSubTab === 'tool' ? 'primary' : ''" @click="activeSubTab = 'tool'">🛠️ {{ $t('settings.toolConfig') }}</el-button>
        <el-button :type="activeSubTab === 'app' ? 'primary' : ''" @click="activeSubTab = 'app'">📱 {{ $t('settings.appConfig') }}</el-button>
        <el-button :type="activeSubTab === 'packages' ? 'primary' : ''" @click="activeSubTab = 'packages'">📦 {{ $t('settings.packageWhitelist') }}</el-button>
        <el-button :type="activeSubTab === 'branding' ? 'primary' : ''" @click="activeSubTab = 'branding'">🎨 {{ $t('settings.brandingConfig') }}</el-button>
      </div>

      <div v-if="activeSubTab === 'general'" class="tab-content">
        <div class="config-section">
          <div class="section-header">
            <h3 class="section-title">🤖 {{ $t('settings.llmDefaults') }}</h3>
            <el-button @click="resetSection('llm')">{{ $t('common.reset') }}</el-button>
          </div>
          <div class="config-grid">
            <div class="config-item">
              <label class="config-label">{{ $t('settings.contextThreshold') }}</label>
              <el-input-number v-model="form.llm.context_threshold" :min="0" :max="1" :step="0.05" :precision="2" />
              <span class="config-hint">0-1</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.temperature') }}</label>
              <el-input-number v-model="form.llm.temperature" :min="0" :max="2" :step="0.1" :precision="1" />
              <span class="config-hint">0-2</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.reflectiveTemperature') }}</label>
              <el-input-number v-model="form.llm.reflective_temperature" :min="0" :max="2" :step="0.1" :precision="1" />
              <span class="config-hint">0-2</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.topP') }}</label>
              <el-input-number v-model="form.llm.top_p" :min="0" :max="1" :step="0.1" :precision="1" />
              <span class="config-hint">0-1</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.frequencyPenalty') }}</label>
              <el-input-number v-model="form.llm.frequency_penalty" :min="-2" :max="2" :step="0.1" :precision="1" />
              <span class="config-hint">-2-2</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.presencePenalty') }}</label>
              <el-input-number v-model="form.llm.presence_penalty" :min="-2" :max="2" :step="0.1" :precision="1" />
              <span class="config-hint">-2-2</span>
            </div>
          </div>
          <div class="config-actions">
            <el-button @click="resetAll">{{ $t('settings.resetAll') }}</el-button>
            <el-button type="primary" @click="saveConfig" :disabled="!hasChanges || saving">
              {{ saving ? $t('common.saving') : $t('settings.saveChanges') }}
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="activeSubTab === 'registration'" class="tab-content">
        <div class="config-section">
          <div class="section-header">
            <h3 class="section-title">🎫 {{ $t('settings.registrationConfig') }}</h3>
            <el-button @click="resetSection('registration')">{{ $t('common.reset') }}</el-button>
          </div>
          <div class="config-grid">
            <div class="config-item full-width">
              <label class="config-label checkbox-label">
                <el-checkbox v-model="form.registration.allow_self_registration" />
                {{ $t('settings.allowSelfRegistration') }}
              </label>
              <p class="config-description">{{ $t('settings.allowSelfRegistrationHint') }}</p>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.defaultInvitationQuota') }}</label>
              <el-input-number v-model="form.registration.default_invitation_quota" :min="0" :max="100" />
              <span class="config-hint">0-100</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.defaultInvitationMaxUses') }}</label>
              <el-input-number v-model="form.registration.default_invitation_max_uses" :min="1" :max="100" />
              <span class="config-hint">1-100</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.invitationExpiryDays') }}</label>
              <el-input-number v-model="form.registration.invitation_expiry_days" :min="0" :max="365" />
              <span class="config-hint">0-365</span>
            </div>
          </div>
          <div class="config-actions">
            <el-button @click="resetAll">{{ $t('settings.resetAll') }}</el-button>
            <el-button type="primary" @click="saveConfig" :disabled="!hasChanges || saving">
              {{ saving ? $t('common.saving') : $t('settings.saveChanges') }}
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="activeSubTab === 'connection'" class="tab-content">
        <div class="config-section">
          <div class="section-header">
            <h3 class="section-title">🔗 {{ $t('settings.connectionLimits') }}</h3>
            <el-button @click="resetSection('connection')">{{ $t('common.reset') }}</el-button>
          </div>
          <div class="config-grid">
            <div class="config-item">
              <label class="config-label">{{ $t('settings.maxConnectionsPerUser') }}</label>
              <el-input-number v-model="form.connection.max_per_user" :min="1" />
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.maxConnectionsPerExpert') }}</label>
              <el-input-number v-model="form.connection.max_per_expert" :min="1" />
            </div>
          </div>
          <div class="config-actions">
            <el-button @click="resetAll">{{ $t('settings.resetAll') }}</el-button>
            <el-button type="primary" @click="saveConfig" :disabled="!hasChanges || saving">
              {{ saving ? $t('common.saving') : $t('settings.saveChanges') }}
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="activeSubTab === 'token'" class="tab-content">
        <div class="config-section">
          <div class="section-header">
            <h3 class="section-title">🔑 {{ $t('settings.tokenConfig') }}</h3>
            <el-button @click="resetSection('token')">{{ $t('common.reset') }}</el-button>
          </div>
          <div class="config-grid">
            <div class="config-item">
              <label class="config-label">{{ $t('settings.accessTokenExpiry') }}</label>
              <el-input v-model="form.token.access_expiry" placeholder="15m" />
              <span class="config-hint">e.g. 15m, 1h, 7d</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.refreshTokenExpiry') }}</label>
              <el-input v-model="form.token.refresh_expiry" placeholder="7d" />
              <span class="config-hint">e.g. 7d, 30d</span>
            </div>
          </div>
          <div class="config-actions">
            <el-button @click="resetAll">{{ $t('settings.resetAll') }}</el-button>
            <el-button type="primary" @click="saveConfig" :disabled="!hasChanges || saving">
              {{ saving ? $t('common.saving') : $t('settings.saveChanges') }}
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="activeSubTab === 'timeout'" class="tab-content">
        <div class="config-section">
          <div class="section-header">
            <h3 class="section-title">⏱️ {{ $t('settings.timeoutConfig') }}</h3>
            <el-button @click="resetSection('timeout')">{{ $t('common.reset') }}</el-button>
          </div>

          <!-- 两档用户可见超时配置（唯一主入口） -->
          <div class="config-grid">
            <div class="config-item full-width subsection-header">
              <h4 class="subsection-title">🚀 {{ $t('settings.userFacingTimeoutGroup') }}</h4>
              <p class="subsection-description">{{ $t('settings.userFacingTimeoutGroupDesc') }}</p>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.fastTimeout') }}</label>
              <el-input-number v-model="form.timeout.fast_timeout" :min="10" :max="600" />
              <span class="config-hint">10-600 {{ $t('settings.seconds') }}</span>
              <p class="config-description">{{ $t('settings.fastTimeoutHint') }}</p>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.taskTimeout') }}</label>
              <el-input-number v-model="form.timeout.task_timeout" :min="60" :max="1800" />
              <span class="config-hint">60-1800 {{ $t('settings.seconds') }}</span>
              <p class="config-description">{{ $t('settings.taskTimeoutHint') }}</p>
            </div>
          </div>
          <div class="config-actions">
            <el-button @click="resetAll">{{ $t('settings.resetAll') }}</el-button>
            <el-button type="primary" @click="saveConfig" :disabled="!hasChanges || saving">
              {{ saving ? $t('common.saving') : $t('settings.saveChanges') }}
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="activeSubTab === 'tool'" class="tab-content">
        <div class="config-section">
          <div class="section-header">
            <h3 class="section-title">🛠️ {{ $t('settings.toolConfig') }}</h3>
            <el-button @click="resetSection('tool')">{{ $t('common.reset') }}</el-button>
          </div>
          <div class="config-grid">
            <div class="config-item">
              <label class="config-label">{{ $t('settings.maxToolRounds') }}</label>
              <el-input-number v-model="form.tool.max_rounds" :min="1" :max="50" />
              <span class="config-hint">1-50</span>
              <p class="config-description">{{ $t('settings.maxToolRoundsHint') }}</p>
            </div>
          </div>
          <div class="config-actions">
            <el-button @click="resetAll">{{ $t('settings.resetAll') }}</el-button>
            <el-button type="primary" @click="saveConfig" :disabled="!hasChanges || saving">
              {{ saving ? $t('common.saving') : $t('settings.saveChanges') }}
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="activeSubTab === 'app'" class="tab-content">
        <div class="config-section">
          <div class="section-header">
            <h3 class="section-title">📱 {{ $t('settings.appConfig') }}</h3>
            <el-button @click="resetSection('app')">{{ $t('common.reset') }}</el-button>
          </div>
          <div class="config-grid">
            <div class="config-item">
              <label class="config-label">{{ $t('settings.clockInterval') }}</label>
              <el-input-number v-model="form.app.clock_interval" :min="5" :max="300" />
              <span class="config-hint">5-300 {{ $t('settings.seconds') }}</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.tickWarnAfterMs') }}</label>
              <el-input-number v-model="form.app.tick_warn_after_ms" :min="60000" :max="3600000" :step="60000" />
              <span class="config-hint">60000-3600000 ms</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.batchSize') }}</label>
              <el-input-number v-model="form.app.batch_size" :min="1" :max="100" />
              <span class="config-hint">1-100</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.maxConcurrency') }}</label>
              <el-input-number v-model="form.app.max_concurrency" :min="1" :max="50" />
              <span class="config-hint">1-50</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.textFilterMaxLength') }}</label>
              <el-input-number v-model="form.app.text_filter_max_length" :min="1000" :max="500000" :step="1000" />
              <span class="config-hint">1000-500000 {{ $t('settings.characters') }}</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.maxUploadSize') }}</label>
              <el-input-number v-model="form.app.max_upload_size" :min="1" :max="500" />
              <span class="config-hint">1-500</span>
            </div>
            <div class="config-item full-width">
              <label class="config-label">{{ $t('settings.attachmentBasePath') }}</label>
              <el-input v-model="form.app.attachment_base_path" placeholder="./data/attachments" />
            </div>
          </div>
          <div class="config-actions">
            <el-button @click="resetAll">{{ $t('settings.resetAll') }}</el-button>
            <el-button type="primary" @click="saveConfig" :disabled="!hasChanges || saving">
              {{ saving ? $t('common.saving') : $t('settings.saveChanges') }}
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="activeSubTab === 'packages'" class="tab-content">
        <PackageWhitelistTab />
      </div>

      <div v-if="activeSubTab === 'branding'" class="tab-content">
        <div class="config-section">
          <div class="section-header">
            <h3 class="section-title">🎨 {{ $t('settings.brandingConfig') }}</h3>
            <el-button @click="resetSection('branding')">{{ $t('common.reset') }}</el-button>
          </div>
          <div class="config-grid">
            <div class="config-item">
              <label class="config-label">{{ $t('settings.brandingAppName') }}</label>
              <el-input v-model="form.branding.app_name" placeholder="Touwaka Mate" />
              <span class="config-hint">{{ $t('settings.brandingAppNameHint') }}</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.brandingLogoIcon') }}</label>
              <el-input v-model="form.branding.logo_icon" placeholder="🤖" />
              <span class="config-hint">{{ $t('settings.brandingLogoIconHint') }}</span>
            </div>
            <div class="config-item full-width">
              <div class="branding-preview">
                <span class="branding-preview-label">{{ $t('settings.brandingPreview') }}</span>
                <div class="branding-preview-content">
                  <span class="preview-icon">{{ form.branding.logo_icon }}</span>
                  <span class="preview-name">{{ form.branding.app_name }}</span>
                </div>
                <span class="config-hint">{{ $t('settings.brandingPreviewHint') }}</span>
              </div>
            </div>
          </div>
          <div class="config-actions">
            <el-button @click="resetAll">{{ $t('settings.resetAll') }}</el-button>
            <el-button type="primary" @click="saveConfig" :disabled="!hasChanges || saving">
              {{ saving ? $t('common.saving') : $t('settings.saveChanges') }}
            </el-button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useSystemSettingsStore } from '@/stores/systemSettings'
import { useToastStore } from '@/stores/toast'
import { useI18n } from 'vue-i18n'
import PackageWhitelistTab from './PackageWhitelistTab.vue'

const { t } = useI18n()
const systemSettingsStore = useSystemSettingsStore()
const toast = useToastStore()

const activeSubTab = ref<'general' | 'registration' | 'connection' | 'token' | 'timeout' | 'tool' | 'app' | 'packages' | 'branding'>('general')
const saving = ref(false)

// 表单基线：记录最近一次成功加载/保存后的状态，用于判断是否有改动
const baselineSettings = ref<any>(null)

// 空结构占位（仅用于表单初始化，不定义业务默认值）
// 默认值权威来源在后端 /system-settings 接口
const createEmptyForm = () => ({
  llm: { context_threshold: 0, temperature: 0, reflective_temperature: 0, top_p: 0, frequency_penalty: 0, presence_penalty: 0 },
  registration: { allow_self_registration: false, default_invitation_quota: 0, default_invitation_max_uses: 0, invitation_expiry_days: 0 },
  connection: { max_per_user: 0, max_per_expert: 0 },
  token: { access_expiry: '', refresh_expiry: '' },
  // timeout 已收口为两档：fast_timeout（快速操作）、task_timeout（长时间任务）
  timeout: { fast_timeout: 0, task_timeout: 0 },
  tool: { max_rounds: 0 },
  app: { clock_interval: 0, tick_warn_after_ms: 0, batch_size: 0, max_concurrency: 0, text_filter_max_length: 0, attachment_base_path: '', max_upload_size: 0 },
  branding: { app_name: '', logo_icon: '' },
})

const form = reactive(createEmptyForm())

const hasChanges = computed(() => {
  if (!baselineSettings.value) return false
  return JSON.stringify(form) !== JSON.stringify(baselineSettings.value)
})

const resetSection = async (section: string) => {
  // 重置需要后端权威默认值，调用 reset 接口
  try {
    await systemSettingsStore.resetSettings([section])
    await systemSettingsStore.loadSettings()
    const settings = systemSettingsStore.settings
    if (settings) {
      Object.assign(form[section as keyof typeof form], settings[section as keyof typeof settings] || {})
      baselineSettings.value = JSON.parse(JSON.stringify(form))
    }
    toast.success(t('settings.resetSuccess'))
  } catch (error) {
    console.error('Failed to reset section:', error)
    toast.error(t('settings.resetFailed'))
  }
}

const resetAll = async () => {
  try {
    await systemSettingsStore.resetSettings()
    await systemSettingsStore.loadSettings()
    const settings = systemSettingsStore.settings
    if (settings) {
      for (const key of Object.keys(form) as Array<keyof typeof form>) {
        Object.assign(form[key], settings[key] || {})
      }
      baselineSettings.value = JSON.parse(JSON.stringify(form))
    }
    toast.success(t('settings.resetSuccess'))
  } catch (error) {
    console.error('Failed to reset all:', error)
    toast.error(t('settings.resetFailed'))
  }
}

const saveConfig = async () => {
  // 检查是否已成功从后端加载，禁止保存占位结构
  if (!systemSettingsStore.loadedFromBackend) {
    toast.error(t('settings.cannotSaveNotLoaded'))
    return
  }
  saving.value = true
  try {
    await systemSettingsStore.updateSettings(form)
    // 保存成功后更新基线，用于后续变更判断
    baselineSettings.value = JSON.parse(JSON.stringify(form))
    toast.success(t('settings.saveSuccess'))
  } catch (error) {
    console.error('Failed to save settings:', error)
    toast.error(t('settings.saveFailed'))
  } finally {
    saving.value = false
  }
}

const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!hasChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  await systemSettingsStore.loadSettings()
  // 检查是否成功从后端加载，只有成功加载才填充表单和基线
  if (!systemSettingsStore.loadedFromBackend) {
    console.error('[SystemConfigTab] Failed to load settings from backend, cannot initialize form')
    return
  }
  const settings = systemSettingsStore.settings
  if (settings) {
    // 直接使用接口返回值填充表单，不再使用硬编码默认值
    Object.assign(form.llm, settings.llm || {})
    Object.assign(form.registration, settings.registration || {})
    Object.assign(form.connection, settings.connection || {})
    Object.assign(form.token, settings.token || {})
    Object.assign(form.timeout, settings.timeout || {})
    Object.assign(form.tool, settings.tool || {})
    Object.assign(form.app, settings.app || {})
    Object.assign(form.branding, settings.branding || {})
    baselineSettings.value = JSON.parse(JSON.stringify(form))
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  systemSettingsStore.unsavedConfigChanges = false
})

watch(hasChanges, (val) => {
  systemSettingsStore.unsavedConfigChanges = val
})

watch(() => systemSettingsStore.settings, (settings) => {
  // 只有成功从后端加载才更新表单和基线
  if (!systemSettingsStore.loadedFromBackend) return
  if (settings) {
    // 直接使用接口返回值更新表单，不再使用硬编码默认值
    Object.assign(form.llm, settings.llm || {})
    Object.assign(form.registration, settings.registration || {})
    Object.assign(form.connection, settings.connection || {})
    Object.assign(form.token, settings.token || {})
    Object.assign(form.timeout, settings.timeout || {})
    Object.assign(form.tool, settings.tool || {})
    Object.assign(form.app, settings.app || {})
    Object.assign(form.branding, settings.branding || {})
    baselineSettings.value = JSON.parse(JSON.stringify(form))
  }
}, { deep: true })
</script>

<style scoped>
.system-config-tab { padding: 20px; }
.loading-state { text-align: center; padding: 40px; color: var(--text-secondary); }
.unsaved-banner { display: flex; align-items: center; margin-bottom: 12px; padding: 10px 12px; background: var(--warning-bg, #fff7e6); border: 1px solid var(--warning-border, #ffd591); border-radius: 8px; color: var(--warning-text, #ad6800); }
.sub-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; }
.tab-content { min-height: 300px; }
.config-section { background: var(--card-bg, #fff); border: 1px solid var(--border-color, #e0e0e0); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.section-title { margin: 0; font-size: 16px; font-weight: 600; }
.section-description { margin-top: 12px; }
.config-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
.config-item { display: flex; flex-direction: column; gap: 4px; }
.config-item.full-width { grid-column: 1 / -1; }
.config-label { font-size: 13px; font-weight: 500; color: var(--text-secondary, #666); }
.config-label.checkbox-label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.config-hint { font-size: 11px; color: var(--text-tertiary, #999); }
.config-description { font-size: 11px; color: var(--text-tertiary, #999); margin: 4px 0 0 0; }
.subsection-header { padding-top: 12px; border-top: 1px solid var(--border-light, #eee); }
.subsection-title { margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: var(--text-primary, #333); }
.subsection-description { margin: 0; font-size: 12px; color: var(--text-tertiary, #999); }
.config-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-light, #eee); }
.branding-preview { display: flex; flex-direction: column; gap: 8px; }
.branding-preview-label { font-size: 12px; color: var(--text-tertiary, #999); }
.branding-preview-content { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: var(--hover-bg, #f5f5f5); border-radius: 8px; }
.preview-icon { font-size: 24px; }
.preview-name { font-size: 18px; font-weight: 600; color: var(--text-primary, #333); }
</style>
