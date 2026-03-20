<template>
  <div class="chat-view">
    <!-- 聊天主体 + 右侧面板（可拖拽调整） -->
    <div class="chat-body-wrapper">
      <Splitpanes @resize="handlePanelResize">
        <!-- 聊天主体 -->
        <Pane :size="chatPaneSize" class="chat-pane">
          <div class="chat-body">
            <!-- 专家信息面板（对话 box 顶部） -->
            <div class="chat-info-panel" v-if="currentExpertId">
              <div class="expert-info">
                <div
                  class="expert-avatar"
                  :style="currentExpert?.avatar_base64 ? { backgroundImage: `url(${currentExpert.avatar_base64})` } : {}"
                >
                  <span v-if="!currentExpert?.avatar_base64">🤖</span>
                </div>
                <h2 class="expert-name">{{ currentExpert?.name || $t('chat.title') }}</h2>
                <!-- skill-studio 显示模型选择器 -->
                <ModelSelector
                  v-if="is_skill_studio"
                  v-model="selected_model_id"
                  class="model-selector"
                />
                <span v-else-if="currentModel" class="model-badge">{{ currentModel.name }}</span>
                <!-- Task 模式状态 -->
                <span
                  class="task-mode-tag"
                  :class="{ 'in-task': taskStore.currentTask, 'no-task': !taskStore.currentTask }"
                  @click="taskStore.currentTask && handleExitTaskMode()"
                  :title="taskStore.currentTask ? $t('chat.exitTaskMode') : $t('chat.selectDirectory')"
                >
                  <template v-if="taskStore.currentTask">
                    📁 {{ taskStore.currentTask.title }}
                    <span class="exit-icon">✕</span>
                  </template>
                  <template v-else>
                    ⚠️ {{ $t('chat.noDirectory') }}
                  </template>
                </span>
              </div>
            </div>
            
            <div class="chat-content" v-if="currentExpertId">
              <ChatWindow
                ref="chatWindowRef"
                :messages="chatStore.sortedMessages"
                :is-loading="isSending"
                :disabled="isAutonomousMode"
                :has-more-messages="chatStore.hasMoreMessages"
                :is-loading-more="chatStore.isLoadingMore"
                :expert-avatar="currentExpert?.avatar_base64"
                :expert-avatar-large="currentExpert?.avatar_large_base64"
                :show-command-hints="is_skill_studio"
                :custom-placeholder="autonomousPlaceholder"
                @send="handleSendMessage"
                @retry="handleRetry"
                @load-more="loadMoreMessages"
                @stop="handleStopGenerate"
              />
              
              <!-- 连接状态指示器 -->
              <div v-if="connectionState !== 'connected'" class="connection-status">
                <span class="status-dot disconnected"></span>
                <span v-if="connectionState === 'reconnecting'">
                  {{ $t('chat.reconnecting') || `连接断开，正在重连... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})` }}
                </span>
                <span v-else>
                  {{ $t('chat.connecting') || '连接中...' }}
                </span>
              </div>
            </div>
            
            <div v-else class="no-expert-selected">
              <p>{{ $t('chat.selectExpert') }}</p>
              <button class="btn-select-expert" @click="router.push('/experts')">
                {{ $t('chat.goSelectExpert') }}
              </button>
            </div>
          </div>
        </Pane>

        <!-- 右侧多功能面板 -->
        <Pane :size="panelPaneSize" class="panel-pane">
          <RightPanel 
            v-if="currentExpertId"
            @topic-select="handleTopicSelect"
            @doc-select="handleDocSelect"
          />
        </Pane>
      </Splitpanes>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import ChatWindow, { type ChatMessage } from '@/components/ChatWindow.vue'
import RightPanel from '@/components/panel/RightPanel.vue'
import ModelSelector from '@/components/ModelSelector.vue'
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/model'
import { useExpertStore } from '@/stores/expert'
import { useUserStore } from '@/stores/user'
import { useTaskStore } from '@/stores/task'
import { usePanelStore } from '@/stores/panel'
import { useConnection, type SSEEvent } from '@/composables/useConnection'
import { messageApi } from '@/api/services'
import type { Message, Topic, Doc } from '@/types'

