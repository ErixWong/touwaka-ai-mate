import { ref, computed, reactive } from 'vue'
import { defineStore } from 'pinia'
import { messageApi, topicApi } from '@/api/services'
import type { Message, MessageStatus, Topic } from '@/types'

export const useChatStore = defineStore('chat', () => {
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

  const messageById = reactive<Map<string, Message>>(new Map())
  const requestToAssistantMessageId = reactive<Map<string, string>>(new Map())
  const requestToUserMessageId = reactive<Map<string, string>>(new Map())
  const userMessageForAssistant = reactive<Map<string, string>>(new Map())
  const manuallyStoppedRequestIds = reactive<Set<string>>(new Set())
  const currentStreamingMessageId = ref<string | null>(null)
  const currentExpertGeneration = ref(0)

  const sortedMessages = computed(() => messages.value)

  const compareMessages = (a: Pick<Message, 'created_at' | 'id'>, b: Pick<Message, 'created_at' | 'id'>) => {
    const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    if (timeDiff !== 0) return timeDiff
    return a.id.localeCompare(b.id)
  }

  const indexMessage = (message: Message) => {
    messageById.set(message.id, message)
    if (message.request_id) {
      if (message.role === 'assistant') {
        requestToAssistantMessageId.set(message.request_id, message.id)
      } else if (message.role === 'user') {
        requestToUserMessageId.set(message.request_id, message.id)
      }
    }
  }

  const unindexMessage = (messageId: string) => {
    const msg = messageById.get(messageId)
    messageById.delete(messageId)
    if (msg?.request_id) {
      if (msg.role === 'assistant') {
        const mappedId = requestToAssistantMessageId.get(msg.request_id)
        if (mappedId === messageId) {
          requestToAssistantMessageId.delete(msg.request_id)
        }
      } else if (msg.role === 'user') {
        const mappedId = requestToUserMessageId.get(msg.request_id)
        if (mappedId === messageId) {
          requestToUserMessageId.delete(msg.request_id)
        }
      }
    }
  }

  const rebuildIndexes = () => {
    messageById.clear()
    requestToAssistantMessageId.clear()
    requestToUserMessageId.clear()
    userMessageForAssistant.clear()
    for (let i = 0; i < messages.value.length; i++) {
      const msg = messages.value[i]
      if (!msg) continue
      indexMessage(msg)
      if (msg.role === 'user' && i + 1 < messages.value.length) {
        const next = messages.value[i + 1]
        if (next?.role === 'assistant') {
          userMessageForAssistant.set(next.id, msg.id)
        }
      }
    }
  }

  const getMessageById = (id: string): Message | undefined => {
    return messageById.get(id)
  }

  const getAssistantMessageByRequestId = (requestId: string): Message | undefined => {
    const msgId = requestToAssistantMessageId.get(requestId)
    if (msgId) return messageById.get(msgId)
    return undefined
  }

  const getUserMessageByRequestId = (requestId: string): Message | undefined => {
    const msgId = requestToUserMessageId.get(requestId)
    if (msgId) return messageById.get(msgId)
    return undefined
  }

  const getStreamingAssistant = (): Message | undefined => {
    if (currentStreamingMessageId.value) {
      const msg = messageById.get(currentStreamingMessageId.value)
      if (msg && msg.status === 'streaming') return msg
      currentStreamingMessageId.value = null
    }
    return messages.value.find(m => m.role === 'assistant' && m.status === 'streaming')
  }

  const isServerMessage = (message: Pick<Message, 'id'>) => {
    return !!message.id && !message.id.startsWith('temp-')
  }

  const getLatestServerMessageId = (): string | null => {
    const serverMessages = messages.value.filter(isServerMessage)
    if (serverMessages.length === 0) return null
    const sortedServerMessages = [...serverMessages].sort(compareMessages)
    return sortedServerMessages[sortedServerMessages.length - 1]?.id || null
  }

  const setCurrentStreaming = (messageId: string | null) => {
    currentStreamingMessageId.value = messageId
  }

  const markRequestManuallyStopped = (requestId: string) => {
    manuallyStoppedRequestIds.add(requestId)
  }

  const clearManuallyStoppedRequest = (requestId: string) => {
    manuallyStoppedRequestIds.delete(requestId)
  }

  const isRequestManuallyStopped = (requestId?: string | null) => {
    return !!requestId && manuallyStoppedRequestIds.has(requestId)
  }

  const insertMessageSorted = (message: Message) => {
    let finalIndex: number

    if (messages.value.length === 0) {
      messages.value.push(message)
      finalIndex = 0
      indexMessage(message)
    } else {
      const lastMessage = messages.value[messages.value.length - 1]
      if (lastMessage && compareMessages(lastMessage, message) <= 0) {
        messages.value.push(message)
        finalIndex = messages.value.length - 1
        indexMessage(message)
      } else {
        const insertIndex = messages.value.findIndex(existing => compareMessages(message, existing) < 0)
        if (insertIndex === -1) {
          messages.value.push(message)
          finalIndex = messages.value.length - 1
        } else {
          messages.value.splice(insertIndex, 0, message)
          finalIndex = insertIndex
        }
        indexMessage(message)
      }
    }

    if (message.role === 'assistant' && finalIndex > 0) {
      const prev = messages.value[finalIndex - 1]
      if (prev?.role === 'user') {
        userMessageForAssistant.set(message.id, prev.id)
      }
    }
    if (message.role === 'user' && finalIndex + 1 < messages.value.length) {
      const next = messages.value[finalIndex + 1]
      if (next?.role === 'assistant') {
        userMessageForAssistant.set(next.id, message.id)
      }
    }
  }

  const loadMessagesByExpert = async (expert_id: string, page: number = 1, size: number = 30) => {
    const generation = page === 1
      ? currentExpertGeneration.value + 1
      : currentExpertGeneration.value

    if (page === 1) {
      const hasStreamingMessage = messages.value.some(m => m.status === 'streaming')
      if (hasStreamingMessage) {
        return
      }

      currentExpertGeneration.value = generation
      isLoading.value = true
      messages.value = []
      messageById.clear()
      requestToAssistantMessageId.clear()
      requestToUserMessageId.clear()
      userMessageForAssistant.clear()
      currentExpertId.value = expert_id
    } else {
      isLoadingMore.value = true
    }
    error.value = null

    try {
      const response = await messageApi.getMessagesByExpert(expert_id, { page, size })
      if (currentExpertId.value !== expert_id || currentExpertGeneration.value !== generation) {
        return
      }

      const items = response.items || []

      if (page === 1) {
        messages.value = [...items].sort(compareMessages)
      } else {
        messages.value = [...items, ...messages.value].sort(compareMessages)
      }
      rebuildIndexes()

      hasMoreMessages.value = items.length === size
      currentPage.value = page
    } catch (err) {
      if (currentExpertId.value === expert_id && currentExpertGeneration.value === generation) {
        error.value = err instanceof Error ? err.message : 'Failed to load messages'
      }
      throw err
    } finally {
      if (currentExpertId.value === expert_id && currentExpertGeneration.value === generation) {
        isLoading.value = false
        isLoadingMore.value = false
      }
    }
  }

  const loadMoreMessages = async () => {
    if (!currentExpertId.value || isLoadingMore.value || !hasMoreMessages.value) return
    await loadMessagesByExpert(currentExpertId.value, currentPage.value + 1)
  }

  const setCurrentExpert = async (expert_id: string | null) => {
    if (currentExpertId.value === expert_id) return

    currentExpertId.value = expert_id
    messages.value = []
    messageById.clear()
    requestToAssistantMessageId.clear()
    requestToUserMessageId.clear()
    userMessageForAssistant.clear()
    currentPage.value = 1
    hasMoreMessages.value = true
    currentExpertGeneration.value += 1

    if (expert_id) {
      await loadMessagesByExpert(expert_id, 1)
    }
  }

  let messageCounter = 0
  const addLocalMessage = (message: Partial<Message> & { images?: Array<{ url: string; name: string; base64?: string }> }) => {
    const messageId = message.id || `temp-${Date.now()}-${++messageCounter}`
    const existingIndex = messages.value.findIndex(m => m.id === messageId)

    let content = message.content || ''
    if (message.images && message.images.length > 0) {
      const multimodalContent = []

      if (content) {
        multimodalContent.push({ type: 'text', text: content })
      }

      for (const img of message.images) {
        const imageUrl = img.base64 || img.url
        multimodalContent.push({
          type: 'image_url',
          image_url: { url: imageUrl }
        })
      }

      content = JSON.stringify({ type: 'multimodal', content: multimodalContent })
    }

    if (existingIndex >= 0) {
      const existing = messages.value[existingIndex]
      if (existing) {
        unindexMessage(existing.id)
        existing.content = content || existing.content
        existing.status = message.status || existing.status
        existing.updated_at = new Date().toISOString()
        indexMessage(existing)
        return existing
      }
    }

    const newMessage: Message = {
      id: messageId,
      request_id: message.request_id,
      expert_id: message.expert_id || currentExpertId.value || '',
      user_id: message.user_id || '',
      topic_id: message.topic_id,
      role: message.role || 'assistant',
      content: content,
      status: message.status || 'streaming',
      metadata: message.metadata,
      created_at: message.created_at || new Date().toISOString(),
      updated_at: message.updated_at || new Date().toISOString(),
    }
    insertMessageSorted(newMessage)
    return newMessage
  }

  const updateMessageContent = (messageId: string, content: string, status?: MessageStatus) => {
    const index = messages.value.findIndex(m => m.id === messageId)
    if (index !== -1) {
      const message = messages.value[index]
      if (message) {
        const newMessage: Message = {
          ...message,
          content: content,
          status: status || message.status,
          updated_at: new Date().toISOString()
        }
        messages.value.splice(index, 1, newMessage)
        indexMessage(newMessage)
        if (newMessage.status !== 'streaming' && currentStreamingMessageId.value === messageId) {
          currentStreamingMessageId.value = null
        }
      }
    }
  }

  const updateMessageReasoningContent = (messageId: string, reasoningContent: string) => {
    const index = messages.value.findIndex(m => m.id === messageId)
    if (index !== -1) {
      const message = messages.value[index]
      if (message) {
        const newMessage: Message = {
          ...message,
          reasoning_content: reasoningContent,
          updated_at: new Date().toISOString()
        }
        messages.value.splice(index, 1, newMessage)
        indexMessage(newMessage)
      }
    }
  }

  const updateMessageMetadata = (messageId: string, metadata: Message['metadata']) => {
    const message = messageById.get(messageId)
    if (message) {
      message.metadata = { ...message.metadata, ...metadata }
    }
  }

  const updateMessageRequestId = (messageId: string, requestId: string) => {
    const index = messages.value.findIndex(m => m.id === messageId)
    if (index !== -1) {
      const message = messages.value[index]
      if (message) {
        unindexMessage(message.id)
        const newMessage: Message = {
          ...message,
          request_id: requestId,
          updated_at: new Date().toISOString(),
        }
        messages.value.splice(index, 1, newMessage)
        indexMessage(newMessage)
      }
    }
  }

  const findStreamingAssistantByRequestId = (requestId: string) => {
    const msgId = requestToAssistantMessageId.get(requestId)
    if (msgId) {
      const msg = messageById.get(msgId)
      if (msg && msg.role === 'assistant' && msg.status === 'streaming') return msg
    }
    return messages.value.find(
      m => m.role === 'assistant' && m.status === 'streaming' && m.request_id === requestId
    ) || null
  }

  const getPreviousUserMessage = (messageId: string): Message | undefined => {
    const assistant = messageById.get(messageId)
    if (assistant?.request_id) {
      const requestUser = getUserMessageByRequestId(assistant.request_id)
      if (requestUser) return requestUser
    }

    const userId = userMessageForAssistant.get(messageId)
    if (userId) return messageById.get(userId)
    const idx = messages.value.findIndex(m => m.id === messageId)
    if (idx === -1) return undefined
    for (let i = idx - 1; i >= 0; i--) {
      const msg = messages.value[i]
      if (msg?.role === 'user') return msg
    }
    return undefined
  }

  const replaceMessage = (messageId: string, nextMessage: Message) => {
    const index = messages.value.findIndex(m => m.id === messageId)
    if (index === -1) return

    const duplicateIndex = messages.value.findIndex((m, i) => i !== index && m.id === nextMessage.id)
    if (duplicateIndex !== -1) {
      unindexMessage(messages.value[duplicateIndex]!.id)
      messages.value.splice(duplicateIndex, 1)
    }

    unindexMessage(messageId)
    messages.value.splice(index, 1, nextMessage)
    indexMessage(nextMessage)
  }

  const mergeMessages = (incomingMessages: Message[]) => {
    for (const incoming of incomingMessages) {
      const index = messages.value.findIndex(m => m.id === incoming.id)
      if (index !== -1) {
        const current = messages.value[index]
        if (current) {
          unindexMessage(current.id)
          const merged: Message = {
            ...current,
            ...incoming,
            updated_at: incoming.updated_at || current.updated_at,
          }
          messages.value.splice(index, 1, merged)
          indexMessage(merged)
        }
        continue
      }

      const newMsg: Message = {
        ...incoming,
        status: incoming.status || 'completed',
      }
      insertMessageSorted(newMsg)
    }
  }

  const removeMessage = (messageId: string) => {
    const index = messages.value.findIndex(m => m.id === messageId)
    if (index >= 0) {
      unindexMessage(messageId)
      messages.value.splice(index, 1)
    }
    if (currentStreamingMessageId.value === messageId) {
      currentStreamingMessageId.value = null
    }
  }

  const clearChat = () => {
    currentExpertId.value = null
    messages.value = []
    messageById.clear()
    requestToAssistantMessageId.clear()
    requestToUserMessageId.clear()
    userMessageForAssistant.clear()
    currentStreamingMessageId.value = null
    currentExpertGeneration.value += 1
    currentPage.value = 1
    hasMoreMessages.value = true
    error.value = null
  }

  const clearError = () => {
    error.value = null
  }

  const topicsTotal = ref(0)
  const topicsPage = ref(1)
  const topicsPages = ref(1)
  const topicsPageSize = ref(10)

  const loadTopics = async (params?: { page?: number; size?: number; search?: string; status?: string; expert_id?: string }) => {
    isLoadingTopics.value = true
    error.value = null
    try {
      const filterExpertId = params?.expert_id || currentExpertId.value || undefined
      const page = params?.page || 1
      const size = params?.size || topicsPageSize.value
      const response = await topicApi.getTopics({ ...params, page, size, expert_id: filterExpertId })
      topics.value = response.items || []
      const pagination = response.pagination
      topicsTotal.value = pagination?.total || 0
      topicsPage.value = pagination.page || 1
      topicsPages.value = pagination.pages || 1
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load topics'
      throw err
    } finally {
      isLoadingTopics.value = false
    }
  }

  const setCurrentTopic = (topicId: string | null) => {
    currentTopicId.value = topicId
  }

  const updateTopic = async (topicId: string, data: Partial<Topic>) => {
    const updated = await topicApi.updateTopic(topicId, data)
    const index = topics.value.findIndex(t => t.id === topicId)
    if (index !== -1) {
      topics.value[index] = updated
    }
    return updated
  }

  const deleteTopic = async (topicId: string) => {
    await topicApi.deleteTopic(topicId)
    topics.value = topics.value.filter(t => t.id !== topicId)
  }

  const topicPage = ref(1)
  const hasMoreTopics = ref(true)

  const loadNextPage = async () => {
    if (!hasMoreTopics.value || isLoadingTopics.value) return
    topicPage.value += 1
    const response = await loadTopics({ page: topicPage.value })
    hasMoreTopics.value = (response?.items?.length || 0) > 0
  }

  const currentTopic = computed(() =>
    topics.value.find(t => t.id === currentTopicId.value) || null
  )

  return {
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
    topicsTotal,
    topicsPage,
    topicsPages,
    topicsPageSize,

    messageById,
    requestToAssistantMessageId,
    requestToUserMessageId,
    currentStreamingMessageId,

    sortedMessages,
    currentTopic,

    getMessageById,
    getAssistantMessageByRequestId,
    getUserMessageByRequestId,
    getStreamingAssistant,
    getLatestServerMessageId,
    setCurrentStreaming,
    markRequestManuallyStopped,
    clearManuallyStoppedRequest,
    isRequestManuallyStopped,

    loadMessagesByExpert,
    loadMoreMessages,
    setCurrentExpert,
    addLocalMessage,
    updateMessageContent,
    updateMessageReasoningContent,
    updateMessageMetadata,
    updateMessageRequestId,
    findStreamingAssistantByRequestId,
    getPreviousUserMessage,
    replaceMessage,
    mergeMessages,
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
