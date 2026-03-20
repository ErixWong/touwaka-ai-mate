<template>
  <div class="register-view">
    <div class="register-card">
      <div class="card-header">
        <div class="header-content">
          <h1 class="register-title">{{ $t('app.title') }}</h1>
          <p class="register-subtitle">{{ $t('register.subtitle') }}</p>
        </div>
        <LangSelector />
      </div>

      <form class="register-form" @submit.prevent="handleRegister">
        <!-- 邀请码 -->
        <div class="form-group">
          <label class="form-label">{{ $t('register.invitationCode') }}</label>
          <input
            v-model="form.invitation_code"
            type="text"
            class="form-input"
            :placeholder="$t('register.invitationCodePlaceholder')"
            :required="!allowSelfRegistration"
          />
          <p v-if="invitationValidation && invitationValidation.valid === false" class="field-error">
            {{ invitationValidation.message }}
          </p>
          <p v-else-if="invitationValidation && invitationValidation.valid === true" class="field-success">
            {{ $t('register.invitationCodeValid', { remaining: invitationValidation.remaining }) }}
          </p>
        </div>

        <!-- 用户名 -->
        <div class="form-group">
          <label class="form-label">{{ $t('register.username') }}</label>
          <input
            v-model="form.username"
            type="text"
            class="form-input"
            :placeholder="$t('register.usernamePlaceholder')"
            required
            pattern="[a-zA-Z][a-zA-Z0-9_]{5,31}"
            :title="$t('register.usernameFormatHint')"
          />
          <p class="field-hint">{{ $t('register.usernameFormatHint') }}</p>
        </div>

        <!-- 邮箱 -->
        <div class="form-group">
          <label class="form-label">{{ $t('register.email') }}</label>
          <input
            v-model="form.email"
            type="email"
            class="form-input"
            :placeholder="$t('register.emailPlaceholder')"
            required
          />
        </div>

        <!-- 密码 -->
        <div class="form-group">
          <label class="form-label">{{ $t('register.password') }}</label>
          <input
            v-model="form.password"
            type="password"
            class="form-input"
            :placeholder="$t('register.passwordPlaceholder')"
            required
            minlength="6"
          />
        </div>

        <!-- 确认密码 -->
        <div class="form-group">
          <label class="form-label">{{ $t('register.confirmPassword') }}</label>
          <input
            v-model="form.confirm_password"
            type="password"
            class="form-input"
            :placeholder="$t('register.confirmPasswordPlaceholder')"
            required
          />
          <p v-if="form.confirm_password && form.password !== form.confirm_password" class="field-error">
            {{ $t('register.passwordMismatch') }}
          </p>
        </div>

        <div v-if="error" class="error-message">
          {{ error }}
        </div>

        <button
          type="submit"
          class="btn-register"
          :disabled="loading || !!(form.confirm_password && form.password !== form.confirm_password)"
        >
          {{ loading ? $t('common.loading') : $t('register.submit') }}
        </button>
      </form>

      <div class="register-footer">
        <p>{{ $t('register.hasAccount') }} <router-link to="/login">{{ $t('register.login') }}</router-link></p>
      </div>
    </div>

    <div class="register-decoration">
      <div class="decoration-circle"></div>
      <div class="decoration-circle"></div>
      <div class="decoration-circle"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores/user'
import LangSelector from '@/components/common/LangSelector.vue'
import { getRegistrationConfig, verifyInvitationCode, register, type VerifyResult } from '@/api/invitation'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const userStore = useUserStore()

const form = reactive({
  invitation_code: '',
  username: '',
  email: '',
  password: '',
  confirm_password: '',
})

const loading = ref(false)
const error = ref('')
const allowSelfRegistration = ref(false)
const invitationValidation = ref<VerifyResult | null>(null)
let validateTimeout: ReturnType<typeof setTimeout> | null = null

