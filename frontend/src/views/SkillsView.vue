<template>
  <div class="skills-view">
    <div class="view-header">
      <h1 class="view-title">{{ $t('skills.title') }}</h1>
    </div>

    <!-- 搜索和过滤 -->
    <div class="skills-filter">
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        :placeholder="$t('skills.searchPlaceholder')"
      />
      <select v-model="filterStatus" class="filter-select">
        <option value="">{{ $t('skills.allSkills') }}</option>
        <option value="active">{{ $t('skills.active') }}</option>
        <option value="inactive">{{ $t('skills.inactive') }}</option>
      </select>
    </div>

    <!-- 加载状态 -->
    <div v-if="skillStore.isLoading && skillStore.skills.length === 0" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <!-- 空状态 -->
    <div v-else-if="skillStore.skills.length === 0" class="empty-state">
      <p>{{ $t('skills.empty') }}</p>
    </div>

    <!-- 技能列表 -->
    <div v-else class="skills-list">
      <div
        v-for="skill in filteredSkills"
        :key="skill.id"
        class="skill-card"
        :class="{ inactive: !skill.is_active }"
      >
        <div class="skill-header">
          <div class="skill-info">
            <h3 class="skill-name">{{ skill.name }}</h3>
            <span class="skill-version" v-if="skill.version">v{{ skill.version }}</span>
          </div>
          <div class="skill-badges">
            <span
              class="security-badge"
              :class="getSecurityClass(skill.security_score ?? 0)"
              :title="$t('skills.securityScore')"
            >
              {{ skill.security_score ?? '-' }}
            </span>
            <span class="status-badge" :class="{ active: skill.is_active }">
              {{ skill.is_active ? $t('skills.active') : $t('skills.inactive') }}
            </span>
          </div>
        </div>

        <p class="skill-description">{{ skill.description || $t('skills.noDescription') }}</p>

        <!-- 标签 -->
        <div v-if="skill.tags && skill.tags.length > 0" class="skill-tags">
          <span v-for="tag in skill.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>

        <!-- 工具清单 -->
        <div v-if="skill.tools && skill.tools.length > 0" class="skill-tools">
          <span class="tools-label">{{ $t('skills.tools') }}:</span>
          <span v-for="tool in skill.tools.slice(0, 3)" :key="tool.id" class="tool-badge">
            {{ tool.name }}
          </span>
          <span v-if="skill.tools.length > 3" class="tool-more">
            +{{ skill.tools.length - 3 }}
          </span>
        </div>

        <!-- 元信息 -->
        <div class="skill-meta">
          <span v-if="skill.author">{{ $t('skills.author') }}: {{ skill.author }}</span>
          <span>{{ $t('skills.source') }}: {{ getSourceLabel(skill.source_type) }}</span>
        </div>

        <!-- 操作按钮 -->
        <div class="skill-actions">
          <button class="btn-action" @click="viewSkillDetail(skill)">
            {{ $t('skills.viewDetail') }}
          </button>
          <button 
            class="btn-action secondary" 
            @click="openParamsDialog(skill)"
          >
            {{ $t('skills.manageParams') }}
          </button>
          <button 
            class="btn-action secondary" 
            @click="toggleSkillActive(skill)"
          >
            {{ skill.is_active ? $t('skills.deactivate') : $t('skills.activate') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 技能详情对话框 -->
    <div v-if="showDetailDialog && selectedSkill" class="dialog-overlay">
      <div class="dialog dialog-large">
        <h3 class="dialog-title">{{ selectedSkill.name }}</h3>
        <div class="dialog-body">
          <div class="detail-section">
            <h4 class="section-title">{{ $t('skills.basicInfo') }}</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">{{ $t('skills.description') }}</span>
                <span class="detail-value">{{ selectedSkill.description || '-' }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ $t('skills.version') }}</span>
                <span class="detail-value">{{ selectedSkill.version || '-' }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ $t('skills.author') }}</span>
                <span class="detail-value">{{ selectedSkill.author || '-' }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ $t('skills.sourceType') }}</span>
                <span class="detail-value">{{ getSourceLabel(selectedSkill.source_type) }}</span>
              </div>
            </div>
          </div>

          <div class="detail-section">
            <h4 class="section-title">{{ $t('skills.securityInfo') }}</h4>
            <div class="security-info">
              <div class="security-score" :class="getSecurityClass(selectedSkill.security_score ?? 0)">
                {{ $t('skills.securityScore') }}: {{ selectedSkill.security_score ?? '-' }}/100
              </div>
              <div v-if="selectedSkill.security_warnings && selectedSkill.security_warnings.length > 0">
                <p class="warnings-title">{{ $t('skills.warnings') }}:</p>
                <ul class="warnings-list">
                  <li v-for="(warning, index) in selectedSkill.security_warnings" :key="index">
                    {{ warning }}
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div v-if="selectedSkill.tools && selectedSkill.tools.length > 0" class="detail-section">
            <h4 class="section-title">{{ $t('skills.toolsList') }}</h4>
            <div class="tools-list">
              <div v-for="tool in selectedSkill.tools" :key="tool.id" class="tool-item">
                <div class="tool-header">
                  <span class="tool-name">{{ tool.name }}</span>
                  <span class="tool-type">{{ tool.type }}</span>
                </div>
                <p class="tool-description">{{ tool.description || '-' }}</p>
                <p v-if="tool.usage" class="tool-usage">
                  <code>{{ tool.usage }}</code>
                </p>
              </div>
            </div>
          </div>

          <div v-if="selectedSkill.skill_md" class="detail-section">
            <h4 class="section-title">SKILL.md</h4>
            <pre class="skill-md-content">{{ selectedSkill.skill_md }}</pre>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeDetailDialog">{{ $t('common.close') }}</button>
        </div>
      </div>
    </div>

    <!-- 参数管理对话框 -->
    <SkillParametersModal
      :visible="showParamsDialog"
      :skill="paramsSkill"
      @close="closeParamsDialog"
      @saved="closeParamsDialog"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillStore } from '@/stores/skill'
