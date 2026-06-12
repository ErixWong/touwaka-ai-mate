import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { useSystemSettingsStore } from '@/stores/systemSettings'
import { messageApi } from '@/api/services'
import type { Message } from '@/types'
import type { SSEEvent } from '@/composables/useConnection'

// 批量缓冲配置 - 优化SSE渲染性能
const BATCH_SIZE = 100      // 每100个字符强制刷新
const BATCH_INTERVAL = 100  // 最大等待100ms刷新一次

export interface UseSSEHandlerOptions {
  expertId: string | (() => string)
  currentAssistantMessage: () => Message | null
  currentUserMessageId: () => string | null
  activeRequestId: () => string | null
  setActiveRequestId: (requestId: string | null) => void
  getStreamingContent: () => string
  getReasoningContent: () => string
  setStreamingContent: (content: string) => void
  setReasoningContent: (content: string) => void
  resetStreamingContent: () => void
  onSkillEvent?: (content: string) => void
  onComplete?: () => void
  onError?: (error: Error) => void
}

export interface CompleteEventData {
  request_id?: string
  message?: Message
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
  const systemSettingsStore = useSystemSettingsStore()

  // 获取 expertId（支持 getter 函数）
  const getExpertId = (): string => {
    return typeof options.expertId === 'function' ? options.expertId() : options.expertId
  }

  // 记录上一次收到的最新消息 ID，用于避免重复拉取
  const lastKnownMessageId = ref<string | null>(null)
  const lastKnownSequence = ref<number>(0)

  const getAssistantByRequestId = (requestId?: string | null): Message | null => {
    if (!requestId) {
      return options.currentAssistantMessage()
    }
    return chatStore.findStreamingAssistantByRequestId(requestId) || null
  }

  const bindPendingAssistantToRequest = (requestId?: string | null) => {
    if (!requestId) return null

    const matched = chatStore.findStreamingAssistantByRequestId(requestId)
    if (matched) return matched

    const pendingAssistant = chatStore.messages.find(
      m => m.role === 'assistant' && m.status === 'streaming' && !m.request_id
    )

    if (pendingAssistant) {
      chatStore.updateMessageRequestId(pendingAssistant.id, requestId)
      if (!options.activeRequestId()) {
        options.setActiveRequestId(requestId)
      }
      return chatStore.findStreamingAssistantByRequestId(requestId)
    }

    return null
  }

  // 批量缓冲相关
  let contentBuffer = ''
  let reasoningBuffer = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  // 安全超时：基于最近一次流式活动的空闲超时，避免长时推理被误判
  let sendingTimeout: ReturnType<typeof setTimeout> | null = null
  const getSendingTimeoutMs = () => {
    const timeoutSeconds = systemSettingsStore.timeoutSettings.chat_idle ?? 300
    return timeoutSeconds * 1000
  }

  // 清除发送超时
  const clearSendingTimeout = () => {
    if (sendingTimeout) {
      clearTimeout(sendingTimeout)
      sendingTimeout = null
    }
  }

  // 强制刷新缓冲区到UI
  const flushBuffers = () => {
    const assistant = getAssistantByRequestId(options.activeRequestId())
    if (!assistant) {
      flushTimer = null
      return
    }

    // 刷新内容缓冲区
    if (contentBuffer) {
      const newContent = options.getStreamingContent() + contentBuffer
      options.setStreamingContent(newContent)
      chatStore.updateMessageContent(assistant.id, newContent)
      contentBuffer = ''
    }

    // 刷新思考内容缓冲区
    if (reasoningBuffer) {
      const newReasoningContent = options.getReasoningContent() + reasoningBuffer
      options.setReasoningContent(newReasoningContent)
      chatStore.updateMessageReasoningContent(assistant.id, newReasoningContent)
      reasoningBuffer = ''
    }

    flushTimer = null
  }

