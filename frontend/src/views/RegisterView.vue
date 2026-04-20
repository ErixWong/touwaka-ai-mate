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

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent="handleRegister"
      >
        <!-- 邀请码 -->
        <el-form-item :label="$t('register.invitationCode')" prop="invitation_code">
          <el-input
            v-model="form.invitation_code"
            :placeholder="$t('register.invitationCodePlaceholder')"
            @blur="validateInvitationCode(form.invitation_code)"
          />
          <el-text v-if="invitationValidation?.valid === false" type="danger" size="small">
            {{ invitationValidation.message }}
          </el-text>
          <el-text v-else-if="invitationValidation?.valid === true" type="success" size="small">
            {{ $t('register.invitationCodeValid', { remaining: invitationValidation.remaining }) }}
          </el-text>
        </el-form-item>

        <!-- 用户名 -->
        <el-form-item :label="$t('register.username')" prop="username">
          <el-input
            v-model="form.username"
            :placeholder="$t('register.usernamePlaceholder')"
            @input="handleUsernameInput"
          />
          <el-text type="info" size="small">{{ $t('register.usernameFormatHint') }}</el-text>
        </el-form-item>

        <!-- 邮箱 -->
        <el-form-item :label="$t('register.email')" prop="email">
          <el-input
            v-model="form.email"
            type="email"
            :placeholder="$t('register.emailPlaceholder')"
          />
        </el-form-item>

        <!-- 密码 -->
        <el-form-item :label="$t('register.password')" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="$t('register.passwordPlaceholder')"
            show-password
          />
        </el-form-item>

        <!-- 确认密码 -->
        <el-form-item :label="$t('register.confirmPassword')" prop="confirm_password">
          <el-input
            v-model="form.confirm_password"
            type="password"
            :placeholder="$t('register.confirmPasswordPlaceholder')"
            show-password
          />
        </el-form-item>

        <el-alert
          v-if="error"
          :title="error"
          type="error"
          :closable="false"
          show-icon
          class="register-error"
        />

        <el-button
          type="primary"
          size="large"
          class="btn-register"
          :loading="loading"
          :disabled="isSubmitDisabled"
          @click="handleRegister"
        >
          {{ loading ? $t('common.loading') : $t('register.submit') }}
        </el-button>
      </el-form>

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
import { ref, reactive, onMounted, watch, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores/user'
import LangSelector from '@/components/common/LangSelector.vue'
import { getRegistrationConfig, verifyInvitationCode, register, type VerifyResult } from '@/api/invitation'
import type { FormInstance, FormRules } from 'element-plus'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const userStore = useUserStore()
const formRef = ref<FormInstance>()

const form = reactive({
  invitation_code: '',
  username: '',
  email: '',
  password: '',
  confirm_password: '',
})

const rules = reactive<FormRules>({
  invitation_code: [{ required: true, message: t('register.invitationCodeRequired'), trigger: 'blur' }],
  username: [
    { required: true, message: t('register.usernameRequired'), trigger: 'blur' },
    { pattern: /^[a-zA-Z][a-zA-Z0-9_]{5,15}$/, message: t('register.usernameFormatHint'), trigger: 'blur' },
  ],
  email: [
    { required: true, message: t('register.emailRequired'), trigger: 'blur' },
    { type: 'email', message: t('register.emailInvalid'), trigger: 'blur' },
  ],
  password: [
    { required: true, message: t('register.passwordRequired'), trigger: 'blur' },
    { min: 6, message: t('register.passwordMinLength'), trigger: 'blur' },
  ],
  confirm_password: [
    { required: true, message: t('register.confirmPasswordRequired'), trigger: 'blur' },
    {
      validator: (rule, value, callback) => {
        if (value !== form.password) {
          callback(new Error(t('register.passwordMismatch')))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
})

const loading = ref(false)
const error = ref('')
const allowSelfRegistration = ref(false)
const invitationValidation = ref<VerifyResult | null>(null)
let validateTimeout: ReturnType<typeof setTimeout> | null = null

const isSubmitDisabled = computed(() => {
  return loading.value || (form.confirm_password && form.password !== form.confirm_password)
})

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
  } catch {
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

// 处理用户名输入，过滤非法字符
const handleUsernameInput = (value: string) => {
  // 只保留字母、数字、下划线
  let filtered = value.replace(/[^a-zA-Z0-9_]/g, '')
  // 确保第一个字符是字母
  const firstChar = filtered[0]
  if (firstChar && !/^[a-zA-Z]$/.test(firstChar)) {
    filtered = filtered.substring(1)
  }
  // 限制最大长度为16
  if (filtered.length > 16) {
    filtered = filtered.substring(0, 16)
  }
  form.username = filtered
}

const handleRegister = async () => {
  if (!formRef.value) return

  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  error.value = ''

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
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : t('register.error')
    error.value = errorMsg
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

:deep(.el-form) {
  --el-form-item-label-font-size: 13px;
  --el-form-item-label-color: #555;
}

:deep(.el-text) {
  margin-top: 4px;
}

.register-error {
  margin-bottom: 12px;
}

.btn-register {
  width: 100%;
  height: 48px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  margin-top: 8px;
}

.btn-register:hover {
  opacity: 0.95;
  transform: translateY(-1px);
}

.register-footer {
  text-align: center;
  font-size: 13px;
  color: #666;
  margin-top: 24px;
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