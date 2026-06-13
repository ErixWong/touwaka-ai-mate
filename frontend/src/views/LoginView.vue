<template>
  <div class="login-view">
    <div class="login-shell">
      <section class="login-brand-panel">
        <div class="brand-badge">
          <span v-if="brandingLogoIcon" class="brand-badge-icon">{{ brandingLogoIcon }}</span>
          {{ $t('login.brand.badge') }}
        </div>
        <div class="brand-copy">
          <h1 class="brand-title">{{ brandingAppName }}</h1>
          <p class="brand-slogan">{{ $t('login.brand.title') }}</p>
          <p class="brand-description">
            {{ $t('login.brand.description') }}
          </p>
        </div>

        <div class="brand-metrics">
          <div class="metric-card">
            <span class="metric-value">{{ $t('login.brand.metricValue1') }}</span>
            <span class="metric-label">{{ $t('login.brand.metricLabel1') }}</span>
          </div>
          <div class="metric-card">
            <span class="metric-value">{{ $t('login.brand.metricValue2') }}</span>
            <span class="metric-label">{{ $t('login.brand.metricLabel2') }}</span>
          </div>
        </div>

        <ul class="brand-points">
          <li>{{ $t('login.brand.point1') }}</li>
          <li>{{ $t('login.brand.point2') }}</li>
          <li>{{ $t('login.brand.point3') }}</li>
        </ul>
      </section>

      <section class="login-card">
        <div class="card-header">
          <div class="header-content">
            <p class="login-kicker">{{ $t('login.kicker') }}</p>
            <h2 class="login-title">{{ $t('login.subtitle') }}</h2>
            <p class="login-subtitle">{{ $t('login.welcomeSubtitle') }}</p>
          </div>
          <div class="header-actions">
            <LangSelector />
          </div>
        </div>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          class="login-form"
          @submit.prevent="handleLogin"
        >
          <el-form-item :label="$t('login.account')" prop="account">
            <el-input
              v-model="form.account"
              :placeholder="$t('login.accountPlaceholder')"
              size="large"
              @keyup.enter="handleLogin"
            />
          </el-form-item>

          <el-form-item :label="$t('login.password')" prop="password">
            <el-input
              v-model="form.password"
              type="password"
              :placeholder="$t('login.passwordPlaceholder')"
              size="large"
              show-password
              @keyup.enter="handleLogin"
            />
          </el-form-item>

          <el-alert
            v-if="error"
            :title="error"
            type="error"
            :closable="false"
            show-icon
            class="login-error"
          />

          <el-button
            type="primary"
            size="large"
            class="btn-login"
            :loading="loading"
            @click="handleLogin"
          >
            {{ loading ? $t('common.loading') : $t('login.submit') }}
          </el-button>
        </el-form>

        <div class="login-footer">
          <p>{{ $t('login.noAccount') }} <router-link to="/register">{{ $t('login.register') }}</router-link></p>
        </div>
      </section>
    </div>

    <div class="login-decoration">
      <div class="decoration-grid"></div>
      <div class="decoration-circle"></div>
      <div class="decoration-circle"></div>
      <div class="decoration-circle"></div>
      <div class="decoration-glow"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores/user'
import { useSystemSettingsStore } from '@/stores/systemSettings'
import { getDisplayableLogoIcon, getBrandingAppName, DEFAULT_BRANDING_APP_NAME } from '@/utils/branding'
import LangSelector from '@/components/common/LangSelector.vue'
import type { FormInstance, FormRules } from 'element-plus'

const router = useRouter()
const { t } = useI18n()
const userStore = useUserStore()
const systemSettingsStore = useSystemSettingsStore()
const formRef = ref<FormInstance>()

const brandingAppName = computed(() => getBrandingAppName(systemSettingsStore.brandingSettings, DEFAULT_BRANDING_APP_NAME))
const brandingLogoIcon = computed(() => getDisplayableLogoIcon(systemSettingsStore.brandingSettings?.logo_icon))

const form = reactive({
  account: '',
  password: '',
})

const rules = reactive<FormRules>({
  account: [{ required: true, message: t('login.accountRequired'), trigger: 'blur' }],
  password: [{ required: true, message: t('login.passwordRequired'), trigger: 'blur' }],
})

const loading = ref(false)
const error = ref('')

