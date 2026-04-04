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
                <span v-if="currentModel" class="model-badge">{{ currentModel.name }}</span>
                <!-- 工作空间模式状态 -->
                <span
                  class="workspace-mode-tag"
                  :class="{
                    'in-task': workspaceMode === 'task',
                    'in-skill': workspaceMode === 'skill',
                    'no-workspace': workspaceMode === 'none'
                  }"
                  :title="workspaceMode === 'task' ? $t('chat.exitTaskMode') : workspaceMode === 'skill' ? $t('chat.exitSkillMode') : $t('chat.selectDirectory')"
                >
                  <!-- 任务模式 -->
                  <template v-if="workspaceMode === 'task'">
                    <span class="mode-icon task-icon"></span>
                    <span class="mode-label">{{ taskStore.currentTask?.title }}</span>
                  </template>
                  
                  <!-- 技能模式 -->
                  <template v-else-if="workspaceMode === 'skill'">
                    <span class="mode-icon skill-icon"></span>
                    <span class="mode-label">{{ currentSkillDisplayName }}</span>
                  </template>
                  
                  <!-- 无工作空间 -->
                  <template v-else>
                    <span class="mode-icon warning-icon"></span>
                    <span class="mode-label">{{ $t('chat.noDirectory') }}</span>
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
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/model'
import { useExpertStore } from '@/stores/expert'
import { useUserStore } from '@/stores/user'
import { useTaskStore } from '@/stores/task'
import { useSkillDirectoryStore } from '@/stores/skillDirectory'
import { usePanelStore } from '@/stores/panel'
import { useConnection } from '@/composables/useConnection'
import { useMessageSending } from '@/composables/useMessageSending'
import { useSSEHandler } from '@/composables/useSSEHandler'
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
const skillDirectoryStore = useSkillDirectoryStore()
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

// SSE 重连配置（用于显示）
const MAX_RECONNECT_ATTEMPTS = 10

// 使用消息发送 composable
const messageSending = useMessageSending({
  expertId: currentExpertId.value,
  modelId: currentModel.value?.id,
  onError: (error) => {
    console.error('[ChatView] Message sending error:', error)
  }
})

// 使用 SSE 处理 composable
const sseHandler = useSSEHandler({
  expertId: currentExpertId.value,
  currentAssistantMessage: () => messageSending.currentAssistantMessage.value,
  currentUserMessageId: () => messageSending.currentUserMessageId.value,
  getStreamingContent: messageSending.getStreamingContent,
  getReasoningContent: messageSending.getReasoningContent,
  resetStreamingContent: messageSending.resetStreamingContent,
  onComplete: () => {
    console.log('[ChatView] SSE complete')
  },
  onError: (error) => {
    console.error('[ChatView] SSE error:', error)
  }
})

// 导出状态给模板使用
const { isSending, currentAssistantMessage, streamingContent, streamingReasoningContent } = messageSending

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

// 自主运行模式 - 当任务状态为 autonomous_wait 或 autonomous_working 时禁用用户输入
const isAutonomousMode = computed(() => {
  const status = taskStore.currentTask?.status
  return status === 'autonomous_wait' || status === 'autonomous_working'
})

// 自主运行模式下的提示文字
const autonomousPlaceholder = computed(() => {
  if (isAutonomousMode.value) {
    return t('chat.autonomousModeHint') || 'AI 正在自主执行任务，输入已禁用...'
  }
  return undefined
})

// 工作空间模式：task | skill | none
type WorkspaceMode = 'task' | 'skill' | 'none'

const workspaceMode = computed<WorkspaceMode>(() => {
  // 任务优先：如果当前在任务模式
  if (taskStore.currentTask) return 'task'
  
  // 技能模式：已设置当前工作技能 或 正在浏览技能目录
  if (skillDirectoryStore.currentWorkingSkill || skillDirectoryStore.browsingSkill) return 'skill'
  
  return 'none'
})

