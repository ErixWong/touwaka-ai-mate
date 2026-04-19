<template>
  <div class="login-view">
    <div class="login-card">
      <div class="card-header">
        <div class="header-content">
          <h1 class="login-title">{{ $t('app.title') }}</h1>
          <p class="login-subtitle">{{ $t('login.subtitle') }}</p>
        </div>
        <LangSelector />
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent="handleLogin"
      >
        <el-form-item :label="$t('login.account')" prop="account">
          <el-input
            v-model="form.account"
            :placeholder="$t('login.accountPlaceholder')"
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-form-item :label="$t('login.password')" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="$t('login.passwordPlaceholder')"
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
    </div>

    <div class="login-decoration">
      <div class="decoration-circle"></div>
      <div class="decoration-circle"></div>
      <div class="decoration-circle"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores/user'
import LangSelector from '@/components/common/LangSelector.vue'
import type { FormInstance, FormRules } from 'element-plus'

const router = useRouter()
const { t } = useI18n()
const userStore = useUserStore()
const formRef = ref<FormInstance>()

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
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  position: relative;
  overflow: hidden;
}

.login-card {
  width: 100%;
  max-width: 400px;
  padding: 48px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  z-index: 1;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
}

.header-content {
  flex: 1;
}

.login-title {
  font-size: 28px;
  font-weight: 700;
  text-align: center;
  margin: 0 0 8px 0;
  color: #333;
}

.login-subtitle {
  font-size: 14px;
  text-align: center;
  color: #666;
  margin: 0;
}

:deep(.el-form-item__label) {
  font-size: 13px;
  font-weight: 500;
  color: #555;
  padding-bottom: 4px;
}

.login-error {
  margin-bottom: 16px;
}

.btn-login {
  width: 100%;
  height: 48px;
  font-size: 15px;
  font-weight: 600;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
}

.btn-login:hover {
  opacity: 0.95;
  transform: translateY(-1px);
}

.login-footer {
  text-align: center;
  font-size: 13px;
  color: #666;
  margin-top: 24px;
}

.login-footer a {
  color: #667eea;
  text-decoration: none;
  font-weight: 500;
}

.login-footer a:hover {
  text-decoration: underline;
}

.login-decoration {
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