const handleLogin = async () => {
  if (!formRef.value) return

  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  error.value = ''
  loading.value = true

  try {
    await userStore.login({
      account: form.account,
      password: form.password,
    })
    router.push({ name: 'experts' })
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : t('login.error')
    error.value = errorMsg
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-view {
  min-height: 100vh;
  padding: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at top left, rgba(93, 95, 239, 0.34), transparent 32%),
    radial-gradient(circle at bottom right, rgba(66, 211, 255, 0.2), transparent 28%),
    linear-gradient(135deg, #0f172a 0%, #111827 45%, #172554 100%);
  position: relative;
  overflow: hidden;
}

.login-shell {
  width: min(1180px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(360px, 420px);
  gap: 32px;
  align-items: stretch;
  position: relative;
  z-index: 1;
}

.login-brand-panel {
  padding: 48px;
  border-radius: 28px;
  color: #eff6ff;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.66), rgba(15, 23, 42, 0.32));
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(18px);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 640px;
}

.brand-badge {
  width: fit-content;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #c4b5fd;
  background: rgba(76, 29, 149, 0.28);
  border: 1px solid rgba(196, 181, 253, 0.2);
  display: flex;
  align-items: center;
  gap: 6px;
}

.brand-badge-icon {
  font-size: 16px;
  line-height: 1;
}

.brand-copy {
  margin-top: 32px;
}

.brand-title {
  margin: 0;
  font-size: clamp(34px, 4vw, 52px);
  line-height: 1.08;
  font-weight: 700;
  max-width: 10ch;
}

.brand-slogan {
  margin: 12px 0 0;
  font-size: 16px;
  line-height: 1.6;
  color: rgba(226, 232, 240, 0.9);
  letter-spacing: 0.02em;
}

.brand-description {
  margin: 24px 0 0;
  max-width: 620px;
  font-size: 16px;
  line-height: 1.75;
  color: rgba(226, 232, 240, 0.82);
}

.brand-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 40px;
}

.metric-card {
  padding: 20px;
  border-radius: 20px;
  background: rgba(15, 23, 42, 0.38);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.metric-value {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #f8fafc;
}

.metric-label {
  display: block;
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(226, 232, 240, 0.72);
}

.brand-points {
  margin: 40px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 14px;
}

.brand-points li {
  position: relative;
  padding-left: 26px;
  font-size: 14px;
  line-height: 1.7;
  color: rgba(226, 232, 240, 0.84);
}

.brand-points li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6 0%, #38bdf8 100%);
  box-shadow: 0 0 20px rgba(56, 189, 248, 0.45);
}

.login-card {
  width: 100%;
  padding: 36px;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 28px;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(18px);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 28px;
}

.header-content {
  flex: 1;
}

.header-actions {
  flex-shrink: 0;
}

.login-kicker {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6366f1;
}

.login-title {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.15;
  margin: 0;
  color: #0f172a;
}

.login-subtitle {
  font-size: 14px;
  line-height: 1.7;
  color: #475569;
  margin: 12px 0 0;
}

.login-form {
  margin-top: 8px;
}

:deep(.el-form) {
  --el-form-item-label-font-size: 13px;
  --el-form-item-label-color: #334155;
}

:deep(.el-form-item) {
  margin-bottom: 22px;
}

:deep(.el-input__wrapper) {
  min-height: 50px;
  border-radius: 14px;
  box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.22);
  background: rgba(248, 250, 252, 0.95);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}

:deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.65), 0 0 0 5px rgba(99, 102, 241, 0.08);
  transform: translateY(-1px);
}

.login-error {
  margin: 4px 0 18px;
}

:deep(.login-error .el-alert) {
  border-radius: 14px;
}

.btn-login {
  width: 100%;
  height: 52px;
  margin-top: 6px;
  border: none;
  border-radius: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 55%, #0ea5e9 100%);
  box-shadow: 0 18px 32px rgba(79, 70, 229, 0.28);
  transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
}

.btn-login:hover {
  opacity: 0.98;
  transform: translateY(-2px);
  box-shadow: 0 20px 36px rgba(79, 70, 229, 0.34);
}

.login-footer {
  font-size: 13px;
  color: #64748b;
  margin-top: 22px;
  text-align: center;
}

.login-footer a {
  color: #4f46e5;
  text-decoration: none;
  font-weight: 700;
}

.login-footer a:hover {
  text-decoration: underline;
}

.login-decoration {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.decoration-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(circle at center, black 28%, transparent 78%);
}

.decoration-circle {
  position: absolute;
  border-radius: 50%;
  filter: blur(8px);
}

.decoration-circle:nth-of-type(1) {
  width: 360px;
  height: 360px;
  top: -120px;
  right: -80px;
  background: rgba(56, 189, 248, 0.12);
}

.decoration-circle:nth-of-type(2) {
  width: 280px;
  height: 280px;
  bottom: -60px;
  left: -40px;
  background: rgba(129, 140, 248, 0.14);
}

.decoration-circle:nth-of-type(3) {
  width: 220px;
  height: 220px;
  bottom: 120px;
  right: 12%;
  background: rgba(192, 132, 252, 0.12);
}

.decoration-glow {
  position: absolute;
  width: 540px;
  height: 540px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.18), transparent 68%);
  filter: blur(18px);
}

@media (max-width: 1080px) {
  .login-shell {
    grid-template-columns: 1fr;
    max-width: 720px;
  }

  .login-brand-panel {
    min-height: auto;
  }

  .brand-title {
    max-width: none;
  }
}

@media (max-width: 768px) {
  .login-view {
    padding: 18px;
  }

  .login-shell {
    gap: 18px;
  }

  .login-brand-panel,
  .login-card {
    padding: 24px;
    border-radius: 22px;
  }

  .brand-metrics {
    grid-template-columns: 1fr;
  }

  .card-header {
    flex-direction: column;
    align-items: stretch;
  }

  .header-actions {
    align-self: flex-end;
  }

  .login-title {
    font-size: 26px;
  }
}

@media (max-width: 520px) {
  .login-brand-panel {
    display: none;
  }

  .login-shell {
    grid-template-columns: 1fr;
  }

  .login-card {
    padding: 22px;
  }
}
</style>