// 当前技能显示名称（用于顶部标签）
const currentSkillDisplayName = computed(() => {
  // 优先使用工作技能
  if (skillDirectoryStore.currentWorkingSkill) {
    return skillDirectoryStore.currentWorkingSkill.name
  }
  // 其次使用正在浏览的技能
  if (skillDirectoryStore.browsingSkill) {
    return skillDirectoryStore.browsingSkill.name
  }
  return null
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

// 使用 SSE 处理器的 handleSSEEvent
const handleSSEEvent = sseHandler.handleSSEEvent

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

  // 设置超时保护
  sseHandler.setSendingTimeoutProtection()

  // 使用 composable 发送消息
  const success = await messageSending.sendMessage(content)
  if (!success) {
    console.error('[ChatView] Failed to send message')
  }
}

// 处理重试
const handleRetry = async (message: ChatMessage) => {
  // 设置超时保护
  sseHandler.setSendingTimeoutProtection()
  
  // 使用 composable 重试消息
  const success = await messageSending.retryMessage(message.id, message.role, message.content)
  if (!success) {
    console.error('[ChatView] Failed to retry message')
  }
}

// 停止生成
const handleStopGenerate = async () => {
  if (!isSending.value) return

  console.log('Stopping generation...')

  // 标记当前正在流式输出的消息为已停止
  const assistant = currentAssistantMessage.value
  if (assistant) {
    chatStore.updateMessageContent(
      assistant.id,
      streamingContent.value || '',
      'stopped'
    )
  }

  sseHandler.clearSendingTimeout()

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

// 从路由获取 taskId 和 skillName
const currentTaskId = computed(() => route.params.taskId as string | undefined)
const currentSkillName = computed(() => route.params.skillName as string | undefined)

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

// 监听路由参数变化（skillName）- 用于从 URL 恢复技能状态
watch(
  currentSkillName,
  async (skillName) => {
    console.log('Route skillName changed:', skillName)
    
    // 必须等用户登录后再处理
    if (!userStore.isLoggedIn) {
      console.log('User not logged in, skip skill handling')
      return
    }

    // 如果有任务模式，技能模式应该被忽略（任务优先）
    if (taskStore.currentTask) {
      console.log('Task mode active, ignoring skill route')
      return
    }

    if (skillName && skillDirectoryStore.browsingSkill?.name !== skillName) {
      // URL 中有 skillName，但当前技能不匹配，需要加载技能
      console.log('Loading skill from URL:', skillName)
      const success = await skillDirectoryStore.loadAndEnterSkillByName(skillName)
      if (!success) {
        // 技能加载失败（可能不存在），清除 URL 中的 skillName
        console.warn('Failed to load skill, removing skillName from URL')
        router.replace({
          name: 'chat',
          params: { expertId: currentExpertId.value }
        })
      }
    } else if (!skillName && skillDirectoryStore.browsingSkill) {
      // URL 中没有 skillName，但当前有技能浏览，退出技能模式
      console.log('No skillName in URL, exiting skill browse mode')
      skillDirectoryStore.exitBrowseMode()
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

/* 工作空间模式标签（融合到头部） */
.workspace-mode-tag {
  font-size: 12px;
  padding: 4px 10px;
  background: var(--secondary-bg, #f0f0f0);
  color: var(--text-secondary, #666);
  border-radius: 16px;
  margin-left: 8px;
  transition: all 0.25s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  letter-spacing: 0.02em;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* 模式图标基础样式 */
.workspace-mode-tag .mode-icon {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  flex-shrink: 0;
  position: relative;
}

/* 任务图标 - 文件夹样式 */
.workspace-mode-tag .mode-icon.task-icon {
  background: linear-gradient(135deg, #ffd54f 0%, #ffb300 100%);
  box-shadow: 0 1px 2px rgba(255, 179, 0, 0.3);
}

.workspace-mode-tag .mode-icon.task-icon::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 3px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 1px;
}

/* 技能图标 - 工具样式 */
.workspace-mode-tag .mode-icon.skill-icon {
  background: linear-gradient(135deg, #ce93d8 0%, #9c27b0 100%);
  box-shadow: 0 1px 2px rgba(156, 39, 176, 0.3);
}

.workspace-mode-tag .mode-icon.skill-icon::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border: 2px solid rgba(255, 255, 255, 0.7);
  border-radius: 2px;
}

/* 警告图标 */
.workspace-mode-tag .mode-icon.warning-icon {
  background: linear-gradient(135deg, #ffcc80 0%, #ff9800 100%);
  box-shadow: 0 1px 2px rgba(255, 152, 0, 0.3);
}

.workspace-mode-tag .mode-icon.warning-icon::before {
  content: '!';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 10px;
  font-weight: bold;
  color: white;
}

/* 模式标签文字 */
.workspace-mode-tag .mode-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 任务模式样式 */
.workspace-mode-tag.in-task {
  background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
  color: #1565c0;
  border: 1px solid rgba(33, 150, 243, 0.2);
}

/* 技能模式样式 */
.workspace-mode-tag.in-skill {
  background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%);
  color: #7b1fa2;
  border: 1px solid rgba(156, 39, 176, 0.2);
}

/* 未选择目录的警告样式 */
.workspace-mode-tag.no-workspace {
  background: linear-gradient(135deg, #fff8e1 0%, #ffecb3 100%);
  color: #e65100;
  border: 1px solid rgba(255, 152, 0, 0.3);
  animation: pulse-warning 2s ease-in-out infinite;
}

@keyframes pulse-warning {
  0%, 100% {
    box-shadow: 0 1px 3px rgba(255, 152, 0, 0.1);
  }
  50% {
    box-shadow: 0 2px 8px rgba(255, 152, 0, 0.25);
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
