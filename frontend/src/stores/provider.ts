import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { providerApi } from '@/api/services'
import type { ModelProvider, ProviderFormData } from '@/types'

/**
 * Provider Store
 * 
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 */

export const useProviderStore = defineStore('provider', () => {
  // State
  const providers = ref<ModelProvider[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const activeProviders = computed(() =>
    providers.value.filter(p => p.is_active)
  )

  const getProviderById = computed(() => (id: string) =>
    providers.value.find(p => p.id === id)
  )

  // Actions
  // 加载 Provider 列表
  const loadProviders = async () => {
    isLoading.value = true
    error.value = null
    try {
      const data = await providerApi.getProviders()
      providers.value = data
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load providers'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 创建 Provider
  const createProvider = async (data: ProviderFormData) => {
    isLoading.value = true
    error.value = null
    try {
      const newProvider = await providerApi.createProvider(data)
      providers.value.unshift(newProvider)
      return newProvider
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create provider'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 更新 Provider
  const updateProvider = async (id: string, data: Partial<ProviderFormData>) => {
    isLoading.value = true
    error.value = null
    try {
      const updatedProvider = await providerApi.updateProvider(id, data)
      const index = providers.value.findIndex(p => p.id === id)
      if (index !== -1) {
        providers.value[index] = updatedProvider
      }
      return updatedProvider
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update provider'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 删除 Provider
  const deleteProvider = async (id: string) => {
    isLoading.value = true
    error.value = null
    try {
      await providerApi.deleteProvider(id)
      providers.value = providers.value.filter(p => p.id !== id)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete provider'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 清除错误
  const clearError = () => {
    error.value = null
  }

  return {
    // State
    providers,
    isLoading,
    error,

    // Getters
    activeProviders,
    getProviderById,

    // Actions
    loadProviders,
    createProvider,
    updateProvider,
    deleteProvider,
    clearError,
  }
})