/**
 * ChatView - 聊天视图
 * 
 * 核心设计：
 * - 入口是 /chat/:expertId，不是 /chat/:topicId
 * - 一个 expert 对一个 user 只有一个连续的对话 session
 * - topic 只是对对话历史的阶段性总结，不是消息的容器
 * - 默认加载最近50条消息，支持滚动加载更多
 */

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const chatStore = useChatStore()
const modelStore = useModelStore()
const expertStore = useExpertStore()
const userStore = useUserStore()
const taskStore = useTaskStore()
const panelStore = usePanelStore()

// 使用统一的连接管理 composable
const {
  connectionState,
  backendAvailable,
  reconnectAttempts,
  connect,
  disconnect,
  checkConnection,
  waitForBackend,
} = useConnection()

const chatWindowRef = ref<InstanceType<typeof ChatWindow> | null>(null)
const isSending = ref(false)
const currentAssistantMessage = ref<Message | null>(null)
// 当前用户消息（用于 SSE 完成后获取新消息）
const currentUserMessageId = ref<string | null>(null)
// 流式内容累积器 - 避免依赖旧对象引用
const streamingContent = ref('')
// 流式思考内容累积器 - 用于 reasoning_delta 事件
const streamingReasoningContent = ref('')

// 安全超时：防止 isSending 永久为 true（SSE 流异常终止时）
let sendingTimeout: ReturnType<typeof setTimeout> | null = null
const SENDING_TIMEOUT_MS = 5 * 60 * 1000  // 5 分钟超时（考虑到复杂工具调用可能耗时较长）

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
    if (isSending.value) {
      console.warn('[ChatView] Sending timeout reached, resetting isSending to false')
      isSending.value = false
      if (currentAssistantMessage.value) {
        chatStore.updateMessageContent(
          currentAssistantMessage.value.id,
          streamingContent.value || '',
          'timeout'
        )
        currentAssistantMessage.value = null
      }
    }
  }, SENDING_TIMEOUT_MS)
}

// SSE 重连配置（用于显示）
const MAX_RECONNECT_ATTEMPTS = 10

// 从路由参数获取 expertId
// skill-studio 作为一个普通专家，通过 /chat/skill-studio 访问
const currentExpertId = computed(() => route.params.expertId as string)

// 判断是否是 skill-studio 模式
const is_skill_studio = computed(() => currentExpertId.value === 'skill-studio')

// skill-studio 模式下选择的模型
const selected_model_id = ref<string>('')

// 初始化模型选择
watch(() => modelStore.models, (models) => {
  if (is_skill_studio.value && models.length > 0 && !selected_model_id.value) {
    // 默认选择第一个可用模型
    const active_model = models.find(m => m.is_active)
    if (active_model) {
      selected_model_id.value = active_model.id
    }
  }
}, { immediate: true })

// 当前专家
const currentExpert = computed(() => {
  if (!currentExpertId.value) return null
  return expertStore.getExpertById(currentExpertId.value)
})

// 从当前专家获取模型
const currentModel = computed(() => {
  const expert = currentExpert.value
  if (expert?.expressive_model_id) {
    return modelStore.getModelById(expert.expressive_model_id)
  }
  return undefined
})

// 自主运行模式 - 当任务状态为 autonomous 时禁用用户输入
const isAutonomousMode = computed(() => {
  return taskStore.currentTask?.status === 'autonomous'
})

// 自主运行模式下的提示文字
const autonomousPlaceholder = computed(() => {
  if (isAutonomousMode.value) {
    return t('chat.autonomousModeHint') || 'AI 正在自主执行任务，输入已禁用...'
  }
  return is_skill_studio.value ? t('chat.commandHint') : undefined
})

// 面板比例相关 - 使用 panelStore 的分屏模式
const chatPaneSize = computed(() => {
  return 100 - panelStore.panelSize
})

const panelPaneSize = computed(() => {
  return panelStore.panelSize
})

const handlePanelResize = (panes: { size: number }[]) => {
  // 用户手动调整大小时，切换为 default 模式并保存
  if (panes.length === 2 && panes[1]) {
    panelStore.setSplitMode('default')
    localStorage.setItem('chat_panel_width', String(panes[1].size))
  }
}

