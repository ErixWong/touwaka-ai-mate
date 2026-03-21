<template>
  <div class="right-panel">
    <!-- Tab 导航 -->
    <div class="panel-header">
      <div class="panel-tabs">
        <button
          v-for="tab in visibleTabs"
          :key="tab.id"
          class="tab-btn"
          :class="{ active: activeTab === tab.id }"
          @click="setActiveTab(tab.id)"
        >
          <span class="tab-icon">{{ tab.icon }}</span>
          <span class="tab-label">{{ tab.label }}</span>
        </button>
      </div>
      <!-- 分屏下拉菜单 - 居右对齐 -->
      <div class="split-dropdown">
        <select
          :value="splitMode"
          @change="onSplitChange"
          class="split-select"
          title="选择分屏比例"
        >
          <option v-for="mode in splitModes" :key="mode.value" :value="mode.value">
            {{ mode.label }}
          </option>
        </select>
      </div>
    </div>

    <!-- Tab 内容 -->
    <div class="panel-content">
      <ExpertTab v-if="activeTab === 'expert'" />
      <TopicsTab
        v-if="activeTab === 'topics'"
        @select="handleTopicSelect"
      />
      <TasksTab v-if="activeTab === 'tasks'" />
      <AssistantTab v-if="activeTab === 'assistants'" />
      <SkillsTab v-if="activeTab === 'skills'" />
      <SkillsDirectoryTab v-if="activeTab === 'skills-directory'" />
      <DebugTab v-if="activeTab === 'debug'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { usePanelStore, type TabId, type SplitMode } from '@/stores/panel'
import { useUserStore } from '@/stores/user'
import ExpertTab from './ExpertTab.vue'
import TopicsTab from './TopicsTab.vue'
import TasksTab from './TasksTab.vue'
import AssistantTab from './AssistantTab.vue'
import SkillsTab from './SkillsTab.vue'
import SkillsDirectoryTab from './SkillsDirectoryTab.vue'
import DebugTab from './DebugTab.vue'
import type { Topic } from '@/types'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const route = useRoute()
const panelStore = usePanelStore()
const userStore = useUserStore()

const activeTab = computed(() => panelStore.activeTab)
const splitMode = computed(() => panelStore.splitMode)

// 分屏模式选项
const splitModes = [
  { value: 'default' as SplitMode, label: '默认', title: '默认比例 (左侧 75% : 右侧 25%)' },
  { value: '5:5' as SplitMode, label: '1:1', title: '1:1 分屏 (左右各 50%)' },
  { value: '3:2' as SplitMode, label: '3:2', title: '3:2 分屏 (左侧 60% : 右侧 40%)' },
  { value: '3:1' as SplitMode, label: '3:1', title: '3:1 分屏 (左侧 75% : 右侧 25%)' },
]

// 设置分屏模式
const setSplitMode = (mode: SplitMode) => {
  panelStore.setSplitMode(mode)
}

// 下拉菜单变更
const onSplitChange = (event: Event) => {
  const target = event.target as HTMLSelectElement
  setSplitMode(target.value as SplitMode)
}

// 判断是否是 skill-studio 专家模式
const is_skill_studio = computed(() => {
  return route.params.expertId === 'skill-studio'
})

// 根据当前专家自动切换默认 Tab
onMounted(() => {
  if (is_skill_studio.value && activeTab.value !== 'skills') {
    panelStore.setActiveTab('skills')
  }
})

watch(() => userStore.isAdmin, (isAdmin) => {
  if (!isAdmin && activeTab.value === 'debug') {
    panelStore.setActiveTab(is_skill_studio.value ? 'skills' : 'topics')
  }
}, { immediate: true })

interface Tab {
  id: TabId
  label: string
  icon: string
  adminOnly?: boolean
  skillStudioOnly?: boolean
}

const visibleTabs = computed<Tab[]>(() => {
  // skill-studio 模式：显示 expert、skills、skills-directory Tab
  if (is_skill_studio.value) {
    const tabs: Tab[] = [
      { id: 'expert', label: t('panel.expert'), icon: '👤' },
      { id: 'skills', label: t('panel.skills') || '技能', icon: '🛠️' },
      { id: 'skills-directory', label: t('panel.skillsDirectory') || '技能目录', icon: '📁' },
      { id: 'debug', label: t('panel.debug'), icon: '🔧', adminOnly: true },
    ]
    return tabs.filter(tab => {
      if (tab.adminOnly && !userStore.isAdmin) return false
      return true
    })
  }

  // 普通模式：显示 expert、topics、tasks、assistants Tab
  // 管理员额外显示 skills-directory Tab
  const tabs: Tab[] = [
    { id: 'expert', label: t('panel.expert'), icon: '👤' },
    { id: 'topics', label: t('panel.topics'), icon: '💬' },
    { id: 'tasks', label: t('panel.tasks') || '任务', icon: '📁' },
    { id: 'assistants', label: t('panel.assistants') || '助理', icon: '🤖' },
    { id: 'skills-directory', label: t('panel.skillsDirectory') || '技能目录', icon: '📁', adminOnly: true },
    { id: 'debug', label: t('panel.debug'), icon: '🔧', adminOnly: true },
  ]

  return tabs.filter(tab => {
    if (tab.adminOnly && !userStore.isAdmin) return false
    return true
  })
})

const setActiveTab = (tabId: TabId) => {
  panelStore.setActiveTab(tabId)
}

const handleTopicSelect = (topic: Topic) => {
  console.log('Selected topic:', topic)
  emit('topic-select', topic)
}

const emit = defineEmits<{
  'topic-select': [topic: Topic]
}>()
</script>

<style scoped>
.right-panel {
  height: 100%;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
  background: var(--sidebar-bg, #fff);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
  gap: 12px;
}

.panel-tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
  flex: 1;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: var(--hover-bg, #f5f5f5);
}

.tab-btn.active {
  background: var(--primary-light, #e3f2fd);
  color: var(--primary-color, #2196f3);
}

.tab-icon {
  font-size: 14px;
}

.tab-label {
  white-space: nowrap;
}

/* 分屏下拉菜单 - 居右 */
.split-dropdown {
  flex-shrink: 0;
}

.split-select {
  padding: 4px 8px;
  padding-right: 24px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  background: var(--secondary-bg, #f5f5f5);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
}

.split-select:hover {
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.split-select:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.panel-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
