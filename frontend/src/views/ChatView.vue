<template>
  <div class="chat-view">
    <div class="chat-body-wrapper">
      <Splitpanes @resize="handlePanelResize">
        <Pane :size="chatPaneSize" class="chat-pane">
          <div class="chat-body">
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
                <span
                  class="workspace-mode-tag"
                  :class="{
                    'in-task': workspaceMode === 'task',
                    'in-skill': workspaceMode === 'skill',
                    'no-workspace': workspaceMode === 'none'
                  }"
                  :title="workspaceMode === 'task' ? $t('chat.exitTaskMode') : workspaceMode === 'skill' ? $t('chat.exitSkillMode') : $t('chat.selectDirectory')"
                >
                  <template v-if="workspaceMode === 'task'">
                    <span class="mode-icon task-icon"></span>
                    <span class="mode-label">{{ taskStore.currentTask?.title }}</span>
                  </template>
                  <template v-else-if="workspaceMode === 'skill'">
                    <span class="mode-icon skill-icon"></span>
                    <span class="mode-label">{{ currentSkillDisplayName }}</span>
                  </template>
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
                :is-loading="session.isSending.value"
                :disabled="session.isAutonomousMode.value"
                :has-more-messages="chatStore.hasMoreMessages"
                :is-loading-more="chatStore.isLoadingMore"
                :expert-avatar="currentExpert?.avatar_base64"
                :expert-avatar-large="currentExpert?.avatar_large_base64"
                :custom-placeholder="session.autonomousPlaceholder.value"
                @send="session.sendMessage"
                @retry="session.retryMessage"
                @load-more="session.loadMoreMessages"
                @stop="session.stopGeneration"
              />

              <div v-if="session.connectionState.value !== 'connected'" class="connection-status">
                <span class="status-dot disconnected"></span>
                <span v-if="session.connectionState.value === 'reconnecting'">
                  {{ $t('chat.reconnecting') || `连接断开，正在重连... (${session.reconnectAttempts.value}/${session.MAX_RECONNECT_ATTEMPTS})` }}
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
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import ChatWindow from '@/components/ChatWindow.vue'
import RightPanel from '@/components/panel/RightPanel.vue'
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/model'
import { useExpertStore } from '@/stores/expert'
import { useUserStore } from '@/stores/user'
import { useTaskStore } from '@/stores/task'
import { useSkillDirectoryStore } from '@/stores/skillDirectory'
import { usePanelStore } from '@/stores/panel'
import { useChatSession } from '@/composables/useChatSession'
import { clearRenderCaches } from '@/composables/useRenderCacheCleanup'
import type { Topic, Doc } from '@/types'

const route = useRoute()
const router = useRouter()
const chatStore = useChatStore()
const modelStore = useModelStore()
const expertStore = useExpertStore()
const userStore = useUserStore()
const taskStore = useTaskStore()
const skillDirectoryStore = useSkillDirectoryStore()
const panelStore = usePanelStore()

const chatWindowRef = ref<InstanceType<typeof ChatWindow> | null>(null)

const currentExpertId = computed(() => route.params.expertId as string)

const currentExpert = computed(() => {
  if (!currentExpertId.value) return null
  return expertStore.getExpertById(currentExpertId.value)
})

const currentModel = computed(() => {
  const expert = currentExpert.value
  if (expert?.expressive_model_id) {
    return modelStore.getModelById(expert.expressive_model_id)
  }
  return undefined
})

const session = useChatSession({
  getExpertId: () => currentExpertId.value,
  getModelId: () => currentModel.value?.id,
})

type WorkspaceMode = 'task' | 'skill' | 'none'

const workspaceMode = computed<WorkspaceMode>(() => {
  if (taskStore.currentTask) return 'task'
  if (skillDirectoryStore.currentWorkingSkill || skillDirectoryStore.browsingSkill) return 'skill'
  return 'none'
})

const currentSkillDisplayName = computed(() => {
  if (skillDirectoryStore.currentWorkingSkill) {
    return skillDirectoryStore.currentWorkingSkill.name
  }
  if (skillDirectoryStore.browsingSkill) {
    return skillDirectoryStore.browsingSkill.name
  }
  return null
})

const chatPaneSize = computed(() => {
  return 100 - panelStore.panelSize
})

const panelPaneSize = computed(() => {
  return panelStore.panelSize
})

const handlePanelResize = (panes: { size: number }[]) => {
  if (panes.length === 2 && panes[1]) {
    panelStore.setSplitMode('default')
    localStorage.setItem('chat_panel_width', String(panes[1].size))
  }
}

const handleTopicSelect = (topic: Topic) => {
  console.log('Selected topic summary:', topic)
  chatStore.setCurrentTopic(topic.id)
}

const handleDocSelect = (doc: Doc) => {
  console.log('Selected doc:', doc)
}

