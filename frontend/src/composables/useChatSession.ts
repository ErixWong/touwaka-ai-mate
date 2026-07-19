import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { useTaskStore } from '@/stores/task'
import { useConnection } from '@/composables/useConnection'
import { useMessageSending } from '@/composables/useMessageSending'
import { useSSEHandler } from '@/composables/useSSEHandler'
import { messageApi } from '@/api/services'
import { APIError } from '@/api/client'
import type { ChatMessage } from '@/components/ChatWindow.vue'

export interface UseChatSessionOptions {
  getExpertId: () => string
  getModelId: () => string | undefined
}

export function useChatSession(options: UseChatSessionOptions) {
  const { t } = useI18n()
  const chatStore = useChatStore()
  const taskStore = useTaskStore()

  const {
    connectionState,
    backendAvailable,
    reconnectAttempts,
    connect: rawConnect,
    disconnect: rawDisconnect,
    checkConnection,
    waitForBackend,
  } = useConnection()

  const MAX_RECONNECT_ATTEMPTS = 10

  const messageSending = useMessageSending({
    get expertId() { return options.getExpertId() },
    get modelId() { return options.getModelId() },
    onError: (error) => {
      console.error('[useChatSession] Message sending error:', error)
    }
  })

  const sseHandler = useSSEHandler({
    getExpertId: () => options.getExpertId(),
    onComplete: (content) => {
      sseHandler.detectAndEmitSkillEvents(content)
    },
  })

  const { isSending, streamingContent } = messageSending
  const handleSSEEvent = sseHandler.handleSSEEvent

  const isAutonomousMode = computed(() => {
    const status = taskStore.currentTask?.status
    return status === 'autonomous_wait' || status === 'autonomous_working'
  })

  const autonomousPlaceholder = computed(() => {
    if (isAutonomousMode.value) {
      return t('chat.autonomousModeHint') || 'AI 正在自主执行任务，输入已禁用...'
    }
    return undefined
  })

  const connectToExpert = async (expert_id: string) => {
    console.log('[useChatSession] Connecting SSE for expert:', expert_id)

    await rawConnect(expert_id, {
      timeout: 10000,
      maxReconnectAttempts: 10,
      reconnectInterval: 3000,
      onEvent: handleSSEEvent,
      onConnectionChange: (connected) => {
        console.log('[useChatSession] SSE connection state:', connected)
      },
      onError: (error) => {
        console.error('[useChatSession] SSE error:', error)
      },
    })
  }

  const sendMessage = async (content: string): Promise<boolean> => {
    const expert_id = options.getExpertId()

    if (!expert_id) {
      console.error('[useChatSession] No expert selected')
      return false
    }

    if (!backendAvailable.value) {
      console.log('[useChatSession] Backend unavailable, waiting...')
      const restored = await waitForBackend(30000)
      if (!restored) {
        chatStore.addLocalMessage({
          expert_id,
          role: 'assistant',
          content: t('error.backendUnavailable') || '后端服务暂时不可用，请稍后重试',
          status: 'error',
        })
        return false
      }
    }

    if (!checkConnection()) {
      console.log('[useChatSession] SSE connection stale, reconnecting...')
      await rawDisconnect()
      connectToExpert(expert_id)
    }

    sseHandler.setSendingTimeoutProtection()

    const success = await messageSending.sendMessage(content)
    if (!success) {
      sseHandler.clearSendingTimeout()
    }
    return success
  }

  const retryMessage = async (message: ChatMessage): Promise<boolean> => {
    sseHandler.setSendingTimeoutProtection()

    const success = await messageSending.retryMessage(message.id, message.role, message.content)
    if (!success) {
      sseHandler.clearSendingTimeout()
    }
    return success
  }

  const stopGeneration = async () => {
    if (!isSending.value) return

    console.log('[useChatSession] Stopping generation...')

    const streamingAssistant = chatStore.getStreamingAssistant()
    const requestId = streamingAssistant?.request_id

    sseHandler.clearSendingTimeout()

    // 标记仅用于「点击停止 → 本地终态写入」窗口期的 SSE 抑制：
    // - 成功/409终态路径：本函数结束前就地清除（stopped 广播中的清除仅为幂等冗余）
    // - 失败路径：必须回滚，禁止静默吞掉后续 SSE
    if (requestId) {
      chatStore.markRequestManuallyStopped(requestId)
    }

    try {
      if (!requestId) return
      await messageApi.stopGeneration(requestId)
      // 停止已被后端接受，走下方本地终态收口
    } catch (error) {
      if (error instanceof APIError && error.status === 409 && requestId) {
        try {
          const requestStatus = await messageApi.getChatRequestStatus(requestId)
          if (requestStatus.status !== 'stopped' && requestStatus.status !== 'completed') {
            // 409 但后端并未终态收口：停止未生效，回滚标记让 SSE 继续
            chatStore.clearManuallyStoppedRequest(requestId)
            console.warn('[useChatSession] Stop rejected and request still active, SSE continues:', requestStatus.status)
            return
          }
          // 409 + DB 已终态：不会再有 stopped 广播，就地清除标记并按 DB 状态收口
          chatStore.clearManuallyStoppedRequest(requestId)

          if (requestStatus.status === 'completed') {
            // completed 语义收口：复用 retry 恢复路径同款 syncCompletedRequest，
            // 从 DB 同步最终 assistant 消息并显式移除临时消息（最终内容/metadata/真实 ID），
            // 不得以流式中间态内容冒充最终回答
            const synced = await messageSending.syncCompletedRequest(requestStatus, streamingAssistant?.id)
            if (!synced && streamingAssistant) {
              // 降级：DB 同步失败时保留本地内容按 completed 收口，由 heartbeat 增量同步事后纠正
              chatStore.updateMessageContent(
                streamingAssistant.id,
                streamingContent.value || streamingAssistant.content || '',
                'completed'
              )
              chatStore.updateMessageMetadata(streamingAssistant.id, {
                recovering: false,
                recovery_attempt: 0,
                recovery_round: null,
              })
            }
            chatStore.setCurrentStreaming(null)
            return
          }

          // stopped：停止语义下本地累计内容即最终内容
          if (streamingAssistant) {
            chatStore.updateMessageContent(
              streamingAssistant.id,
              streamingContent.value || streamingAssistant.content || '',
              'stopped'
            )
            chatStore.updateMessageMetadata(streamingAssistant.id, {
              recovering: false,
              recovery_attempt: 0,
              recovery_round: null,
            })
            chatStore.setCurrentStreaming(null)
          }
          return
        } catch (statusError) {
          // 无法确认后端状态：保守回滚，保持流可接收
          chatStore.clearManuallyStoppedRequest(requestId)
          console.warn('[useChatSession] Failed to reconcile stop status, SSE continues:', statusError)
          return
        }
      } else {
        // 网络错误 / 500 等：停止未被接受，回滚标记让 SSE 继续
        if (requestId) {
          chatStore.clearManuallyStoppedRequest(requestId)
        }
        console.warn('[useChatSession] Stop generation API failed, SSE continues:', error)
        return
      }
    }

    // 停止已被后端接受：写入前端本地终态
    if (streamingAssistant) {
      chatStore.updateMessageContent(
        streamingAssistant.id,
        streamingContent.value || streamingAssistant.content || '',
        'stopped'
      )
      chatStore.updateMessageMetadata(streamingAssistant.id, {
        recovering: false,
        recovery_attempt: 0,
        recovery_round: null,
      })
      chatStore.setCurrentStreaming(null)
    }

    // 本地终态写入后标记即完成使命：消息已非 streaming，晚到 SSE 自然落空。
    // 就地清除，标记生命周期收窄为「点击停止 → 本地终态写入」窗口，
    // 不再依赖 stopped 广播作为唯一清理路径（事件处理器中的清除保留为幂等冗余）。
    if (requestId) {
      chatStore.clearManuallyStoppedRequest(requestId)
    }
  }

  const initChat = async (expertId: string) => {
    console.log('[useChatSession] initChat:', expertId)

    if (isSending.value) {
      console.log('[useChatSession] Skipping init - message sending in progress')
      return
    }

    if (chatStore.currentExpertId === expertId && connectionState.value === 'connected') {
      console.log('[useChatSession] Already initialized for expert:', expertId)
      return
    }

    await chatStore.setCurrentExpert(expertId)
    connectToExpert(expertId)
  }

  const loadMoreMessages = async () => {
    await chatStore.loadMoreMessages()
  }

  const disconnect = async () => {
    await rawDisconnect()
  }

  watch(
    () => backendAvailable.value,
    async (isAvailable, wasAvailable) => {
      const expertId = options.getExpertId()
      if (isAvailable && !wasAvailable && expertId) {
        console.log('[useChatSession] Backend back online, reconnecting SSE...')
        reconnectAttempts.value = 0
        connectToExpert(expertId)
      }
    }
  )

  return {
    connectionState,
    backendAvailable,
    reconnectAttempts,
    MAX_RECONNECT_ATTEMPTS,
    isSending,
    isAutonomousMode,
    autonomousPlaceholder,

    initChat,
    sendMessage,
    retryMessage,
    stopGeneration,
    loadMoreMessages,
    disconnect,
  }
}
