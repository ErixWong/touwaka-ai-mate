<template>
  <div class="skills-tab">
    <!-- 左侧：已注册技能列表 -->
    <div class="skills-list-panel">
      <div class="panel-header">
        <h3 class="panel-title">{{ $t('skills.registeredSkills') || '已注册技能' }}</h3>
        <span class="skills-count">{{ skills.length }}</span>
      </div>
      
      <div v-if="loading" class="loading-state">
        <span class="loading-spinner">⏳</span>
        <span>{{ $t('common.loading') || '加载中...' }}</span>
      </div>
      
      <div v-else-if="skills.length === 0" class="empty-state">
        <span class="empty-icon">📦</span>
        <p>{{ $t('skills.noSkills') || '暂无已注册技能' }}</p>
        <p class="empty-hint">{{ $t('skills.importHint') || '在左侧对话中输入：帮我导入技能 [路径]' }}</p>
      </div>
      
      <div v-else class="skills-items">
        <div 
          v-for="skill in skills" 
          :key="skill.id"
          class="skill-item"
          :class="{ 
            selected: selected_skill?.id === skill.id,
            inactive: !skill.is_active 
          }"
          @click="select_skill(skill)"
        >
          <div class="skill-item-main">
            <span class="skill-name">{{ skill.name }}</span>
            <span class="skill-version" v-if="skill.version">v{{ skill.version }}</span>
          </div>
          <div class="skill-item-meta">
            <span class="tool-count" v-if="skill.tool_count">
              {{ skill.tool_count }} {{ $t('skills.tools') || '工具' }}
            </span>
            <span 
              class="skill-status" 
              :class="{ active: skill.is_active }"
            >
              {{ skill.is_active ? ($t('skills.enabled') || '启用') : ($t('skills.disabled') || '禁用') }}
            </span>
          </div>
        </div>
      </div>
      
      <!-- 刷新按钮 -->
      <button class="refresh-btn" @click="load_skills" :disabled="loading">
        <span class="refresh-icon" :class="{ spinning: loading }">🔄</span>
        {{ $t('common.refresh') || '刷新' }}
      </button>
    </div>
    
    <!-- 右侧：技能目录树 / 技能详情 -->
    <div class="skills-detail-panel">
      <!-- 技能详情视图 -->
      <div v-if="selected_skill" class="skill-detail">
        <div class="detail-header">
          <h4 class="detail-title">{{ selected_skill.name }}</h4>
          <button class="close-btn" @click="selected_skill = null">✕</button>
        </div>
        
        <div class="detail-content">
          <p v-if="selected_skill.description" class="detail-description">
            {{ selected_skill.description }}
          </p>
          
          <div class="detail-meta">
            <div v-if="selected_skill.version" class="meta-item">
              <span class="meta-label">{{ $t('skills.version') || '版本' }}:</span>
              <span class="meta-value">{{ selected_skill.version }}</span>
            </div>
            <div v-if="selected_skill.author" class="meta-item">
              <span class="meta-label">{{ $t('skills.author') || '作者' }}:</span>
              <span class="meta-value">{{ selected_skill.author }}</span>
            </div>
            <div v-if="selected_skill.source_path" class="meta-item">
              <span class="meta-label">{{ $t('skills.path') || '路径' }}:</span>
              <span class="meta-value path">{{ selected_skill.source_path }}</span>
            </div>
          </div>
          
          <div v-if="selected_skill.tags?.length" class="detail-tags">
            <span 
              v-for="tag in selected_skill.tags" 
              :key="tag"
              class="tag"
            >
              {{ tag }}
            </span>
          </div>
          
          <!-- 工具列表 -->
          <div v-if="selected_skill.tools?.length" class="detail-tools">
            <h5 class="tools-title">{{ $t('skills.toolsList') || '工具列表' }}</h5>
            <div 
              v-for="tool in selected_skill.tools" 
              :key="tool.id"
              class="tool-item"
            >
              <span class="tool-name">{{ tool.name }}</span>
              <span v-if="tool.description" class="tool-desc">{{ tool.description }}</span>
            </div>
          </div>
          
          <!-- 已分配专家 -->
          <div v-if="selected_skill.assigned_experts?.length" class="detail-experts">
            <h5 class="experts-title">{{ $t('skills.assignedExperts') || '已分配专家' }}</h5>
            <div 
              v-for="expert in selected_skill.assigned_experts" 
              :key="expert.id"
              class="expert-item"
            >
              <span class="expert-name">{{ expert.name }}</span>
              <span 
                class="expert-status"
                :class="{ enabled: expert.is_enabled }"
              >
                {{ expert.is_enabled ? ($t('skills.enabled') || '启用') : ($t('skills.disabled') || '禁用') }}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 技能目录树视图 -->
      <div v-else class="skill-directory-panel">
        <div class="panel-header">
          <h3 class="panel-title">{{ $t('skillsDirectory.title') || '技能目录' }}</h3>
          <button class="refresh-btn-small" @click="loadDirectories" :disabled="skillDirectoryStore.isLoading">
            <span :class="{ spinning: skillDirectoryStore.isLoading }">🔄</span>
          </button>
        </div>
        
        <div v-if="skillDirectoryStore.isLoading" class="loading-state">
          <span class="loading-spinner">⏳</span>
          <span>{{ $t('common.loading') || '加载中...' }}</span>
        </div>
        
        <div v-else-if="skillDirectoryStore.skillDirectories.length === 0" class="empty-state">
          <span class="empty-icon">📁</span>
          <p>{{ $t('skillsDirectory.noDirectories') || '暂无技能目录' }}</p>
        </div>
        
        <div v-else class="directory-tree">
          <div
            v-for="dir in skillDirectoryStore.skillDirectories"
            :key="dir.name"
            class="directory-item"
            :class="{ selected: skillDirectoryStore.selectedSkill?.name === dir.name }"
            @click="selectDirectory({ name: dir.name, path: dir.path, skill_id: dir.skill_id })"
          >
            <span class="dir-icon">📁</span>
            <span class="dir-name">{{ dir.name }}</span>
          </div>
        </div>
        
        <!-- 选中目录的详情 -->
        <div v-if="skillDirectoryStore.selectedSkill" class="directory-detail">
          <div class="detail-section">
            <h4 class="section-title">{{ skillDirectoryStore.selectedSkill.name }}</h4>
            <p v-if="skillDirectoryStore.selectedSkill.description" class="section-desc">
              {{ skillDirectoryStore.selectedSkill.description }}
            </p>
            <p v-else class="section-desc empty">{{ $t('skillsDirectory.noDescription') || '暂无描述' }}</p>
          </div>
          
          <div class="detail-actions">
            <button 
              class="action-btn primary"
              :disabled="!!taskStore.currentTask"
              @click="handleSetWorkingDirectory"
            >
              {{ $t('skillsDirectory.setWorkingDirectory') || '设为工作目录' }}
            </button>
          </div>
          
          <p v-if="taskStore.currentTask" class="hint-text">
            {{ $t('skillsDirectory.exitTaskFirst') || '请先退出当前任务' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { skill_api } from '@/api/services'
import { eventBus, EVENTS } from '@/utils/eventBus'
import { useSkillDirectoryStore } from '@/stores/skillDirectory'
import { useTaskStore } from '@/stores/task'
import { useToastStore } from '@/stores/toast'
import type { Skill, SkillDetail } from '@/types'

const { t } = useI18n()
const skillDirectoryStore = useSkillDirectoryStore()
const taskStore = useTaskStore()
const toast = useToastStore()

const skills = ref<Skill[]>([])
const selected_skill = ref<SkillDetail | null>(null)
const loading = ref(false)

// 订阅技能相关事件
let unsubscribeCallbacks: (() => void)[] = []

onMounted(() => {
  load_skills()
  loadDirectories()
  
  // 订阅技能变更事件，自动刷新列表
  unsubscribeCallbacks = [
    eventBus.on(EVENTS.SKILL_REGISTERED, () => {
      load_skills()
      // 如果当前有选中的技能，也刷新详情
      if (selected_skill.value) {
        select_skill(selected_skill.value)
      }
    }),
    eventBus.on(EVENTS.SKILL_ASSIGNED, () => {
      if (selected_skill.value) {
        select_skill(selected_skill.value)
      }
    }),
    eventBus.on(EVENTS.SKILL_UNASSIGNED, () => {
      if (selected_skill.value) {
        select_skill(selected_skill.value)
      }
    }),
    eventBus.on(EVENTS.SKILL_TOGGLED, () => {
      load_skills()
    }),
    eventBus.on(EVENTS.SKILL_DELETED, () => {
      load_skills()
      selected_skill.value = null
    }),
  ]
})

onUnmounted(() => {
  // 取消订阅
  unsubscribeCallbacks.forEach(unsubscribe => unsubscribe())
})

// 加载技能列表
const load_skills = async () => {
  loading.value = true
  try {
    const res = await skill_api.list_all_skills({ include_inactive: true })
    if (res.success) {
      skills.value = res.skills || []
    }
  } catch (err) {
    console.error('Failed to load skills:', err)
  } finally {
    loading.value = false
  }
}

// 选择技能查看详情
const select_skill = async (skill: Skill | SkillDetail) => {
  loading.value = true
  try {
    const res = await skill_api.get_skill_detail(skill.id)
    if (res.success) {
      selected_skill.value = res.skill
    }
  } catch (err) {
    console.error('Failed to get skill detail:', err)
  } finally {
    loading.value = false
  }
}

// 加载技能目录
const loadDirectories = async () => {
  await skillDirectoryStore.loadSkillDirectories()
}

// 选择目录
const selectDirectory = async (dir: { name: string; path: string; skill_id?: string }) => {
  // 设置选中的技能目录
  skillDirectoryStore.selectSkill({
    name: dir.name,
    path: dir.path,
    is_registered: true,
    skill_id: dir.skill_id
  })
}

// 设为工作目录
const handleSetWorkingDirectory = () => {
  if (taskStore.currentTask) {
    toast.warning(t('skillsDirectory.exitTaskFirst'))
    return
  }
  
  const selected = skillDirectoryStore.selectedSkill
  if (selected) {
    skillDirectoryStore.enterSkillMode(selected)
    toast.success(t('skillsDirectory.workingDirectorySet', { name: selected.name }))
  }
}
</script>

<style scoped>
.skills-tab {
  height: 100%;
  display: flex;
  gap: 1px;
  background: var(--border-color, #e0e0e0);
  min-height: 0;
}

/* 左侧面板：已注册技能列表 */
.skills-list-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--sidebar-bg, #fff);
  min-height: 0;
}

/* 右侧面板：技能目录/详情 */
.skills-detail-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--sidebar-bg, #fff);
  min-height: 0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.skills-count {
  font-size: 12px;
  color: var(--text-secondary, #666);
  background: var(--bg-secondary, #f5f5f5);
  padding: 2px 8px;
  border-radius: 10px;
}

/* 加载和空状态 */
.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-secondary, #666);
}

.loading-spinner {
  font-size: 24px;
  margin-bottom: 8px;
  animation: spin 1s linear infinite;
}

.empty-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  margin-top: 8px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 技能项 */
.skills-items {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}

.skill-item {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.skill-item:hover {
  background: var(--bg-hover, #f0f0f0);
}

.skill-item.selected {
  background: var(--primary-light, #e3f2fd);
  border-color: var(--primary-color, #2196f3);
}

.skill-item.inactive {
  opacity: 0.6;
}

.skill-item-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.skill-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--text-primary, #333);
}

.skill-version {
  font-size: 11px;
  color: var(--text-tertiary, #999);
}

.skill-item-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.tool-count {
  color: var(--text-secondary, #666);
}

.skill-status {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
}

.skill-status.active {
  background: var(--success-light, #e8f5e9);
  color: var(--success-color, #4caf50);
}

/* 刷新按钮 */
.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 8px;
  padding: 8px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  background: var(--bg-primary, #fff);
  color: var(--text-secondary, #666);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--bg-hover, #f0f0f0);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-icon.spinning {
  animation: spin 1s linear infinite;
}

.refresh-btn-small {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  background: var(--bg-primary, #fff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.refresh-btn-small:hover:not(:disabled) {
  background: var(--bg-hover, #f0f0f0);
}

.refresh-btn-small:disabled {
  opacity: 0.5;
}

/* 技能详情 */
.skill-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--bg-primary, #fff);
  flex-shrink: 0;
}

.detail-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #666);
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: var(--bg-hover, #f0f0f0);
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.detail-description {
  font-size: 13px;
  color: var(--text-secondary, #666);
  line-height: 1.5;
  margin-bottom: 12px;
}

.detail-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.meta-item {
  display: flex;
  font-size: 12px;
}

.meta-label {
  color: var(--text-tertiary, #999);
  min-width: 50px;
}

.meta-value {
  color: var(--text-secondary, #666);
}

.meta-value.path {
  font-family: monospace;
  font-size: 11px;
  word-break: break-all;
}

/* 标签 */
.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.tag {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--bg-hover, #f0f0f0);
  border-radius: 4px;
  color: var(--text-secondary, #666);
}

/* 工具列表 */
.detail-tools,
.detail-experts {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.tools-title,
.experts-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #333);
  margin: 0 0 8px 0;
}

.tool-item,
.expert-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: 12px;
  border-bottom: 1px solid var(--border-light, #f0f0f0);
}

.tool-item:last-child,
.expert-item:last-child {
  border-bottom: none;
}

.tool-name,
.expert-name {
  color: var(--text-primary, #333);
}

.tool-desc {
  color: var(--text-tertiary, #999);
  font-size: 11px;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expert-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
}

.expert-status.enabled {
  background: var(--success-light, #e8f5e9);
  color: var(--success-color, #4caf50);
}

/* 技能目录面板 */
.skill-directory-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.directory-tree {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}

.directory-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.directory-item:hover {
  background: var(--bg-hover, #f0f0f0);
}

.directory-item.selected {
  background: var(--primary-light, #e3f2fd);
}

.dir-icon {
  font-size: 16px;
}

.dir-name {
  font-size: 13px;
  color: var(--text-primary, #333);
}

/* 目录详情 */
.directory-detail {
  border-top: 1px solid var(--border-color, #e0e0e0);
  padding: 12px;
  background: var(--bg-secondary, #f9f9f9);
  flex-shrink: 0;
}

.detail-section {
  margin-bottom: 12px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--text-primary, #333);
}

.section-desc {
  font-size: 12px;
  color: var(--text-secondary, #666);
  line-height: 1.5;
  margin: 0;
}

.section-desc.empty {
  color: var(--text-tertiary, #999);
  font-style: italic;
}

.detail-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn.primary {
  background: var(--primary-color, #2196f3);
  color: white;
}

.action-btn.primary:hover:not(:disabled) {
  background: var(--primary-dark, #1976d2);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hint-text {
  font-size: 11px;
  color: var(--warning-color, #ff9800);
  margin: 8px 0 0 0;
}
</style>
