<template>
  <div class="skills-tab">
    <!-- 内部 TabPage 切换 -->
    <div class="internal-tabs">
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'registered' }"
        @click="activeTab = 'registered'"
      >
        {{ $t('skills.registeredSkills') || '已注册技能' }}
      </button>
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'directory' }"
        @click="activeTab = 'directory'"
      >
        {{ $t('skillsDirectory.title') || '技能目录' }}
      </button>
    </div>
    
    <!-- 已注册技能列表 -->
    <div v-show="activeTab === 'registered'" class="tab-content">
      <div class="panel-header">
        <span class="skills-count">{{ skills.length }} {{ $t('skills.skills') || '个技能' }}</span>
        <button class="refresh-btn-small" @click="load_skills" :disabled="loading">
          <span :class="{ spinning: loading }">🔄</span>
        </button>
      </div>
      
      <div v-if="loading" class="loading-state">
        <span class="loading-spinner">⏳</span>
        <span>{{ $t('common.loading') || '加载中...' }}</span>
      </div>
      
      <div v-else-if="skills.length === 0" class="empty-state">
        <span class="empty-icon">📦</span>
        <p>{{ $t('skills.noSkills') || '暂无已注册技能' }}</p>
        <p class="empty-hint">{{ $t('skills.importHint') || '在对话中输入：帮我导入技能 [路径]' }}</p>
      </div>
      
      <div v-else class="skills-items">
        <div 
          v-for="skill in skills" 
          :key="skill.id"
          class="skill-item"
          :class="{ inactive: !skill.is_active }"
          @click="open_skill_editor(skill)"
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
    </div>
    
    <!-- 技能目录 -->
    <div v-show="activeTab === 'directory'" class="tab-content">
      <!-- 文件浏览模式 -->
      <template v-if="skillDirectoryStore.isBrowsing">
        <!-- 浏览头部 -->
        <div class="browse-header">
          <div class="browse-info">
            <button class="btn-back" @click="exitBrowseMode" :title="$t('tasks.backToList') || '返回列表'">
              <span class="icon">←</span>
            </button>
            <div class="browse-title">
              <span class="dir-icon">📁</span>
              <span class="dir-name">{{ skillDirectoryStore.browsingSkill?.name }}</span>
            </div>
          </div>
          <div class="browse-actions">
            <button class="btn-refresh" @click="refreshFiles" :disabled="skillDirectoryStore.isLoadingFiles" :title="$t('tasks.refresh') || '刷新'">
              <span class="icon">↻</span>
            </button>
          </div>
        </div>

        <!-- 面包屑导航 -->
        <div class="breadcrumb" v-if="skillDirectoryStore.browsingPath">
          <span class="breadcrumb-item" @click="navigateToRoot">
            {{ $t('tasks.workspace') || '根目录' }}
          </span>
          <template v-for="(part, index) in skillDirectoryStore.browsingPath.split('/')" :key="index">
            <span class="separator">/</span>
            <span class="breadcrumb-item" @click="navigateToPath(skillDirectoryStore.browsingPath.split('/').slice(0, index + 1).join('/'))">
              {{ part }}
            </span>
          </template>
        </div>
        <div class="breadcrumb" v-else>
          <span class="breadcrumb-item root">{{ $t('tasks.workspace') || '根目录' }}</span>
        </div>

        <!-- 文件列表 -->
        <div class="file-list">
          <div v-if="skillDirectoryStore.isLoadingFiles" class="loading-state">
            <span class="loading-spinner">⏳</span>
            <span>{{ $t('common.loading') || '加载中...' }}</span>
          </div>
          
          <div v-else-if="skillDirectoryStore.currentFiles.length === 0" class="empty-state">
            <span class="empty-icon">📂</span>
            <p>{{ $t('tasks.noFiles') || '暂无文件' }}</p>
          </div>
          
          <template v-else>
            <div
              v-for="file in skillDirectoryStore.currentFiles"
              :key="file.path"
              class="file-item"
              @click="handleFileClick(file)"
            >
              <span class="file-icon">{{ file.type === 'directory' ? '📁' : getFileIcon(file.name) }}</span>
              <div class="file-info">
                <div class="file-name">{{ file.name }}</div>
                <div class="file-meta">
                  <span v-if="file.type === 'file'" class="file-size">{{ formatSize(file.size) }}</span>
                  <span class="file-date">{{ formatDate(file.modified_at) }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </template>
      
      <!-- 目录列表模式 -->
      <template v-else>
        <div class="panel-header">
          <span class="skills-count">{{ skillDirectoryStore.skillDirectories.length }} {{ $t('skills.directories') || '个目录' }}</span>
          <div class="header-actions">
            <button class="action-btn-small" @click="openCreateDirectoryDialog" :title="$t('skillsDirectory.createDirectory') || '新建目录'">
              <span>➕</span>
            </button>
            <button class="refresh-btn-small" @click="loadDirectories" :disabled="skillDirectoryStore.isLoading">
              <span :class="{ spinning: skillDirectoryStore.isLoading }">🔄</span>
            </button>
          </div>
        </div>
        
        <div v-if="skillDirectoryStore.isLoading" class="loading-state">
          <span class="loading-spinner">⏳</span>
          <span>{{ $t('common.loading') || '加载中...' }}</span>
        </div>
        
        <div v-else-if="skillDirectoryStore.skillDirectories.length === 0" class="empty-state">
          <span class="empty-icon">📁</span>
          <p>{{ $t('skillsDirectory.noDirectories') || '暂无技能目录' }}</p>
          <button class="add-btn-large" @click="openCreateDirectoryDialog">
            ➕ {{ $t('skillsDirectory.createDirectory') || '新建目录' }}
          </button>
        </div>
        
        <div v-else class="directory-list">
          <div
            v-for="dir in skillDirectoryStore.skillDirectories"
            :key="dir.name"
            class="directory-item"
            :class="{ selected: skillDirectoryStore.selectedSkill?.name === dir.name }"
            @click="selectDirectory(dir)"
            @dblclick="enterDirectory(dir)"
          >
            <span class="dir-icon">📁</span>
            <div class="dir-info">
              <span class="dir-name">{{ dir.name }}</span>
              <span v-if="dir.description" class="dir-desc">{{ dir.description }}</span>
            </div>
            <button class="enter-btn" @click.stop="enterDirectory(dir)" :title="$t('skillsDirectory.browseFiles') || '浏览文件'">
              <span>→</span>
            </button>
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
              class="action-btn secondary"
              @click="enterDirectory(skillDirectoryStore.selectedSkill)"
            >
              {{ $t('skillsDirectory.browseFiles') || '浏览文件' }}
            </button>
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
      </template>
    </div>
    
    <!-- 创建目录对话框 -->
    <div v-if="showCreateDirectoryDialog" class="dialog-overlay" @click.self="closeCreateDirectoryDialog">
      <div class="dialog">
        <div class="dialog-header">
          <h3>{{ $t('skillsDirectory.createDirectory') || '新建技能目录' }}</h3>
          <button class="btn-close" @click="closeCreateDirectoryDialog">×</button>
        </div>
        <div class="dialog-body">
          <div class="form-group">
            <label>{{ $t('skillsDirectory.directoryName') || '目录名称' }}</label>
            <input
              v-model="newDirectoryName"
              type="text"
              :placeholder="$t('skillsDirectory.directoryNamePlaceholder') || '输入目录名称（仅限英文、数字、下划线、连字符）'"
              class="form-input"
              @keyup.enter="handleCreateDirectory"
            />
          </div>
          <div class="form-group">
            <label>{{ $t('skills.description') || '描述' }}</label>
            <textarea
              v-model="newDirectoryDescription"
              :placeholder="$t('skillsDirectory.descriptionPlaceholder') || '输入描述（可选）'"
              class="form-textarea"
              rows="3"
            ></textarea>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeCreateDirectoryDialog">
            {{ $t('common.cancel') || '取消' }}
          </button>
          <button
            class="btn-confirm"
            @click="handleCreateDirectory"
            :disabled="!newDirectoryName.trim() || isCreatingDirectory"
          >
            {{ isCreatingDirectory ? ($t('common.creating') || '创建中...') : ($t('common.create') || '创建') }}
          </button>
        </div>
      </div>
    </div>
    
    <!-- 文件预览对话框 -->
    <div v-if="showFilePreview" class="dialog-overlay preview-overlay" @click.self="closeFilePreview">
      <div class="dialog preview-dialog">
        <div class="dialog-header">
          <div class="preview-title-row">
            <span class="preview-icon">{{ getFileIcon(previewFile?.name || '') }}</span>
            <span class="preview-filename">{{ previewFile?.name }}</span>
          </div>
          <button class="btn-close" @click="closeFilePreview">×</button>
        </div>
        <div class="dialog-body preview-body">
          <div v-if="previewLoading" class="preview-loading">
            <span class="loading-spinner">⏳</span>
            <span>{{ $t('common.loading') || '加载中...' }}</span>
          </div>
          <template v-else>
            <!-- 代码/文本预览 -->
            <template v-if="previewType === 'code' || previewType === 'text'">
              <CodePreview
                :code="previewContent"
                :language="previewFileLanguage"
                :show-line-numbers="true"
                :show-copy-button="true"
                theme="auto"
              />
            </template>
            <!-- Markdown 预览 -->
            <template v-else-if="previewType === 'markdown'">
              <div class="preview-markdown" v-html="previewRenderedHtml"></div>
            </template>
            <!-- 图片预览 -->
            <template v-else-if="previewType === 'image'">
              <div class="preview-image">
                <img :src="previewContent" :alt="previewFile?.name" />
              </div>
            </template>
            <!-- 不支持的类型 -->
            <div v-else class="preview-unsupported">
              <p>{{ $t('tasks.previewNotSupported') || '暂不支持此文件类型预览' }}</p>
            </div>
          </template>
        </div>
      </div>
    </div>
    
    <!-- 技能编辑弹窗 -->
    <Teleport to="body">
      <div v-if="show_editor" class="skill-editor-overlay">
        <div class="skill-editor-modal">
          <div class="modal-header">
            <h3>{{ editing_skill?.name || $t('skills.editSkill') || '编辑技能' }}</h3>
            <button class="close-btn" @click="close_editor">×</button>
          </div>
          
          <!-- 弹窗内部 TabPage -->
          <div class="modal-tabs">
            <button 
              class="modal-tab-btn" 
              :class="{ active: editor_tab === 'basic' }"
              @click="editor_tab = 'basic'"
            >
              {{ $t('skills.basicInfo') || '基本信息' }}
            </button>
            <button 
              class="modal-tab-btn" 
              :class="{ active: editor_tab === 'tools' }"
              @click="editor_tab = 'tools'"
            >
              {{ $t('skills.toolsList') || '工具列表' }}
              <span v-if="skill_form.tools?.length" class="tab-badge">{{ skill_form.tools.length }}</span>
            </button>
            <button
              class="modal-tab-btn"
              :class="{ active: editor_tab === 'params' }"
              @click="editor_tab = 'params'"
            >
              {{ $t('skills.parametersTitle') || '参数配置' }}
              <span v-if="skill_form.parameters?.length" class="tab-badge">{{ skill_form.parameters.length }}</span>
            </button>
          </div>
          
          <div class="modal-body">
            <!-- 基本信息 Tab -->
            <div v-show="editor_tab === 'basic'" class="editor-section">
              <div class="form-group">
                <label>{{ $t('skills.name') || '名称' }}</label>
                <input v-model="skill_form.name" type="text" class="form-input" />
              </div>
              <div class="form-group">
                <label>{{ $t('skills.description') || '描述' }}</label>
                <textarea v-model="skill_form.description" class="form-textarea" rows="5"></textarea>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>{{ $t('skills.version') || '版本' }}</label>
                  <input v-model="skill_form.version" type="text" class="form-input" />
                </div>
                <div class="form-group">
                  <label>{{ $t('skills.author') || '作者' }}</label>
                  <input v-model="skill_form.author" type="text" class="form-input" />
                </div>
              </div>
              <div class="form-group">
                <label class="checkbox-label">
                  <input type="checkbox" v-model="skill_form.is_active" />
                  {{ $t('skills.enabled') || '启用' }}
                </label>
              </div>
            </div>
            
            <!-- 工具列表 Tab -->
            <div v-show="editor_tab === 'tools'" class="editor-section tools-section">
              <div v-if="skill_form.tools?.length" class="tools-list">
                <div v-for="tool in skill_form.tools" :key="tool.id" class="tool-item">
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
              <div v-else class="empty-state">
                <span class="empty-icon">🔧</span>
                <p>{{ $t('skills.noTools') || '暂无工具' }}</p>
              </div>
            </div>
            
            <!-- 参数配置 Tab -->
            <div v-show="editor_tab === 'params'" class="editor-section">
              <div class="section-header">
                <span></span>
                <button class="add-btn" @click="add_parameter">+ {{ $t('skills.addParameter') || '添加参数' }}</button>
              </div>
              <div v-if="skill_form.parameters?.length" class="parameters-list">
                <div v-for="(param, index) in skill_form.parameters" :key="index" class="parameter-item">
                  <div class="param-row">
                    <input v-model="param.param_name" type="text" class="form-input param-name" :placeholder="$t('skills.paramName') || '参数名'" />
                    <input v-model="param.param_value" :type="param.is_secret ? 'password' : 'text'" class="form-input param-value" :placeholder="$t('skills.paramValue') || '参数值'" />
                    <label class="secret-label">
                      <input type="checkbox" v-model="param.is_secret" />
                      {{ $t('skills.secret') || '密钥' }}
                    </label>
                    <button class="remove-btn" @click="remove_parameter(index)">×</button>
                  </div>
                </div>
              </div>
              <div v-else class="empty-state">
                <span class="empty-icon">⚙️</span>
                <p>{{ $t('skills.noParameters') || '暂无参数配置' }}</p>
                <button class="add-btn-large" @click="add_parameter">+ {{ $t('skills.addParameter') || '添加参数' }}</button>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn-cancel" @click="close_editor">{{ $t('common.cancel') || '取消' }}</button>
            <button class="btn-save" @click="save_skill" :disabled="saving">
              {{ saving ? ($t('common.saving') || '保存中...') : ($t('common.save') || '保存') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { skill_api } from '@/api/services'
import { eventBus, EVENTS } from '@/utils/eventBus'
import { useSkillDirectoryStore } from '@/stores/skillDirectory'
import { useTaskStore } from '@/stores/task'
import { useToastStore } from '@/stores/toast'
import CodePreview from '@/components/CodePreview.vue'
import type { Skill, SkillDetail, SkillTool, SkillParameter } from '@/types'

// 扩展 SkillParameter 类型以支持前端编辑
interface EditableParameter {
  id?: string
  param_name: string
  param_value: string
  is_secret: boolean
}

const { t } = useI18n()
const skillDirectoryStore = useSkillDirectoryStore()
const taskStore = useTaskStore()
const toast = useToastStore()

// Tab 状态
const activeTab = ref<'registered' | 'directory'>('registered')

// 技能列表状态
const skills = ref<Skill[]>([])
const loading = ref(false)

// 编辑器状态
const show_editor = ref(false)
const editing_skill = ref<SkillDetail | null>(null)
const saving = ref(false)
const editor_tab = ref<'basic' | 'tools' | 'params'>('basic')

// 表单数据
const skill_form = reactive({
  name: '',
  description: '',
  version: '',
  author: '',
  is_active: true,
  tools: [] as SkillTool[],
  parameters: [] as EditableParameter[]
})

// 创建目录对话框
const showCreateDirectoryDialog = ref(false)
const newDirectoryName = ref('')
const newDirectoryDescription = ref('')
const isCreatingDirectory = ref(false)

// 文件预览
const showFilePreview = ref(false)
const previewFile = ref<{ name: string; path: string; size: number; modified_at: string } | null>(null)
const previewType = ref<'text' | 'code' | 'markdown' | 'image' | 'unsupported'>('text')
const previewContent = ref('')
const previewRenderedHtml = ref('')
const previewLoading = ref(false)

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true,
})

// 订阅技能相关事件
let unsubscribeCallbacks: (() => void)[] = []

onMounted(() => {
  load_skills()
  loadDirectories()
  
  // 订阅技能变更事件，自动刷新列表
  unsubscribeCallbacks = [
    eventBus.on(EVENTS.SKILL_REGISTERED, () => {
      load_skills()
    }),
    eventBus.on(EVENTS.SKILL_TOGGLED, () => {
      load_skills()
    }),
    eventBus.on(EVENTS.SKILL_DELETED, () => {
      load_skills()
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
    skills.value = res.skills || []
  } catch (err) {
    console.error('Failed to load skills:', err)
  } finally {
    loading.value = false
  }
}

// 加载技能目录
const loadDirectories = async () => {
  await skillDirectoryStore.loadSkillDirectories()
}

// 选择目录
const selectDirectory = (dir: { name: string; path: string; skill_id?: string; description?: string }) => {
  skillDirectoryStore.selectSkill({
    name: dir.name,
    path: dir.path,
    description: dir.description,
    is_registered: true,
    skill_id: dir.skill_id
  })
}

// 进入目录浏览
const enterDirectory = async (dir: { name: string; path: string; skill_id?: string }) => {
  if (!dir.skill_id) {
    toast.warning(t('skillsDirectory.skillNotRegistered') || '该技能未注册，无法浏览文件')
    return
  }
  
  skillDirectoryStore.enterBrowseMode({
    name: dir.name,
    path: dir.path,
    is_registered: true,
    skill_id: dir.skill_id
  })
  
  await skillDirectoryStore.loadSkillFiles()
}

// 退出浏览模式
const exitBrowseMode = () => {
  skillDirectoryStore.exitBrowseMode()
}

// 刷新文件列表
const refreshFiles = async () => {
  await skillDirectoryStore.loadSkillFiles(skillDirectoryStore.browsingPath || undefined)
}

// 导航到根目录
const navigateToRoot = async () => {
  await skillDirectoryStore.loadSkillFiles()
}

// 导航到指定路径
const navigateToPath = async (path: string) => {
  await skillDirectoryStore.loadSkillFiles(path)
}

// 处理文件点击
const handleFileClick = async (file: { name: string; path: string; type: 'directory' | 'file'; size: number; modified_at: string }) => {
  if (file.type === 'directory') {
    // 进入子目录
    await skillDirectoryStore.navigateToSubdir(file.name)
  } else {
    // 预览文件
    await openFilePreview(file)
  }
}

// 打开文件预览
const openFilePreview = async (file: { name: string; path: string; size: number; modified_at: string }) => {
  previewFile.value = file
  previewType.value = getPreviewType(file.name)
  previewContent.value = ''
  previewRenderedHtml.value = ''
  previewLoading.value = true
  showFilePreview.value = true
  
  try {
    const response = await skillDirectoryStore.getFileContent(file.path)
    const content = response.content || ''
    
    if (previewType.value === 'markdown') {
      // 渲染 Markdown
      const rawHtml = marked.parse(content) as string
      previewRenderedHtml.value = DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: [
          'p', 'br', 'strong', 'em', 'u', 's', 'del', 'ins',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'ul', 'ol', 'li',
          'blockquote', 'pre', 'code',
          'a', 'img',
          'table', 'thead', 'tbody', 'tr', 'th', 'td',
          'hr', 'div', 'span'
        ],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel', 'width', 'height'],
        ALLOW_DATA_ATTR: true,
      })
    } else if (previewType.value === 'image') {
      // 图片使用 base64 或 URL
      previewContent.value = `data:image/png;base64,${btoa(unescape(encodeURIComponent(content)))}`
    } else {
      previewContent.value = content
    }
  } catch (err) {
    console.error('Failed to load file content:', err)
    toast.error(t('skillsDirectory.loadFileFailed') || '加载文件失败')
    previewType.value = 'unsupported'
  } finally {
    previewLoading.value = false
  }
}

// 关闭文件预览
const closeFilePreview = () => {
  showFilePreview.value = false
  previewFile.value = null
  previewContent.value = ''
  previewRenderedHtml.value = ''
}

// 获取预览类型
const getPreviewType = (filename: string): 'text' | 'code' | 'markdown' | 'image' | 'unsupported' => {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  
  const textExts = ['txt', 'csv', 'log']
  const codeExts = ['js', 'ts', 'vue', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'sh', 'sql', 'md']
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']
  
  if (ext === 'md') return 'markdown'
  if (textExts.includes(ext)) return 'text'
  if (codeExts.includes(ext)) return 'code'
  if (imageExts.includes(ext)) return 'image'
  
  return 'unsupported'
}

// 获取文件图标
const getFileIcon = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const iconMap: Record<string, string> = {
    pdf: '📄',
    doc: '📝',
    docx: '📝',
    txt: '📃',
    md: '📑',
    csv: '📊',
    xlsx: '📊',
    xls: '📊',
    ppt: '📽️',
    pptx: '📽️',
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    gif: '🖼️',
    zip: '📦',
    json: '📋',
    js: '📜',
    ts: '📜',
    vue: '💚',
    py: '🐍',
  }
  return iconMap[ext] || '📄'
}

// 格式化文件大小
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// 格式化日期
const formatDate = (dateStr: string): string => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return '-'
  
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  
  if (days === 0) return t('tasks.today') || '今天'
  if (days === 1) return t('tasks.yesterday') || '昨天'
  if (days < 7) return t('tasks.daysAgo', { count: days }) || `${days}天前`
  return date.toLocaleDateString()
}

