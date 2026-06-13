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
    skill_http: number
    resident_skill: number
    remote_llm: number
    chat_idle: number
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
  app?: {
    clock_interval?: number
    batch_size?: number
    max_concurrency?: number
    text_filter_max_length?: number
    attachment_base_path?: string
    max_upload_size?: number
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
  const brandingLoaded = ref(false)
  const unsavedConfigChanges = ref(false)
  // 标记是否已成功从后端加载真实配置（区别于占位结构）
  const loadedFromBackend = ref(false)
  let brandingPromise: Promise<BrandingSettings> | null = null

  // 空结构占位（仅防止 undefined 导致模板报错，不定义业务默认值）
  // 默认值权威来源在后端，前端通过接口获取
  // 注意：必须包含所有 section，确保失败态下 reset 能正确展开字段列表
  const defaultSettings: SystemSettings = {
    llm: {
      context_threshold: 0,
      temperature: 0,
      reflective_temperature: 0,
      top_p: 0,
      frequency_penalty: 0,
      presence_penalty: 0,
    },
    connection: {
      max_per_user: 0,
      max_per_expert: 0,
    },
    token: {
      access_expiry: '',
      refresh_expiry: '',
    },
    timeout: {
      vm_execution: 0,
      python_execution: 0,
      skill_call: 0,
      skill_http: 0,
      resident_skill: 0,
      remote_llm: 0,
      chat_idle: 0,
    },
    tool: {
      max_rounds: 0,
    },
    registration: {
      allow_self_registration: false,
      default_invitation_quota: 0,
      default_invitation_max_uses: 0,
      invitation_expiry_days: 0,
    },
    app: {
      clock_interval: 0,
      batch_size: 0,
      max_concurrency: 0,
      text_filter_max_length: 0,
      attachment_base_path: '',
      max_upload_size: 0,
    },
    branding: {
      app_name: '',
      logo_icon: '',
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
      loadedFromBackend.value = true  // 标记已成功加载
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load system settings'
      // 加载失败时保持空结构占位，不填充业务默认值
      // 后端才是默认值权威来源，前端不应自行定义业务默认值
      loadedFromBackend.value = false  // 标记未成功加载
      if (!settings.value) {
        settings.value = defaultSettings
      }
    } finally {
      isLoading.value = false
    }
  }

  const loadRuntimeSettings = async () => {
    try {
      const response = await apiClient.get('/system-settings/runtime')
      const runtimeSettings = response.data.data as Partial<SystemSettings>
      settings.value = {
        ...defaultSettings,
        ...(settings.value || {}),
        timeout: {
          ...defaultSettings.timeout,
          ...(settings.value?.timeout || {}),
          ...(runtimeSettings.timeout || {}),
        },
      }
    } catch {
      console.warn('[systemSettings] 运行时配置加载失败，保持现有状态')
      // 不填充业务默认值，避免与后端权威来源冲突
    }
  }

  // 更新系统配置
  const updateSettings = async (newSettings: Partial<SystemSettings>) => {
    // 检查是否已成功加载真实配置，禁止保存占位结构
    if (!loadedFromBackend.value) {
      throw new Error('Cannot save settings: configuration not loaded from backend')
    }
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
  // keys 参数可以是：
  // 1. 未定义或空数组 -> 重置所有配置
  // 2. 扁平 key 数组 -> 重置指定字段（如 ['registration.allow_self_registration']）
  // 3. section 名数组 -> 自动展开为该 section 下所有字段
  const resetSettings = async (keys?: string[]) => {
    isLoading.value = true
    error.value = null
    try {
      // 如果传入 section 名，展开为完整字段列表
      let flattenedKeys = keys
      if (keys && keys.length > 0) {
        flattenedKeys = keys.flatMap(key => {
          // 如果 key 包含点号，说明已经是扁平格式，直接使用
          if (key.includes('.')) {
            return [key]
          }
          // 否则展开为该 section 下所有字段
          const sectionSettings = settings.value?.[key as keyof SystemSettings]
          if (sectionSettings && typeof sectionSettings === 'object') {
            return Object.keys(sectionSettings).map(subKey => `${key}.${subKey}`)
          }
          return [key]
        })
      }
      
      const response = await apiClient.post('/system-settings/reset', {
        keys: flattenedKeys,
        all: !flattenedKeys || flattenedKeys.length === 0
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
    if (brandingLoaded.value && settings.value?.branding) {
      return settings.value.branding
    }

    if (brandingPromise) {
      return brandingPromise
    }

    brandingPromise = (async () => {
      try {
        const response = await apiClient.get('/branding')
        const data = response.data.data
        if (settings.value) {
          settings.value.branding = data
        } else {
          settings.value = { ...defaultSettings, branding: data } as SystemSettings
        }
        brandingLoaded.value = true
        return data
      } catch {
        const fallback = { ...defaultSettings.branding }
        if (settings.value) {
          settings.value.branding = fallback
        } else {
          settings.value = { ...defaultSettings, branding: fallback }
        }
        brandingLoaded.value = true
        return fallback
      } finally {
        brandingPromise = null
      }
    })()

    return brandingPromise
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
    brandingLoaded,
    loadedFromBackend,  // 导出加载状态标记
    unsavedConfigChanges,
    loadSettings,
    loadRuntimeSettings,
    updateSettings,
    resetSettings,
    getSetting,
    loadBranding,
  }
})
