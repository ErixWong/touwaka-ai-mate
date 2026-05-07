import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import apiClient from '@/api/client'

/**
 * 系统配置类型定义
 */
export interface SystemSettings {
  llm: {
    context_threshold: number
    temperature: number
    reflective_temperature: number
    top_p: number
    frequency_penalty: number
    presence_penalty: number
  }
  connection: {
    max_per_user: number
    max_per_expert: number
  }
  token: {
    access_expiry: string
    refresh_expiry: string
  }
  timeout: {
    vm_execution: number
    python_execution: number
    skill_call: number
    remote_llm: number
  }
  tool: {
    max_rounds: number
  }
  registration: {
    allow_self_registration: boolean
    default_invitation_quota: number
    default_invitation_max_uses: number
    invitation_expiry_days: number
  }
  branding: {
    app_name: string
    logo_icon: string
  }
}

export interface BrandingSettings {
  app_name: string
  logo_icon: string
}

/**
 * SystemSettings Store
 * 管理系统级配置（仅管理员可修改）
 */
export const useSystemSettingsStore = defineStore('systemSettings', () => {
  // State
  const settings = ref<SystemSettings | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // 默认配置（用于初始化）
  const defaultSettings: SystemSettings = {
    llm: {
      context_threshold: 0.70,
      temperature: 0.70,
      reflective_temperature: 0.30,
      top_p: 1.0,
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
    },
    connection: {
      max_per_user: 5,
      max_per_expert: 100,
    },
    token: {
      access_expiry: '15m',
      refresh_expiry: '7d',
    },
    timeout: {
      vm_execution: 30,
      python_execution: 300,
      skill_call: 60,
      remote_llm: 120,
    },
    tool: {
      max_rounds: 20,
    },
    registration: {
      allow_self_registration: true,
      default_invitation_quota: 10,
      default_invitation_max_uses: 5,
      invitation_expiry_days: 30,
    },
    branding: {
      app_name: 'Touwaka Mate',
      logo_icon: '🤖',
    },
  }

  // Getters
  const llmSettings = computed(() => settings.value?.llm || defaultSettings.llm)
  const connectionSettings = computed(() => settings.value?.connection || defaultSettings.connection)
  const tokenSettings = computed(() => settings.value?.token || defaultSettings.token)
  const timeoutSettings = computed(() => settings.value?.timeout || defaultSettings.timeout)
  const toolSettings = computed(() => settings.value?.tool || defaultSettings.tool)
  const registrationSettings = computed(() => settings.value?.registration || defaultSettings.registration)
  const brandingSettings = computed(() => settings.value?.branding || defaultSettings.branding)

  // Actions
  // 加载系统配置
  const loadSettings = async () => {
    isLoading.value = true
    error.value = null
    try {
      const response = await apiClient.get('/system-settings')
      settings.value = response.data.data
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load system settings'
      // 加载失败时使用默认值
      settings.value = defaultSettings
    } finally {
      isLoading.value = false
    }
  }

  // 更新系统配置
  const updateSettings = async (newSettings: Partial<SystemSettings>) => {
    isLoading.value = true
    error.value = null
    try {
      const response = await apiClient.put('/system-settings', newSettings)
      settings.value = response.data.data
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update system settings'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 重置配置为默认值
  const resetSettings = async (keys?: string[]) => {
    isLoading.value = true
    error.value = null
    try {
      const response = await apiClient.post('/system-settings/reset', {
        keys,
        all: !keys
      })
      settings.value = response.data.data
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to reset system settings'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 获取单个配置值（支持路径访问，如 'llm.temperature'）
  const getSetting = (path: string): number | string | undefined => {
    if (!settings.value) return undefined
    const parts = path.split('.')
    let result: any = settings.value
    for (const part of parts) {
      if (result && typeof result === 'object' && part in result) {
        result = result[part]
      } else {
        return undefined
      }
    }
    return result
  }

  const loadBranding = async (): Promise<BrandingSettings> => {
    try {
      const response = await apiClient.get('/branding')
      const data = response.data.data
      if (settings.value) {
        settings.value.branding = data
      } else {
        settings.value = { ...defaultSettings, branding: data } as SystemSettings
      }
      return data
    } catch {
      return { app_name: 'Touwaka Mate', logo_icon: '🤖' }
    }
  }

  return {
    settings,
    isLoading,
    error,
    defaultSettings,
    llmSettings,
    connectionSettings,
    tokenSettings,
    timeoutSettings,
    toolSettings,
    registrationSettings,
    brandingSettings,
    loadSettings,
    updateSettings,
    resetSettings,
    getSetting,
    loadBranding,
  }
})
