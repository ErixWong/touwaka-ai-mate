import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { messageApi } from '@/api/services'
import type { Message } from '@/types'
import type { SSEEvent } from '@/composables/useConnection'

export interface UseSSEHandlerOptions {
  expertId: string
  currentAssistantMessage: () => Message | null
  currentUserMessageId: () => string | null
  getStreamingContent: () => string
  getReasoningContent: () => string
  resetStreamingContent: () => void
  onSkillEvent?: (content: string) => void
  onComplete?: () => void
  onError?: (error: Error) => void
}

export interface CompleteEventData {
  message_id?: string
  content?: string
  reasoning_content?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  model?: string
}

/**
 * SSE 事件处理 composable
 *
 * 职责：
 * - 处理所有 SSE 事件类型（delta, reasoning_delta, tool_call, complete, error 等）
 * - 管理流式内容更新
 * - 处理消息完成后的数据库同步
 * - 检测技能相关操作并触发事件
 */
export function useSSEHandler(options: UseSSEHandlerOptions) {
  const { t } = useI18n()
  const chatStore = useChatStore()

  // 记录上一次收到的最新消息 ID，用于避免重复拉取
  const lastKnownMessageId = ref<string | null>(null)

  // 安全超时：防止 isSending 永久为 true（SSE 流异常终止时）
  let sendingTimeout: ReturnType<typeof setTimeout> | null = null
  const SENDING_TIMEOUT_MS = 5 * 60 * 1000  // 5 分钟超时

  // 清除发送超时
  const clearSendingTimeout = () => {
    if (sendingTimeout) {
      clearTimeout(sendingTimeout)
      sendingTimeout = null
    }
  }

  // 设置发送超时保护
  const setSendingTimeoutProtection = () => {
    clearSendingTimeout()
    sendingTimeout = setTimeout(() => {
      const assistant = options.currentAssistantMessage()
      if (assistant) {
        chatStore.updateMessageContent(
          assistant.id,
          options.getStreamingContent() || '',
          'timeout'
        )
      }
    }, SENDING_TIMEOUT_MS)
  }

  /**
   * 使用服务端返回的内容更新临时消息（fallback 方案）
   */
  const updateTempMessageWithServerData = (data: CompleteEventData) => {
    const assistant = options.currentAssistantMessage()
    if (!assistant) return

    const finalContent = data.content || options.getStreamingContent()
    chatStore.updateMessageContent(assistant.id, finalContent, 'completed')

    if (data.reasoning_content || options.getReasoningContent()) {
      chatStore.updateMessageReasoningContent(
        assistant.id,
        data.reasoning_content || options.getReasoningContent()
      )
    }

    if (data.usage && data.usage.prompt_tokens !== undefined && data.usage.completion_tokens !== undefined && data.usage.total_tokens !== undefined) {
      chatStore.updateMessageMetadata(assistant.id, {
        tokens: {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens,
        },
        model: data.model,
      })
    }
  }

  /**
   * 从数据库获取消息并替换临时消息
   */
  const replaceTempMessagesWithDb = async (messageId: string): Promise<boolean> => {
    const assistant = options.currentAssistantMessage()
    if (!options.expertId || !assistant) return false

    try {
      const messagesFromDb = await messageApi.getMessagesWithBefore(
        options.expertId,
        messageId,
        { limit: 10 }
      )

      if (!messagesFromDb || messagesFromDb.length === 0) return false

      const assistantMsgIndex = messagesFromDb.findIndex(m => m.id === messageId)
      if (assistantMsgIndex === -1) return false

      const newMessages = messagesFromDb.slice(0, assistantMsgIndex + 1)

      // 移除临时消息
      const tempUserId = options.currentUserMessageId()
      const tempAssistantId = assistant.id
      const tempUserIndex = tempUserId ? chatStore.messages.findIndex(m => m.id === tempUserId) : -1
      const tempAssistantIndex = tempAssistantId ? chatStore.messages.findIndex(m => m.id === tempAssistantId) : -1

      if (tempUserIndex !== -1 && tempAssistantIndex !== -1) {
        // 移除临时消息
        const idsToRemove = [tempAssistantId, tempUserId].filter(Boolean)
        for (const id of idsToRemove) {
          chatStore.removeMessage(id!)
        }

        // 添加数据库消息（带去重检查）
        for (const msg of newMessages) {
          const existingIndex = chatStore.messages.findIndex(m => m.id === msg.id)
          if (existingIndex !== -1) {
            // 已存在，更新而不是添加
            const existing = chatStore.messages[existingIndex]
            if (existing) {
              existing.content = msg.content
              existing.reasoning_content = msg.reasoning_content
              existing.tool_calls = msg.tool_calls
              existing.status = 'completed'
              existing.metadata = msg.metadata
              existing.updated_at = msg.updated_at || msg.created_at
            }
          } else {
            // 不存在，添加新消息
            const dbMessage: Message = {
              id: msg.id,
              expert_id: msg.expert_id,
              user_id: msg.user_id,
              topic_id: msg.topic_id,
              role: msg.role,
              content: msg.content,
              reasoning_content: msg.reasoning_content,
              tool_calls: msg.tool_calls,
              status: 'completed',
              metadata: msg.metadata,
              created_at: msg.created_at,
              updated_at: msg.updated_at || msg.created_at,
            }
            chatStore.messages.push(dbMessage)
          }
        }

        console.log('[useSSEHandler] Replaced temp messages with DB messages:', newMessages.length)
        return true
      } else {
        // 找不到临时消息，直接添加数据库消息
        console.log('[useSSEHandler] Temp messages not found, adding DB messages directly')
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

  /**
   * 检测技能相关操作，触发刷新事件
   */
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

  /**
   * 处理 SSE complete 事件
   */
  const handleCompleteEvent = async (data: CompleteEventData) => {
    const assistant = options.currentAssistantMessage()
    if (!assistant) {
      console.log('[useSSEHandler] Setting isSending to false on complete event (no current message)')
      clearSendingTimeout()
      return
    }

    // 更新已知的消息 ID，避免心跳检测误判导致刷新
    if (data.message_id) {
      lastKnownMessageId.value = data.message_id
    }

    // 尝试从数据库获取消息
    if (data.message_id && options.expertId) {
      const success = await replaceTempMessagesWithDb(data.message_id)
      if (!success) {
        // 数据库获取失败，使用服务端返回的内容
        console.log('[useSSEHandler] Failed to get DB messages, using server data')
        updateTempMessageWithServerData(data)
      }
    } else {
      // 没有 message_id，使用服务端返回的内容
      updateTempMessageWithServerData(data)
    }

    // 检测技能相关操作
    const finalContent = data.content || options.getStreamingContent()
    detectAndEmitSkillEvents(finalContent)
    options.onSkillEvent?.(finalContent)

    console.log('[useSSEHandler] Setting isSending to false on complete event')
    clearSendingTimeout()
    options.onComplete?.()
  }

  /**
   * 处理 SSE 事件
   */
  const handleSSEEvent = async (event: SSEEvent) => {
    // 处理心跳事件
    if (event.event === 'heartbeat') {
      try {
        const data = JSON.parse(event.data)
        const serverLatestMessageId = data.latest_message_id

        // 如果正在发送消息，跳过心跳检测触发的刷新
        const isSending = chatStore.messages.some(m => m.status === 'streaming')
        if (isSending) {
          // 只更新 lastKnownMessageId，不触发刷新
          if (serverLatestMessageId) {
            lastKnownMessageId.value = serverLatestMessageId
          }
          return
        }

        // 如果服务端有消息 ID，且与本地已知的不同
        if (serverLatestMessageId && serverLatestMessageId !== lastKnownMessageId.value) {
          // 获取本地最新消息 ID
          const localMessages = chatStore.sortedMessages
          const lastMessage = localMessages.length > 0 ? localMessages[localMessages.length - 1] : undefined
          const localLatestId = lastMessage?.id ?? null

          // 如果服务端消息 ID 与本地最新消息 ID 不同，说明有新消息
          if (serverLatestMessageId !== localLatestId) {
            console.log('[useSSEHandler] 检测到新消息，主动拉取:', {
              serverLatest: serverLatestMessageId,
              localLatest: localLatestId,
            })

            // 刷新消息列表（只拉取第一页最新消息）
            if (options.expertId) {
              await chatStore.loadMessagesByExpert(options.expertId, 1)
            }
          }

          // 更新已知的消息 ID
          lastKnownMessageId.value = serverLatestMessageId
        }
      } catch (e) {
        console.error('[useSSEHandler] Parse heartbeat error:', e)
      }
      return
    }

    try {
      const data = JSON.parse(event.data)

      switch (event.event) {
        case 'connected':
          console.log('[useSSEHandler] SSE connected:', data)
          break

        case 'start':
          console.log('[useSSEHandler] SSE start:', data)
          // 如果检测到新话题，刷新话题列表
          if (data.is_new_topic) {
            console.log('[useSSEHandler] 检测到新话题，刷新话题列表')
            chatStore.loadTopics({ expert_id: options.expertId })
          }
          break

        case 'delta':
          if (options.currentAssistantMessage()) {
            // 使用累积器，不依赖旧对象引用
            const newContent = options.getStreamingContent() + data.content
            chatStore.updateMessageContent(
              options.currentAssistantMessage()!.id,
              newContent
            )
          }
          break

        case 'reasoning_delta':
          // 处理思考内容增量事件（DeepSeek R1、GLM-Z1、Qwen3 等支持）
          if (options.currentAssistantMessage()) {
            const newReasoningContent = options.getReasoningContent() + data.content
            chatStore.updateMessageReasoningContent(
              options.currentAssistantMessage()!.id,
              newReasoningContent
            )
          }
          break

        case 'tool_call':
          // 工具调用开始 - 只显示简单的进度提示
          console.log('[useSSEHandler] Tool call:', data)
          if (options.currentAssistantMessage() && data.toolCalls) {
            const toolNames = data.toolCalls.map((tc: { displayName?: string; function?: { name?: string }; name?: string }) => {
              return tc.displayName || tc.function?.name || tc.name || 'unknown'
            }).join(', ')

            // 只显示简单的进度提示，不显示详细参数
            const newContent = options.getStreamingContent() + `\n\n🔧 正在调用工具: ${toolNames}...\n`
            chatStore.updateMessageContent(
              options.currentAssistantMessage()!.id,
              newContent
            )
          }
          break

        case 'tool_result':
          // 单个工具执行完成 - 只显示简单的状态提示
          console.log('[useSSEHandler] Tool result:', data)
          // 不再显示详细结果，等 SSE 完成后从数据库获取
          break

        case 'tool_results':
          // 所有工具执行完成（批量结果）
          console.log('[useSSEHandler] Tool results:', data)
          // 不再显示详细结果，等 SSE 完成后从数据库获取
          break

        case 'complete':
          await handleCompleteEvent(data)
          break

        case 'error':
          console.log('[useSSEHandler] SSE error event received:', data)
          const assistant = options.currentAssistantMessage()
          if (assistant) {
            chatStore.updateMessageContent(
              assistant.id,
              data.message || t('error.unknownError'),
              'error'
            )
          }
          console.log('[useSSEHandler] Setting isSending to false on error event')
          clearSendingTimeout()
          options.onError?.(new Error(data.message || t('error.unknownError')))
          break

        default:
          console.log('[useSSEHandler] Unknown SSE event:', event.event, data)
      }
    } catch (e) {
      console.error('[useSSEHandler] Parse SSE event error:', e)
      // 解析错误时也要重置 isSending，防止输入框永久禁用
      if (event.event === 'complete' || event.event === 'error') {
        console.log('[useSSEHandler] Setting isSending to false after parse error')
        clearSendingTimeout()
      }
    }
  }

  return {
    lastKnownMessageId,
    handleSSEEvent,
    handleCompleteEvent,
    setSendingTimeoutProtection,
    clearSendingTimeout,
    detectAndEmitSkillEvents,
  }
}
