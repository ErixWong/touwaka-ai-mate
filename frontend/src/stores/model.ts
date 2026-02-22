import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { modelApi } from '@/api/services'
import type { AIModel, ModelFormData } from '@/types'

/**
 * Model Store
 * 
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 */

export const useModelStore = defineStore('model', () => {
  // State
  const models = ref<AIModel[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const activeModels = computed(() =>
    models.value.filter(m => m.is_active)
  )

  // 根据ID获取模型
  const getModelById = computed(() => {
    return (id: string) => models.value.find(m => m.id === id)
  })

  // Actions
  // 加载模型列表
  const loadModels = async () => {
    isLoading.value = true
    error.value = null
    try {
      const data = await modelApi.getModels()
      models.value = data
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load models'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 创建模型
  const createModel = async (data: ModelFormData) => {
    isLoading.value = true
    error.value = null
    try {
      const newModel = await modelApi.createModel(data)
      models.value.push(newModel)
      return newModel
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create model'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 更新模型
  const updateModel = async (id: string, data: Partial<ModelFormData>) => {
    isLoading.value = true
    error.value = null
    try {
      const updatedModel = await modelApi.updateModel(id, data)
      const index = models.value.findIndex(m => m.id === id)
      if (index !== -1) {
        models.value[index] = updatedModel
      }
      return updatedModel
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update model'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 删除模型
  const deleteModel = async (id: string) => {
    isLoading.value = true
    error.value = null
    try {
      await modelApi.deleteModel(id)
      models.value = models.value.filter(m => m.id !== id)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete model'
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
    models,
    isLoading,
    error,

    // Getters
    activeModels,
    getModelById,

    // Actions
    loadModels,
    createModel,
    updateModel,
    deleteModel,
    clearError,
  }
})
