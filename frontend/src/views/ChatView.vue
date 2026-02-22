<template>
  <div class="chat-view">
    <!-- 聊天头部 -->
    <div class="chat-header">
      <div class="expert-info">
        <h2 class="expert-name">{{ currentExpert?.name || $t('chat.title') }}</h2>
        <span v-if="currentModel" class="model-badge">{{ currentModel.name }}</span>
      </div>
      <div class="header-actions">
        <button class="btn-toggle-panel" @click="togglePanel">
          {{ panelStore.isCollapsed ? $t('panel.expand') : $t('panel.collapse') }}
        </button>
      </div>
    </div>

    <!-- 聊天主体 + 右侧面板 -->
    <div class="chat-body-wrapper">
      <!-- 聊天主体 -->
      <div class="chat-body">
        <template v-if="currentExpertId">
          <ChatWindow
            ref="chatWindowRef"
            :messages="chatStore.sortedMessages"
            :is-loading="isSending"
            @send="handleSendMessage"
            @retry="handleRetry"
          />
          
          <!-- SSE 连接状态指示器 -->
          <div v-if="!isConnected" class="connection-status">
            <span class="status-dot disconnected"></span>
            {{ $t('chat.connecting') || '连接中...' }}
          </div>
        </template>
        
        <div v-else class="no-expert-selected">
          <p>{{ $t('chat.selectExpert') }}</p>
          <button class="btn-select-expert" @click="router.push('/experts')">
            {{ $t('chat.goSelectExpert') }}
          </button>
        </div>
      </div>

      <!-- 右侧多功能面板 -->
      <RightPanel 
        v-if="currentExpertId"
        @topic-select="handleTopicSelect"
        @doc-select="handleDocSelect"
      />
    </div>

    <!-- 加载更多历史消息 -->
    <div v-if="chatStore.hasMoreMessages && currentExpertId" class="load-more">
      <button
        class="btn-load-more"
        :disabled="chatStore.isLoadingMore"
        @click="loadMoreMessages"
      >
        {{ chatStore.isLoadingMore ? $t('common.loading') : $t('chat.loadMore') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ChatWindow, { type ChatMessage } from '@/components/ChatWindow.vue'
import RightPanel from '@/components/panel/RightPanel.vue'
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/model'
import { useExpertStore } from '@/stores/expert'
import { useUserStore } from '@/stores/user'
import { usePanelStore } from '@/stores/panel'
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
const panelStore = usePanelStore()

const chatWindowRef = ref<InstanceType<typeof ChatWindow> | null>(null)
const eventSource = ref<EventSource | null>(null)
const isSending = ref(false)
const isConnected = ref(false)
const currentAssistantMessage = ref<Message | null>(null)

// 从路由参数获取 expertId
const currentExpertId = computed(() => route.params.expertId as string)

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

// 切换右侧面板
const togglePanel = () => {
  panelStore.toggleCollapse()
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

// 建立 SSE 连接到 Expert
const connectToExpert = (expert_id: string) => {
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
  })

  eventSource.value.addEventListener('start', (event) => {
    try {
      const data = JSON.parse(event.data)
      console.log('SSE start:', data)
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
  }
}

// 处理消息发送
const handleSendMessage = async (content: string) => {
  const expert_id = currentExpertId.value
  
  if (!expert_id) {
    console.error('No expert selected')
    return
  }

  const model_id = currentModel.value?.id || currentExpert.value?.expressive_model_id

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
    const userMessage = chatStore.messages.find(
      m => m.role === 'user' && new Date(m.created_at).getTime() < new Date(message.created_at || 0).getTime()
    )
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
    if (isLoggedIn && currentExpertId.value) {
      // 用户登录后，如果有 expertId，加载消息
      await initChat(currentExpertId.value)
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
  }
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

.chat-body {
  flex: 1;
  overflow: hidden;
  padding: 16px;
  position: relative;
  display: flex;
  flex-direction: column;
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

.load-more {
  display: flex;
  justify-content: center;
  padding: 12px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
}

.btn-load-more {
  padding: 8px 16px;
  background: var(--secondary-bg, #f5f5f5);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-load-more:hover:not(:disabled) {
  background: var(--hover-bg, #e8e8e8);
}

.btn-load-more:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