// 加载注册配置
onMounted(async () => {
  try {
    const config = await getRegistrationConfig()
    allowSelfRegistration.value = config.allowSelfRegistration

    // 从 URL 参数获取邀请码
    const codeFromUrl = route.query.code as string
    if (codeFromUrl) {
      form.invitation_code = codeFromUrl
      await validateInvitationCode(codeFromUrl)
    }
  } catch (err) {
    console.error('Failed to load registration config:', err)
  }
})

// 验证邀请码
const validateInvitationCode = async (code: string) => {
  if (!code) {
    invitationValidation.value = null
    return
  }

  try {
    const result = await verifyInvitationCode(code)
    invitationValidation.value = result
  } catch (err) {
    invitationValidation.value = { valid: false, message: t('register.invitationCodeInvalid') }
  }
}

// 监听邀请码输入
watch(() => form.invitation_code, (newCode) => {
  if (validateTimeout) {
    clearTimeout(validateTimeout)
  }
  
  if (newCode) {
    validateTimeout = setTimeout(() => {
      validateInvitationCode(newCode)
    }, 500)
  } else {
    invitationValidation.value = null
  }
})

const handleRegister = async () => {
  error.value = ''

  // 验证密码匹配
  if (form.password !== form.confirm_password) {
    error.value = t('register.passwordMismatch')
    return
  }

  // 验证邀请码
  if (!allowSelfRegistration.value && !form.invitation_code) {
    error.value = t('register.invitationCodeRequired')
    return
  }

  if (form.invitation_code && invitationValidation.value && !invitationValidation.value.valid) {
    error.value = t('register.invitationCodeInvalid')
    return
  }

  loading.value = true

  try {
    const result = await register({
      username: form.username,
      email: form.email,
      password: form.password,
      invitation_code: form.invitation_code || undefined,
    })

    // 保存 token
    localStorage.setItem('access_token', result.access_token)
    localStorage.setItem('refresh_token', result.refresh_token)
    
    // 加载用户信息
    await userStore.loadUser()

    // 跳转到专家列表
    router.push({ name: 'experts' })
  } catch (err: any) {
    error.value = err.response?.data?.message || t('register.error')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.register-view {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  position: relative;
  overflow: hidden;
}

.register-card {
  width: 100%;
  max-width: 420px;
  padding: 40px 48px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  z-index: 1;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.header-content {
  flex: 1;
}

.register-title {
  font-size: 28px;
  font-weight: 700;
  text-align: center;
  margin: 0 0 8px 0;
  color: #333;
}

.register-subtitle {
  font-size: 14px;
  text-align: center;
  color: #666;
  margin: 0;
}

.register-form {
  margin-bottom: 20px;
}

.form-group {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #555;
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.field-error {
  font-size: 12px;
  color: #c62828;
  margin-top: 4px;
}

.field-success {
  font-size: 12px;
  color: #2e7d32;
  margin-top: 4px;
}

.field-hint {
  font-size: 12px;
  color: #888;
  margin-top: 4px;
}

.error-message {
  padding: 10px;
  background: #ffebee;
  border: 1px solid #ef9a9a;
  border-radius: 8px;
  font-size: 13px;
  color: #c62828;
  margin-bottom: 12px;
}

.btn-register {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.2s;
}

.btn-register:hover:not(:disabled) {
  opacity: 0.95;
  transform: translateY(-1px);
}

.btn-register:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.register-footer {
  text-align: center;
  font-size: 13px;
  color: #666;
}

.register-footer a {
  color: #667eea;
  text-decoration: none;
  font-weight: 500;
}

.register-footer a:hover {
  text-decoration: underline;
}

.register-decoration {
  position: absolute;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
}

.decoration-circle {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
}

.decoration-circle:nth-child(1) {
  width: 300px;
  height: 300px;
  top: -100px;
  right: -100px;
}

.decoration-circle:nth-child(2) {
  width: 200px;
  height: 200px;
  bottom: -50px;
  left: -50px;
}

.decoration-circle:nth-child(3) {
  width: 150px;
  height: 150px;
  bottom: 100px;
  right: 10%;
}
</style>