<template>
  <div class="skills-view">
    <div class="view-header">
      <h1 class="view-title">{{ $t('skills.title') }}</h1>
    </div>

    <!-- 搜索和过滤 -->
    <div class="skills-filter">
      <el-input
        v-model="searchQuery"
        :placeholder="$t('skills.searchPlaceholder')"
        clearable
      />
      <el-select v-model="filterStatus" :placeholder="$t('skills.allSkills')">
        <el-option value="" :label="$t('skills.allSkills')" />
        <el-option value="active" :label="$t('skills.active')" />
        <el-option value="inactive" :label="$t('skills.inactive')" />
      </el-select>
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
          <el-button size="small" @click="viewSkillDetail(skill)">
            {{ $t('skills.viewDetail') }}
          </el-button>
          <el-button 
            v-if="userStore.isAdmin"
            size="small"
            @click="openSkillEditor(skill)"
          >
            {{ $t('skills.editSkill') || '编辑' }}
          </el-button>
          <el-button
            v-if="userStore.isAdmin"
            size="small"
            @click="openParamsDialog(skill)"
          >
            <span class="btn-icon">⚙️</span>
            {{ $t('skills.manageParams') }}
          </el-button>
          <el-button
            size="small"
            @click="openMyParamsDialog(skill)"
          >
            <span class="btn-icon">🔧</span>
            {{ $t('skills.myParameters.title') || '我的参数' }}
          </el-button>
        </div>
      </div>
    </div>

    <!-- 技能详情对话框 -->
    <el-dialog
      v-model="showDetailDialog"
      :title="selectedSkill?.name"
      width="720px"
      destroy-on-close
    >
      <div class="dialog-body">
        <div class="detail-section">
          <h4 class="section-title">{{ $t('skills.basicInfo') }}</h4>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">{{ $t('skills.description') }}</span>
              <span class="detail-value">{{ selectedSkill?.description || '-' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">{{ $t('skills.version') }}</span>
              <span class="detail-value">{{ selectedSkill?.version || '-' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">{{ $t('skills.author') }}</span>
              <span class="detail-value">{{ selectedSkill?.author || '-' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">{{ $t('skills.sourceType') }}</span>
              <span class="detail-value">{{ getSourceLabel(selectedSkill?.source_type || '') }}</span>
            </div>
          </div>
        </div>

        <div class="detail-section">
          <h4 class="section-title">{{ $t('skills.securityInfo') }}</h4>
          <div class="security-info">
            <div class="security-score" :class="getSecurityClass(selectedSkill?.security_score ?? 0)">
              {{ $t('skills.securityScore') }}: {{ selectedSkill?.security_score ?? '-' }}/100
            </div>
            <div v-if="selectedSkill?.security_warnings && selectedSkill.security_warnings.length > 0">
              <p class="warnings-title">{{ $t('skills.warnings') }}:</p>
              <ul class="warnings-list">
                <li v-for="(warning, index) in selectedSkill.security_warnings" :key="index">
                  {{ warning }}
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div v-if="selectedSkill?.tools && selectedSkill.tools.length > 0" class="detail-section">
          <h4 class="section-title">{{ $t('skills.toolsList') }}</h4>
          <div class="tools-list">
            <div v-for="tool in selectedSkill.tools" :key="tool.id" class="tool-item">
              <div class="tool-header">
                <span class="tool-name">{{ tool.name }}</span>
                <el-tag v-if="tool.is_resident" size="small" type="success">{{ $t('skills.isResident') || '驻留' }}</el-tag>
              </div>
              <p class="tool-description">{{ tool.description || '-' }}</p>
              <p v-if="tool.script_path" class="tool-usage">
                <code>{{ tool.script_path }}</code>
              </p>
            </div>
          </div>
        </div>

        <div v-if="selectedSkill?.skill_md" class="detail-section">
          <h4 class="section-title">SKILL.md</h4>
          <pre class="skill-md-content">{{ selectedSkill.skill_md }}</pre>
        </div>
      </div>
      <template #footer>
        <el-button @click="closeDetailDialog">{{ $t('common.close') }}</el-button>
      </template>
    </el-dialog>

    <!-- 参数管理对话框 -->
    <SkillParametersModal
      :visible="showParamsDialog"
      :skill="paramsSkill"
      @close="closeParamsDialog"
      @saved="closeParamsDialog"
    />
    
    <!-- 用户参数对话框 -->
    <MySkillParametersModal
      :visible="showMyParamsDialog"
      :skill="myParamsSkill"
      @close="closeMyParamsDialog"
      @saved="closeMyParamsDialog"
    />
    
    <!-- 技能编辑弹窗 -->
    <el-dialog
      v-model="showSkillEditor"
      :title="editingSkill?.name || $t('skills.editSkill') || '编辑技能'"
      width="640px"
      destroy-on-close
      class="skill-editor-dialog"
    >
      <el-tabs v-model="editorTab" type="border-card">
        <!-- 基本信息 Tab -->
        <el-tab-pane :label="$t('skills.basicInfo') || '基本信息'" name="basic">
          <el-form label-position="top" class="skill-form">
            <!-- ID（只读） -->
            <el-form-item :label="$t('skills.id') || 'ID'">
              <el-input :model-value="editingSkill?.id" readonly disabled />
            </el-form-item>
            
            <!-- Mark（可编辑） -->
            <el-form-item :label="$t('skills.mark') || '技能标识 (Mark)'">
              <el-input 
                v-model="skillForm.mark" 
                :placeholder="$t('skills.markPlaceholder') || '小写字母、数字、连字符'"
              />
              <el-text type="info" size="small">
                {{ $t('skills.markHint') || '用于生成工具名称，格式：mark__tool_name' }}
              </el-text>
            </el-form-item>
            
            <!-- 名称 -->
            <el-form-item :label="$t('skills.name') || '名称'">
              <el-input v-model="skillForm.name" />
            </el-form-item>
            
            <!-- 描述 -->
            <el-form-item :label="$t('skills.description') || '描述'">
              <el-input v-model="skillForm.description" type="textarea" :rows="3" />
            </el-form-item>
            
            <!-- 版本 & 作者 -->
            <div class="form-row">
              <el-form-item :label="$t('skills.version') || '版本'" class="form-item-half">
                <el-input v-model="skillForm.version" />
              </el-form-item>
              <el-form-item :label="$t('skills.author') || '作者'" class="form-item-half">
                <el-input v-model="skillForm.author" />
              </el-form-item>
            </div>
            
            <!-- 来源信息 -->
            <div class="form-row">
              <el-form-item :label="$t('skills.sourceType') || '来源类型'" class="form-item-half">
                <el-input :model-value="editingSkill?.source_type" readonly disabled />
              </el-form-item>
              <el-form-item :label="$t('skills.sourcePath') || '来源路径'" class="form-item-half">
                <el-input v-model="skillForm.source_path" />
              </el-form-item>
            </div>
            
            <!-- 来源 URL -->
            <el-form-item v-if="editingSkill?.source_url" :label="$t('skills.sourceUrl') || '来源 URL'">
              <el-input :model-value="editingSkill?.source_url" readonly disabled />
            </el-form-item>
            
            <!-- 标签 -->
            <el-form-item :label="$t('skills.tags') || '标签'">
              <el-tag
                v-for="(tag, index) in skillForm.tags"
                :key="index"
                closable
                @close="removeTag(index)"
                class="tag-item"
              >
                {{ tag }}
              </el-tag>
              <el-input
                v-if="tagInputVisible"
                ref="tagInputRef"
                v-model="newTagInput"
                size="small"
                @keyup.enter="addTag"
                @blur="addTag"
                class="tag-input"
              />
              <el-button v-else size="small" @click="showTagInput">+ {{ $t('skills.addTag') || '添加标签' }}</el-button>
            </el-form-item>
            
            <!-- 启用状态 -->
            <el-form-item>
              <el-checkbox v-model="skillForm.is_active">
                {{ $t('skills.enabled') || '启用' }}
              </el-checkbox>
            </el-form-item>
            
            <!-- 时间信息 -->
            <div class="form-row">
              <el-form-item :label="$t('skills.createdAt') || '创建时间'" class="form-item-half">
                <el-input :model-value="formatDateTime(editingSkill?.created_at)" readonly disabled />
              </el-form-item>
              <el-form-item :label="$t('skills.updatedAt') || '更新时间'" class="form-item-half">
                <el-input :model-value="formatDateTime(editingSkill?.updated_at)" readonly disabled />
              </el-form-item>
            </div>
          </el-form>
        </el-tab-pane>

        <!-- 工具列表 Tab -->
        <el-tab-pane :label="$t('skills.toolsList') || '工具列表'" name="tools">
          <div v-if="skillForm.tools?.length" class="tools-list-editor">
            <el-card v-for="tool in skillForm.tools" :key="tool.id" class="tool-card" shadow="never">
              <template #header>
                <div class="tool-card-header">
                  <el-input v-model="tool.name" :placeholder="$t('skills.name') || '名称'" />
                  <el-tag v-if="tool.is_resident" type="success" size="small">{{ $t('skills.isResident') || '驻留' }}</el-tag>
                </div>
              </template>
              
              <el-form label-position="left" label-width="80px">
                <el-form-item :label="$t('skills.description') || '描述'">
                  <el-input v-model="tool.description" :placeholder="$t('skills.description') || '描述'" />
                </el-form-item>
                
                <el-form-item :label="$t('skills.scriptPath') || '脚本路径'">
                  <el-input v-model="tool.script_path" :placeholder="$t('skills.scriptPath') || '脚本路径'" />
                </el-form-item>
                
                <el-form-item :label="$t('skills.parametersTitle') || '参数'">
                  <el-input v-model="tool.parameters" type="textarea" :rows="5" :placeholder="$t('skills.parametersPlaceholder') || 'JSON 格式的参数定义'" />
                </el-form-item>
                
                <el-form-item>
                  <el-checkbox v-model="tool.is_resident">
                    {{ $t('skills.isResidentHint') || '驻留进程（持续运行，stdio 通信）' }}
                  </el-checkbox>
                </el-form-item>
              </el-form>
            </el-card>
          </div>
          <el-empty v-else :description="$t('skills.noTools') || '暂无工具'" />
        </el-tab-pane>

        <!-- 参数配置 Tab -->
        <el-tab-pane :label="$t('skills.parametersTitle') || '参数配置'" name="params">
          <div class="section-header">
            <span></span>
            <el-button type="primary" size="small" @click="addParameter">+ {{ $t('skills.addParameter') || '添加参数' }}</el-button>
          </div>
          <div v-if="skillForm.parameters?.length" class="parameters-list">
            <div v-for="(param, index) in skillForm.parameters" :key="index" class="parameter-item">
              <el-input v-model="param.param_name" :placeholder="$t('skills.paramName') || '参数名'" class="param-name" />
              <el-input v-model="param.param_value" :placeholder="$t('skills.paramValue') || '参数值'" :type="param.is_secret ? 'password' : 'text'" class="param-value" />
              <el-checkbox v-model="param.is_secret">{{ $t('skills.secret') || '密钥' }}</el-checkbox>
              <el-button type="danger" size="small" circle @click="removeParameter(index)">×</el-button>
            </div>
          </div>
          <el-empty v-else :description="$t('skills.noParameters') || '暂无参数配置'">
            <el-button type="primary" @click="addParameter">+ {{ $t('skills.addParameter') || '添加参数' }}</el-button>
          </el-empty>
        </el-tab-pane>
      </el-tabs>
      
      <template #footer>
        <div class="dialog-footer-custom">
          <el-button type="danger" @click="deleteSkill" :loading="deletingSkill">
            {{ deletingSkill ? ($t('common.deleting') || '删除中...') : ($t('common.delete') || '删除') }}
          </el-button>
          <div class="footer-right">
            <el-button @click="closeSkillEditor">{{ $t('common.cancel') || '取消' }}</el-button>
            <el-button type="primary" @click="saveSkill" :loading="savingSkill">
              {{ savingSkill ? ($t('common.saving') || '保存中...') : ($t('common.save') || '保存') }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
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
import MySkillParametersModal from '@/components/MySkillParametersModal.vue'

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
const showMyParamsDialog = ref(false)
const selectedSkill = ref<Skill | null>(null)
const paramsSkill = ref<Skill | null>(null)
const myParamsSkill = ref<Skill | null>(null)

// 技能编辑器状态
const showSkillEditor = ref(false)
const editingSkill = ref<SkillDetail | null>(null)
const savingSkill = ref(false)
const deletingSkill = ref(false)
const editorTab = ref<'basic' | 'tools' | 'params'>('basic')
const newTagInput = ref('')
const tagInputVisible = ref(false)
const tagInputRef = ref<HTMLInputElement>()

// 表单数据
const skillForm = reactive({
  name: '',
  mark: '',  // 技能标识，用于生成 tool_name
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

// 用户参数管理
const openMyParamsDialog = (skill: Skill) => {
  myParamsSkill.value = skill
  showMyParamsDialog.value = true
}

const closeMyParamsDialog = () => {
  showMyParamsDialog.value = false
  myParamsSkill.value = null
}

// 技能编辑器
const openSkillEditor = async (skill: Skill) => {
  try {
    // 获取技能详情
    const res = await skill_api.get_skill_detail(skill.id)
    editingSkill.value = res.skill
    
    // 填充表单
    skillForm.name = res.skill.name
    skillForm.mark = res.skill.mark || ''
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
  tagInputVisible.value = false
}

// 显示标签输入框
const showTagInput = () => {
  tagInputVisible.value = true
  // 下一帧聚焦输入框
  setTimeout(() => {
    tagInputRef.value?.focus()
  }, 0)
}

// 移除标签
const removeTag = (index: number) => {
  skillForm.tags.splice(index, 1)
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
    // 验证 mark 格式（只允许小写字母、数字、下划线和连字符）
    const markPattern = /^[a-z0-9_-]+$/
    if (skillForm.mark && !markPattern.test(skillForm.mark)) {
      toast.error(t('skills.markFormatError') || '技能标识格式错误，只允许小写字母、数字、下划线、连字符')
      return
    }
    
    // 构建更新数据
    const updateData = {
      name: skillForm.name,
      mark: skillForm.mark,
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

.skills-filter .el-input {
  flex: 1;
}

.skills-filter .el-select {
  width: 160px;
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

.btn-icon {
  font-size: 14px;
}

/* 对话框内容 */
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

  .skill-actions .el-button {
    width: 100%;
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


.skill-form .form-row {
  display: flex;
  gap: 16px;
}

.skill-form .form-item-half {
  flex: 1;
}

.tag-item {
  margin-right: 8px;
  margin-bottom: 8px;
}

.tag-input {
  width: 120px;
}

.tools-list-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tool-card {
  margin-bottom: 0;
}

.tool-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tool-card-header .el-input {
  flex: 1;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.parameters-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.parameter-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--bg-secondary, #f9f9f9);
  border-radius: 6px;
}

.param-name {
  width: 140px;
  flex-shrink: 0;
}

.param-value {
  flex: 1;
}

.dialog-footer-custom {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer-right {
  display: flex;
  gap: 12px;
}
</style>