// 处理 Topic 选择
const handleTopicSelect = (topic: Topic) => {
  console.log('Selected topic:', topic)
  // TODO: 加载该 topic 的消息
}

// 处理 Doc 选择
const handleDocSelect = (doc: Doc) => {
  console.log('Selected doc:', doc)
  // TODO: 打开文档预览
}

// 加载更多历史消息
const loadMoreMessages = async () => {
  await chatStore.loadMoreMessages()
}

// 记录上一次收到的最新消息 ID，用于避免重复拉取
const lastKnownMessageId = ref<string | null>(null)

// ==================== SSE Complete 事件处理 ====================

interface CompleteEventData {
  message_id?: string
  content?: string
  reasoning_content?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  model?: string
}

/**
 * 使用服务端返回的内容更新临时消息（fallback 方案）
 */
const updateTempMessageWithServerData = (data: CompleteEventData) => {
  if (!currentAssistantMessage.value) return
  
  const finalContent = data.content || streamingContent.value
  chatStore.updateMessageContent(currentAssistantMessage.value.id, finalContent, 'completed')
  
  if (data.reasoning_content || streamingReasoningContent.value) {
    chatStore.updateMessageReasoningContent(
      currentAssistantMessage.value.id,
      data.reasoning_content || streamingReasoningContent.value
    )
  }
  
  if (data.usage && data.usage.prompt_tokens !== undefined && data.usage.completion_tokens !== undefined && data.usage.total_tokens !== undefined) {
    chatStore.updateMessageMetadata(currentAssistantMessage.value.id, {
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
  if (!currentExpertId.value || !currentAssistantMessage.value) return false
  
  try {
    const messagesFromDb = await messageApi.getMessagesWithBefore(
      currentExpertId.value,
      messageId,
      { limit: 10 }
    )
    
    if (!messagesFromDb || messagesFromDb.length === 0) return false
    
    const assistantMsgIndex = messagesFromDb.findIndex(m => m.id === messageId)
    if (assistantMsgIndex === -1) return false
    
    const newMessages = messagesFromDb.slice(0, assistantMsgIndex + 1)
    
    // 移除临时消息
    const tempUserId = currentUserMessageId.value
    const tempAssistantId = currentAssistantMessage.value.id
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
        // 检查是否已存在相同 ID 的消息，避免重复
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
      
      console.log('[ChatView] Replaced temp messages with DB messages:', newMessages.length)
      return true
    } else {
      // 找不到临时消息，直接添加数据库消息
      console.log('[ChatView] Temp messages not found, adding DB messages directly')
      for (const msg of newMessages) {
        chatStore.addLocalMessage({ ...msg, status: 'completed' })
      }
      return true
    }
  } catch (error) {
    console.error('[ChatView] Failed to fetch messages from DB:', error)
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
  if (!currentAssistantMessage.value) {
    console.log('[ChatView] Setting isSending to false on complete event (no current message)')
    clearSendingTimeout()
    isSending.value = false
    return
  }
  
  // 更新已知的消息 ID，避免心跳检测误判导致刷新
  if (data.message_id) {
    lastKnownMessageId.value = data.message_id
  }
  
  // 尝试从数据库获取消息
  if (data.message_id && currentExpertId.value) {
    const success = await replaceTempMessagesWithDb(data.message_id)
    if (!success) {
      // 数据库获取失败，使用服务端返回的内容
      console.log('[ChatView] Failed to get DB messages, using server data')
      updateTempMessageWithServerData(data)
    }
  } else {
    // 没有 message_id，使用服务端返回的内容
    updateTempMessageWithServerData(data)
  }
  
  // 清除用户消息 ID
  currentUserMessageId.value = null
  
  // 检测技能相关操作
  const finalContent = data.content || streamingContent.value
  detectAndEmitSkillEvents(finalContent)
  
  currentAssistantMessage.value = null
  console.log('[ChatView] Setting isSending to false on complete event')
  clearSendingTimeout()
  isSending.value = false
}

// 处理 SSE 事件
const handleSSEEvent = async (event: SSEEvent) => {
  // 处理心跳事件
  if (event.event === 'heartbeat') {
    try {
      const data = JSON.parse(event.data)
      const serverLatestMessageId = data.latest_message_id
      
      // 如果正在发送消息，跳过心跳检测触发的刷新
      // 原因：SSE 过程中后端会保存 tool 消息，心跳检测会发现这些消息并触发刷新
      // 但我们希望在 SSE 完成后统一从数据库获取消息，避免重复刷新
      if (isSending.value) {
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
          console.log('检测到新消息，主动拉取:', {
            serverLatest: serverLatestMessageId,
            localLatest: localLatestId,
          })
          
          // 刷新消息列表（只拉取第一页最新消息）
          if (currentExpertId.value) {
            await chatStore.loadMessagesByExpert(currentExpertId.value, 1)
          }
        }
        
        // 更新已知的消息 ID
        lastKnownMessageId.value = serverLatestMessageId
      }
    } catch (e) {
      console.error('Parse heartbeat error:', e)
    }
    return
  }

  try {
    const data = JSON.parse(event.data)

    switch (event.event) {
      case 'connected':
        console.log('SSE connected:', data)
        break

      case 'start':
        console.log('SSE start:', data)
        // 如果检测到新话题，刷新话题列表
        if (data.is_new_topic) {
          console.log('检测到新话题，刷新话题列表')
          chatStore.loadTopics({ expert_id: currentExpertId.value })
        }
        break

      case 'delta':
        if (currentAssistantMessage.value) {
          // 使用累积器，不依赖旧对象引用
          streamingContent.value += data.content
          chatStore.updateMessageContent(
            currentAssistantMessage.value.id,
            streamingContent.value
          )
        }
        break

      case 'reasoning_delta':
        // 处理思考内容增量事件（DeepSeek R1、GLM-Z1、Qwen3 等支持）
        if (currentAssistantMessage.value) {
          streamingReasoningContent.value += data.content
          chatStore.updateMessageReasoningContent(
            currentAssistantMessage.value.id,
            streamingReasoningContent.value
          )
        }
        break

      case 'tool_call':
        // 工具调用开始 - 只显示简单的进度提示
        // 详细的工具调用信息会在 SSE 完成后从数据库获取（role: 'tool' 消息）
        console.log('Tool call:', data)
        if (currentAssistantMessage.value && data.toolCalls) {
          const toolNames = data.toolCalls.map((tc: { displayName?: string; function?: { name?: string }; name?: string }) => {
            return tc.displayName || tc.function?.name || tc.name || 'unknown'
          }).join(', ')
          
          // 只显示简单的进度提示，不显示详细参数
          streamingContent.value += `\n\n🔧 正在调用工具: ${toolNames}...\n`
          chatStore.updateMessageContent(
            currentAssistantMessage.value.id,
            streamingContent.value
          )
        }
        break

      case 'tool_result':
        // 单个工具执行完成 - 只显示简单的状态提示
        console.log('Tool result:', data)
        // 不再显示详细结果，等 SSE 完成后从数据库获取
        break

      case 'tool_results':
        // 所有工具执行完成（批量结果）
        console.log('Tool results:', data)
        // 不再显示详细结果，等 SSE 完成后从数据库获取
        break

      case 'complete':
        await handleCompleteEvent(data)
        break

      case 'error':
        console.log('SSE error event received:', data)
        if (currentAssistantMessage.value) {
          chatStore.updateMessageContent(
            currentAssistantMessage.value.id,
            data.message || t('error.unknownError'),
            'error'
          )
          currentAssistantMessage.value = null
        }
        console.log('[ChatView] Setting isSending to false on error event')
        clearSendingTimeout()
        isSending.value = false
        break

      default:
        console.log('Unknown SSE event:', event.event, data)
    }
  } catch (e) {
    console.error('Parse SSE event error:', e)
    // 解析错误时也要重置 isSending，防止输入框永久禁用
    if (event.event === 'complete' || event.event === 'error') {
      console.log('[ChatView] Setting isSending to false after parse error')
      clearSendingTimeout()
      isSending.value = false
      currentAssistantMessage.value = null
    }
  }
}

// 建立 SSE 连接到 Expert
const connectToExpert = async (expert_id: string) => {
  console.log('Connecting to SSE for expert:', expert_id)
  
  await connect(expert_id, {
    timeout: 10000,
    maxReconnectAttempts: 10,
    reconnectInterval: 3000,
    onEvent: handleSSEEvent,
    onConnectionChange: (connected) => {
      console.log('SSE connection state:', connected)
    },
    onError: (error) => {
      console.error('SSE error:', error)
    },
  })
}

// 处理消息发送
const handleSendMessage = async (content: string) => {
  const expert_id = currentExpertId.value

  if (!expert_id) {
    console.error('No expert selected')
    return
  }

  // 如果后端不可用，等待后端恢复
  if (!backendAvailable.value) {
    console.log('Backend is not available, waiting for it to come back...')
    const restored = await waitForBackend(30000) // 最多等待 30 秒
    if (!restored) {
      console.error('Backend is still not available after waiting')
      // 添加错误消息提示用户
      chatStore.addLocalMessage({
        expert_id,
        role: 'assistant',
        content: t('error.backendUnavailable') || '后端服务暂时不可用，请稍后重试',
        status: 'error',
      })
      return
    }
  }

  // 检查 SSE 连接状态
  if (!checkConnection()) {
    console.log('[ChatView] SSE connection stale, reconnecting...')
    await disconnect()
    connectToExpert(expert_id)
  }

  // skill-studio 使用用户选择的模型，其他专家使用绑定的模型
  const model_id = is_skill_studio.value
    ? selected_model_id.value
    : (currentModel.value?.id || currentExpert.value?.expressive_model_id)

  // 添加用户消息到本地
  const userMessage = chatStore.addLocalMessage({
    expert_id,
    role: 'user',
    content,
    status: 'completed',
  })
  // 保存用户消息 ID，用于 SSE 完成后获取新消息
  currentUserMessageId.value = userMessage.id

  // 添加助手消息占位（流式）
  currentAssistantMessage.value = chatStore.addLocalMessage({
    expert_id,
    role: 'assistant',
    content: '',
    status: 'streaming',
  })
  streamingContent.value = ''  // 重置流式内容累积器
  streamingReasoningContent.value = ''  // 重置思考内容累积器

  isSending.value = true
  setSendingTimeoutProtection()  // 设置超时保护

  try {
    // 构建消息参数
    // 注意：如果有图片，userMessage.content 已经是多模态 JSON 格式
    const messageParams: {
      content: string;
      expert_id: string;
      model_id?: string;
      task_id?: string;
      task_path?: string;
    } = {
      content: userMessage.content,  // 使用 chatStore 中处理后的内容（可能包含多模态 JSON）
      expert_id,
      model_id,
    }
    
    // 如果在任务模式下，添加 task_id 和 task_path
    if (taskStore.currentTask) {
      messageParams.task_id = taskStore.currentTask.id  // 使用数据库主键
      // 添加当前浏览路径
      if (taskStore.currentPath) {
        messageParams.task_path = taskStore.currentPath
      }
    }
    
    // 使用 messageApi 发送消息（自动处理认证）
    const result = await messageApi.sendMessage(messageParams)

    console.log('Message sent:', result)

  } catch (error) {
    console.error('Send message error:', error)
    if (currentAssistantMessage.value) {
      chatStore.updateMessageContent(
        currentAssistantMessage.value.id,
        error instanceof Error ? error.message : t('error.networkError'),
        'error'
      )
      currentAssistantMessage.value = null
    }
    clearSendingTimeout()
    isSending.value = false
  }
}

// 处理重试
const handleRetry = async (message: ChatMessage) => {
  // 删除失败的消息
  chatStore.removeMessage(message.id)

  // 重新发送
  if (message.role === 'assistant') {
    // 如果是助手消息失败，找到对应的用户消息重发
    // 注意：需要找最近的一条用户消息，而不是第一条
    const messageTime = new Date(message.created_at || 0).getTime()
    const userMessages = chatStore.messages.filter(
      m => m.role === 'user' && new Date(m.created_at).getTime() < messageTime
    )
    // 取最近的一条用户消息
    const userMessage = userMessages[userMessages.length - 1]
    if (userMessage) {
      await handleSendMessage(userMessage.content)
    }
  } else {
    // 直接重发原消息
    await handleSendMessage(message.content)
  }
}

// 停止生成
const handleStopGenerate = async () => {
  if (!isSending.value) return

  console.log('Stopping generation...')

  // 标记当前正在流式输出的消息为已停止
  if (currentAssistantMessage.value) {
    chatStore.updateMessageContent(
      currentAssistantMessage.value.id,
      streamingContent.value || '',
      'stopped'
    )
    currentAssistantMessage.value = null
  }

  clearSendingTimeout()
  isSending.value = false

  // 调用后端停止 API
  try {
    await messageApi.stopGeneration(currentExpertId.value!)
  } catch (error) {
    console.warn('Stop generation API not available:', error)
  }
}

// 初始化：加载 expert 的消息
const initChat = async (expertId: string) => {
  console.log('initChat called for expert:', expertId, 'isSending:', isSending.value)
  
  // 如果正在发送消息，跳过初始化，避免竞态条件
  if (isSending.value) {
    console.log('Skipping initChat - message sending in progress')
    return
  }
  
  // 避免重复初始化同一个 expert（检查 SSE 是否已连接）
  if (chatStore.currentExpertId === expertId && connectionState.value === 'connected') {
    console.log('Already initialized for expert:', expertId)
    return
  }

  // 设置当前专家并加载消息
  await chatStore.setCurrentExpert(expertId)

  // 设置 expertStore 的当前专家
  expertStore.setCurrentExpert(expertId)

  // 建立 SSE 连接
  connectToExpert(expertId)
}

// 从路由获取 taskId
const currentTaskId = computed(() => route.params.taskId as string | undefined)

// 监听路由参数变化（expertId）
watch(
  () => route.params.expertId as string,
  async (expertId) => {
    console.log('Route expertId changed:', expertId, 'isLoggedIn:', userStore.isLoggedIn)
    // 必须等用户登录后再加载消息
    if (!userStore.isLoggedIn) {
      console.log('User not logged in, skip loading messages')
      return
    }

    if (expertId) {
      await initChat(expertId)
    } else {
      // 没有 expertId，清除聊天状态
      chatStore.clearChat()
      await disconnect()
    }
  },
  { immediate: true }
)

// 监听路由参数变化（taskId）- 用于从 URL 恢复任务状态
watch(
  currentTaskId,
  async (taskId) => {
    console.log('Route taskId changed:', taskId)
    
    // 必须等用户登录后再处理
    if (!userStore.isLoggedIn) {
      console.log('User not logged in, skip task handling')
      return
    }

    if (taskId && taskStore.currentTask?.id !== taskId) {
      // URL 中有 taskId，但当前任务不匹配，需要加载任务
      console.log('Loading task from URL:', taskId)
      const success = await taskStore.loadAndEnterTask(taskId)
      if (!success) {
        // 任务加载失败（可能不存在或无权限），清除 URL 中的 taskId
        console.warn('Failed to load task, removing taskId from URL')
        router.replace({
          name: 'chat',
          params: { expertId: currentExpertId.value }
        })
      }
    } else if (!taskId && taskStore.currentTask) {
      // URL 中没有 taskId，但当前有任务，退出任务模式
      console.log('No taskId in URL, exiting task mode')
      taskStore.exitTask()
    }
  },
  { immediate: true }
)

// 监听用户登录状态变化
watch(
  () => userStore.isLoggedIn,
  async (isLoggedIn) => {
    console.log('User login state changed:', isLoggedIn, 'currentExpertId:', currentExpertId.value)
    if (isLoggedIn && currentExpertId.value) {
      // 用户登录后，如果有 expertId，加载消息
      console.log('User logged in, initializing chat for expert:', currentExpertId.value)
      await initChat(currentExpertId.value)
    }
  }
)

// 监听后端可用性变化 - 当后端恢复时自动重连 SSE
watch(
  () => backendAvailable.value,
  async (isAvailable, wasAvailable) => {
    // 后端从不可用变为可用，且当前有 expertId
    if (isAvailable && !wasAvailable && currentExpertId.value) {
      console.log('Backend is back online, reconnecting SSE...')
      // 重置重连计数
      reconnectAttempts.value = 0
      // 重新建立 SSE 连接
      connectToExpert(currentExpertId.value)
    }
  }
)

// 退出任务模式
const handleExitTaskMode = () => {
  taskStore.exitTask()
  // 清除 URL 中的 taskId
  if (route.params.taskId) {
    router.replace({
      name: 'chat',
      params: { expertId: currentExpertId.value }
    })
  }
}

onMounted(async () => {
  // 加载模型列表
  await modelStore.loadModels()
  // 加载专家列表
  await expertStore.loadExperts()
})
</script>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--main-bg, #fff);
}

.chat-body-wrapper {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.chat-pane {
  height: 100%;
}

.panel-pane {
  height: 100%;
  padding: 16px;
  padding-left: 6px;
}

.chat-body {
  height: 100%;
  overflow: hidden;
  padding: 16px;
  position: relative;
  display: flex;
  flex-direction: column;
}

.chat-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* 专家信息面板样式 - 上圆角+下直角，与 chatbox 融为一体 */
.chat-info-panel {
  padding: 12px 16px;
  background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
  flex-shrink: 0;
  border-radius: 12px 12px 0 0;
  border: 1px solid var(--border-color, #e0e0e0);
  border-bottom: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.expert-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.expert-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  background-color: var(--secondary-bg, #f8f9fa);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.expert-name {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.model-badge {
  font-size: 12px;
  padding: 2px 8px;
  background: var(--badge-bg, #e3f2fd);
  color: var(--primary-color, #2196f3);
  border-radius: 12px;
}

.model-selector {
  margin-left: 8px;
}

.no-expert-selected {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary, #666);
  gap: 16px;
}

.btn-select-expert {
  padding: 10px 24px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.btn-select-expert:hover {
  background: var(--primary-hover, #1976d2);
}

.connection-status {
  position: absolute;
  top: 8px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  background: var(--secondary-bg, #f5f5f5);
  border-radius: 12px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  z-index: 10;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.connected {
  background: #4caf50;
}

.status-dot.disconnected {
  background: #ff9800;
}

/* Task 模式标签（融合到头部） */
.task-mode-tag {
  font-size: 12px;
  padding: 2px 8px;
  background: var(--secondary-bg, #f0f0f0);
  color: var(--text-hint, #999);
  border-radius: 10px;
  margin-left: 8px;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.task-mode-tag.in-task {
  background: var(--primary-color, #2196f3);
  color: white;
  cursor: pointer;
}

.task-mode-tag.in-task:hover {
  background: var(--primary-hover, #1976d2);
}

.task-mode-tag .exit-icon {
  font-size: 10px;
  opacity: 0.7;
  margin-left: 2px;
}

.task-mode-tag.in-task:hover .exit-icon {
  opacity: 1;
}

/* 未选择目录的警告样式 */
.task-mode-tag.no-task {
  background: var(--warning-bg, #fff3e0);
  color: var(--warning-color, #e65100);
  border: 1px solid var(--warning-border, #ffb74d);
  animation: pulse-warning 2s ease-in-out infinite;
}

@keyframes pulse-warning {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
</style>

<style>
.splitpanes--horizontal > .splitpanes__splitter {
  position: relative;
  background: transparent;
  cursor: col-resize;
  width: 10px;
  min-width: 10px;
  margin: 0 -5px;
  z-index: 10;
}

.splitpanes--horizontal > .splitpanes__splitter::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 100%;
  background: var(--border-color, #e0e0e0);
  border-radius: 2px;
  transition: background 0.2s, width 0.2s;
}

.splitpanes--horizontal > .splitpanes__splitter:hover::before,
.splitpanes--horizontal > .splitpanes__splitter:active::before {
  width: 6px;
  background: var(--primary-color, #2196f3);
}

.splitpanes--horizontal > .splitpanes__splitter::after {
  content: '⋮';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 12px;
  color: var(--text-hint, #999);
  pointer-events: none;
  transition: color 0.2s;
}

.splitpanes--horizontal > .splitpanes__splitter:hover::after {
  color: var(--primary-color, #2196f3);
}

.splitpanes__pane {
  overflow: hidden;
}
</style>