import type { Skill } from '@/types'
import SkillParametersModal from '@/components/SkillParametersModal.vue'

const { t } = useI18n()
const skillStore = useSkillStore()

const searchQuery = ref('')
const filterStatus = ref('')

// 对话框状态
const showDetailDialog = ref(false)
const showParamsDialog = ref(false)
const selectedSkill = ref<Skill | null>(null)
const paramsSkill = ref<Skill | null>(null)

// 过滤后的技能列表
const filteredSkills = computed(() => {
  let skills = skillStore.skills

  // 搜索过滤
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    skills = skills.filter(s => 
      s.name.toLowerCase().includes(query) ||
      s.description?.toLowerCase().includes(query) ||
      s.tags?.some(t => t.toLowerCase().includes(query))
    )
  }

  // 状态过滤
  if (filterStatus.value === 'active') {
    skills = skills.filter(s => s.is_active)
  } else if (filterStatus.value === 'inactive') {
    skills = skills.filter(s => !s.is_active)
  }

  return skills
})

// 获取安全等级样式类
const getSecurityClass = (score: number) => {
  if (score >= 80) return 'high'
  if (score >= 50) return 'medium'
  return 'low'
}

// 获取来源标签
const getSourceLabel = (type: string) => {
  switch (type) {
    case 'url': return t('skills.sourceUrl')
    case 'zip': return t('skills.sourceZip')
    case 'local': return t('skills.sourceLocal')
    default: return type
  }
}

// 查看技能详情
const viewSkillDetail = async (skill: Skill) => {
  // 如果没有工具清单，先加载详情
  if (!skill.tools) {
    try {
      await skillStore.loadSkill(skill.id)
      selectedSkill.value = skillStore.currentSkill
    } catch {
      selectedSkill.value = skill
    }
  } else {
    selectedSkill.value = skill
  }
  showDetailDialog.value = true
}

const closeDetailDialog = () => {
  showDetailDialog.value = false
  selectedSkill.value = null
}

// 切换激活状态
const toggleSkillActive = async (skill: Skill) => {
  try {
    await skillStore.toggleSkillActive(skill.id)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : t('skills.toggleFailed')
    alert(errorMsg)
  }
}

// 参数管理
const openParamsDialog = (skill: Skill) => {
  paramsSkill.value = skill
  showParamsDialog.value = true
}

const closeParamsDialog = () => {
  showParamsDialog.value = false
  paramsSkill.value = null
}

onMounted(() => {
  skillStore.loadSkills()
})
</script>

<style scoped>
.skills-view {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.view-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

/* 过滤器 */
.skills-filter {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.search-input {
  flex: 1;
  padding: 10px 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
}

.filter-select {
  padding: 10px 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
  background: white;
  min-width: 120px;
}

/* 加载和空状态 */
.loading-state,
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-secondary, #666);
}

.empty-state p {
  margin-bottom: 16px;
}

/* 技能列表 - 栅格布局 */
.skills-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 20px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 8px;
}

.skill-card {
  padding: 20px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
}

