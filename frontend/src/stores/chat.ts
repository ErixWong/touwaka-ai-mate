import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { messageApi, topicApi } from '@/api/services'
import type { Message, MessageStatus, Topic } from '@/types'

/**
 * Chat Store
 *
 * 核心设计：
 * - 消息按 expert + user 组织，不是按 topic 组织
 * - topic 只是对对话历史的阶段性总结，不是消息的容器
 * - 一个 expert 对一个 user 只有一个连续的对话 session
 *
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 */

export const useChatStore = defineStore('chat', () => {
  // State
  const currentExpertId = ref<string | null>(null)
  const messages = ref<Message[]>([])
  const topics = ref<Topic[]>([])
  const currentTopicId = ref<string | null>(null)
  const isLoading = ref(false)
  const isLoadingMore = ref(false)
  const isLoadingTopics = ref(false)
  const hasMoreMessages = ref(true)
  const currentPage = ref(1)
  const error = ref<string | null>(null)

  // Getters
  const sortedMessages = computed(() =>
    [...messages.value].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
  )

  // Actions

  /**
   * 加载指定 expert 与当前用户的对话历史
   * 这是主要的加载方法，替代原来的 loadMessages(topic_id)
   */
  const loadMessagesByExpert = async (expert_id: string, page: number = 1, limit: number = 50) => {
    if (page === 1) {
      isLoading.value = true
      messages.value = []
      currentExpertId.value = expert_id
    } else {
      isLoadingMore.value = true
    }
    error.value = null

    try {
      const response = await messageApi.getMessagesByExpert(expert_id, { page, limit })
      const items = response.items || []
      
      if (page === 1) {
        messages.value = items
      } else {
        // 加载更多历史消息，插入到前面
        messages.value = [...items, ...messages.value]
      }
      
      hasMoreMessages.value = items.length === limit
      currentPage.value = page
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load messages'
      throw err
    } finally {
      isLoading.value = false
      isLoadingMore.value = false
    }
  }

  /**
   * 加载更多历史消息
   */
  const loadMoreMessages = async () => {
    if (!currentExpertId.value || isLoadingMore.value || !hasMoreMessages.value) return
    await loadMessagesByExpert(currentExpertId.value, currentPage.value + 1)
  }

  /**
   * 设置当前 expert 并加载消息
   */
  const setCurrentExpert = async (expert_id: string | null) => {
    if (currentExpertId.value === expert_id) return
    
    currentExpertId.value = expert_id
    messages.value = []
    currentPage.value = 1
    hasMoreMessages.value = true
    
    if (expert_id) {
      await loadMessagesByExpert(expert_id, 1)
    }
  }

  /**
   * 添加本地消息（用于 SSE 流式显示）
   */
  let messageCounter = 0
  const addLocalMessage = (message: Partial<Message>) => {
    const newMessage: Message = {
      id: message.id || `temp-${Date.now()}-${++messageCounter}`,
      expert_id: message.expert_id || currentExpertId.value || '',
      user_id: message.user_id || '',
      topic_id: message.topic_id,
      role: message.role || 'assistant',
      content: message.content || '',
      status: message.status || 'streaming',
      metadata: message.metadata,
      created_at: message.created_at || new Date().toISOString(),
      updated_at: message.updated_at || new Date().toISOString(),
    }
    messages.value.push(newMessage)
    return newMessage
  }

  /**
   * 更新消息内容（用于 SSE）
   */
  const updateMessageContent = (messageId: string, content: string, status?: MessageStatus) => {
    const message = messages.value.find(m => m.id === messageId)
    if (message) {
      message.content = content
      if (status) {
        message.status = status
      }
      message.updated_at = new Date().toISOString()
    }
  }

  /**
   * 更新消息元数据
   */
  const updateMessageMetadata = (messageId: string, metadata: Message['metadata']) => {
    const message = messages.value.find(m => m.id === messageId)
    if (message) {
      message.metadata = { ...message.metadata, ...metadata }
    }
  }

  /**
   * 删除消息（用于重试）
   */
  const removeMessage = (messageId: string) => {
    const index = messages.value.findIndex(m => m.id === messageId)
    if (index >= 0) {
      messages.value.splice(index, 1)
    }
  }

  /**
   * 清除当前对话
   */
  const clearChat = () => {
    currentExpertId.value = null
    messages.value = []
    currentPage.value = 1
    hasMoreMessages.value = true
    error.value = null
  }

  /**
   * 清除错误
   */
  const clearError = () => {
    error.value = null
  }

  // ==================== Topics 相关 ====================

  /**
   * 加载话题列表（按当前 expert 过滤）
   */
  const loadTopics = async (params?: { page?: number; size?: number; search?: string; status?: string; expert_id?: string }) => {
    isLoadingTopics.value = true
    error.value = null
    try {
      // 如果没有传入 expert_id，使用当前的 expertId
      const filterExpertId = params?.expert_id || currentExpertId.value || undefined
      const response = await topicApi.getTopics({ ...params, expert_id: filterExpertId })
      topics.value = response.items || []
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load topics'
      throw err
    } finally {
      isLoadingTopics.value = false
    }
  }

  /**
   * 设置当前话题
   */
  const setCurrentTopic = (topicId: string | null) => {
    currentTopicId.value = topicId
  }

  /**
   * 更新话题
   */
  const updateTopic = async (topicId: string, data: Partial<Topic>) => {
    const updated = await topicApi.updateTopic(topicId, data)
    const index = topics.value.findIndex(t => t.id === topicId)
    if (index !== -1) {
      topics.value[index] = updated
    }
    return updated
  }

  /**
   * 删除话题
   */
  const deleteTopic = async (topicId: string) => {
    await topicApi.deleteTopic(topicId)
    topics.value = topics.value.filter(t => t.id !== topicId)
  }

  /**
   * 话题分页状态
   */
  const topicPage = ref(1)
  const hasMoreTopics = ref(true)

  /**
   * 加载下一页话题
   */
  const loadNextPage = async () => {
    if (!hasMoreTopics.value || isLoadingTopics.value) return
    topicPage.value += 1
    const response = await loadTopics({ page: topicPage.value })
    hasMoreTopics.value = (response?.items?.length || 0) > 0
  }

  /**
   * 获取当前话题
   */
  const currentTopic = computed(() =>
    topics.value.find(t => t.id === currentTopicId.value) || null
  )

  return {
    // State
    currentExpertId,
    messages,
    topics,
    currentTopicId,
    isLoading,
    isLoadingMore,
    isLoadingTopics,
    hasMoreMessages,
    hasMoreTopics,
    error,

    // Getters
    sortedMessages,
    currentTopic,

    // Actions
    loadMessagesByExpert,
    loadMoreMessages,
    setCurrentExpert,
    addLocalMessage,
    updateMessageContent,
    updateMessageMetadata,
    removeMessage,
    clearChat,
    clearError,
    loadTopics,
    setCurrentTopic,
    updateTopic,
    deleteTopic,
    loadNextPage,
  }
})
