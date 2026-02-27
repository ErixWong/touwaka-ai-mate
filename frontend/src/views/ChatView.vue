<template>
  <div class="chat-view">
    <!-- 聊天头部 -->
    <div class="chat-header">
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
      </div>
    </div>

    <!-- 聊天主体 + 右侧面板（可拖拽调整） -->
    <div class="chat-body-wrapper">
      <Splitpanes @resize="handlePanelResize">
        <!-- 聊天主体 -->
        <Pane :size="chatPaneSize" class="chat-pane">
          <div class="chat-body">
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
                :custom-placeholder="is_skill_studio ? '输入 / 查看快捷指令，或描述你想做什么...' : undefined"
                @send="handleSendMessage"
                @retry="handleRetry"
                @load-more="loadMoreMessages"
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
import { useNetworkStatus } from '@/composables/useNetworkStatus'
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
const { isBackendAvailable, waitForBackend } = useNetworkStatus()

const chatWindowRef = ref<InstanceType<typeof ChatWindow> | null>(null)
const eventSource = ref<EventSource | null>(null)
const isSending = ref(false)
const isConnected = ref(false)
const currentAssistantMessage = ref<Message | null>(null)

// SSE 重连配置
const RECONNECT_INTERVAL = 3000 // 重连间隔 3 秒
const MAX_RECONNECT_ATTEMPTS = 10 // 最大重连次数
const reconnectAttempts = ref(0)
const reconnectTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const isReconnecting = ref(false)

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

// 面板比例相关
const PANEL_WIDTH_KEY = 'chat_panel_width'
const DEFAULT_PANEL_SIZE = 25

const savedPanelSize = ref(
  parseFloat(localStorage.getItem(PANEL_WIDTH_KEY) || String(DEFAULT_PANEL_SIZE))
)

const chatPaneSize = computed(() => {
  return 100 - savedPanelSize.value
})

const panelPaneSize = computed(() => {
  return savedPanelSize.value
})

