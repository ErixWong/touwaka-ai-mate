import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type TabId = 'expert' | 'topics' | 'tasks' | 'assistants' | 'debug' | 'skills'

// 分屏比例模式
export type SplitMode = 'default' | '5:5' | '3:2'

// 分屏比例配置（面板占比）
const SPLIT_CONFIG: Record<SplitMode, number> = {
  'default': 25,
  '5:5': 50,
  '3:2': 40,
}

export const usePanelStore = defineStore('panel', () => {
  // State
  const isCollapsed = ref(false)
  const activeTab = ref<TabId>('expert')  // 默认显示 expert
  const width = ref(320)
  const splitMode = ref<SplitMode>('default')

  // 计算当前面板比例
  const panelSize = computed(() => SPLIT_CONFIG[splitMode.value])

  // 切换分屏模式：default → 5:5 → 3:2 → default
  const toggleSplitMode = () => {
    const modes: SplitMode[] = ['default', '5:5', '3:2']
    const currentIndex = modes.indexOf(splitMode.value)
    const nextIndex = (currentIndex + 1) % modes.length
    const nextMode = modes[nextIndex] as SplitMode
    splitMode.value = nextMode
    // 保存到 localStorage
    localStorage.setItem('panel_split_mode', splitMode.value)
  }

  // 设置指定分屏模式
  const setSplitMode = (mode: SplitMode) => {
    splitMode.value = mode
    localStorage.setItem('panel_split_mode', mode)
  }

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
    if (savedTab && ['expert', 'topics', 'tasks', 'assistants', 'debug', 'skills'].includes(savedTab)) {
      activeTab.value = savedTab
    }
    // 恢复分屏模式
    const savedSplitMode = localStorage.getItem('panel_split_mode')
    if (savedSplitMode && ['default', '5:5', '3:2'].includes(savedSplitMode)) {
      splitMode.value = savedSplitMode as SplitMode
    }
  }

  // 自动调用初始化
  initFromStorage()

  return {
    isCollapsed,
    activeTab,
    width,
    splitMode,
    panelSize,
    toggleCollapse,
    toggleSplitMode,
    setSplitMode,
    setActiveTab,
    setWidth,
  }
})
