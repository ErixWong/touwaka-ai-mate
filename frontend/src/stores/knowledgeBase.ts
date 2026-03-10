import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { knowledgeBaseApi } from '@/api/services'
import type {
  KnowledgeBase,
  KbArticle,
  KbSection,
  KbParagraph,
  KbTag,
  CreateKnowledgeBaseRequest,
  UpdateKnowledgeBaseRequest,
  CreateKbArticleRequest,
  UpdateKbArticleRequest,
  CreateKbSectionRequest,
  UpdateKbSectionRequest,
  MoveKbSectionRequest,
  CreateKbParagraphRequest,
  UpdateKbParagraphRequest,
  MoveKbParagraphRequest,
  CreateKbTagRequest,
  UpdateKbTagRequest,
  KbSearchResult,
} from '@/types'

/**
 * KnowledgeBase Store
 *
 * 知识库状态管理（重构后）
 * - 管理用户的知识库列表
 * - 当前选中的知识库
 * - 文章、章节、段落管理
 * - 标签管理
 * - 搜索功能
 */
export const useKnowledgeBaseStore = defineStore('knowledgeBase', () => {
  // ========== State ==========

  // 知识库列表
  const knowledgeBases = ref<KnowledgeBase[]>([])
  const currentKb = ref<KnowledgeBase | null>(null)

  // 文章
  const articles = ref<KbArticle[]>([])
  const currentArticle = ref<KbArticle | null>(null)

  // 章节树
  const sectionTree = ref<KbSection[]>([])
  const currentSection = ref<KbSection | null>(null)

  // 段落
  const paragraphs = ref<KbParagraph[]>([])
  const currentParagraph = ref<KbParagraph | null>(null)

  // 标签
  const tags = ref<KbTag[]>([])

  // 搜索结果
  const searchResults = ref<KbSearchResult[]>([])

  // 状态
  const isLoading = ref(false)
  const isLoadingArticles = ref(false)
  const isLoadingSections = ref(false)
  const isLoadingParagraphs = ref(false)
  const isSearching = ref(false)
  const error = ref<string | null>(null)

  // ========== Getters ==========

  const totalParagraphCount = computed(() =>
    knowledgeBases.value.reduce((sum, kb) => sum + (kb.paragraph_count || 0), 0)
  )

  const hasCurrentKb = computed(() => currentKb.value !== null)

  const hasCurrentArticle = computed(() => currentArticle.value !== null)

  // ========== Actions - 知识库管理 ==========

  /**
   * 加载知识库列表
   */
  const loadKnowledgeBases = async (params?: { page?: number; pageSize?: number; limit?: number }) => {
    isLoading.value = true
    error.value = null
    try {
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
    articles.value = []
    currentArticle.value = null
    sectionTree.value = []
    currentSection.value = null
    paragraphs.value = []
    currentParagraph.value = null
    tags.value = []
  }

  // ========== Actions - 文章管理 ==========

  /**
   * 加载文章列表
   * @param kbId 知识库ID
   * @param params 查询参数，支持 page, pageSize, tag_ids
   */
  const loadArticles = async (kbId: string, params?: { page?: number; pageSize?: number; tag_ids?: string[] }) => {
    isLoadingArticles.value = true
    error.value = null
    try {
      const response = await knowledgeBaseApi.getArticles(kbId, params)
      articles.value = response.items || []
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load articles'
      throw err
    } finally {
      isLoadingArticles.value = false
    }
  }

  /**
   * 加载文章详情（含章节树）
   */
  const loadArticle = async (kbId: string, articleId: string) => {
    isLoading.value = true
    error.value = null
    try {
      const result = await knowledgeBaseApi.getArticleTree(kbId, articleId)
      currentArticle.value = result.article
      sectionTree.value = result.tree || []
      return result
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load article'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 创建文章
   */
  const createArticle = async (kbId: string, data: CreateKbArticleRequest) => {
    isLoading.value = true
    error.value = null
    try {
      const article = await knowledgeBaseApi.createArticle(kbId, data)
      articles.value.unshift(article)
      return article
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create article'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 更新文章
   */
  const updateArticle = async (kbId: string, articleId: string, data: UpdateKbArticleRequest) => {
    error.value = null
    try {
      const updated = await knowledgeBaseApi.updateArticle(kbId, articleId, data)
      const index = articles.value.findIndex(a => a.id === articleId)
      if (index !== -1) {
        articles.value[index] = updated
      }
      if (currentArticle.value?.id === articleId) {
        currentArticle.value = updated
      }
      return updated
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update article'
      throw err
    }
  }

  /**
   * 删除文章
   */
  const deleteArticle = async (kbId: string, articleId: string) => {
    error.value = null
    try {
      await knowledgeBaseApi.deleteArticle(kbId, articleId)
      articles.value = articles.value.filter(a => a.id !== articleId)
      if (currentArticle.value?.id === articleId) {
        currentArticle.value = null
        sectionTree.value = []
        paragraphs.value = []
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete article'
      throw err
    }
  }

  // ========== Actions - 章节管理 ==========

  /**
   * 加载章节树
   */
  const loadSectionTree = async (kbId: string, articleId: string) => {
    isLoadingSections.value = true
    error.value = null
    try {
      const result = await knowledgeBaseApi.getArticleTree(kbId, articleId)
      sectionTree.value = result.tree || []
      return result.tree
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load section tree'
      throw err
    } finally {
      isLoadingSections.value = false
    }
  }

  /**
   * 创建章节
   */
  const createSection = async (kbId: string, data: CreateKbSectionRequest) => {
    isLoading.value = true
    error.value = null
    try {
      const section = await knowledgeBaseApi.createSection(kbId, data)
      // 刷新章节树
      if (currentArticle.value) {
        await loadSectionTree(kbId, data.article_id)
      }
      return section
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create section'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 更新章节
   */
  const updateSection = async (kbId: string, sectionId: string, data: UpdateKbSectionRequest) => {
    error.value = null
    try {
      const updated = await knowledgeBaseApi.updateSection(kbId, sectionId, data)
      if (currentSection.value?.id === sectionId) {
        currentSection.value = updated
      }
      return updated
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update section'
      throw err
    }
  }

  /**
   * 删除章节
   */
  const deleteSection = async (kbId: string, sectionId: string) => {
    error.value = null
    try {
      await knowledgeBaseApi.deleteSection(kbId, sectionId)
      if (currentSection.value?.id === sectionId) {
        currentSection.value = null
        paragraphs.value = []
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete section'
      throw err
    }
  }

  /**
   * 移动章节（上移/下移）
   */
  const moveSection = async (kbId: string, sectionId: string, direction: 'up' | 'down') => {
    error.value = null
    try {
      const result = await knowledgeBaseApi.moveSection(kbId, sectionId, { direction })
      return result
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to move section'
      throw err
    }
  }

  // ========== Actions - 段落管理 ==========

  /**
   * 加载段落列表
   */
  const loadParagraphs = async (kbId: string, sectionId: string, params?: { page?: number; pageSize?: number }) => {
    isLoadingParagraphs.value = true
    error.value = null
    try {
      const response = await knowledgeBaseApi.queryParagraphs(kbId, {
        section_id: sectionId,
        pagination: params,
      })
      paragraphs.value = response.items || []
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load paragraphs'
      throw err
    } finally {
      isLoadingParagraphs.value = false
    }
  }

  /**
   * 创建段落
   */
  const createParagraph = async (kbId: string, data: CreateKbParagraphRequest) => {
    isLoading.value = true
    error.value = null
    try {
      const paragraph = await knowledgeBaseApi.createParagraph(kbId, data)
      paragraphs.value.push(paragraph)
      return paragraph
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create paragraph'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 更新段落
   */
  const updateParagraph = async (kbId: string, paragraphId: string, data: UpdateKbParagraphRequest) => {
    error.value = null
    try {
      const updated = await knowledgeBaseApi.updateParagraph(kbId, paragraphId, data)
      const index = paragraphs.value.findIndex(p => p.id === paragraphId)
      if (index !== -1) {
        paragraphs.value[index] = updated
      }
      if (currentParagraph.value?.id === paragraphId) {
        currentParagraph.value = updated
      }
      return updated
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update paragraph'
      throw err
    }
  }

  /**
   * 删除段落
   */
  const deleteParagraph = async (kbId: string, paragraphId: string) => {
    error.value = null
    try {
      await knowledgeBaseApi.deleteParagraph(kbId, paragraphId)
      paragraphs.value = paragraphs.value.filter(p => p.id !== paragraphId)
      if (currentParagraph.value?.id === paragraphId) {
        currentParagraph.value = null
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete paragraph'
      throw err
    }
  }

  /**
   * 移动段落（上移/下移）
   */
  const moveParagraph = async (kbId: string, paragraphId: string, direction: 'up' | 'down') => {
    error.value = null
    try {
      const result = await knowledgeBaseApi.moveParagraph(kbId, paragraphId, { direction })
      return result
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to move paragraph'
      throw err
    }
  }

  // ========== Actions - 标签管理 ==========

  /**
   * 加载标签列表
   */
  const loadTags = async (kbId: string) => {
    error.value = null
    try {
      const response = await knowledgeBaseApi.getTags(kbId)
      tags.value = response.items || []
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load tags'
      throw err
    }
  }

  /**
   * 创建标签
   */
  const createTag = async (kbId: string, data: CreateKbTagRequest) => {
    isLoading.value = true
    error.value = null
    try {
      const tag = await knowledgeBaseApi.createTag(kbId, data)
      tags.value.push(tag)
      return tag
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create tag'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 更新标签
   */
  const updateTag = async (kbId: string, tagId: string, data: UpdateKbTagRequest) => {
    error.value = null
    try {
      const updated = await knowledgeBaseApi.updateTag(kbId, tagId, data)
      const index = tags.value.findIndex(t => t.id === tagId)
      if (index !== -1) {
        tags.value[index] = updated
      }
      return updated
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update tag'
      throw err
    }
  }

  /**
   * 删除标签
   */
  const deleteTag = async (kbId: string, tagId: string) => {
    error.value = null
    try {
      await knowledgeBaseApi.deleteTag(kbId, tagId)
      tags.value = tags.value.filter(t => t.id !== tagId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete tag'
      throw err
    }
  }

  // ========== Actions - 搜索 ==========

  /**
   * 语义搜索（单个知识库内）
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
    articles,
    currentArticle,
    sectionTree,
    currentSection,
    paragraphs,
    currentParagraph,
    tags,
    searchResults,
    isLoading,
    isLoadingArticles,
    isLoadingSections,
    isLoadingParagraphs,
    isSearching,
    error,

    // Getters
    totalParagraphCount,
    hasCurrentKb,
    hasCurrentArticle,

    // Actions - 知识库管理
    loadKnowledgeBases,
    loadKnowledgeBase,
    createKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
    clearCurrentKb,

    // Actions - 文章管理
    loadArticles,
    loadArticle,
    createArticle,
    updateArticle,
    deleteArticle,

    // Actions - 章节管理
    loadSectionTree,
    createSection,
    updateSection,
    deleteSection,
    moveSection,

    // Actions - 段落管理
    loadParagraphs,
    createParagraph,
    updateParagraph,
    deleteParagraph,
    moveParagraph,

    // Actions - 标签管理
    loadTags,
    createTag,
    updateTag,
    deleteTag,

    // Actions - 搜索
    search,
    globalSearch,
    clearSearchResults,

    // Utilities
    clearError,
  }
})
