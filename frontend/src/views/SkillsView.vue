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
            v-if="userStore.isAdmin"
            class="btn-action secondary" 
            @click="openSkillEditor(skill)"
          >
            {{ $t('skills.editSkill') || '编辑' }}
          </button>
          <button
            v-if="userStore.isAdmin"
            class="btn-action secondary"
            @click="openParamsDialog(skill)"
          >
            {{ $t('skills.manageParams') }}
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
                  <span v-if="tool.is_resident" class="tool-type resident">{{ $t('skills.isResident') || '驻留' }}</span>
                </div>
                <p class="tool-description">{{ tool.description || '-' }}</p>
                <p v-if="tool.script_path" class="tool-usage">
                  <code>{{ tool.script_path }}</code>
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
    
    <!-- 技能编辑弹窗 -->
    <Teleport to="body">
      <div v-if="showSkillEditor" class="skill-editor-overlay">
        <div class="skill-editor-modal">
          <div class="modal-header">
            <h3>{{ editingSkill?.name || $t('skills.editSkill') || '编辑技能' }}</h3>
            <button class="close-btn" @click="closeSkillEditor">×</button>
          </div>
          
          <!-- 弹窗内部 TabPage -->
          <div class="modal-tabs">
            <button 
              class="modal-tab-btn" 
              :class="{ active: editorTab === 'basic' }"
              @click="editorTab = 'basic'"
            >
              {{ $t('skills.basicInfo') || '基本信息' }}
            </button>
            <button 
              class="modal-tab-btn" 
              :class="{ active: editorTab === 'tools' }"
              @click="editorTab = 'tools'"
            >
              {{ $t('skills.toolsList') || '工具列表' }}
              <span v-if="skillForm.tools?.length" class="tab-badge">{{ skillForm.tools.length }}</span>
            </button>
            <button
              class="modal-tab-btn"
              :class="{ active: editorTab === 'params' }"
              @click="editorTab = 'params'"
            >
              {{ $t('skills.parametersTitle') || '参数配置' }}
              <span v-if="skillForm.parameters?.length" class="tab-badge">{{ skillForm.parameters.length }}</span>
            </button>
          </div>
          
          <div class="modal-body">
            <!-- 基本信息 Tab -->
            <div v-show="editorTab === 'basic'" class="editor-section">
              <!-- ID（只读） -->
              <div class="form-group">
                <label>{{ $t('skills.id') || 'ID' }}</label>
                <input :value="editingSkill?.id" type="text" class="form-input readonly" readonly />
              </div>
              
              <!-- 名称 -->
              <div class="form-group">
                <label>{{ $t('skills.name') || '名称' }}</label>
                <input v-model="skillForm.name" type="text" class="form-input" />
              </div>
              
              <!-- 描述 -->
              <div class="form-group">
                <label>{{ $t('skills.description') || '描述' }}</label>
                <textarea v-model="skillForm.description" class="form-textarea" rows="3"></textarea>
              </div>
              
              <!-- 版本 & 作者 -->
              <div class="form-row">
                <div class="form-group">
                  <label>{{ $t('skills.version') || '版本' }}</label>
                  <input v-model="skillForm.version" type="text" class="form-input" />
                </div>
                <div class="form-group">
                  <label>{{ $t('skills.author') || '作者' }}</label>
                  <input v-model="skillForm.author" type="text" class="form-input" />
                </div>
              </div>
              
              <!-- 来源信息 -->
              <div class="form-row">
                <div class="form-group">
                  <label>{{ $t('skills.sourceType') || '来源类型' }}</label>
                  <input :value="editingSkill?.source_type" type="text" class="form-input readonly" readonly />
                </div>
                <div class="form-group">
                  <label>{{ $t('skills.sourcePath') || '来源路径' }}</label>
                  <input v-model="skillForm.source_path" type="text" class="form-input" />
                </div>
              </div>
              
              <!-- 来源 URL（如果有） -->
              <div class="form-group" v-if="editingSkill?.source_url">
                <label>{{ $t('skills.sourceUrl') || '来源 URL' }}</label>
                <input :value="editingSkill?.source_url" type="text" class="form-input readonly" readonly />
              </div>
              
              <!-- 标签 -->
              <div class="form-group">
                <label>{{ $t('skills.tags') || '标签' }}</label>
                <div class="tags-input-container">
                  <div class="tags-list">
                    <span v-for="(tag, index) in skillForm.tags" :key="index" class="tag-item">
                      {{ tag }}
                      <button class="tag-remove" @click="removeTag(index)">×</button>
                    </span>
                  </div>
                  <input
                    v-model="newTagInput"
                    type="text"
                    class="form-input tag-input"
                    :placeholder="$t('skills.addTagPlaceholder') || '输入标签后按 Enter'"
                    @keyup.enter="addTag"
                  />
                </div>
              </div>
              
              <!-- 安全信息 -->
              <div class="form-row" v-if="editingSkill?.security_score !== undefined">
                <div class="form-group">
                  <label>{{ $t('skills.securityScore') || '安全评分' }}</label>
                  <div class="security-score-display">
                    <span class="score-value" :class="getSecurityScoreClass(editingSkill?.security_score)">
                      {{ editingSkill?.security_score ?? '-' }}
                    </span>
                    <span class="score-max">/ 100</span>
                  </div>
                </div>
                <div class="form-group" v-if="editingSkill?.security_warnings?.length">
                  <label>{{ $t('skills.securityWarnings') || '安全警告' }}</label>
                  <div class="security-warnings">
                    <span v-for="(warning, index) in editingSkill?.security_warnings" :key="index" class="warning-item">
                      ⚠️ {{ warning }}
                    </span>
                  </div>
                </div>
              </div>
              
              <!-- 启用状态 -->
              <div class="form-group">
                <label class="checkbox-label">
                  <input type="checkbox" v-model="skillForm.is_active" />
                  {{ $t('skills.enabled') || '启用' }}
                </label>
              </div>
              
              <!-- 时间信息（只读） -->
              <div class="form-row">
                <div class="form-group">
                  <label>{{ $t('skills.createdAt') || '创建时间' }}</label>
                  <input :value="formatDateTime(editingSkill?.created_at)" type="text" class="form-input readonly" readonly />
                </div>
                <div class="form-group">
                  <label>{{ $t('skills.updatedAt') || '更新时间' }}</label>
                  <input :value="formatDateTime(editingSkill?.updated_at)" type="text" class="form-input readonly" readonly />
                </div>
              </div>
            </div>
            
            <!-- 工具列表 Tab -->
            <div v-show="editorTab === 'tools'" class="editor-section tools-section">
              <div v-if="skillForm.tools?.length" class="tools-list-editor">
                <div v-for="tool in skillForm.tools" :key="tool.id" class="tool-item-editor">
                  <div class="tool-header">
                    <input v-model="tool.name" type="text" class="tool-name-input" :placeholder="$t('skills.name') || '名称'" />
                    <span v-if="tool.is_resident" class="resident-badge">驻留</span>
                  </div>
                  
                  <div class="tool-fields">
                    <!-- 描述 -->
                    <div class="field-row">
                      <span class="field-label">{{ $t('skills.description') || '描述' }}</span>
                      <input v-model="tool.description" type="text" class="field-input" :placeholder="$t('skills.description') || '描述'" />
                    </div>
                    
                    <!-- 脚本路径 -->
                    <div class="field-row">
                      <span class="field-label">{{ $t('skills.scriptPath') || '脚本路径' }}</span>
                      <input v-model="tool.script_path" type="text" class="field-input" :placeholder="$t('skills.scriptPath') || '脚本路径'" />
                    </div>
                    
                    <!-- 参数定义 -->
                    <div class="field-row">
                      <span class="field-label">{{ $t('skills.parameters') || '参数' }}</span>
                      <textarea v-model="tool.parameters" class="field-textarea" rows="5" :placeholder="$t('skills.parametersPlaceholder') || 'JSON 格式的参数定义'"></textarea>
                    </div>
                    
                    <!-- 驻留进程 -->
                    <div class="field-row">
                      <span class="field-label">{{ $t('skills.isResident') || '驻留进程' }}</span>
                      <label class="checkbox-inline">
                        <input type="checkbox" v-model="tool.is_resident" />
                        {{ $t('skills.isResidentHint') || '持续运行，stdio 通信' }}
                      </label>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="empty-state-editor">
                <span class="empty-icon">🔧</span>
                <p>{{ $t('skills.noTools') || '暂无工具' }}</p>
              </div>
            </div>
            
            <!-- 参数配置 Tab -->
            <div v-show="editorTab === 'params'" class="editor-section">
              <div class="section-header">
                <span></span>
                <button class="add-btn" @click="addParameter">+ {{ $t('skills.addParameter') || '添加参数' }}</button>
              </div>
              <div v-if="skillForm.parameters?.length" class="parameters-list">
                <div v-for="(param, index) in skillForm.parameters" :key="index" class="parameter-item">
                  <div class="param-row">
                    <input v-model="param.param_name" type="text" class="form-input param-name" :placeholder="$t('skills.paramName') || '参数名'" />
                    <input v-model="param.param_value" :type="param.is_secret ? 'password' : 'text'" class="form-input param-value" :placeholder="$t('skills.paramValue') || '参数值'" />
                    <label class="secret-label">
                      <input type="checkbox" v-model="param.is_secret" />
                      {{ $t('skills.secret') || '密钥' }}
                    </label>
                    <button class="remove-btn" @click="removeParameter(index)">×</button>
                  </div>
                </div>
              </div>
              <div v-else class="empty-state-editor">
                <span class="empty-icon">⚙️</span>
                <p>{{ $t('skills.noParameters') || '暂无参数配置' }}</p>
                <button class="add-btn-large" @click="addParameter">+ {{ $t('skills.addParameter') || '添加参数' }}</button>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn-delete" @click="deleteSkill" :disabled="deletingSkill">
              {{ deletingSkill ? ($t('common.deleting') || '删除中...') : ($t('common.delete') || '删除') }}
            </button>
            <div class="footer-right">
              <button class="btn-cancel" @click="closeSkillEditor">{{ $t('common.cancel') || '取消' }}</button>
              <button class="btn-save" @click="saveSkill" :disabled="savingSkill">
                {{ savingSkill ? ($t('common.saving') || '保存中...') : ($t('common.save') || '保存') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillStore } from '@/stores/skill'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { skill_api } from '@/api/services'
import type { Skill, SkillDetail, SkillTool, SkillParameter } from '@/types'
import SkillParametersModal from '@/components/SkillParametersModal.vue'

// 扩展 SkillParameter 类型以支持前端编辑
interface EditableParameter {
  id?: string
  param_name: string
  param_value: string
  is_secret: boolean
}

const { t } = useI18n()
const skillStore = useSkillStore()
const toast = useToastStore()
const userStore = useUserStore()

const searchQuery = ref('')
const filterStatus = ref('')

// 对话框状态
const showDetailDialog = ref(false)
const showParamsDialog = ref(false)
const selectedSkill = ref<Skill | null>(null)
const paramsSkill = ref<Skill | null>(null)

// 技能编辑器状态
const showSkillEditor = ref(false)
const editingSkill = ref<SkillDetail | null>(null)
const savingSkill = ref(false)
const deletingSkill = ref(false)
const editorTab = ref<'basic' | 'tools' | 'params'>('basic')
const newTagInput = ref('')

// 表单数据
const skillForm = reactive({
  name: '',
  description: '',
  version: '',
  author: '',
  source_path: '',
  is_active: true,
  tags: [] as string[],
  tools: [] as SkillTool[],
  parameters: [] as EditableParameter[]
})

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

// 参数管理
const openParamsDialog = (skill: Skill) => {
  paramsSkill.value = skill
  showParamsDialog.value = true
}

const closeParamsDialog = () => {
  showParamsDialog.value = false
  paramsSkill.value = null
}

// 技能编辑器
const openSkillEditor = async (skill: Skill) => {
  try {
    // 获取技能详情
    const res = await skill_api.get_skill_detail(skill.id)
    editingSkill.value = res.skill
    
    // 填充表单
    skillForm.name = res.skill.name
    skillForm.description = res.skill.description || ''
    skillForm.version = res.skill.version || ''
    skillForm.author = res.skill.author || ''
    skillForm.source_path = res.skill.source_path || ''
    skillForm.is_active = res.skill.is_active
    skillForm.tags = res.skill.tags || []
    skillForm.tools = res.skill.tools || []
    
    // 获取参数
    try {
      const paramsRes = await skill_api.get_skill_parameters(skill.id)
      skillForm.parameters = (paramsRes.parameters || []).map((p: SkillParameter) => ({
        id: p.id,
        param_name: p.param_name,
        param_value: p.param_value,
        is_secret: !!p.is_secret
      }))
    } catch {
      skillForm.parameters = []
    }
    
    showSkillEditor.value = true
    editorTab.value = 'basic'
  } catch (err) {
    console.error('Failed to load skill detail:', err)
    toast.error(t('skills.loadFailed') || '加载技能详情失败')
  }
}

const closeSkillEditor = () => {
  showSkillEditor.value = false
  editingSkill.value = null
  editorTab.value = 'basic'
}

// 添加参数
const addParameter = () => {
  skillForm.parameters.push({
    param_name: '',
    param_value: '',
    is_secret: false
  })
}

// 移除参数
const removeParameter = (index: number) => {
  skillForm.parameters.splice(index, 1)
}

// 添加标签
const addTag = () => {
  const tag = newTagInput.value.trim()
  if (tag && !skillForm.tags.includes(tag)) {
    skillForm.tags.push(tag)
  }
  newTagInput.value = ''
}

// 移除标签
const removeTag = (index: number) => {
  skillForm.tags.splice(index, 1)
}

// 安全评分样式类
const getSecurityScoreClass = (score?: number): string => {
  if (score === undefined) return ''
  if (score >= 80) return 'high'
  if (score >= 60) return 'medium'
  return 'low'
}

// 格式化日期时间
const formatDateTime = (dateStr?: string): string => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString()
}