// 预览文件语言
const previewFileLanguage = computed(() => {
  if (!previewFile.value) return 'plaintext'
  const ext = previewFile.value.name.split('.').pop()?.toLowerCase() || ''
  return ext
})

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

// 打开创建目录对话框
const openCreateDirectoryDialog = () => {
  newDirectoryName.value = ''
  newDirectoryDescription.value = ''
  showCreateDirectoryDialog.value = true
}

// 关闭创建目录对话框
const closeCreateDirectoryDialog = () => {
  showCreateDirectoryDialog.value = false
  newDirectoryName.value = ''
  newDirectoryDescription.value = ''
}

// 创建目录
const handleCreateDirectory = async () => {
  const name = newDirectoryName.value.trim()
  if (!name) return
  
  // 验证目录名称格式
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    toast.error(t('skillsDirectory.invalidDirectoryName') || '目录名称只能包含英文、数字、下划线和连字符')
    return
  }
  
  isCreatingDirectory.value = true
  try {
    await skillDirectoryStore.createSkillDirectory(name, newDirectoryDescription.value.trim() || undefined)
    toast.success(t('skillsDirectory.directoryCreated') || '目录创建成功')
    closeCreateDirectoryDialog()
  } catch (err) {
    console.error('Failed to create directory:', err)
    toast.error(t('skillsDirectory.createDirectoryFailed') || '创建目录失败')
  } finally {
    isCreatingDirectory.value = false
  }
}

