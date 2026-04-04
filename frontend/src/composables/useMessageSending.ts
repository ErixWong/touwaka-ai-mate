import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { useTaskStore } from '@/stores/task'
import { useSkillDirectoryStore } from '@/stores/skillDirectory'
import { messageApi } from '@/api/services'
import type { Message } from '@/types'

export interface UseMessageSendingOptions {
  expertId: string | (() => string)
  modelId?: string | (() => string | undefined)
  onError?: (error: Error) => void
}

export interface SendMessageParams {
  content: string
  expertId: string
  modelId?: string
}

/**
 * 消息发送管理 composable
 * 
 * 职责：
 * - 管理消息发送流程
 * - 处理用户消息和助手消息的创建
 * - 管理流式内容累积器
 * - 处理发送错误
 */
export function useMessageSending(options: UseMessageSendingOptions) {
  const { t } = useI18n()
  const chatStore = useChatStore()
  const taskStore = useTaskStore()
  const skillDirectoryStore = useSkillDirectoryStore()

  // 流式内容累积器 - 用于 SSE delta 事件
  const streamingContent = ref('')
  // 流式思考内容累积器 - 用于 reasoning_delta 事件
  const streamingReasoningContent = ref('')

  // 当前正在流式输出的助手消息 - 从 store 自动推导
  const currentAssistantMessage = computed<Message | null>(() =>
    chatStore.messages.find(m => m.role === 'assistant' && m.status === 'streaming') || null
  )

  // 当前用户消息ID - 从当前助手消息自动推导
  const currentUserMessageId = computed<string | null>(() => {
    const assistant = currentAssistantMessage.value
    if (!assistant) return null

    const idx = chatStore.messages.findIndex(m => m.id === assistant.id)
    for (let i = idx - 1; i >= 0; i--) {
      const msg = chatStore.messages[i]
      if (msg && msg.role === 'user') {
        return msg.id
      }
    }
    return null
  })

  // 是否正在发送消息 - 从 store 自动推导
  const isSending = computed<boolean>(() =>
    chatStore.messages.some(m => m.status === 'streaming')
  )

  // 重置流式内容累积器
  const resetStreamingContent = () => {
    streamingContent.value = ''
    streamingReasoningContent.value = ''
  }

  // 追加流式内容
  const appendStreamingContent = (content: string) => {
    streamingContent.value += content
    return streamingContent.value
  }

  // 追加思考内容
  const appendReasoningContent = (content: string) => {
    streamingReasoningContent.value += content
    return streamingReasoningContent.value
  }

  // 获取流式内容
  const getStreamingContent = () => streamingContent.value
  const getReasoningContent = () => streamingReasoningContent.value

  // 设置流式内容（用于 SSE 更新后同步）
  const setStreamingContent = (content: string) => {
    streamingContent.value = content
  }

  // 设置思考内容
  const setReasoningContent = (content: string) => {
    streamingReasoningContent.value = content
  }

  // 获取 expertId（支持 getter 函数）
  const getExpertId = (): string => {
    return typeof options.expertId === 'function' ? options.expertId() : options.expertId
  }

  // 获取 modelId（支持 getter 函数）
  const getModelId = (): string | undefined => {
    if (!options.modelId) return undefined
    return typeof options.modelId === 'function' ? options.modelId() : options.modelId
  }

  // 发送消息
  const sendMessage = async (content: string): Promise<boolean> => {
    const expert_id = getExpertId()

    if (!expert_id) {
      console.error('[useMessageSending] No expert selected')
      return false
    }

    // 添加用户消息到本地
    chatStore.addLocalMessage({
      expert_id,
      role: 'user',
      content,
      status: 'completed',
    })

    // 添加助手消息占位（流式）
    chatStore.addLocalMessage({
      expert_id,
      role: 'assistant',
      content: '',
      status: 'streaming',
    })

    // 重置流式内容累积器
    resetStreamingContent()

    try {
      // 获取最后一条用户消息（刚添加的）
      const lastUserMessage = chatStore.messages[chatStore.messages.length - 1]

      // 构建消息参数
      const messageParams: {
        content: string
        expert_id: string
        model_id?: string
        task_id?: string
        working_path?: string
      } = {
        content: lastUserMessage?.content || content,
        expert_id,
        model_id: getModelId(),
      }

      // 任务模式：只传 task_id
      if (taskStore.currentTask) {
        messageParams.task_id = taskStore.currentTask.id
      }

      // 技能模式：传技能目录路径作为 working_path
      const activeSkill = skillDirectoryStore.currentWorkingSkill || skillDirectoryStore.browsingSkill
      if (!taskStore.currentTask && activeSkill) {
        let skillPath = activeSkill.path
        if (skillPath.startsWith('data/')) {
          skillPath = skillPath.substring(5)
        }
        messageParams.working_path = skillPath
      }

      // 发送消息
      const result = await messageApi.sendMessage(messageParams)
      console.log('[useMessageSending] Message sent:', result)
      return true

    } catch (error) {
      console.error('[useMessageSending] Send message error:', error)
      
      // 更新助手消息为错误状态
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

  // 重试消息
  const retryMessage = async (messageId: string, messageRole: string, messageContent: string): Promise<boolean> => {
    if (messageRole === 'assistant') {
      // 找到消息索引
      const messageIndex = chatStore.messages.findIndex(m => m.id === messageId)
      if (messageIndex === -1) {
        console.warn('[useMessageSending] Retry failed: message not found', messageId)
        return false
      }

      // 从当前消息往前找，找到最近的一条用户消息
      let userMessage: Message | null = null
      for (let i = messageIndex - 1; i >= 0; i--) {
        const msg = chatStore.messages[i]
        if (msg?.role === 'user') {
          userMessage = msg
          break
        }
      }

      if (userMessage) {
        // 删除失败的助手消息
        chatStore.removeMessage(messageId)
        // 重发对应的用户消息
        return await sendMessage(userMessage.content)
      } else {
        console.warn('[useMessageSending] Retry failed: no user message found', messageId)
        return false
      }
    } else {
      // 用户消息失败：直接重发
      chatStore.removeMessage(messageId)
      return await sendMessage(messageContent)
    }
  }

  return {
    // 状态
    isSending,
    currentAssistantMessage,
    currentUserMessageId,
    streamingContent,
    streamingReasoningContent,
    
    // 方法
    sendMessage,
    retryMessage,
    resetStreamingContent,
    appendStreamingContent,
    appendReasoningContent,
    getStreamingContent,
    getReasoningContent,
    setStreamingContent,
    setReasoningContent,
  }
}
