<template>
  <div class="system-config-tab">
    <div v-if="systemSettingsStore.isLoading" class="loading-state">{{ $t('common.loading') }}</div>

    <template v-else>
      <div class="sub-tabs">
        <el-button :type="activeSubTab === 'general' ? 'primary' : ''" @click="activeSubTab = 'general'">🤖 {{ $t('settings.generalConfig') }}</el-button>
        <el-button :type="activeSubTab === 'registration' ? 'primary' : ''" @click="activeSubTab = 'registration'">🎫 {{ $t('settings.registrationConfig') }}</el-button>
        <el-button :type="activeSubTab === 'connection' ? 'primary' : ''" @click="activeSubTab = 'connection'">🔗 {{ $t('settings.connectionLimits') }}</el-button>
        <el-button :type="activeSubTab === 'token' ? 'primary' : ''" @click="activeSubTab = 'token'">🔑 {{ $t('settings.tokenConfig') }}</el-button>
        <el-button :type="activeSubTab === 'timeout' ? 'primary' : ''" @click="activeSubTab = 'timeout'">⏱️ {{ $t('settings.timeoutConfig') }}</el-button>
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
              <el-input-number v-model="form.llm.frequency_penalty" :min="0" :max="2" :step="0.1" :precision="1" />
              <span class="config-hint">0-2</span>
            </div>
            <div class="config-item">
              <label class="config-label">{{ $t('settings.presencePenalty') }}</label>
              <el-input-number v-model="form.llm.presence_penalty" :min="0" :max="2" :step="0.1" :precision="1" />
              <span class="config-hint">0-2</span>
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
        </div>
      </div>

      <div v-if="activeSubTab === 'timeout'" class="tab-content">
        <div class="config-section">
          <div class="section-header">
            <h3 class="section-title">⏱️ {{ $t('settings.timeoutConfig') }}</h3>
            <el-button @click="resetSection('timeout')">{{ $t('common.reset') }}</el-button>
          </div>
          <div class="config-grid">
            <div class="config-item">
              <label class="config-label">{{ $t('settings.maxToolRounds') }}</label>
              <el-input-number v-model="form.tool.max_rounds" :min="1" :max="50" />
              <span class="config-hint">1-50</span>
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
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useSystemSettingsStore } from '@/stores/systemSettings'
import { useToastStore } from '@/stores/toast'
import { useI18n } from 'vue-i18n'
import PackageWhitelistTab from './PackageWhitelistTab.vue'

const { t } = useI18n()
const systemSettingsStore = useSystemSettingsStore()
const toast = useToastStore()

const activeSubTab = ref<'general' | 'registration' | 'connection' | 'token' | 'timeout' | 'app' | 'packages' | 'branding'>('general')
const saving = ref(false)

const form = reactive({
  llm: { context_threshold: 0.7, temperature: 0.7, reflective_temperature: 0.3, top_p: 1, frequency_penalty: 0, presence_penalty: 0 },
  registration: { allow_self_registration: true, default_invitation_quota: 10, default_invitation_max_uses: 5, invitation_expiry_days: 30 },
  connection: { max_per_user: 5, max_per_expert: 100 },
  token: { access_expiry: '15m', refresh_expiry: '7d' },
  tool: { max_rounds: 20 },
  app: { clock_interval: 30, batch_size: 10, max_concurrency: 5, text_filter_max_length: 50000, attachment_base_path: './data/attachments', max_upload_size: 50 },
  branding: { app_name: 'Touwaka Mate', logo_icon: '🤖' },
})

const defaults = {
  llm: { context_threshold: 0.7, temperature: 0.7, reflective_temperature: 0.3, top_p: 1, frequency_penalty: 0, presence_penalty: 0 },
  registration: { allow_self_registration: true, default_invitation_quota: 10, default_invitation_max_uses: 5, invitation_expiry_days: 30 },
  connection: { max_per_user: 5, max_per_expert: 100 },
  token: { access_expiry: '15m', refresh_expiry: '7d' },
  tool: { max_rounds: 20 },
  app: { clock_interval: 30, batch_size: 10, max_concurrency: 5, text_filter_max_length: 50000, attachment_base_path: './data/attachments', max_upload_size: 50 },
  branding: { app_name: 'Touwaka Mate', logo_icon: '🤖' },
}

