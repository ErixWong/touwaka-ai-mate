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
                :has-more-messages="chatStore.hasMoreMessages"
                :is-loading-more="chatStore.isLoadingMore"
                :expert-avatar="currentExpert?.avatar_base64"
                :expert-avatar-large="currentExpert?.avatar_large_base64"
                :show-command-hints="is_skill_studio"
                :custom-placeholder="is_skill_studio ? $t('chat.commandHint') : undefined"
                @send="handleSendMessage"
                @retry="handleRetry"
                @load-more="loadMoreMessages"
                @stop="handleStopGenerate"
              />
              
              <!-- SSE 连接状态指示器 -->
              <div v-if="!isConnected" class="connection-status">
                <span class="status-dot disconnected"></span>
                <span v-if="isReconnecting">
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
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
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
import { useNetworkStatus } from '@/composables/useNetworkStatus'
import { useSSE, type SSEEvent } from '@/composables/useSSE'
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
const { isBackendAvailable, waitForBackend } = useNetworkStatus()

const chatWindowRef = ref<InstanceType<typeof ChatWindow> | null>(null)
const isSending = ref(false)
const currentAssistantMessage = ref<Message | null>(null)

// 使用新的 SSE composable
const {
  isConnected,
  isReconnecting,
  reconnectAttempts,
  connect: connectSSE,
  disconnect: disconnectSSE,
} = useSSE()

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
let lastKnownMessageId = ref<string | null>(null)

// 处理 SSE 事件
const handleSSEEvent = async (event: SSEEvent) => {
  // 处理心跳事件
  if (event.event === 'heartbeat') {
    try {
      const data = JSON.parse(event.data)
      const serverLatestMessageId = data.latest_message_id
      
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
          chatStore.updateMessageContent(
            currentAssistantMessage.value.id,
            currentAssistantMessage.value.content + data.content
          )
        }
        break

      case 'tool_call':
        console.log('Tool call:', data)
        // 在当前消息中显示工具调用信息（包含参数）
        if (currentAssistantMessage.value && data.toolCalls) {
          const toolDetails = data.toolCalls.map((tc: any) => {
            const name = tc.displayName || tc.function?.name || tc.name || 'unknown'
            // 尝试解析参数
            let params = ''
            if (tc.function?.arguments) {
              try {
                const args = typeof tc.function.arguments === 'string'
                  ? JSON.parse(tc.function.arguments)
                  : tc.function.arguments
                // 显示关键参数（截断过长的值）
                const keys = Object.keys(args).slice(0, 3)
                if (keys.length > 0) {
                  const summary = keys.map(k => {
                    const val = String(args[k])
                    const truncated = val.length > 30 ? val.substring(0, 30) + '...' : val
                    return `${k}=${truncated}`
                  }).join(', ')
                  params = ` (${summary})`
                }
              } catch {
                // 解析失败则忽略参数
              }
            }
            return `🔧 ${name}${params}`
          }).join('\n')
          
          chatStore.updateMessageContent(
            currentAssistantMessage.value.id,
            currentAssistantMessage.value.content + `\n\n${toolDetails}\n`
          )
        }
        break

      case 'tool_results':
        console.log('Tool results:', data)
        // 在当前消息中显示工具执行结果摘要
        if (currentAssistantMessage.value && data.results) {
          const resultSummary = data.results.map((r: any) => {
            const name = r.toolName || 'unknown'
            const success = r.success ? '✅' : '❌'
            return `${success} ${name}`
          }).join('\n')
          
          chatStore.updateMessageContent(
            currentAssistantMessage.value.id,
            currentAssistantMessage.value.content + `\n${resultSummary}\n\n---\n`
          )
        }
        break

      case 'complete':
        if (currentAssistantMessage.value) {
          if (data.usage) {
            chatStore.updateMessageMetadata(currentAssistantMessage.value.id, {
              tokens: data.usage,
              model: data.model,
            })
          }
          chatStore.updateMessageContent(
            currentAssistantMessage.value.id,
            data.content || currentAssistantMessage.value.content,
            'completed'
          )
          
          // 检测技能相关操作，触发刷新事件
          const content = data.content || currentAssistantMessage.value.content || ''
          if (content.includes('Skill') && content.includes('successfully')) {
            if (content.includes('registered') || content.includes('updated')) {
              import('@/utils/eventBus').then(({ eventBus, EVENTS }) => {
                eventBus.emit(EVENTS.SKILL_REGISTERED)
              })
            } else if (content.includes('assigned')) {
              import('@/utils/eventBus').then(({ eventBus, EVENTS }) => {
                eventBus.emit(EVENTS.SKILL_ASSIGNED)
              })
            } else if (content.includes('unassigned')) {
              import('@/utils/eventBus').then(({ eventBus, EVENTS }) => {
                eventBus.emit(EVENTS.SKILL_UNASSIGNED)
              })
            } else if (content.includes('enabled') || content.includes('disabled')) {
              import('@/utils/eventBus').then(({ eventBus, EVENTS }) => {
                eventBus.emit(EVENTS.SKILL_TOGGLED)
              })
            } else if (content.includes('deleted')) {
              import('@/utils/eventBus').then(({ eventBus, EVENTS }) => {
                eventBus.emit(EVENTS.SKILL_DELETED)
              })
            }
          }
          
          currentAssistantMessage.value = null
        }
        isSending.value = false
        break

      case 'error':
        if (currentAssistantMessage.value) {
          chatStore.updateMessageContent(
            currentAssistantMessage.value.id,
            data.message || t('error.unknownError'),
            'error'
          )
          currentAssistantMessage.value = null
        }
        isSending.value = false
        break

      default:
        console.log('Unknown SSE event:', event.event, data)
    }
  } catch (e) {
    console.error('Parse SSE event error:', e)
  }
}

