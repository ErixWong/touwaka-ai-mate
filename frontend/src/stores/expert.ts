import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { expertApi } from '@/api/services'
import type { Expert } from '@/types'

/**
 * Expert Store
 * 
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 */

export const useExpertStore = defineStore('expert', () => {
  // State
  const experts = ref<Expert[]>([])
  const currentExpertId = ref<string | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const currentExpert = computed(() =>
    experts.value.find(e => e.id === currentExpertId.value)
  )

  const activeExperts = computed(() =>
    experts.value.filter(e => e.is_active)
  )

  // Actions
  // 加载专家列表
  const loadExperts = async (options?: { is_active?: boolean }) => {
    isLoading.value = true
    error.value = null
    try {
      const data = await expertApi.getExperts(options || {})
      experts.value = data
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load experts'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 加载单个专家
  const loadExpert = async (id: string) => {
    isLoading.value = true
    error.value = null
    try {
      const expert = await expertApi.getExpert(id)
      const index = experts.value.findIndex(e => e.id === id)
      if (index >= 0) {
        experts.value[index] = expert
      } else {
        experts.value.push(expert)
      }
      return expert
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load expert'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 设置当前专家
  const setCurrentExpert = (id: string | null) => {
    if (id === null) {
      currentExpertId.value = null
      return
    }

    const expert = experts.value.find(e => e.id === id)
    if (expert) {
      currentExpertId.value = id
      // 保存到 localStorage
      localStorage.setItem('current_expert_id', id)
    }
  }

  // 从 localStorage 恢复当前专家
  const restoreCurrentExpert = () => {
    const savedExpertId = localStorage.getItem('current_expert_id')
    if (savedExpertId) {
      const expert = experts.value.find(e => e.id === savedExpertId)
      if (expert && expert.is_active) {
        currentExpertId.value = savedExpertId
        return true
      }
    }
    return false
  }

  // 获取专家信息
  const getExpertById = (id: string) => {
    return experts.value.find(e => e.id === id)
  }

  // 创建专家
  const createExpert = async (data: Partial<Expert>) => {
    isLoading.value = true
    error.value = null
    try {
      const newExpert = await expertApi.createExpert(data)
      experts.value.push(newExpert)
      return newExpert
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create expert'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 更新专家
  const updateExpert = async (id: string, data: Partial<Expert>) => {
    isLoading.value = true
    error.value = null
    try {
      await expertApi.updateExpert(id, data)
      // 重新加载所有专家列表以获取最新数据
      await loadExperts({})
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update expert'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 删除专家
  const deleteExpert = async (id: string) => {
    isLoading.value = true
    error.value = null
    try {
      await expertApi.deleteExpert(id)
      experts.value = experts.value.filter(e => e.id !== id)
      // 如果删除的是当前选中的专家，清空选择
      if (currentExpertId.value === id) {
        currentExpertId.value = null
        localStorage.removeItem('current_expert_id')
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete expert'
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
    experts,
    currentExpertId,
    isLoading,
    error,

    // Getters
    currentExpert,
    activeExperts,

    // Actions
    loadExperts,
    loadExpert,
    setCurrentExpert,
    restoreCurrentExpert,
    getExpertById,
    createExpert,
    updateExpert,
    deleteExpert,
    clearError,
  }
})