const hasChanges = computed(() => {
  const settings = systemSettingsStore.settings
  if (!settings) return false
  return JSON.stringify(form) !== JSON.stringify({
    llm: { context_threshold: settings.llm?.context_threshold ?? 0.7, temperature: settings.llm?.temperature ?? 0.7, reflective_temperature: settings.llm?.reflective_temperature ?? 0.3, top_p: settings.llm?.top_p ?? 1, frequency_penalty: settings.llm?.frequency_penalty ?? 0, presence_penalty: settings.llm?.presence_penalty ?? 0 },
    registration: { allow_self_registration: settings.registration?.allow_self_registration ?? true, default_invitation_quota: settings.registration?.default_invitation_quota ?? 10, default_invitation_max_uses: settings.registration?.default_invitation_max_uses ?? 5, invitation_expiry_days: settings.registration?.invitation_expiry_days ?? 30 },
    connection: { max_per_user: settings.connection?.max_per_user ?? 5, max_per_expert: settings.connection?.max_per_expert ?? 100 },
    token: { access_expiry: settings.token?.access_expiry ?? '15m', refresh_expiry: settings.token?.refresh_expiry ?? '7d' },
    tool: { max_rounds: settings.tool?.max_rounds ?? 20 },
    app: { clock_interval: settings.app?.clock_interval ?? 30, batch_size: settings.app?.batch_size ?? 10, max_concurrency: settings.app?.max_concurrency ?? 5, text_filter_max_length: settings.app?.text_filter_max_length ?? 50000, attachment_base_path: settings.app?.attachment_base_path ?? './data/attachments', max_upload_size: settings.app?.max_upload_size ?? 50 },
    branding: { app_name: settings.branding?.app_name ?? 'Touwaka Mate', logo_icon: settings.branding?.logo_icon ?? '🤖' },
  })
})

const resetSection = (section: string) => {
  Object.assign(form[section as keyof typeof form], defaults[section as keyof typeof defaults])
}

const resetAll = () => {
  Object.assign(form, defaults)
}

const saveConfig = async () => {
  saving.value = true
  try {
    await systemSettingsStore.updateSettings(form)
    toast.success(t('settings.saveSuccess'))
  } catch (error) {
    console.error('Failed to save settings:', error)
    toast.error(t('settings.saveFailed'))
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await systemSettingsStore.loadSettings()
  const settings = systemSettingsStore.settings
  if (settings) {
    form.llm.context_threshold = settings.llm?.context_threshold ?? 0.7
    form.llm.temperature = settings.llm?.temperature ?? 0.7
    form.llm.reflective_temperature = settings.llm?.reflective_temperature ?? 0.3
    form.llm.top_p = settings.llm?.top_p ?? 1
    form.llm.frequency_penalty = settings.llm?.frequency_penalty ?? 0
    form.llm.presence_penalty = settings.llm?.presence_penalty ?? 0
    form.registration.allow_self_registration = settings.registration?.allow_self_registration ?? true
    form.registration.default_invitation_quota = settings.registration?.default_invitation_quota ?? 10
    form.registration.default_invitation_max_uses = settings.registration?.default_invitation_max_uses ?? 5
    form.registration.invitation_expiry_days = settings.registration?.invitation_expiry_days ?? 30
    form.connection.max_per_user = settings.connection?.max_per_user ?? 5
    form.connection.max_per_expert = settings.connection?.max_per_expert ?? 100
    form.token.access_expiry = settings.token?.access_expiry ?? '15m'
    form.token.refresh_expiry = settings.token?.refresh_expiry ?? '7d'
    form.tool.max_rounds = settings.tool?.max_rounds ?? 20
    form.app.clock_interval = settings.app?.clock_interval ?? 30
    form.app.batch_size = settings.app?.batch_size ?? 10
    form.app.max_concurrency = settings.app?.max_concurrency ?? 5
    form.app.text_filter_max_length = settings.app?.text_filter_max_length ?? 50000
    form.app.attachment_base_path = settings.app?.attachment_base_path ?? './data/attachments'
    form.app.max_upload_size = settings.app?.max_upload_size ?? 50
    form.branding.app_name = settings.branding?.app_name ?? 'Touwaka Mate'
    form.branding.logo_icon = settings.branding?.logo_icon ?? '🤖'
  }
})

