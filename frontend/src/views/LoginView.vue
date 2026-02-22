<template>
  <div class="login-view">
    <div class="login-card">
      <h1 class="login-title">{{ $t('app.title') }}</h1>
      <p class="login-subtitle">{{ $t('login.subtitle') }}</p>

      <form class="login-form" @submit.prevent="handleLogin">
        <div class="form-group">
          <label class="form-label">{{ $t('login.account') }}</label>
          <input
            v-model="form.account"
            type="text"
            class="form-input"
            :placeholder="$t('login.accountPlaceholder')"
            required
          />
        </div>

        <div class="form-group">
          <label class="form-label">{{ $t('login.password') }}</label>
          <input
            v-model="form.password"
            type="password"
            class="form-input"
            :placeholder="$t('login.passwordPlaceholder')"
            required
          />
        </div>

        <div v-if="error" class="error-message">
          {{ error }}
        </div>

        <button
          type="submit"
          class="btn-login"
          :disabled="loading"
        >
          {{ loading ? $t('common.loading') : $t('login.submit') }}
        </button>
      </form>

      <div class="login-footer">
        <p>{{ $t('login.noAccount') }} <a href="#">{{ $t('login.register') }}</a></p>
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

const router = useRouter()
const { t } = useI18n()
const userStore = useUserStore()

const form = reactive({
  account: '',
  password: '',
})

const loading = ref(false)
const error = ref('')

  const handleLogin = async () => {
    error.value = ''
    loading.value = true

    try {
      await userStore.login({
        account: form.account,
        password: form.password,
      })
      router.push({ name: 'experts' })
    } catch (err: any) {
      error.value = err.message || err.response?.data?.message || t('login.error')
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
  margin: 0 0 32px 0;
}

.login-form {
  margin-bottom: 24px;
}

.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #555;
  margin-bottom: 8px;
}

.form-input {
  width: 100%;
  padding: 12px 16px;
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

.error-message {
  padding: 12px;
  background: #ffebee;
  border: 1px solid #ef9a9a;
  border-radius: 8px;
  font-size: 13px;
  color: #c62828;
  margin-bottom: 16px;
}

.btn-login {
  width: 100%;
  padding: 14px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.2s;
}

.btn-login:hover:not(:disabled) {
  opacity: 0.95;
  transform: translateY(-1px);
}

.btn-login:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.login-footer {
  text-align: center;
  font-size: 13px;
  color: #666;
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