// 建立 SSE 连接到 Expert
const connectToExpert = async (expert_id: string) => {
  console.log('Connecting to SSE for expert:', expert_id)
  
  await connectSSE(expert_id, {
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
  if (!isBackendAvailable.value) {
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
  if (!isConnected.value) {
    console.log('SSE not connected, waiting for reconnection...')
    // 等待 SSE 重连（最多 5 秒）
    const startTime = Date.now()
    while (!isConnected.value && Date.now() - startTime < 5000) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    if (!isConnected.value) {
      console.error('SSE connection not established after waiting')
      chatStore.addLocalMessage({
        expert_id,
        role: 'assistant',
        content: t('chat.connectionLost'),
        status: 'error',
      })
      return
    }
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

  // 添加助手消息占位（流式）
  currentAssistantMessage.value = chatStore.addLocalMessage({
    expert_id,
    role: 'assistant',
    content: '',
    status: 'streaming',
  })

  isSending.value = true

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
      currentAssistantMessage.value.content || '',
      'stopped'
    )
    currentAssistantMessage.value = null
  }

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
  console.log('initChat called for expert:', expertId)
  // 避免重复初始化同一个 expert（检查 SSE 是否已连接）
  if (chatStore.currentExpertId === expertId && isConnected.value) {
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
      await disconnectSSE()
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
  () => isBackendAvailable.value,
  async (isAvailable, wasAvailable) => {
    // 后端从不可用变为可用，且当前有 expertId
    if (isAvailable && !wasAvailable && currentExpertId.value) {
      console.log('Backend is back online, reconnecting SSE...')
      // 重置重连计数
      reconnectAttempts.value = 0
      isReconnecting.value = false
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

onUnmounted(() => {
  // 清理 SSE 连接（useSSE 会自动处理）
  disconnectSSE()
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

/* 专家信息面板样式 */
.chat-info-panel {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--header-bg, #fff);
  flex-shrink: 0;
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
