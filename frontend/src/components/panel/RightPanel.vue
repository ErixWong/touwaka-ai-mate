<template>
  <div class="right-panel" :class="{ collapsed: isCollapsed }">
    <!-- 折叠时的展开按钮 -->
    <div v-if="isCollapsed" class="collapsed-bar" @click="togglePanel">
      <span class="expand-icon">◀</span>
      <span class="collapsed-text">{{ getTabLabel(activeTab) }}</span>
    </div>
    
    <!-- 展开时的内容 -->
    <template v-else>
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
        <TopicsTab 
          v-if="activeTab === 'topics'" 
          @select="handleTopicSelect" 
        />
        <DebugTab v-if="activeTab === 'debug'" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePanelStore, type TabId } from '@/stores/panel'
import { useUserStore } from '@/stores/user'
import TopicsTab from './TopicsTab.vue'
import DebugTab from './DebugTab.vue'
import type { Topic } from '@/types'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const panelStore = usePanelStore()
const userStore = useUserStore()

const isCollapsed = computed(() => panelStore.isCollapsed)
const activeTab = computed(() => panelStore.activeTab)

interface Tab {
  id: TabId
  label: string
  icon: string
  adminOnly?: boolean
}

const visibleTabs = computed<Tab[]>(() => {
  const tabs: Tab[] = [
    { id: 'topics', label: t('panel.topics'), icon: '💬' },
    { id: 'debug', label: t('panel.debug'), icon: '🔧', adminOnly: true },
  ]
  
  return tabs.filter(tab => {
    if (tab.adminOnly && !userStore.isAdmin) {
      return false
    }
    return true
  })
})

const getTabLabel = (tabId: TabId): string => {
  const tab = visibleTabs.value.find(t => t.id === tabId)
  return tab?.label || ''
}

const togglePanel = () => {
  panelStore.toggleCollapse()
}

const setActiveTab = (tabId: TabId) => {
  panelStore.setActiveTab(tabId)
}

const handleTopicSelect = (topic: Topic) => {
  // 处理 topic 选择
  console.log('Selected topic:', topic)
  emit('topic-select', topic)
}

const emit = defineEmits<{
  'topic-select': [topic: Topic]
}>()
</script>

<style scoped>
.right-panel {
  width: 320px;
  border-left: 1px solid var(--border-color, #e0e0e0);
  background: var(--sidebar-bg, #fff);
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  flex-shrink: 0;
}

.right-panel.collapsed {
  width: 40px;
}

.collapsed-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 4px;
  cursor: pointer;
  height: 100%;
  background: var(--sidebar-bg, #f5f5f5);
}

.collapsed-bar:hover {
  background: var(--hover-bg, #e8e8e8);
}

.expand-icon {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.collapsed-text {
  writing-mode: vertical-rl;
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-top: 8px;
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
