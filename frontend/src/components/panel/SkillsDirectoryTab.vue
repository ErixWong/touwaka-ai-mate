<template>
  <div class="skills-directory-tab">
    <!-- 头部 -->
    <div class="skills-header">
      <h2 class="title">{{ $t('panel.skillsDirectory') || '技能目录' }}</h2>
      <div class="header-actions">
        <button class="btn-refresh" @click="handleRefresh" :disabled="skillDirectoryStore.isLoading" :title="$t('common.refresh') || '刷新'">
          <span class="icon">↻</span>
        </button>
      </div>
    </div>

    <!-- 主内容区：左右分栏 -->
    <div class="skills-content">
      <!-- 左侧：技能目录树 -->
      <div class="skills-tree-panel">
        <div class="panel-title">{{ $t('skills.directoryTree') || '目录树' }}</div>
        
        <div v-if="skillDirectoryStore.isLoading" class="loading">
          {{ $t('common.loading') || '加载中...' }}
        </div>

        <div v-else-if="skillDirectoryStore.skillDirectories.length === 0" class="empty">
          {{ $t('skills.noSkills') || '暂无技能' }}
        </div>

        <div v-else class="skill-list">
          <div
            v-for="skill in skillDirectoryStore.skillDirectories"
            :key="skill.name"
            class="skill-item"
            :class="{ 
              'selected': skillDirectoryStore.selectedSkill?.name === skill.name,
              'is-working': skillDirectoryStore.currentWorkingSkill?.name === skill.name
            }"
            @click="handleSelectSkill(skill)"
          >
            <span class="skill-icon">🛠️</span>
            <div class="skill-info">
              <div class="skill-name">{{ skill.name }}</div>
              <div class="skill-meta">
                <span v-if="skill.tools?.length" class="tool-count">
                  {{ skill.tools.length }} {{ $t('skills.tools') || '工具' }}
                </span>
                <span v-if="skill.is_registered" class="registered-badge">
                  {{ $t('skills.registered') || '已注册' }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：技能信息面板 -->
      <div class="skill-info-panel">
        <template v-if="selectedSkillDetail">
          <div class="panel-title">{{ $t('skills.info') || '技能信息' }}</div>
          
          <div class="info-content">
            <!-- 基本信息 -->
            <div class="info-section">
              <div class="info-row">
                <span class="info-label">{{ $t('skills.name') || '名称' }}:</span>
                <span class="info-value">{{ selectedSkillDetail.name }}</span>
              </div>
              
              <div v-if="selectedSkillDetail.description" class="info-row">
                <span class="info-label">{{ $t('skills.description') || '描述' }}:</span>
                <span class="info-value description">{{ selectedSkillDetail.description }}</span>
              </div>

              <div v-if="selectedSkillDetail.version" class="info-row">
                <span class="info-label">{{ $t('skills.version') || '版本' }}:</span>
                <span class="info-value">{{ selectedSkillDetail.version }}</span>
              </div>

              <div v-if="selectedSkillDetail.author" class="info-row">
                <span class="info-label">{{ $t('skills.author') || '作者' }}:</span>
                <span class="info-value">{{ selectedSkillDetail.author }}</span>
              </div>
            </div>

            <!-- 工具列表 -->
            <div v-if="selectedSkillDetail.tools?.length" class="info-section">
              <div class="section-title">{{ $t('skills.toolsList') || '工具列表' }}</div>
              <div class="tools-list">
                <div
                  v-for="tool in selectedSkillDetail.tools"
                  :key="tool.id"
                  class="tool-item"
                >
                  <span class="tool-icon">🔧</span>
                  <div class="tool-info">
                    <div class="tool-name">{{ tool.name }}</div>
                    <div v-if="tool.description" class="tool-desc">{{ tool.description }}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 分配的专家 -->
            <div v-if="selectedSkillDetail.assigned_experts?.length" class="info-section">
              <div class="section-title">{{ $t('skills.assignedExperts') || '已分配专家' }}</div>
              <div class="experts-list">
                <div
                  v-for="expert in selectedSkillDetail.assigned_experts"
                  :key="expert.id"
                  class="expert-item"
                >
                  <span class="expert-icon">👤</span>
                  <span class="expert-name">{{ expert.name }}</span>
                  <span v-if="expert.is_enabled" class="enabled-badge">{{ $t('skills.enabled') || '已启用' }}</span>
                </div>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="info-actions">
              <button
                v-if="!isCurrentWorkingSkill"
                class="btn-set-working"
                @click="handleSetWorkingSkill"
                :title="$t('skills.setWorkingDirectory') || '设为当前工作目录'"
              >
                <span class="btn-icon">📁</span>
                <span>{{ $t('skills.setWorkingDirectory') || '设为工作目录' }}</span>
              </button>
              <button
                v-else
                class="btn-exit-working"
                @click="handleExitWorkingSkill"
                :title="$t('skills.exitWorkingDirectory') || '退出工作目录'"
              >
                <span class="btn-icon">✕</span>
                <span>{{ $t('skills.exitWorkingDirectory') || '退出工作目录' }}</span>
              </button>
            </div>
          </div>
        </template>

        <div v-else class="no-selection">
          <p>{{ $t('skills.selectSkill') || '请选择一个技能查看详情' }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSkillDirectoryStore, type SkillDirectoryItem } from '@/stores/skillDirectory'
import { useTaskStore } from '@/stores/task'
import { useToastStore } from '@/stores/toast'
import type { SkillDetail } from '@/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const skillDirectoryStore = useSkillDirectoryStore()
const taskStore = useTaskStore()
const toast = useToastStore()

// 选中的技能详情
const selectedSkillDetail = ref<SkillDetail | null>(null)
const isLoadingDetail = ref(false)

// 是否是当前工作技能
const isCurrentWorkingSkill = computed(() => {
  return skillDirectoryStore.currentWorkingSkill?.name === skillDirectoryStore.selectedSkill?.name
})

// 选择技能
const handleSelectSkill = async (skill: SkillDirectoryItem) => {
  skillDirectoryStore.selectSkill(skill)
  
  // 加载技能详情
  if (skill.skill_id) {
    isLoadingDetail.value = true
    try {
      const detail = await skillDirectoryStore.loadSkillDetail(skill.skill_id)
      selectedSkillDetail.value = detail
    } catch (error) {
      console.error('Failed to load skill detail:', error)
      selectedSkillDetail.value = null
    } finally {
      isLoadingDetail.value = false
    }
  } else {
    // 未注册的技能，显示基本信息
    selectedSkillDetail.value = {
      ...skill,
      tools: skill.tools || [],
      is_active: false
    } as SkillDetail
  }

  // 更新 URL query 参数
  updateUrlQuery(skill.name)
}

// 设置当前工作技能
const handleSetWorkingSkill = () => {
  const skill = skillDirectoryStore.selectedSkill
  if (!skill) return

  // 检查是否在任务模式
  if (taskStore.currentTask) {
    toast.warning(t('skills.exitTaskFirst') || '请先退出当前任务')
    return
  }

  skillDirectoryStore.enterSkillMode(skill)
  toast.success(t('skills.workingDirectorySet') || `已将 ${skill.name} 设为工作目录`)
}

// 退出工作技能
const handleExitWorkingSkill = () => {
  skillDirectoryStore.exitSkillMode()
  toast.info(t('skills.workingDirectoryExited') || '已退出工作目录')
}

// 刷新技能列表
const handleRefresh = async () => {
  await skillDirectoryStore.loadSkillDirectories()
}

// 更新 URL query 参数
const updateUrlQuery = (skillName: string) => {
  const expertId = route.params.expertId
  if (expertId) {
    router.push({
      name: 'chat',
      params: { expertId },
      query: { skill: skillName }
    })
  }
}

// 从 URL 恢复状态
const restoreFromUrl = async () => {
  const skillName = route.query.skill as string
  if (skillName) {
    // 查找对应的技能
    const skill = skillDirectoryStore.skillDirectories.find(s => s.name === skillName)
    if (skill) {
      await handleSelectSkill(skill)
    }
  }
}

// 监听技能目录加载完成
watch(() => skillDirectoryStore.skillDirectories, async (directories) => {
  if (directories.length > 0) {
    await restoreFromUrl()
  }
}, { immediate: true })

onMounted(() => {
  skillDirectoryStore.loadSkillDirectories()
})
</script>

<style scoped>
.skills-directory-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--sidebar-bg, #f5f5f5);
}