// 保存技能
const saveSkill = async () => {
  if (!editingSkill.value) return
  
  savingSkill.value = true
  try {
    // 构建更新数据
    const updateData = {
      name: skillForm.name,
      description: skillForm.description,
      source_path: skillForm.source_path,
      version: skillForm.version,
      author: skillForm.author,
      tags: skillForm.tags,
      is_active: skillForm.is_active
    }
    
    // 更新技能基本信息
    await skill_api.update_skill(editingSkill.value.id, updateData)
    
    // 保存工具信息
    if (skillForm.tools.length > 0) {
      await skill_api.update_skill_tools(editingSkill.value.id, skillForm.tools.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        script_path: t.script_path,
        parameters: t.parameters,
        is_resident: t.is_resident
      })))
    }
    
    // 保存参数
    if (skillForm.parameters.length > 0) {
      await skill_api.save_skill_parameters(editingSkill.value.id, {
        parameters: skillForm.parameters.filter(p => p.param_name.trim()).map(p => ({
          param_name: p.param_name.trim(),
          param_value: p.param_value,
          is_secret: p.is_secret
        }))
      })
    }
    
    toast.success(t('skills.saveSuccess') || '保存成功')
    closeSkillEditor()
    // 等待列表刷新完成
    await skillStore.loadSkills()
  } catch (err) {
    console.error('Failed to save skill:', err)
    toast.error(t('skills.saveFailed') || '保存失败')
  } finally {
    savingSkill.value = false
  }
}

