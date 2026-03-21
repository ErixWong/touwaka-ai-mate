<template>
  <div class="skills-directory-tab">
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
      
      <!-- 底部注册信息 Banner -->
      <div v-if="skillDirectoryStore.selectedSkill" class="registration-banner">
        <div class="banner-content">
          <span class="banner-label">{{ skillDirectoryStore.selectedSkill.name }}</span>
          <span
            class="banner-status"
            :class="skillDirectoryStore.selectedSkill.is_registered ? 'registered' : 'unregistered'"
          >
            {{ skillDirectoryStore.selectedSkill.is_registered ? ($t('skills.registered') || '已注册') : ($t('skills.unregistered') || '未注册') }}
          </span>
        </div>
      </div>
    </template>
    
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { skill_api } from '@/api/services'
import { useSkillDirectoryStore } from '@/stores/skillDirectory'
import { useToastStore } from '@/stores/toast'
import CodePreview from '@/components/CodePreview.vue'
import type { Skill } from '@/types'

const { t } = useI18n()
const skillDirectoryStore = useSkillDirectoryStore()
const toast = useToastStore()

// 技能列表（用于判断注册状态）
const skills = ref<Skill[]>([])

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

onMounted(() => {
  loadDirectories()
  loadSkills()
})

// 加载技能列表（用于判断注册状态）
const loadSkills = async () => {
  try {
    const res = await skill_api.list_all_skills({ include_inactive: true })
    skills.value = res.skills || []
  } catch (err) {
    console.error('Failed to load skills:', err)
  }
}

// 加载技能目录
const loadDirectories = async () => {
  await skillDirectoryStore.loadSkillDirectories()
}

// 根据 source_path 判断目录是否已注册
const getDirectoryRegistrationStatus = (dirName: string): { is_registered: boolean; skill_id?: string } => {
  const skill = skills.value.find(s => {
    if (!s.source_path) return false
    const sourcePath = s.source_path
    return sourcePath === dirName ||
           sourcePath.endsWith(`/${dirName}`) ||
           sourcePath.endsWith(`\\${dirName}`)
  })
  
  return {
    is_registered: !!skill,
    skill_id: skill?.id
  }
}

// 选择目录
const selectDirectory = (dir: { name: string; path: string; skill_id?: string; description?: string; is_registered?: boolean }) => {
  const registrationStatus = getDirectoryRegistrationStatus(dir.name)
  
  skillDirectoryStore.selectSkill({
    name: dir.name,
    path: dir.path,
    description: dir.description,
    is_registered: registrationStatus.is_registered,
    skill_id: registrationStatus.skill_id
  })
}

// 进入目录浏览
const enterDirectory = async (dir: { name: string; path: string; skill_id?: string }) => {
  const registrationStatus = getDirectoryRegistrationStatus(dir.name)
  
  skillDirectoryStore.enterBrowseMode({
    name: dir.name,
    path: dir.path,
    is_registered: registrationStatus.is_registered,
    skill_id: registrationStatus.skill_id || dir.name
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
    await skillDirectoryStore.navigateToSubdir(file.name)
  } else {
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
</script>

<style scoped>
.skills-directory-tab {
  height: 100%;
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

/* 底部注册信息 Banner */
.registration-banner {
  border-top: 1px solid var(--border-color, #e0e0e0);
  padding: 12px 16px;
  background: var(--bg-secondary, #f9f9f9);
  flex-shrink: 0;
}

.banner-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.banner-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.banner-status {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 12px;
}

.banner-status.registered {
  background: var(--success-light, #e8f5e9);
  color: var(--success-color, #4caf50);
}

.banner-status.unregistered {
  background: var(--bg-tertiary, #f0f0f0);
  color: var(--text-secondary, #999);
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
  width: 95%;
  max-width: 1200px;
  max-height: 90vh;
  height: 85vh;
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
  min-height: 400px;
  max-height: 75vh;
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
</style>