// 打开技能编辑器
const open_skill_editor = async (skill: Skill) => {
  loading.value = true
  try {
    // 获取技能详情
    const res = await skill_api.get_skill_detail(skill.id)
    editing_skill.value = res.skill
    
    // 填充表单
    skill_form.name = res.skill.name
    skill_form.description = res.skill.description || ''
    skill_form.version = res.skill.version || ''
    skill_form.author = res.skill.author || ''
    skill_form.is_active = res.skill.is_active
    skill_form.tools = res.skill.tools || []
    
    // 获取参数
    try {
      const paramsRes = await skill_api.get_skill_parameters(skill.id)
      skill_form.parameters = (paramsRes.parameters || []).map((p: SkillParameter) => ({
        id: p.id,
        param_name: p.param_name,
        param_value: p.param_value,
        is_secret: !!p.is_secret
      }))
    } catch {
      skill_form.parameters = []
    }
    
    show_editor.value = true
  } catch (err) {
    console.error('Failed to load skill detail:', err)
    toast.error(t('skills.loadFailed') || '加载技能详情失败')
  } finally {
    loading.value = false
  }
}

// 关闭编辑器
const close_editor = () => {
  show_editor.value = false
  editing_skill.value = null
  editor_tab.value = 'basic'  // 重置为基本信息 Tab
}

