import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { userApi, authApi } from '@/api/services'
import { setLocale, getLocale, type Locale } from '@/i18n'
import type { User, UserPreference } from '@/types'

/**
 * User Store
 * 
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 */

export const useUserStore = defineStore('user', () => {
  // State
  const user = ref<User | null>(null)
  const preferences = ref<UserPreference | null>(null)
  const isAuthenticated = ref(false)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const isLoggedIn = computed(() => isAuthenticated.value && !!user.value)

  const isAdmin = computed(() => {
    if (!user.value?.roles) return false
    return user.value.roles.includes('admin')
  })

  const theme = computed(() => preferences.value?.theme || 'auto')

  const language = computed<Locale>({
    get: () => preferences.value?.language || getLocale(),
    set: (value: Locale) => {
      if (preferences.value) {
        preferences.value.language = value
      }
    },
  })

  // Actions
  // 登录
  const login = async (credentials: { account: string; password: string }) => {
    isLoading.value = true
    error.value = null
    try {
      const response = await authApi.login(credentials)
      localStorage.setItem('access_token', response.access_token)
      localStorage.setItem('refresh_token', response.refresh_token)
      isAuthenticated.value = true
      // 登录后获取完整用户信息
      await loadUser()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Login failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 注册
  const register = async (data: { username: string; email: string; password: string }) => {
    isLoading.value = true
    error.value = null
    try {
      await authApi.register(data)
      // 注册成功后自动登录（使用用户名登录）
      await login({ account: data.username, password: data.password })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Registration failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 登出
  const logout = async () => {
    try {
      await authApi.logout()
    } finally {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      user.value = null
      preferences.value = null
      isAuthenticated.value = false
    }
  }

  // 加载当前用户
  const loadUser = async () => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      isAuthenticated.value = false
      user.value = null
      return
    }

    isLoading.value = true
    try {
      const userData = await userApi.getCurrentUser()
      user.value = userData
      isAuthenticated.value = true
      // 后端 /auth/me 已经返回了 preferences
      if (userData.preferences) {
        preferences.value = userData.preferences
        // 应用用户语言设置
        if (userData.preferences.language && userData.preferences.language !== getLocale()) {
          setLocale(userData.preferences.language)
        }
      }
    } catch (err) {
      // Token 可能已过期，清除并标记为未登录
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      user.value = null
      preferences.value = null
      isAuthenticated.value = false
      // 抛出错误让调用者知道加载失败
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 加载用户配置
  const loadPreferences = async () => {
    // preferences 已经在 loadUser 中从 /api/auth/me 返回了
    // 这个方法现在只用于登录后单独加载
    if (preferences.value) {
      return
    }
    try {
      const userData = await userApi.getCurrentUser()
      if (userData.preferences) {
        preferences.value = userData.preferences
        if (userData.preferences.language && userData.preferences.language !== getLocale()) {
          setLocale(userData.preferences.language)
        }
      }
    } catch (err) {
      console.error('Failed to load preferences:', err)
    }
  }

  // 更新用户配置
  const updatePreferences = async (data: Partial<UserPreference>) => {
    isLoading.value = true
    error.value = null
    try {
      const updated = await userApi.updatePreferences(data)
      preferences.value = updated

      // 如果语言变更，立即应用
      if (data.language && data.language !== getLocale()) {
        setLocale(data.language)
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update preferences'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 切换语言
  const changeLanguage = async (locale: Locale) => {
    setLocale(locale)
    if (isLoggedIn.value) {
      await updatePreferences({ language: locale })
    }
  }

  // 切换主题
  const changeTheme = async (theme: 'light' | 'dark' | 'auto') => {
    if (isLoggedIn.value) {
      await updatePreferences({ theme })
    } else {
      if (preferences.value) {
        preferences.value.theme = theme
      } else {
        preferences.value = {
          user_id: '',
          theme,
          language: getLocale(),
          enable_stream: true,
          enable_debug: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      }
    }
  }

  // 清除错误
  const clearError = () => {
    error.value = null
  }

  return {
    // State
    user,
    preferences,
    isAuthenticated,
    isLoading,
    error,

    // Getters
    isLoggedIn,
    isAdmin,
    theme,
    language,

    // Actions
    login,
    register,
    logout,
    loadUser,
    loadPreferences,
    updatePreferences,
    changeLanguage,
    changeTheme,
    clearError,
  }
})
