import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { useTaskStore } from '@/stores/task'
import { useSkillDirectoryStore } from '@/stores/skillDirectory'
import { useToastStore } from '@/stores/toast'
import { messageApi } from '@/api/services'
import type { ChatRequestStatus, Message } from '@/types'

export interface UseMessageSendingOptions {
  expertId: string | (() => string)
  modelId?: string | (() => string | undefined)
  onError?: (error: Error) => void
}

export function useMessageSending(options: UseMessageSendingOptions) {
  const { t } = useI18n()
  const chatStore = useChatStore()
  const taskStore = useTaskStore()
  const skillDirectoryStore = useSkillDirectoryStore()
  const toast = useToastStore()

  const activeRequestId = computed<string | null>(() => {
    const streaming = chatStore.getStreamingAssistant()
    return streaming?.request_id || null
  })

  const currentAssistantMessage = computed<Message | null>(() => {
    return chatStore.getStreamingAssistant() || null
  })

  const currentUserMessageId = computed<string | null>(() => {
    const assistant = currentAssistantMessage.value
    if (!assistant) return null
    if (assistant.request_id) {
      const requestUser = chatStore.getUserMessageByRequestId(assistant.request_id)
      if (requestUser) return requestUser.id
    }
    const prevUser = chatStore.getPreviousUserMessage(assistant.id)
    return prevUser?.id || null
  })

  const isSending = computed<boolean>(() =>
    chatStore.messages.some(m => m.status === 'streaming')
  )

  const streamingContent = computed<string>(() => {
    const assistant = currentAssistantMessage.value
    return assistant?.content || ''
  })

  const streamingReasoningContent = computed<string>(() => {
    const assistant = currentAssistantMessage.value
    return assistant?.reasoning_content || ''
  })

  const getExpertId = (): string => {
    return typeof options.expertId === 'function' ? options.expertId() : options.expertId
  }

  const getModelId = (): string | undefined => {
    if (!options.modelId) return undefined
    return typeof options.modelId === 'function' ? options.modelId() : options.modelId
  }

  const syncCompletedRequest = async (request: ChatRequestStatus, fallbackMessageId?: string): Promise<boolean> => {
    const expert_id = getExpertId()
    const assistantMessageId = request.assistant_message_id || fallbackMessageId

    if (!expert_id || !assistantMessageId) {
      return false
    }

    try {
      const messagesFromDb = await messageApi.getMessagesWithBefore(
        expert_id,
        assistantMessageId,
        { limit: 10 }
      )

      if (!messagesFromDb?.length) {
        return false
      }

      const tempAssistantId = fallbackMessageId
      const tempAssistant = tempAssistantId ? chatStore.getMessageById(tempAssistantId) : undefined
      const requestUser = request.request_id ? chatStore.getUserMessageByRequestId(request.request_id) : undefined

      if (tempAssistant && tempAssistantId) {
        chatStore.removeMessage(tempAssistantId)
        const prevUser = requestUser || chatStore.getPreviousUserMessage(tempAssistantId)
        const dbUserMessage = messagesFromDb.find(message => message.role === 'user')
        if (dbUserMessage && prevUser && prevUser.id !== dbUserMessage.id) {
          chatStore.removeMessage(prevUser.id)
        }
      }

      chatStore.mergeMessages(messagesFromDb.map(message => ({
        ...message,
        status: 'completed' as const,
      })))
      return true
    } catch (error) {
      console.error('[useMessageSending] Failed to sync completed request:', error)
      return false
    }
  }

  const sendMessage = async (content: string): Promise<boolean> => {
    const expert_id = getExpertId()

    if (!expert_id) {
      console.error('[useMessageSending] No expert selected')
      return false
    }

    const userPlaceholder = chatStore.addLocalMessage({
      expert_id,
      role: 'user',
      content,
      status: 'completed',
    })

    const assistantPlaceholder = chatStore.addLocalMessage({
      expert_id,
      role: 'assistant',
      content: '',
      status: 'streaming',
    })

    chatStore.setCurrentStreaming(assistantPlaceholder.id)

    try {
      const messageParams: {
        content: string
        expert_id: string
        model_id?: string
        task_id?: string
        task_db_id?: string
        working_path?: string
      } = {
        content: userPlaceholder?.content || content,
        expert_id,
        model_id: getModelId(),
      }

      if (taskStore.currentTask) {
        // 明确使用 task_db_id 传递数据库主键
        // 不再发送兼容字段 task_id，后端会通过 task_db_id || task_id 兼容旧接口
        messageParams.task_db_id = taskStore.currentTask.id
      }

      const activeSkill = skillDirectoryStore.currentWorkingSkill || skillDirectoryStore.browsingSkill
      if (!taskStore.currentTask && activeSkill) {
        let skillPath = activeSkill.path
        if (skillPath.startsWith('data/')) {
          skillPath = skillPath.substring(5)
        }
        messageParams.working_path = skillPath
      }

      const result = await messageApi.sendMessage(messageParams)
      if (result.request_id) {
        chatStore.updateMessageRequestId(assistantPlaceholder.id, result.request_id)
      }
      console.log('[useMessageSending] Message sent:', result)
      return true

    } catch (error) {
      console.error('[useMessageSending] Send message error:', error)

      const assistant = currentAssistantMessage.value
      if (assistant) {
        chatStore.updateMessageContent(
          assistant.id,
          error instanceof Error ? error.message : t('error.networkError'),
          'error'
        )
      }

      options.onError?.(error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }

  const retryMessage = async (messageId: string, messageRole: string, messageContent: string): Promise<boolean> => {
    if (messageRole === 'assistant') {
      const targetMessage = chatStore.getMessageById(messageId) || null
      const requestId = targetMessage?.request_id || null

      if (requestId) {
        try {
          const requestStatus = await messageApi.getChatRequestStatus(requestId)

          const requestAssistant = requestStatus.assistant_message_id
            ? chatStore.getMessageById(requestStatus.assistant_message_id)
            : null

          if (requestStatus.status === 'completed') {
            await syncCompletedRequest(requestStatus, requestAssistant?.id || messageId)
            return true
          }

          if (requestStatus.status === 'running' || requestStatus.status === 'accepted') {
            const targetAssistantId = requestAssistant?.id || messageId
            chatStore.updateMessageContent(targetAssistantId, requestAssistant?.content || targetMessage?.content || '', 'streaming')
            chatStore.setCurrentStreaming(targetAssistantId)
            return true
          }

          if (requestStatus.can_retry) {
            const retried = await messageApi.retryChatRequest(requestId)
            chatStore.updateMessageRequestId(messageId, retried.request_id)
            chatStore.updateMessageContent(messageId, '', 'streaming')
            chatStore.setCurrentStreaming(messageId)
            return true
          }
        } catch (error) {
          console.warn('[useMessageSending] Request recovery failed:', error)
          toast.error('无法确认原请求状态，请手动重新发送')
          return false
        }
      }

      const messageIndex = chatStore.messages.findIndex(m => m.id === messageId)
      if (messageIndex === -1) {
        console.warn('[useMessageSending] Retry failed: message not found', messageId)
        return false
      }

      let userMessage: Message | null = null
      for (let i = messageIndex - 1; i >= 0; i--) {
        const msg = chatStore.messages[i]
        if (msg?.role === 'user') {
          userMessage = msg
          break
        }
      }

      if (userMessage) {
        chatStore.removeMessage(messageId)
        return await sendMessage(userMessage.content)
      } else {
        console.warn('[useMessageSending] Retry failed: no user message found', messageId)
        return false
      }
    } else {
      chatStore.removeMessage(messageId)
      return await sendMessage(messageContent)
    }
  }

  return {
    isSending,
    currentAssistantMessage,
    currentUserMessageId,
    streamingContent,
    streamingReasoningContent,
    activeRequestId,

    sendMessage,
    retryMessage,
  }
}