.skill-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.skill-card.inactive {
  opacity: 0.7;
  background: var(--secondary-bg, #f8f9fa);
}

.skill-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.skill-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-name {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.skill-version {
  font-size: 12px;
  color: var(--text-secondary, #666);
  background: var(--secondary-bg, #f0f0f0);
  padding: 2px 6px;
  border-radius: 4px;
}

.skill-badges {
  display: flex;
  gap: 8px;
}

.security-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 4px;
}

.security-badge.high {
  background: #e8f5e9;
  color: #2e7d32;
}

.security-badge.medium {
  background: #fff3e0;
  color: #ef6c00;
}

.security-badge.low {
  background: #ffebee;
  color: #c62828;
}

.status-badge {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--secondary-bg, #f0f0f0);
  color: var(--text-secondary, #666);
}

.status-badge.active {
  background: #e8f5e9;
  color: #2e7d32;
}

.skill-description {
  font-size: 14px;
  color: var(--text-secondary, #666);
  margin: 0 0 12px 0;
  line-height: 1.5;
}

.skill-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.tag {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--primary-light, #e3f2fd);
  color: var(--primary-color, #2196f3);
  border-radius: 12px;
}

.skill-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.tools-label {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.tool-badge {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--secondary-bg, #f0f0f0);
  border-radius: 4px;
  color: var(--text-primary, #333);
}

.tool-more {
  font-size: 11px;
  color: var(--text-tertiary, #999);
}

.skill-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-tertiary, #999);
  margin-bottom: 16px;
}

.skill-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: 12px;
}

.btn-action {
  padding: 6px 12px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.btn-action:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-action.secondary {
  background: var(--secondary-bg, #f5f5f5);
  color: var(--text-secondary, #666);
}

/* 对话框 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
}

.dialog-large {
  max-width: 720px;
}

.dialog-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  color: var(--text-primary, #333);
}

.dialog-body {
  padding: 24px;
  overflow-y: auto;
  max-height: 60vh;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

/* 详情对话框 */
.detail-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-label {
  font-size: 12px;
  color: var(--text-tertiary, #999);
}

.detail-value {
  font-size: 14px;
  color: var(--text-primary, #333);
}

.security-info {
  padding: 12px;
  background: var(--secondary-bg, #f8f9fa);
  border-radius: 8px;
}

.security-score {
  font-weight: 600;
  margin-bottom: 8px;
}

.security-score.high { color: #2e7d32; }
.security-score.medium { color: #ef6c00; }
.security-score.low { color: #c62828; }

.warnings-title {
  font-size: 13px;
  font-weight: 500;
  margin: 12px 0 8px 0;
}

.warnings-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text-secondary, #666);
}

.warnings-list li {
  margin-bottom: 4px;
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-item {
  padding: 12px;
  background: var(--secondary-bg, #f8f9fa);
  border-radius: 8px;
}

.tool-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.tool-name {
  font-weight: 500;
  color: var(--text-primary, #333);
}

.tool-type {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--primary-light, #e3f2fd);
  color: var(--primary-color, #2196f3);
  border-radius: 4px;
}

.tool-description {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin: 0 0 6px 0;
}

.tool-usage {
  margin: 0;
}

.tool-usage code {
  font-size: 12px;
  padding: 4px 8px;
  background: #fff;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  display: inline-block;
}

.skill-md-content {
  padding: 12px;
  background: var(--secondary-bg, #f8f9fa);
  border-radius: 8px;
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  max-height: 300px;
}

/* 按钮 */
.btn-cancel {
  padding: 8px 16px;
  background: white;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-cancel:hover {
  background: var(--secondary-bg, #f5f5f5);
}

/* 响应式 */
@media (max-width: 768px) {
  .skills-view {
    padding: 16px;
  }

  .skills-list {
    grid-template-columns: 1fr;
  }

  .view-header {
    flex-direction: column;
    gap: 16px;
    align-items: flex-start;
  }

  .skill-header {
    flex-direction: column;
    gap: 8px;
  }

  .skill-badges {
    align-self: flex-start;
  }

  .skill-actions {
    flex-direction: column;
  }

  .btn-action {
    width: 100%;
    text-align: center;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (min-width: 769px) and (max-width: 1024px) {
  .skills-list {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1200px) {
  .skills-list {
    grid-template-columns: repeat(3, 1fr);
  }
}

/* 滚动条样式 */
.skills-list::-webkit-scrollbar {
  width: 6px;
}

.skills-list::-webkit-scrollbar-track {
  background: transparent;
}

.skills-list::-webkit-scrollbar-thumb {
  background: var(--border-color, #e0e0e0);
  border-radius: 3px;
}

.skills-list::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary, #999);
}
</style>