const handlePanelResize = (panes: { size: number }[]) => {
  if (panes.length === 2 && panes[1]) {
    savedPanelSize.value = panes[1].size
    localStorage.setItem(PANEL_WIDTH_KEY, String(panes[1].size))
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

// 清理重连定时器
const clearReconnectTimer = () => {
  if (reconnectTimer.value) {
    clearTimeout(reconnectTimer.value)
    reconnectTimer.value = null
  }
}

// 建立 SSE 连接到 Expert
const connectToExpert = (expert_id: string) => {
  // 清理重连定时器
  clearReconnectTimer()
  
  // 关闭现有连接
  if (eventSource.value) {
    eventSource.value.close()
    eventSource.value = null
  }

  const token = localStorage.getItem('access_token')
  const sseUrl = `/api/chat/stream?expert_id=${expert_id}&token=${encodeURIComponent(token || '')}`

  console.log('Connecting to SSE:', sseUrl)
  eventSource.value = new EventSource(sseUrl)
  isConnected.value = false

  eventSource.value.addEventListener('connected', (event) => {
    console.log('SSE connected:', event.data)
    isConnected.value = true
    reconnectAttempts.value = 0 // 重置重连计数
    isReconnecting.value = false
  })

  eventSource.value.addEventListener('start', (event) => {
    try {
      const data = JSON.parse(event.data)
      console.log('SSE start:', data)

      // 如果检测到新话题，刷新话题列表
      if (data.is_new_topic) {
        console.log('检测到新话题，刷新话题列表')
        chatStore.loadTopics({ expert_id: currentExpertId.value })
      }
    } catch (e) {
      console.error('Parse error:', e)
    }
  })

  eventSource.value.addEventListener('delta', (event) => {
    try {
      const data = JSON.parse(event.data)
      if (currentAssistantMessage.value) {
        chatStore.updateMessageContent(
          currentAssistantMessage.value.id,
          currentAssistantMessage.value.content + data.content
        )
      }
    } catch (e) {
      console.error('Parse error:', e)
    }
  })

  // 处理工具调用事件
  eventSource.value.addEventListener('tool_call', (event) => {
    try {
      const data = JSON.parse(event.data)
      console.log('Tool call:', data)
      
      // 在当前消息中显示工具调用信息
      if (currentAssistantMessage.value && data.toolCalls) {
        const toolNames = data.toolCalls.map((tc: any) =>
          tc.displayName || tc.function?.name || tc.name || 'unknown'
        ).join(', ')
        
        chatStore.updateMessageContent(
          currentAssistantMessage.value.id,
          currentAssistantMessage.value.content + `\n\n🔧 调用工具: ${toolNames}\n`
        )
      }
    } catch (e) {
      console.error('Parse tool_call error:', e)
    }
  })

  // 处理工具执行结果事件
  eventSource.value.addEventListener('tool_results', (event) => {
    try {
      const data = JSON.parse(event.data)
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
    } catch (e) {
      console.error('Parse tool_results error:', e)
    }
  })

  eventSource.value.addEventListener('complete', (event) => {
    try {
      const data = JSON.parse(event.data)
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
    } catch (e) {
      console.error('Parse error:', e)
    }
  })

  eventSource.value.addEventListener('error', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data)
      if (currentAssistantMessage.value) {
        chatStore.updateMessageContent(
          currentAssistantMessage.value.id,
          data.message || t('error.unknownError'),
          'error'
        )
        currentAssistantMessage.value = null
      }
      isSending.value = false
    } catch (e) {
      console.error('Parse error:', e)
    }
  })

  eventSource.value.onerror = (error) => {
    console.error('SSE error:', error)
    isConnected.value = false
    
    // 自动重连逻辑
    if (!isReconnecting.value && reconnectAttempts.value < MAX_RECONNECT_ATTEMPTS) {
      isReconnecting.value = true
      reconnectAttempts.value++
      
      console.log(`SSE connection lost. Reconnecting in ${RECONNECT_INTERVAL}ms... (attempt ${reconnectAttempts.value}/${MAX_RECONNECT_ATTEMPTS})`)
      
      reconnectTimer.value = setTimeout(() => {
        if (currentExpertId.value) {
          console.log(`Attempting to reconnect SSE... (${reconnectAttempts.value}/${MAX_RECONNECT_ATTEMPTS})`)
          connectToExpert(currentExpertId.value)
        }
      }, RECONNECT_INTERVAL)
    } else if (reconnectAttempts.value >= MAX_RECONNECT_ATTEMPTS) {
      console.error('SSE reconnection failed after maximum attempts')
      // 可以在这里添加用户提示
    }
  }
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

  // skill-studio 使用用户选择的模型，其他专家使用绑定的模型
  const model_id = is_skill_studio.value 
    ? selected_model_id.value 
    : (currentModel.value?.id || currentExpert.value?.expressive_model_id)

  // 添加用户消息到本地
  chatStore.addLocalMessage({
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
    // 使用 messageApi 发送消息（自动处理认证）
    const result = await messageApi.sendMessage({
      content,
      expert_id,
      model_id,
    })

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

// 初始化：加载 expert 的消息
const initChat = async (expertId: string) => {
  console.log('initChat called for expert:', expertId)
  // 避免重复初始化同一个 expert
  if (chatStore.currentExpertId === expertId && eventSource.value) {
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
      if (eventSource.value) {
        eventSource.value.close()
        eventSource.value = null
        isConnected.value = false
      }
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

onMounted(async () => {
  // 加载模型列表
  await modelStore.loadModels()
  // 加载专家列表
  await expertStore.loadExperts()
})

onUnmounted(() => {
  // 清理 SSE 连接
  if (eventSource.value) {
    eventSource.value.close()
    eventSource.value = null
  }
  // 清理重连定时器
  clearReconnectTimer()
})
</script>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--main-bg, #fff);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-toggle-panel {
  padding: 6px 12px;
  background: var(--secondary-bg, #f5f5f5);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-toggle-panel:hover {
  background: var(--hover-bg, #e8e8e8);
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
  height: 100%;
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
