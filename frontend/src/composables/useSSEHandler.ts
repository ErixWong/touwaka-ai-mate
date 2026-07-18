import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { useSystemSettingsStore } from '@/stores/systemSettings'
import { messageApi } from '@/api/services'
import type { Message } from '@/types'
import type { SSEEvent } from '@/composables/useConnection'

const BATCH_SIZE = 100
const BATCH_INTERVAL = 100

export interface UseSSEHandlerOptions {
  getExpertId: () => string
  onComplete?: (content: string) => void
}

export interface CompleteEventData {
  request_id?: string
  message?: Message
}

export function useSSEHandler(options: UseSSEHandlerOptions) {
  const { t } = useI18n()
  const chatStore = useChatStore()
  const systemSettingsStore = useSystemSettingsStore()

  const lastKnownMessageId = ref<string | null>(null)
  const lastKnownSequence = ref<number>(0)

  let contentBuffer = ''
  let reasoningBuffer = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  let sendingTimeout: ReturnType<typeof setTimeout> | null = null
  const getSendingTimeoutMs = () => {
    const timeoutSeconds = systemSettingsStore.timeoutSettings.chat_idle ?? 300
    return timeoutSeconds * 1000
  }

  const clearSendingTimeout = () => {
    if (sendingTimeout) {
      clearTimeout(sendingTimeout)
      sendingTimeout = null
    }
  }

  const getStreamingAssistant = (): Message | undefined => {
    return chatStore.getStreamingAssistant()
  }

  const isManuallyStoppedRequest = (requestId?: string | null) => {
    return chatStore.isRequestManuallyStopped(requestId)
  }

  const flushBuffers = () => {
    const assistant = getStreamingAssistant()
    if (!assistant) {
      flushTimer = null
      return
    }

    if (contentBuffer) {
      const newContent = (assistant.content || '') + contentBuffer
      chatStore.updateMessageContent(assistant.id, newContent)
      contentBuffer = ''
    }

    if (reasoningBuffer) {
      const newReasoning = (assistant.reasoning_content || '') + reasoningBuffer
      chatStore.updateMessageReasoningContent(assistant.id, newReasoning)
      reasoningBuffer = ''
    }

    flushTimer = null
  }

  const scheduleFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(flushBuffers, BATCH_INTERVAL)
  }

  const bumpSendingTimeoutProtection = () => {
    clearSendingTimeout()
    sendingTimeout = setTimeout(() => {
      const assistant = getStreamingAssistant()
      if (assistant) {
        chatStore.updateMessageContent(
          assistant.id,
          assistant.content || '',
          'timeout'
        )
      }
    }, getSendingTimeoutMs())
  }

  const setSendingTimeoutProtection = () => {
    bumpSendingTimeoutProtection()
  }

  const updateTempMessageWithServerData = (data: CompleteEventData) => {
    const assistant = chatStore.findStreamingAssistantByRequestId(data.request_id || '')
    if (!assistant) return

    const message = data.message
    if (!message) return

    chatStore.replaceMessage(assistant.id, {
      ...message,
      request_id: data.request_id || message.request_id,
      status: 'completed',
      updated_at: message.updated_at || message.created_at,
    })
  }

  const replaceTempMessagesWithDb = async (messageId: string, requestId?: string): Promise<boolean> => {
    const assistant = chatStore.findStreamingAssistantByRequestId(requestId || '')
    const expertId = options.getExpertId()
    if (!expertId || !assistant) return false

    try {
      const messagesFromDb = await messageApi.getMessagesWithBefore(
        expertId,
        messageId,
        { limit: 10 }
      )

      if (!messagesFromDb || messagesFromDb.length === 0) return false

      const assistantMsgIndex = messagesFromDb.findIndex(m => m.id === messageId)
      if (assistantMsgIndex === -1) return false

      const newMessages = messagesFromDb.slice(0, assistantMsgIndex + 1)

      const tempAssistantId = assistant.id
      const tempAssistant = chatStore.getMessageById(tempAssistantId)
      const requestUserId = requestId ? chatStore.getUserMessageByRequestId(requestId)?.id || null : null
      const tempUserId = requestUserId || (tempAssistant ? chatStore.getPreviousUserMessage(tempAssistantId)?.id || null : null)

      if (tempUserId && tempAssistant) {
        chatStore.removeMessage(tempAssistantId)
        chatStore.removeMessage(tempUserId)

        for (const msg of newMessages) {
          const existing = chatStore.getMessageById(msg.id)
          if (existing) {
            existing.content = msg.content
            existing.reasoning_content = msg.reasoning_content
            existing.tool_calls = msg.tool_calls
            existing.status = 'completed'
            existing.metadata = msg.metadata
            existing.updated_at = msg.updated_at || msg.created_at
          } else {
            chatStore.addLocalMessage({ ...msg, status: 'completed' })
          }
        }
        return true
      } else {
        for (const msg of newMessages) {
          chatStore.addLocalMessage({ ...msg, status: 'completed' })
        }
        return true
      }
    } catch (error) {
      console.error('[useSSEHandler] Failed to fetch messages from DB:', error)
      return false
    }
  }

  const detectAndEmitSkillEvents = (content: string) => {
    if (!content.includes('Skill') || !content.includes('successfully')) return

    import('@/utils/eventBus').then(({ eventBus, EVENTS }) => {
      if (content.includes('registered') || content.includes('updated')) {
        eventBus.emit(EVENTS.SKILL_REGISTERED)
      } else if (content.includes('assigned')) {
        eventBus.emit(EVENTS.SKILL_ASSIGNED)
      } else if (content.includes('unassigned')) {
        eventBus.emit(EVENTS.SKILL_UNASSIGNED)
      } else if (content.includes('enabled') || content.includes('disabled')) {
        eventBus.emit(EVENTS.SKILL_TOGGLED)
      } else if (content.includes('deleted')) {
        eventBus.emit(EVENTS.SKILL_DELETED)
      }
    })
  }

  const handleCompleteEvent = async (data: CompleteEventData) => {
    if (isManuallyStoppedRequest(data.request_id)) {
      if (data.request_id) {
        chatStore.clearManuallyStoppedRequest(data.request_id)
      }
      chatStore.setCurrentStreaming(null)
      clearSendingTimeout()
      return
    }

    const assistant = chatStore.findStreamingAssistantByRequestId(data.request_id || '')
    if (!assistant) {
      clearSendingTimeout()
      return
    }

    if (data.message?.id) {
      lastKnownMessageId.value = data.message.id
    }

    if (data.message) {
      updateTempMessageWithServerData(data)
    } else if (data.request_id && assistant.request_id === data.request_id) {
      const success = await replaceTempMessagesWithDb(assistant.id, data.request_id)
      if (!success) {
        console.log('[useSSEHandler] Failed to get DB messages, using server data')
      }
    }

    const finalContent = data.message?.content || assistant.content
    options.onComplete?.(finalContent)

    chatStore.updateMessageMetadata(assistant.id, {
      recovering: false,
      recovery_attempt: 0,
      recovery_round: null,
    })

    chatStore.setCurrentStreaming(null)
    clearSendingTimeout()
  }

  const bindPendingAssistantToRequest = (requestId?: string | null) => {
    if (!requestId) return null

    const matched = chatStore.findStreamingAssistantByRequestId(requestId)
    if (matched) return matched

    const existingAssistant = chatStore.getAssistantMessageByRequestId(requestId)
    if (existingAssistant?.status === 'streaming') {
      chatStore.setCurrentStreaming(existingAssistant.id)
      return existingAssistant
    }

    const pendingAssistant = chatStore.messages.find(
      m => m.role === 'assistant' && m.status === 'streaming' && !m.request_id
    )

    if (pendingAssistant) {
      chatStore.updateMessageRequestId(pendingAssistant.id, requestId)
      chatStore.setCurrentStreaming(pendingAssistant.id)
      return chatStore.findStreamingAssistantByRequestId(requestId)
    }

    return null
  }

  const handleSSEEvent = async (event: SSEEvent) => {
    if (event.event === 'heartbeat') {
      try {
        const data = JSON.parse(event.data)
        const serverLatestMessageId = data.latest_message_id
        const serverLatestSequence = Number(data.latest_sequence || 0)

        if (serverLatestSequence > lastKnownSequence.value) {
          lastKnownSequence.value = serverLatestSequence
        }

        const isSending = chatStore.messages.some(m => m.status === 'streaming')
        if (isSending) {
          if (serverLatestMessageId) {
            lastKnownMessageId.value = serverLatestMessageId
          }
          return
        }

        if (serverLatestMessageId && serverLatestMessageId !== lastKnownMessageId.value) {
          const expertId = options.getExpertId()
          if (expertId) {
            try {
              const result = await messageApi.getMessagesSince(expertId, {
                after_message_id: lastKnownMessageId.value || undefined,
                limit: 50,
              })

              if (result.items?.length) {
                chatStore.mergeMessages(result.items.map(message => ({
                  ...message,
                  status: 'completed',
                })))
              }

              if (result.latest_message_id) {
                lastKnownMessageId.value = result.latest_message_id
                return
              }
            } catch (error) {
              console.warn('[useSSEHandler] incremental sync failed:', error)
            }
          }

          lastKnownMessageId.value = serverLatestMessageId
        }
      } catch (e) {
        console.error('[useSSEHandler] Parse heartbeat error:', e)
      }
      return
    }

    try {
      const data = JSON.parse(event.data)
      const eventSequence = Number(data.sequence || event.id || 0)
      if (eventSequence && eventSequence <= lastKnownSequence.value && event.event !== 'connected') {
        return
      }
      if (eventSequence > lastKnownSequence.value) {
        lastKnownSequence.value = eventSequence
      }

      switch (event.event) {
        case 'connected':
          console.log('[useSSEHandler] SSE connected:', data)
          break

        case 'start':
          console.log('[useSSEHandler] SSE start:', data)
          bindPendingAssistantToRequest(data.request_id)
          bumpSendingTimeoutProtection()
          if (data.is_new_topic) {
            const expertId = options.getExpertId()
            chatStore.loadTopics({ expert_id: expertId })
          }
          break

        case 'delta':
          if (isManuallyStoppedRequest(data.request_id)) {
            break
          }
          if (getStreamingAssistant()) {
            bumpSendingTimeoutProtection()
            contentBuffer += data.content

            if (contentBuffer.length >= BATCH_SIZE) {
              if (flushTimer) {
                clearTimeout(flushTimer)
                flushTimer = null
              }
              flushBuffers()
            } else {
              scheduleFlush()
            }
          }
          break

        case 'reasoning_delta':
          if (isManuallyStoppedRequest(data.request_id)) {
            break
          }
          if (getStreamingAssistant()) {
            bumpSendingTimeoutProtection()
            reasoningBuffer += data.content

            if (reasoningBuffer.length >= BATCH_SIZE) {
              if (flushTimer) {
                clearTimeout(flushTimer)
                flushTimer = null
              }
              flushBuffers()
            } else {
              scheduleFlush()
            }
          }
          break

        case 'tool_call':
          if (isManuallyStoppedRequest(data.request_id)) {
            break
          }
          console.log('[useSSEHandler] Tool call:', data)
          if (getStreamingAssistant() && data.toolCalls) {
            bumpSendingTimeoutProtection()
            const toolNames = data.toolCalls.map((tc: { displayName?: string; function?: { name?: string }; name?: string }) => {
              return tc.displayName || tc.function?.name || tc.name || 'unknown'
            }).join(', ')

            const assistant = getStreamingAssistant()!
            const currentContent = assistant.content || ''
            const newContent = currentContent + `\n\n🔧 正在调用工具: ${toolNames}...\n`
            chatStore.updateMessageContent(assistant.id, newContent)
          }
          break

        case 'tool_result':
        case 'tool_results':
          if (isManuallyStoppedRequest(data.request_id)) {
            break
          }
          if (data.request_id) {
            bindPendingAssistantToRequest(data.request_id)
          }
          if (getStreamingAssistant()) {
            bumpSendingTimeoutProtection()
          }
          break

        case 'tool_limit_warning':
          if (data.message) {
            const assistant = getStreamingAssistant()
            if (assistant) {
              bumpSendingTimeoutProtection()
              const currentContent = assistant.content || ''
              const warningText = `\n\n⚠️ ${data.message}\n`
              chatStore.updateMessageContent(assistant.id, currentContent + warningText)
            }
          }
          break

        case 'tool_limit_reached':
          if (data.summary) {
            const assistant = getStreamingAssistant()
            if (assistant) {
              bumpSendingTimeoutProtection()
              const currentContent = assistant.content || ''
              const summaryText = `\n\n📊 ${data.summary}\n\n${data.message || ''}`
              chatStore.updateMessageContent(assistant.id, currentContent + summaryText)
            }
          }
          break

        case 'recovering':
          if (isManuallyStoppedRequest(data.request_id)) {
            break
          }
          if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = null
          }
          contentBuffer = ''
          reasoningBuffer = ''
          if (data.request_id) {
            bindPendingAssistantToRequest(data.request_id)
          }
          {
            const assistant = chatStore.findStreamingAssistantByRequestId(data.request_id || '')
            if (assistant) {
              if (typeof data.content === 'string') {
                chatStore.updateMessageContent(
                  assistant.id,
                  data.content,
                  'streaming'
                )
              }
              if (typeof data.reasoning_content === 'string') {
                chatStore.updateMessageReasoningContent(assistant.id, data.reasoning_content)
              }
              chatStore.updateMessageMetadata(assistant.id, {
                recovering: true,
                recovery_attempt: typeof data.attempt === 'number' ? data.attempt : undefined,
                recovery_round: typeof data.round === 'number' ? data.round : undefined,
              })
            }
          }
          bumpSendingTimeoutProtection()
          break

        case 'recovered':
          // 当前轮已重新发起：恢复指示与后端状态机 recovering -> running 保持一致
          if (isManuallyStoppedRequest(data.request_id)) {
            break
          }
          {
            const assistant = chatStore.findStreamingAssistantByRequestId(data.request_id || '')
            if (assistant) {
              chatStore.updateMessageMetadata(assistant.id, {
                recovering: false,
                recovery_attempt: 0,
                recovery_round: null,
              })
            }
          }
          bumpSendingTimeoutProtection()
          break

        case 'complete':
          if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = null
          }
          flushBuffers()
          if (data.request_id) {
            bindPendingAssistantToRequest(data.request_id)
          }
          await handleCompleteEvent(data)
          break

        case 'stopped':
          if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = null
          }
          flushBuffers()
          if (data.request_id) {
            bindPendingAssistantToRequest(data.request_id)
          }
          {
            const assistant = chatStore.findStreamingAssistantByRequestId(data.request_id || '')
            if (assistant) {
              chatStore.updateMessageContent(
                assistant.id,
                assistant.content || '',
                'stopped'
              )
              chatStore.updateMessageMetadata(assistant.id, {
                recovering: false,
                recovery_attempt: 0,
                recovery_round: null,
              })
            }
          }
          if (data.request_id) {
            chatStore.clearManuallyStoppedRequest(data.request_id)
          }
          chatStore.setCurrentStreaming(null)
          clearSendingTimeout()
          break

        case 'error':
          if (isManuallyStoppedRequest(data.request_id)) {
            if (data.request_id) {
              chatStore.clearManuallyStoppedRequest(data.request_id)
            }
            chatStore.setCurrentStreaming(null)
            clearSendingTimeout()
            break
          }
          console.error('[useSSEHandler] SSE error event:', data)
          if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = null
          }
          flushBuffers()
          if (data.request_id) {
            bindPendingAssistantToRequest(data.request_id)
          }

          {
            const assistant = chatStore.findStreamingAssistantByRequestId(data.request_id || '')
            if (assistant) {
              chatStore.updateMessageContent(
                assistant.id,
                data.message || t('error.unknownError'),
                'error'
              )
              chatStore.updateMessageMetadata(assistant.id, {
                recovering: false,
                recovery_attempt: 0,
                recovery_round: null,
              })
            }
          }
          clearSendingTimeout()
          break

        default:
          console.log('[useSSEHandler] Unknown SSE event:', event.event, data)
          break
      }
    } catch (e) {
      console.error('[useSSEHandler] Parse SSE event error:', e)
      if (event.event === 'complete' || event.event === 'error') {
        clearSendingTimeout()
      }
    }
  }

  return {
    lastKnownMessageId,
    handleSSEEvent,
    handleCompleteEvent,
    replaceTempMessagesWithDb,
    setSendingTimeoutProtection,
    clearSendingTimeout,
    detectAndEmitSkillEvents,
  }
}
