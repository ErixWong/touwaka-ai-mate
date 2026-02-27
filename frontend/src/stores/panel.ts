import { defineStore } from 'pinia'
import { ref } from 'vue'

export type TabId = 'expert' | 'topics' | 'debug' | 'skills'

export const usePanelStore = defineStore('panel', () => {
  // State
  const isCollapsed = ref(false)
  const activeTab = ref<TabId>('expert')  // 默认显示 expert
  const width = ref(320)

  // Actions
  const toggleCollapse = () => {
    isCollapsed.value = !isCollapsed.value
    // 持久化到 localStorage
    localStorage.setItem('panel_collapsed', String(isCollapsed.value))
  }

  const setActiveTab = (tabId: TabId) => {
    activeTab.value = tabId
    // 如果面板是收起的，展开它
    if (isCollapsed.value) {
      isCollapsed.value = false
    }
  }

  const setWidth = (newWidth: number) => {
    width.value = Math.min(Math.max(newWidth, 280), 600)
  }

  // 初始化时从 localStorage 恢复状态
  const initFromStorage = () => {
    const collapsed = localStorage.getItem('panel_collapsed')
    if (collapsed !== null) {
      isCollapsed.value = collapsed === 'true'
    }
    const savedTab = localStorage.getItem('panel_active_tab') as TabId | null
    if (savedTab && ['expert', 'topics', 'debug'].includes(savedTab)) {
      activeTab.value = savedTab
    }
  }

  // 自动调用初始化
  initFromStorage()

  return {
    isCollapsed,
    activeTab,
    width,
    toggleCollapse,
    setActiveTab,
    setWidth,
  }
})