// 删除技能
const deleteSkill = async () => {
  if (!editingSkill.value) return
  
  // 确认删除
  const confirmed = confirm(t('skills.deleteConfirm') || `确定要删除技能 "${editingSkill.value.name}" 吗？此操作不可撤销。`)
  if (!confirmed) return
  
  deletingSkill.value = true
  try {
    await skill_api.delete_skill(editingSkill.value.id)
    toast.success(t('skills.deleteSuccess') || '删除成功')
    closeSkillEditor()
    // 刷新列表
    await skillStore.loadSkills()
  } catch (err) {
    console.error('Failed to delete skill:', err)
    toast.error(t('skills.deleteFailed') || '删除失败')
  } finally {
    deletingSkill.value = false
  }
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

/* 技能编辑弹窗 */
.skill-editor-overlay {
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

.skill-editor-modal {
  background: var(--bg-primary, #fff);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 90%;
  max-width: 640px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

/* 弹窗内部 TabPage */
.modal-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
  padding: 0 20px;
  background: var(--bg-secondary, #f9f9f9);
}

.modal-tab-btn {
  padding: 12px 16px;
  border: none;
  background: transparent;
  font-size: 13px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s ease;
  border-bottom: 2px solid transparent;
  display: flex;
  align-items: center;
  gap: 6px;
}

.modal-tab-btn:hover {
  color: var(--text-primary, #333);
  background: var(--bg-hover, #f0f0f0);
}

.modal-tab-btn.active {
  color: var(--primary-color, #2196f3);
  border-bottom-color: var(--primary-color, #2196f3);
  font-weight: 500;
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 500;
  background: var(--bg-tertiary, #e0e0e0);
  color: var(--text-secondary, #666);
  border-radius: 9px;
}

.modal-tab-btn.active .tab-badge {
  background: var(--primary-light, #e3f2fd);
  color: var(--primary-color, #2196f3);
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  font-size: 20px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-primary, #333);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.editor-section {
  margin-bottom: 20px;
}

.editor-section:last-child {
  margin-bottom: 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.add-btn {
  padding: 4px 12px;
  font-size: 12px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.add-btn:hover {
  background: var(--primary-dark, #1976d2);
}

.add-btn-large {
  margin-top: 12px;
  padding: 8px 16px;
  font-size: 13px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.add-btn-large:hover {
  background: var(--primary-dark, #1976d2);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-row .form-group {
  flex: 1;
}

.form-group {
  margin-bottom: 14px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #333);
  box-sizing: border-box;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.form-textarea {
  resize: vertical;
  min-height: 70px;
}

.form-input.readonly {
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
  cursor: not-allowed;
}

/* 工具列表 */
.tools-section {
  padding: 0;
}

.tools-list-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tool-item-editor {
  padding: 16px;
  background: var(--bg-secondary, #f9f9f9);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e0e0e0);
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--border-color, #e0e0e0);
}

.tool-name-input {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary, #333);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  padding: 4px 8px;
  background: var(--bg-primary, #fff);
  flex: 1;
}

.tool-name-input:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.resident-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  background: #e8f5e9;
  color: #388e3c;
}

.tool-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.field-label {
  min-width: 60px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  padding-top: 6px;
}

.field-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  font-size: 12px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #333);
}

.field-input:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.field-textarea {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  font-size: 12px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #333);
  resize: vertical;
  min-height: 60px;
  font-family: inherit;
}

.field-textarea:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.checkbox-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

/* 参数列表 */
.parameters-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.parameter-item {
  padding: 8px;
  background: var(--bg-secondary, #f9f9f9);
  border-radius: 6px;
}

.param-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.param-name {
  width: 120px;
  flex-shrink: 0;
}

.param-value {
  flex: 1;
}

.secret-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary, #666);
  white-space: nowrap;
}

.remove-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  font-size: 16px;
  color: var(--danger-color, #dc3545);
  cursor: pointer;
  flex-shrink: 0;
}

.remove-btn:hover {
  background: var(--danger-light, #ffebee);
}

/* 弹窗底部 */
.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
}

.footer-right {
  display: flex;
  gap: 12px;
}

.btn-delete {
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--danger-color, #dc3545);
  border: none;
  color: white;
}

.btn-delete:hover:not(:disabled) {
  background: #c82333;
}

.btn-delete:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-save {
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--primary-color, #2196f3);
  border: none;
  color: white;
}

.btn-save:hover:not(:disabled) {
  background: var(--primary-dark, #1976d2);
}

.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 标签输入容器 */
.tags-input-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--primary-light, #e3f2fd);
  color: var(--primary-color, #2196f3);
  border-radius: 4px;
  font-size: 12px;
}

.tag-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: none;
  background: transparent;
  color: var(--primary-color, #2196f3);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}

.tag-remove:hover {
  color: var(--danger-color, #dc3545);
}

.tag-input {
  margin-top: 4px;
}

/* 安全评分显示 */
.security-score-display {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.score-value {
  font-size: 24px;
  font-weight: 600;
}

.score-value.high {
  color: var(--success-color, #4caf50);
}

.score-value.medium {
  color: var(--warning-color, #ff9800);
}

.score-value.low {
  color: var(--danger-color, #dc3545);
}

.score-max {
  font-size: 14px;
  color: var(--text-tertiary, #999);
}

/* 安全警告列表 */
.security-warnings {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.warning-item {
  display: block;
  font-size: 12px;
  color: var(--warning-color, #ff9800);
  padding: 4px 8px;
  background: var(--warning-light, #fff8e1);
  border-radius: 4px;
}

/* 空状态编辑器 */
.empty-state-editor {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-secondary, #666);
}

.empty-state-editor .empty-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.empty-state-editor p {
  margin: 0 0 12px 0;
}
</style>