  // 安排缓冲区刷新
  const scheduleFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(flushBuffers, BATCH_INTERVAL)
  }

  // 任意流式活动都应续命，只有长时间无反馈才算超时
  const bumpSendingTimeoutProtection = () => {
    clearSendingTimeout()
    sendingTimeout = setTimeout(() => {
      const assistant = getAssistantByRequestId(options.activeRequestId()) || options.currentAssistantMessage()
      if (assistant) {
        chatStore.updateMessageContent(
          assistant.id,
          options.getStreamingContent() || '',
          'timeout'
        )
      }
      options.setActiveRequestId(null)
    }, getSendingTimeoutMs())
  }

  // 设置发送超时保护
  const setSendingTimeoutProtection = () => {
    bumpSendingTimeoutProtection()
  }

  /**
   * 使用服务端返回的内容更新临时消息（fallback 方案）
   */
  const updateTempMessageWithServerData = (data: CompleteEventData) => {
    const assistant = getAssistantByRequestId(data.request_id)
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

  /**
   * 从数据库获取消息并替换临时消息
   */
  const replaceTempMessagesWithDb = async (messageId: string, requestId?: string): Promise<boolean> => {
    const assistant = getAssistantByRequestId(requestId)
    const expertId = getExpertId()
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
    const assistant = getAssistantByRequestId(data.request_id)
    if (!assistant) {
      console.log('[useSSEHandler] Setting isSending to false on complete event (no current message)')
      clearSendingTimeout()
      options.setActiveRequestId(null)
      return
    }

    // 更新已知的消息 ID，避免心跳检测误判导致刷新
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

    // 检测技能相关操作
    const finalContent = data.message?.content || options.getStreamingContent()
    detectAndEmitSkillEvents(finalContent)
    options.onSkillEvent?.(finalContent)

    console.log('[useSSEHandler] Setting isSending to false on complete event')
    clearSendingTimeout()
    options.setActiveRequestId(null)
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
        const serverLatestSequence = Number(data.latest_sequence || 0)

        if (serverLatestSequence > lastKnownSequence.value) {
          lastKnownSequence.value = serverLatestSequence
        }

        // 如果正在发送消息，跳过心跳检测触发的刷新
        const isSending = chatStore.messages.some(m => m.status === 'streaming')
        if (isSending) {
          // 只更新 lastKnownMessageId，不触发刷新
          if (serverLatestMessageId) {
            lastKnownMessageId.value = serverLatestMessageId
          }
          return
        }

        // 如果服务端有消息 ID，且与本地已知的不同，只更新游标
        // 不再通过 heartbeat 触发第一页整页重载，避免聊天视图被打断
        if (serverLatestMessageId && serverLatestMessageId !== lastKnownMessageId.value) {
          console.log('[useSSEHandler] heartbeat detected newer server message id, cursor updated only:', {
            serverLatest: serverLatestMessageId,
            localKnown: lastKnownMessageId.value,
          })

          const expertId = getExpertId()
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
          // 如果检测到新话题，刷新话题列表
          if (data.is_new_topic) {
            console.log('[useSSEHandler] 检测到新话题，刷新话题列表')
            const expertId = getExpertId()
            chatStore.loadTopics({ expert_id: expertId })
          }
          break

        case 'delta':
          if (getAssistantByRequestId(data.request_id)) {
            bumpSendingTimeoutProtection()
            // 使用批量缓冲机制，减少UI更新频率
            contentBuffer += data.content
            
            // 达到批量大小立即刷新，否则安排定时刷新
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
          // 处理思考内容增量事件（DeepSeek R1、GLM-Z1、Qwen3 等支持）
          if (getAssistantByRequestId(data.request_id)) {
            bumpSendingTimeoutProtection()
            // 使用批量缓冲机制
            reasoningBuffer += data.content
            
            // 达到批量大小立即刷新，否则安排定时刷新
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
          // 工具调用开始 - 只显示简单的进度提示
          console.log('[useSSEHandler] Tool call:', data)
          if (getAssistantByRequestId(data.request_id) && data.toolCalls) {
            bumpSendingTimeoutProtection()
            const toolNames = data.toolCalls.map((tc: { displayName?: string; function?: { name?: string }; name?: string }) => {
              return tc.displayName || tc.function?.name || tc.name || 'unknown'
            }).join(', ')

            // 只显示简单的进度提示，不显示详细参数
            const newContent = options.getStreamingContent() + `\n\n🔧 正在调用工具: ${toolNames}...\n`
            // 同步更新累积器 ref
            options.setStreamingContent(newContent)
            // 更新 store 中的消息内容
            chatStore.updateMessageContent(
              getAssistantByRequestId(data.request_id)!.id,
              newContent
            )
          }
          break

        case 'tool_result':
          // 单个工具执行完成 - 只显示简单的状态提示
          console.log('[useSSEHandler] Tool result:', data)
          if (getAssistantByRequestId(data.request_id)) {
            bumpSendingTimeoutProtection()
          }
          // 不再显示详细结果，等 SSE 完成后从数据库获取
          break

        case 'tool_results':
          // 所有工具执行完成（批量结果）
          console.log('[useSSEHandler] Tool results:', data)
          if (getAssistantByRequestId(data.request_id)) {
            bumpSendingTimeoutProtection()
          }
          // 不再显示详细结果，等 SSE 完成后从数据库获取
          break

        case 'complete':
          // 确保缓冲区内容全部刷新后再处理完成事件
          if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = null
          }
          flushBuffers()
          await handleCompleteEvent(data)
          break

        case 'tool_limit_warning':
          // 工具调用即将达到上限（80%阈值），显示警告提示
          console.log('[useSSEHandler] Tool limit warning:', data)
          if (data.message) {
            const assistant = getAssistantByRequestId(data.request_id)
            if (assistant) {
              bumpSendingTimeoutProtection()
              const currentContent = options.getStreamingContent() || ''
              const warningText = `\n\n⚠️ ${data.message}\n`
              options.setStreamingContent(currentContent + warningText)
              chatStore.updateMessageContent(assistant.id, currentContent + warningText)
            }
          }
          break

        case 'tool_limit_reached':
          // 工具调用已达到上限（100%），显示总结
          console.log('[useSSEHandler] Tool limit reached:', data)
          if (data.summary) {
            const assistant = getAssistantByRequestId(data.request_id)
            if (assistant) {
              bumpSendingTimeoutProtection()
              const currentContent = options.getStreamingContent() || ''
              const summaryText = `\n\n📊 ${data.summary}\n\n${data.message || ''}`
              options.setStreamingContent(currentContent + summaryText)
              chatStore.updateMessageContent(assistant.id, currentContent + summaryText)
            }
          }
          break

        case 'stopped':
          console.log('[useSSEHandler] SSE stopped event received:', data)
          if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = null
          }
          flushBuffers()
          {
            const assistant = getAssistantByRequestId(data.request_id)
            if (assistant) {
              chatStore.updateMessageContent(
                assistant.id,
                options.getStreamingContent() || assistant.content || '',
                'stopped'
              )
            }
          }
          clearSendingTimeout()
          options.setActiveRequestId(null)
          break

        case 'error':
          console.log('[useSSEHandler] SSE error event received:', data)
          // 确保缓冲区内容全部刷新
          if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = null
          }
          flushBuffers()
          
          const assistant = getAssistantByRequestId(data.request_id)
          if (assistant) {
            chatStore.updateMessageContent(
              assistant.id,
              data.message || t('error.unknownError'),
              'error'
            )
          }
          console.log('[useSSEHandler] Setting isSending to false on error event')
          clearSendingTimeout()
          options.setActiveRequestId(null)
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