/* Header */
.skills-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.btn-refresh {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-refresh:hover:not(:disabled) {
  background: var(--hover-bg, #e8e8e8);
  color: var(--primary-color, #2196f3);
  border-color: var(--primary-color, #2196f3);
}

.btn-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-refresh .icon {
  font-size: 14px;
}

/* Content */
.skills-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* Left Panel: Skills Tree */
.skills-tree-panel {
  width: 55%;
  border-right: 1px solid var(--border-color, #e0e0e0);
  display: flex;
  flex-direction: column;
}

.panel-title {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #666);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--secondary-bg, #fafafa);
}

.skill-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.skill-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 4px;
}

.skill-item:hover {
  background: var(--hover-bg, #e8e8e8);
}

.skill-item.selected {
  background: var(--primary-light, #e3f2fd);
  border-left: 3px solid var(--primary-color, #2196f3);
}

.skill-item.is-working {
  background: rgba(156, 39, 176, 0.1);
  border-left: 3px solid #9c27b0;
}

.skill-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.skill-info {
  flex: 1;
  min-width: 0;
}

.skill-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-meta {
  display: flex;
  gap: 8px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary, #999);
}

.tool-count {
  color: var(--primary-color, #2196f3);
}

.registered-badge {
  color: #4caf50;
}

/* Right Panel: Skill Info */
.skill-info-panel {
  width: 45%;
  display: flex;
  flex-direction: column;
}

.info-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.info-section {
  margin-bottom: 16px;
}

.info-row {
  display: flex;
  margin-bottom: 8px;
}

.info-label {
  font-size: 12px;
  color: var(--text-secondary, #666);
  min-width: 60px;
  flex-shrink: 0;
}

.info-value {
  font-size: 13px;
  color: var(--text-primary, #333);
  flex: 1;
}

.info-value.description {
  white-space: pre-wrap;
  word-break: break-word;
}

.section-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #333);
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

/* Tools List */
.tools-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  background: var(--card-bg, #fff);
  border-radius: 6px;
  border: 1px solid var(--border-color, #e0e0e0);
}

.tool-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.tool-info {
  flex: 1;
  min-width: 0;
}

.tool-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.tool-desc {
  font-size: 11px;
  color: var(--text-secondary, #666);
  margin-top: 2px;
}

/* Experts List */
.experts-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.expert-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--card-bg, #fff);
  border-radius: 4px;
  font-size: 12px;
}

.expert-icon {
  font-size: 14px;
}

.expert-name {
  flex: 1;
  color: var(--text-primary, #333);
}

.enabled-badge {
  font-size: 10px;
  color: #4caf50;
  background: rgba(76, 175, 80, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}

/* Actions */
.info-actions {
  padding: 12px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  display: flex;
  gap: 8px;
}

.btn-set-working,
.btn-exit-working {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-set-working {
  background: var(--primary-color, #2196f3);
  border: none;
  color: white;
}

.btn-set-working:hover {
  background: var(--primary-hover, #1976d2);
}

.btn-exit-working {
  background: rgba(156, 39, 176, 0.1);
  border: 1px solid #9c27b0;
  color: #9c27b0;
}

.btn-exit-working:hover {
  background: rgba(156, 39, 176, 0.2);
}

.btn-icon {
  font-size: 14px;
}

/* Empty States */
.loading,
.empty,
.no-selection {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary, #666);
  font-size: 13px;
  padding: 24px;
  text-align: center;
}

.no-selection {
  height: 100%;
}
</style>