// 添加参数
const add_parameter = () => {
  skill_form.parameters.push({
    param_name: '',
    param_value: '',
    is_secret: false
  })
}

// 移除参数
const remove_parameter = (index: number) => {
  skill_form.parameters.splice(index, 1)
}

// 保存技能
const save_skill = async () => {
  if (!editing_skill.value) return
  
  saving.value = true
  try {
    // 更新技能基本信息
    await skill_api.update_skill(editing_skill.value.id, {
      name: skill_form.name,
      description: skill_form.description,
      is_active: skill_form.is_active
    })
    
    // 保存工具信息
    if (skill_form.tools.length > 0) {
      await skill_api.update_skill_tools(editing_skill.value.id, skill_form.tools.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        script_path: t.script_path,
        parameters: t.parameters,
        is_resident: t.is_resident
      })))
    }
    
    // 保存参数
    if (skill_form.parameters.length > 0) {
      await skill_api.save_skill_parameters(editing_skill.value.id, {
        parameters: skill_form.parameters.filter(p => p.param_name.trim()).map(p => ({
          param_name: p.param_name.trim(),
          param_value: p.param_value,
          is_secret: p.is_secret
        }))
      })
    }
    
    toast.success(t('skills.saveSuccess') || '保存成功')
    close_editor()
    load_skills()
  } catch (err) {
    console.error('Failed to save skill:', err)
    toast.error(t('skills.saveFailed') || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.skills-tab {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--sidebar-bg, #fff);
  min-height: 0;
}

/* 内部 TabPage */
.internal-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 10px 16px;
  border: none;
  background: transparent;
  font-size: 13px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s ease;
  border-bottom: 2px solid transparent;
}

.tab-btn:hover {
  color: var(--text-primary, #333);
  background: var(--bg-hover, #f5f5f5);
}

.tab-btn.active {
  color: var(--primary-color, #2196f3);
  border-bottom-color: var(--primary-color, #2196f3);
  font-weight: 500;
}

/* Tab 内容 */
.tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
}

.skills-count {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.header-actions {
  display: flex;
  gap: 6px;
}

.action-btn-small {
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

.action-btn-small:hover {
  background: var(--bg-hover, #f0f0f0);
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

.spinning {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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

/* 目录列表 */
.directory-list {
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
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
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
  flex-shrink: 0;
}

.dir-info {
  flex: 1;
  min-width: 0;
}

.dir-name {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.dir-desc {
  display: block;
  font-size: 11px;
  color: var(--text-secondary, #666);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.enter-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-secondary, #666);
  font-size: 14px;
  opacity: 0;
  transition: all 0.2s;
  flex-shrink: 0;
}

.directory-item:hover .enter-btn {
  opacity: 1;
}

.enter-btn:hover {
  background: var(--primary-color, #2196f3);
  border-color: var(--primary-color, #2196f3);
  color: white;
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

.action-btn.secondary {
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-primary, #333);
  border: 1px solid var(--border-color, #e0e0e0);
}

.action-btn.secondary:hover {
  background: var(--bg-hover, #e8e8e8);
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

/* 浏览模式 */
.browse-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--primary-bg, #e3f2fd);
}

.browse-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.btn-back {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
}

.btn-back:hover {
  background: var(--hover-bg, #ddd);
}

.browse-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.browse-title .dir-icon {
  font-size: 16px;
}

.browse-title .dir-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.browse-actions {
  display: flex;
  gap: 8px;
}

.btn-refresh {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  flex-shrink: 0;
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
  font-size: 16px;
  transition: transform 0.3s;
}

.btn-refresh:hover:not(:disabled) .icon {
  transform: rotate(180deg);
}

/* 面包屑 */
.breadcrumb {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  white-space: nowrap;
  overflow-x: auto;
}

.breadcrumb-item {
  cursor: pointer;
  color: var(--primary-color, #2196f3);
}

.breadcrumb-item:hover {
  text-decoration: underline;
}

.breadcrumb-item.root {
  cursor: default;
  color: var(--text-secondary, #666);
}

.separator {
  margin: 0 4px;
  color: var(--text-secondary, #999);
}

/* 文件列表 */
.file-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.file-item:hover {
  background: var(--hover-bg, #e8e8e8);
}

.file-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 14px;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-secondary, #999);
  margin-top: 2px;
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
  background: var(--dialog-bg, #fff);
  border-radius: 12px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.dialog-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.btn-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  font-size: 18px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  border-radius: 4px;
}

.btn-close:hover {
  background: var(--hover-bg, #e8e8e8);
}

.dialog-body {
  padding: 18px;
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

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.btn-cancel,
.btn-confirm {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--border-color, #ccc);
  color: var(--text-secondary, #666);
}

.btn-cancel:hover {
  background: var(--hover-bg, #e8e8e8);
}

.btn-confirm {
  background: var(--primary-color, #2196f3);
  border: none;
  color: white;
}

.btn-confirm:hover:not(:disabled) {
  background: var(--primary-hover, #1976d2);
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 预览对话框 */
.preview-overlay {
  z-index: 1001;
}

.preview-dialog {
  max-width: 800px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.preview-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-icon {
  font-size: 18px;
}

.preview-filename {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.preview-body {
  flex: 1;
  overflow: auto;
  min-height: 300px;
  max-height: 60vh;
}

.preview-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-secondary, #666);
}

.preview-unsupported {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  gap: 16px;
}

.preview-unsupported p {
  margin: 0;
  color: var(--text-secondary, #666);
}

.preview-image {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.preview-image img {
  max-width: 100%;
  max-height: 50vh;
  object-fit: contain;
  border-radius: 4px;
}

/* Markdown 预览样式 */
.preview-markdown {
  padding: 16px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #333);
}

.preview-markdown :deep(h1),
.preview-markdown :deep(h2),
.preview-markdown :deep(h3),
.preview-markdown :deep(h4),
.preview-markdown :deep(h5),
.preview-markdown :deep(h6) {
  margin: 16px 0 8px 0;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary, #333);
}

.preview-markdown :deep(h1) { font-size: 1.5em; border-bottom: 1px solid var(--border-color, #e0e0e0); padding-bottom: 8px; }
.preview-markdown :deep(h2) { font-size: 1.35em; }
.preview-markdown :deep(h3) { font-size: 1.2em; }
.preview-markdown :deep(h4) { font-size: 1.1em; }

.preview-markdown :deep(p) { margin: 8px 0; }
.preview-markdown :deep(p:first-child) { margin-top: 0; }
.preview-markdown :deep(p:last-child) { margin-bottom: 0; }

.preview-markdown :deep(ul),
.preview-markdown :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.preview-markdown :deep(li) { margin: 4px 0; }
.preview-markdown :deep(ul) { list-style-type: disc; }
.preview-markdown :deep(ol) { list-style-type: decimal; }

.preview-markdown :deep(pre) {
  background: var(--code-bg, #1e1e1e);
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}

.preview-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
  color: #d4d4d4;
  font-size: 13px;
  line-height: 1.5;
}

.preview-markdown :deep(code) {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
}

.preview-markdown :deep(code:not(pre code)) {
  background: var(--code-bg, #f0f0f0);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--code-color, #d63384);
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

/* 工具列表 */
.tools-section {
  padding: 0;
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tool-item {
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
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
}

.btn-cancel,
.btn-save {
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  background: var(--bg-secondary, #f5f5f5);
  border: 1px solid var(--border-color, #e0e0e0);
  color: var(--text-primary, #333);
}

.btn-cancel:hover {
  background: var(--bg-tertiary, #e0e0e0);
}

.btn-save {
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
</style>