const currentTaskId = computed(() => route.params.taskId as string | undefined)
const currentSkillName = computed(() => route.params.skillName as string | undefined)

watch(
  () => route.params.expertId as string,
  async (expertId) => {
    console.log('Route expertId changed:', expertId)
    if (!userStore.isLoggedIn) return

    if (expertId) {
      clearRenderCaches()
      expertStore.setCurrentExpert(expertId)
      await session.initChat(expertId)
    } else {
      clearRenderCaches()
      chatStore.clearChat()
      await session.disconnect()
    }
  },
  { immediate: true }
)

watch(
  currentTaskId,
  async (taskId) => {
    if (!userStore.isLoggedIn) return

    if (taskId && taskStore.currentTask?.id !== taskId) {
      const success = await taskStore.loadAndEnterTask(taskId)
      if (!success) {
        router.replace({
          name: 'chat',
          params: { expertId: currentExpertId.value }
        })
      }
    } else if (!taskId && taskStore.currentTask) {
      taskStore.exitTask()
    }
  },
  { immediate: true }
)

watch(
  currentSkillName,
  async (skillName) => {
    if (!userStore.isLoggedIn) return
    if (taskStore.currentTask) return

    if (skillName && skillDirectoryStore.browsingSkill?.name !== skillName) {
      const success = await skillDirectoryStore.loadAndEnterSkillByName(skillName)
      if (!success) {
        router.replace({
          name: 'chat',
          params: { expertId: currentExpertId.value }
        })
      }
    } else if (!skillName && skillDirectoryStore.browsingSkill) {
      skillDirectoryStore.exitBrowseMode()
    }
  },
  { immediate: true }
)

watch(
  () => userStore.isLoggedIn,
  async (isLoggedIn) => {
    if (isLoggedIn && currentExpertId.value) {
      expertStore.setCurrentExpert(currentExpertId.value)
      await session.initChat(currentExpertId.value)
    }
  }
)

onMounted(async () => {
  await modelStore.loadModels()
  await expertStore.loadExperts()
})
</script>

<style scoped>
.chat-view {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-body-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
}

.chat-body-wrapper :deep(.splitpanes) {
  flex: 1;
  min-height: 0;
}

.chat-body-wrapper :deep(.splitpanes__splitter) {
  position: relative;
  flex: 0 0 16px;
  width: 16px;
  margin: 0 -6px;
  background: transparent;
  cursor: col-resize;
}

.chat-body-wrapper :deep(.splitpanes__splitter::before) {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: calc(100% - 32px);
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: var(--border-color, #d1d5db);
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
}

.chat-body-wrapper :deep(.splitpanes__splitter:hover::before),
.chat-body-wrapper :deep(.splitpanes__splitter:active::before) {
  background: var(--primary-color, #2563eb);
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
}

.chat-body-wrapper :deep(.splitpanes__pane) {
  min-height: 0;
  display: flex;
}

.chat-pane,
.panel-pane {
  min-height: 0;
}

.chat-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
  overflow: hidden;
}

.chat-info-panel {
  flex-shrink: 0;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 12px 12px 0 0;
  border-bottom: none;
  background: var(--bg-primary, #fff);
  padding: 16px 20px;
}

.expert-info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.expert-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--avatar-bg, #f3f4f6);
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.expert-name {
  margin: 0;
  font-size: 18px;
  color: var(--text-primary, #111827);
}

.model-badge {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--secondary-bg, #eff6ff);
  color: var(--primary-color, #2563eb);
  font-size: 12px;
  font-weight: 600;
}

.workspace-mode-tag {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 40%;
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
}

.workspace-mode-tag.in-task {
  background: #ecfdf5;
  color: #047857;
}

.workspace-mode-tag.in-skill {
  background: #eff6ff;
  color: #1d4ed8;
}

.workspace-mode-tag.no-workspace {
  background: #fff7ed;
  color: #c2410c;
}

.mode-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mode-icon {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: currentColor;
}

.chat-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.chat-content :deep(.chat-window) {
  flex: 1;
  min-height: 0;
}

.connection-status {
  position: absolute;
  left: 50%;
  bottom: 84px;
  transform: translateX(-50%);
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.84);
  color: #fff;
  font-size: 12px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
}

.status-dot.disconnected {
  background: #ef4444;
}

.no-expert-selected {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary, #6b7280);
}

.btn-select-expert {
  padding: 10px 16px;
  border: none;
  border-radius: 10px;
  background: var(--primary-color, #2563eb);
  color: #fff;
  cursor: pointer;
}

@media (max-width: 768px) {
  .chat-body {
    padding: 12px;
  }

  .expert-info {
    flex-wrap: wrap;
  }

  .workspace-mode-tag {
    margin-left: 0;
    max-width: 100%;
  }
}
</style>
