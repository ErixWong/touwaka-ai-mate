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
    // Note: max_tokens 不在系统设置中管理，由模型表和专家配置决定
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
    vm_execution: number      // VM 执行超时（秒）
    python_execution: number  // Python 执行超时（秒）
    skill_call: number        // 技能调用超时（秒）
    remote_llm: number        // 远程 LLM 调用超时（秒）
  }
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
  }

  // Getters
  const llmSettings = computed(() => settings.value?.llm || defaultSettings.llm)
  const connectionSettings = computed(() => settings.value?.connection || defaultSettings.connection)
  const tokenSettings = computed(() => settings.value?.token || defaultSettings.token)
  const timeoutSettings = computed(() => settings.value?.timeout || defaultSettings.timeout)

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

  return {
    // State
    settings,
    isLoading,
    error,
    defaultSettings,
    // Getters
    llmSettings,
    connectionSettings,
    tokenSettings,
    timeoutSettings,
    // Actions
    loadSettings,
    updateSettings,
    resetSettings,
    getSetting,
  }
})
