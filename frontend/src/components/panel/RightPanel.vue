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
      <button class="collapse-btn" @click="togglePanel" :title="$t('panel.collapse')">
        ▶
      </button>
    </div>
    
    <!-- Tab 内容 -->
    <div class="panel-content">
      <ExpertTab v-if="activeTab === 'expert'" />
      <TopicsTab
        v-if="activeTab === 'topics'"
        @select="handleTopicSelect"
      />
      <TasksTab v-if="activeTab === 'tasks'" />
      <SkillsTab v-if="activeTab === 'skills'" />
      <DebugTab v-if="activeTab === 'debug'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { usePanelStore, type TabId } from '@/stores/panel'
import { useUserStore } from '@/stores/user'
import ExpertTab from './ExpertTab.vue'
import TopicsTab from './TopicsTab.vue'
import TasksTab from './TasksTab.vue'
import SkillsTab from './SkillsTab.vue'
import DebugTab from './DebugTab.vue'
import type { Topic } from '@/types'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const route = useRoute()
const panelStore = usePanelStore()
const userStore = useUserStore()

const activeTab = computed(() => panelStore.activeTab)

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
  // skill-studio 模式：显示 expert 和 skills Tab
  if (is_skill_studio.value) {
    const tabs: Tab[] = [
      { id: 'expert', label: t('panel.expert'), icon: '👤' },
      { id: 'skills', label: t('panel.skills') || '技能', icon: '🛠️' },
      { id: 'debug', label: t('panel.debug'), icon: '🔧', adminOnly: true },
    ]
    return tabs.filter(tab => {
      if (tab.adminOnly && !userStore.isAdmin) return false
      return true
    })
  }
  
  // 普通模式：显示 expert、topics、tasks Tab
  const tabs: Tab[] = [
    { id: 'expert', label: t('panel.expert'), icon: '👤' },
    { id: 'topics', label: t('panel.topics'), icon: '💬' },
    { id: 'tasks', label: t('panel.tasks') || '任务', icon: '📁' },
    { id: 'debug', label: t('panel.debug'), icon: '🔧', adminOnly: true },
  ]
  
  return tabs.filter(tab => {
    if (tab.adminOnly && !userStore.isAdmin) return false
    return true
  })
})

const togglePanel = () => {
  panelStore.toggleCollapse()
}

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
  border-left: 1px solid var(--border-color, #e0e0e0);
  background: var(--sidebar-bg, #fff);
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
}

.panel-tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
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

.collapse-btn {
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #666);
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
}

.collapse-btn:hover {
  background: var(--hover-bg, #f5f5f5);
}

.panel-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
