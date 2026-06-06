<script setup lang="ts">
import { ref, shallowRef, computed, type Component, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardView from './DashboardView.vue'
import JobListView from './JobListView.vue'
import InboxListView from './InboxListView.vue'
import TalentPoolListView from './TalentPoolListView.vue'
import SmartMatchView from './SmartMatchView.vue'
import MatchResultListView from './MatchResultListView.vue'
import HistoryView from './HistoryView.vue'
import AIAssistantView from './AIAssistantView.vue'

const { t } = useI18n()

interface NavItem {
  key: string
  label: string
  icon: string
  component: Component
}

const navItems = computed<NavItem[]>(() => [
  { key: 'dashboard', label: t('resumeScreening.nav.dashboard'), icon: '📊', component: markRaw(DashboardView) },
  { key: 'jobs', label: t('resumeScreening.nav.jobs'), icon: '📋', component: markRaw(JobListView) },
  { key: 'inbox', label: t('resumeScreening.nav.inbox'), icon: '📨', component: markRaw(InboxListView) },
  { key: 'talent', label: t('resumeScreening.nav.talent'), icon: '👥', component: markRaw(TalentPoolListView) },
  { key: 'match', label: t('resumeScreening.nav.match'), icon: '🎯', component: markRaw(SmartMatchView) },
  { key: 'results', label: t('resumeScreening.nav.results'), icon: '📄', component: markRaw(MatchResultListView) },
  { key: 'history', label: t('resumeScreening.nav.history'), icon: '🕐', component: markRaw(HistoryView) },
  { key: 'ai', label: t('resumeScreening.nav.ai'), icon: '🤖', component: markRaw(AIAssistantView) },
])

const activeKey = ref('dashboard')
const currentComponent = shallowRef<Component>(navItems.value[0]!.component)

function switchNav(key: string) {
  activeKey.value = key
  const item = navItems.value.find(n => n.key === key)
  if (item) currentComponent.value = item.component
}
</script>

<template>
  <div class="rfs-container">
    <aside class="rfs-sidebar">
      <div class="rfs-sidebar-title">{{ t('resumeScreening.appTitle') }}</div>
      <nav class="rfs-nav">
        <button
          v-for="item in navItems"
          :key="item.key"
          :class="['rfs-nav-item', { active: activeKey === item.key }]"
          @click="switchNav(item.key)"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </button>
      </nav>
    </aside>
    <main class="rfs-main">
      <component :is="currentComponent" />
    </main>
  </div>
</template>

<style scoped>
.rfs-container {
  display: flex;
  height: calc(100vh - 60px);
  overflow: hidden;
}

.rfs-sidebar {
  width: 200px;
  min-width: 200px;
  background: var(--el-bg-color-page, #f5f7fa);
  border-right: 1px solid var(--el-border-color-light, #e4e7ed);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.rfs-sidebar-title {
  padding: 16px;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  border-bottom: 1px solid var(--el-border-color-light, #e4e7ed);
}

.rfs-nav {
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 2px;
}

.rfs-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: var(--el-text-color-regular, #606266);
  text-align: left;
  transition: all 0.2s;
}

.rfs-nav-item:hover {
  background: var(--el-fill-color-light, #f0f2f5);
}

.rfs-nav-item.active {
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary, #409eff);
  font-weight: 500;
}

.nav-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.nav-label {
  flex: 1;
}

.rfs-main {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  background: var(--el-bg-color, #fff);
}
</style>
