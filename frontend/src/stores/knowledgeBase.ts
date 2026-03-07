import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { knowledgeBaseApi } from '@/api/services'
import type {
  KnowledgeBase,
  Knowledge,
  KnowledgePoint,
  CreateKnowledgeBaseRequest,
  UpdateKnowledgeBaseRequest,
  CreateKnowledgeRequest,
  UpdateKnowledgeRequest,
  CreateKnowledgePointRequest,
  UpdateKnowledgePointRequest,
  KnowledgeSearchResult,
} from '@/types'

/**
 * KnowledgeBase Store
 *
 * 知识库状态管理
 * - 管理用户的知识库列表
 * - 当前选中的知识库
 * - 文章树和知识点
 * - 搜索功能
 */
export const useKnowledgeBaseStore = defineStore('knowledgeBase', () => {
  // ========== State ==========

  // 知识库列表
  const knowledgeBases = ref<KnowledgeBase[]>([])
  const currentKb = ref<KnowledgeBase | null>(null)

  // 文章树
  const knowledgeTree = ref<Knowledge[]>([])
  const currentKnowledge = ref<Knowledge | null>(null)

  // 知识点
  const currentPoints = ref<KnowledgePoint[]>([])
  const currentPoint = ref<KnowledgePoint | null>(null)

  // 搜索结果
  const searchResults = ref<KnowledgeSearchResult[]>([])

  // 状态
  const isLoading = ref(false)
  const isLoadingTree = ref(false)
  const isLoadingPoints = ref(false)
  const isSearching = ref(false)
  const error = ref<string | null>(null)

  // ========== Getters ==========

  const totalPointCount = computed(() =>
    knowledgeBases.value.reduce((sum, kb) => sum + (kb.point_count || 0), 0)
  )

  const hasCurrentKb = computed(() => currentKb.value !== null)

  // ========== Actions - 知识库管理 ==========

  /**
   * 加载知识库列表
   */
  const loadKnowledgeBases = async (params?: { page?: number; pageSize?: number; limit?: number }) => {
    isLoading.value = true
    error.value = null
    try {
      // 统一使用 pageSize 参数
      const apiParams = {
        page: params?.page,
        pageSize: params?.pageSize || params?.limit,
      }
      const response = await knowledgeBaseApi.getKnowledgeBases(apiParams)
      knowledgeBases.value = response.items || []
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load knowledge bases'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 加载知识库详情
   */
  const loadKnowledgeBase = async (id: string) => {
    isLoading.value = true
    error.value = null
    try {
      const kb = await knowledgeBaseApi.getKnowledgeBase(id)
      currentKb.value = kb
      return kb
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load knowledge base'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 创建知识库
   */
  const createKnowledgeBase = async (data: CreateKnowledgeBaseRequest) => {
    isLoading.value = true
    error.value = null
    try {
      const kb = await knowledgeBaseApi.createKnowledgeBase(data)
      knowledgeBases.value.unshift(kb)
      return kb
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create knowledge base'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 更新知识库
   */
  const updateKnowledgeBase = async (id: string, data: UpdateKnowledgeBaseRequest) => {
    error.value = null
    try {
      const updated = await knowledgeBaseApi.updateKnowledgeBase(id, data)
      const index = knowledgeBases.value.findIndex(kb => kb.id === id)
      if (index !== -1) {
        knowledgeBases.value[index] = updated
      }
      if (currentKb.value?.id === id) {
        currentKb.value = updated
      }
      return updated
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update knowledge base'
      throw err
    }
  }

  /**
   * 删除知识库
   */
  const deleteKnowledgeBase = async (id: string) => {
    error.value = null
    try {
      await knowledgeBaseApi.deleteKnowledgeBase(id)
      knowledgeBases.value = knowledgeBases.value.filter(kb => kb.id !== id)
      if (currentKb.value?.id === id) {
        clearCurrentKb()
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete knowledge base'
      throw err
    }
  }

  /**
   * 清除当前知识库状态
   */
  const clearCurrentKb = () => {
    currentKb.value = null
    knowledgeTree.value = []
    currentKnowledge.value = null
    currentPoints.value = []
    currentPoint.value = null
  }

  // ========== Actions - 文章管理 ==========

  /**
   * 加载文章树
   */
  const loadKnowledgeTree = async (kbId: string) => {
    isLoadingTree.value = true
    error.value = null
    try {
      const tree = await knowledgeBaseApi.getKnowledgeTree(kbId)
      knowledgeTree.value = tree
      return tree
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load knowledge tree'
      throw err
    } finally {
      isLoadingTree.value = false
    }
  }

  /**
   * 加载文章详情
   */
  const loadKnowledge = async (kbId: string, knowledgeId: string) => {
    isLoading.value = true
    error.value = null
    try {
      const knowledge = await knowledgeBaseApi.getKnowledge(kbId, knowledgeId)
      currentKnowledge.value = knowledge
      // 同时加载知识点列表
      await loadKnowledgePoints(kbId, knowledgeId)
      return knowledge
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load knowledge'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 创建文章
   */
  const createKnowledge = async (kbId: string, data: CreateKnowledgeRequest) => {
    isLoading.value = true
    error.value = null
    try {
      const knowledge = await knowledgeBaseApi.createKnowledge(kbId, data)
      // 刷新文章树
      await loadKnowledgeTree(kbId)
      return knowledge
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create knowledge'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 更新文章
   */
  const updateKnowledge = async (kbId: string, knowledgeId: string, data: UpdateKnowledgeRequest) => {
    error.value = null
    try {
      const updated = await knowledgeBaseApi.updateKnowledge(kbId, knowledgeId, data)
      if (currentKnowledge.value?.id === knowledgeId) {
        currentKnowledge.value = updated
      }
      // 刷新文章树
      await loadKnowledgeTree(kbId)
      return updated
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update knowledge'
      throw err
    }
  }

  /**
   * 删除文章
   */
  const deleteKnowledge = async (kbId: string, knowledgeId: string) => {
    error.value = null
    try {
      await knowledgeBaseApi.deleteKnowledge(kbId, knowledgeId)
      if (currentKnowledge.value?.id === knowledgeId) {
        currentKnowledge.value = null
        currentPoints.value = []
      }
      // 刷新文章树
      await loadKnowledgeTree(kbId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete knowledge'
      throw err
    }
  }

  // ========== Actions - 知识点管理 ==========

  /**
   * 加载知识点列表
   */
  const loadKnowledgePoints = async (kbId: string, knowledgeId: string) => {
    isLoadingPoints.value = true
    error.value = null
    try {
      const response = await knowledgeBaseApi.getKnowledgePoints(kbId, knowledgeId)
      currentPoints.value = response.items || []
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load knowledge points'
      throw err
    } finally {
      isLoadingPoints.value = false
    }
  }

  /**
   * 加载知识点详情
   */
  const loadKnowledgePoint = async (kbId: string, knowledgeId: string, pointId: string) => {
    isLoading.value = true
    error.value = null
    try {
      const point = await knowledgeBaseApi.getKnowledgePoint(kbId, knowledgeId, pointId)
      currentPoint.value = point
      return point
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load knowledge point'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 创建知识点
   */
  const createKnowledgePoint = async (kbId: string, knowledgeId: string, data: CreateKnowledgePointRequest) => {
    isLoading.value = true
    error.value = null
    try {
      const point = await knowledgeBaseApi.createKnowledgePoint(kbId, knowledgeId, data)
      currentPoints.value.push(point)
      return point
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create knowledge point'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 更新知识点
   */
  const updateKnowledgePoint = async (kbId: string, knowledgeId: string, pointId: string, data: UpdateKnowledgePointRequest) => {
    error.value = null
    try {
      const updated = await knowledgeBaseApi.updateKnowledgePoint(kbId, knowledgeId, pointId, data)
      const index = currentPoints.value.findIndex(p => p.id === pointId)
      if (index !== -1) {
        currentPoints.value[index] = updated
      }
      if (currentPoint.value?.id === pointId) {
        currentPoint.value = updated
      }
      return updated
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update knowledge point'
      throw err
    }
  }

  /**
   * 删除知识点
   */
  const deleteKnowledgePoint = async (kbId: string, knowledgeId: string, pointId: string) => {
    error.value = null
    try {
      await knowledgeBaseApi.deleteKnowledgePoint(kbId, knowledgeId, pointId)
      currentPoints.value = currentPoints.value.filter(p => p.id !== pointId)
      if (currentPoint.value?.id === pointId) {
        currentPoint.value = null
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete knowledge point'
      throw err
    }
  }

  // ========== Actions - 搜索 ==========

  /**
   * 语义搜索（单个知识库内）
   * 注意：默认阈值设为 0.1，因为 all-MiniLM-L6-v2 的相似度通常在 0.1-0.5 之间
   */
  const search = async (kbId: string, query: string, topK = 5, threshold = 0.1) => {
    isSearching.value = true
    error.value = null
    try {
      const results = await knowledgeBaseApi.search(kbId, {
        query,
        kb_id: kbId,
        top_k: topK,
        threshold,
      })
      searchResults.value = results
      return results
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Search failed'
      throw err
    } finally {
      isSearching.value = false
    }
  }

  /**
   * 全局语义搜索（跨所有知识库）
   * 注意：默认阈值设为 0.1，因为 all-MiniLM-L6-v2 的相似度通常在 0.1-0.5 之间
   */
  const globalSearch = async (query: string, topK = 10, threshold = 0.1) => {
    isSearching.value = true
    error.value = null
    try {
      const results = await knowledgeBaseApi.globalSearch({
        query,
        top_k: topK,
        threshold,
      })
      searchResults.value = results
      return results
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Global search failed'
      throw err
    } finally {
      isSearching.value = false
    }
  }

  /**
   * 清除搜索结果
   */
  const clearSearchResults = () => {
    searchResults.value = []
  }

  /**
   * 清除错误
   */
  const clearError = () => {
    error.value = null
  }

  return {
    // State
    knowledgeBases,
    currentKb,
    knowledgeTree,
    currentKnowledge,
    currentPoints,
    currentPoint,
    searchResults,
    isLoading,
    isLoadingTree,
    isLoadingPoints,
    isSearching,
    error,

    // Getters
    totalPointCount,
    hasCurrentKb,

    // Actions - 知识库管理
    loadKnowledgeBases,
    loadKnowledgeBase,
    createKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
    clearCurrentKb,

    // Actions - 文章管理
    loadKnowledgeTree,
    loadKnowledge,
    createKnowledge,
    updateKnowledge,
    deleteKnowledge,

    // Actions - 知识点管理
    loadKnowledgePoints,
    loadKnowledgePoint,
    createKnowledgePoint,
    updateKnowledgePoint,
    deleteKnowledgePoint,

    // Actions - 搜索
    search,
    globalSearch,
    clearSearchResults,

    // Utilities
    clearError,
  }
})