watch(() => systemSettingsStore.settings, (settings) => {
  if (settings) {
    form.llm.context_threshold = settings.llm?.context_threshold ?? 0.7
    form.llm.temperature = settings.llm?.temperature ?? 0.7
    form.llm.reflective_temperature = settings.llm?.reflective_temperature ?? 0.3
    form.llm.top_p = settings.llm?.top_p ?? 1
    form.llm.frequency_penalty = settings.llm?.frequency_penalty ?? 0
    form.llm.presence_penalty = settings.llm?.presence_penalty ?? 0
    form.registration.allow_self_registration = settings.registration?.allow_self_registration ?? true
    form.registration.default_invitation_quota = settings.registration?.default_invitation_quota ?? 10
    form.registration.default_invitation_max_uses = settings.registration?.default_invitation_max_uses ?? 5
    form.registration.invitation_expiry_days = settings.registration?.invitation_expiry_days ?? 30
    form.connection.max_per_user = settings.connection?.max_per_user ?? 5
    form.connection.max_per_expert = settings.connection?.max_per_expert ?? 100
    form.token.access_expiry = settings.token?.access_expiry ?? '15m'
    form.token.refresh_expiry = settings.token?.refresh_expiry ?? '7d'
    form.tool.max_rounds = settings.tool?.max_rounds ?? 20
    form.app.clock_interval = settings.app?.clock_interval ?? 30
    form.app.batch_size = settings.app?.batch_size ?? 10
    form.app.max_concurrency = settings.app?.max_concurrency ?? 5
    form.app.text_filter_max_length = settings.app?.text_filter_max_length ?? 50000
    form.app.attachment_base_path = settings.app?.attachment_base_path ?? './data/attachments'
    form.app.max_upload_size = settings.app?.max_upload_size ?? 50
    form.branding.app_name = settings.branding?.app_name ?? 'Touwaka Mate'
    form.branding.logo_icon = settings.branding?.logo_icon ?? '🤖'
  }
}, { deep: true })
</script>

<style scoped>
.system-config-tab { padding: 20px; }
.loading-state { text-align: center; padding: 40px; color: var(--text-secondary); }
.sub-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; }
.tab-content { min-height: 300px; }
.config-section { background: var(--card-bg, #fff); border: 1px solid var(--border-color, #e0e0e0); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.section-title { margin: 0; font-size: 16px; font-weight: 600; }
.config-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
.config-item { display: flex; flex-direction: column; gap: 4px; }
.config-item.full-width { grid-column: 1 / -1; }
.config-label { font-size: 13px; font-weight: 500; color: var(--text-secondary, #666); }
.config-label.checkbox-label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.config-hint { font-size: 11px; color: var(--text-tertiary, #999); }
.config-description { font-size: 11px; color: var(--text-tertiary, #999); margin: 4px 0 0 0; }
.config-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-light, #eee); }
.branding-preview { display: flex; flex-direction: column; gap: 8px; }
.branding-preview-label { font-size: 12px; color: var(--text-tertiary, #999); }
.branding-preview-content { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: var(--hover-bg, #f5f5f5); border-radius: 8px; }
.preview-icon { font-size: 24px; }
.preview-name { font-size: 18px; font-weight: 600; color: var(--text-primary, #333); }
</style>