<template>
  <div class="tasks-tab">
    <!-- 任务模式：文件管理界面 -->
    <template v-if="taskStore.isInTaskMode && taskStore.currentTask">
      <div class="workspace-header">
        <div class="workspace-info">
          <button class="btn-back" @click="handleExitTask" :title="$t('tasks.backToList')">
            <span class="icon">←</span>
          </button>
          <div class="workspace-title">
            <span class="task-icon">📁</span>
            <span class="task-name">{{ taskStore.currentTask.title }}</span>
          </div>
        </div>
        <button class="btn-upload" @click="triggerUpload" :title="$t('tasks.uploadFile')">
          <span class="icon">↑</span>
        </button>
        <input
          ref="fileInputRef"
          type="file"
          style="display: none"
          @change="handleFileUpload"
          :accept="allowedFileTypes"
        />
      </div>

      <!-- 当前路径面包屑 -->
      <div class="breadcrumb">
        <span class="breadcrumb-item" @click="navigateTo()">
          {{ $t('tasks.workspace') }}
        </span>
        <template v-if="currentPath">
          <span v-for="(part, index) in currentPath.split('/')" :key="index">
            <span class="separator">/</span>
            <span class="breadcrumb-item" @click="navigateTo(currentPath.split('/').slice(0, index + 1).join('/'))">
              {{ part }}
            </span>
          </span>
        </template>
      </div>

      <!-- 文件列表 -->
      <div class="file-list">
        <div v-if="taskStore.isLoadingFiles" class="loading">
          {{ $t('common.loading') }}
        </div>

        <div v-else-if="taskStore.currentFiles.length === 0" class="empty">
          {{ $t('tasks.noFiles') }}
        </div>

        <template v-else>
          <div
            v-for="file in taskStore.currentFiles"
            :key="file.path"
            class="file-item"
            @click="handleFileClick(file)"
          >
            <span class="file-icon">{{ file.is_directory ? '📁' : getFileIcon(file.name) }}</span>
            <div class="file-info">
              <div class="file-name">{{ file.name }}</div>
              <div class="file-meta">
                <span v-if="!file.is_directory" class="file-size">{{ formatSize(file.size) }}</span>
                <span class="file-date">{{ formatDate(file.modified_at) }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- 任务列表模式 -->
    <template v-else>
      <!-- 头部 -->
      <div class="tasks-header">
        <h2 class="title">{{ $t('tasks.title') }}</h2>
        <button class="btn-create" @click="showCreateDialog = true" :title="$t('tasks.create')">
          <span class="icon">+</span>
        </button>
      </div>

      <!-- 搜索框 -->
      <div class="search-box">
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="$t('tasks.searchPlaceholder')"
          class="search-input"
        />
      </div>

      <!-- 任务列表 -->
      <div class="task-items" ref="taskListRef">
        <div v-if="taskStore.isLoading && taskStore.tasks.length === 0" class="loading">
          {{ $t('common.loading') }}
        </div>

        <div v-else-if="filteredTasks.length === 0" class="empty">
          {{ searchQuery ? $t('common.empty') : $t('tasks.empty') }}
        </div>

        <template v-else>
          <div
            v-for="task in filteredTasks"
            :key="task.id"
            class="task-item"
            :class="{ active: task.id === taskStore.currentTaskId }"
            :title="`ID: ${task.task_id}`"
            @click="handleSelectTask(task)"
          >
            <div class="task-title">{{ task.title }}</div>
            <div class="task-meta">
              <span class="task-date">{{ formatDate(task.updated_at) }}</span>
            </div>
            <div v-if="task.description" class="task-description">
              {{ truncate(task.description, 50) }}
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- 创建任务对话框 -->
    <div v-if="showCreateDialog" class="dialog-overlay" @click.self="showCreateDialog = false">
      <div class="dialog">
        <div class="dialog-header">
          <h3>{{ $t('tasks.createTitle') }}</h3>
          <button class="btn-close" @click="showCreateDialog = false">×</button>
        </div>
        <div class="dialog-body">
          <div class="form-group">
            <label>{{ $t('tasks.titleLabel') }}</label>
            <input
              v-model="newTask.title"
              type="text"
              :placeholder="$t('tasks.titlePlaceholder')"
              class="form-input"
              @keyup.enter="handleCreateTask"
            />
          </div>
          <div class="form-group">
            <label>{{ $t('tasks.descriptionLabel') }}</label>
            <textarea
              v-model="newTask.description"
              :placeholder="$t('tasks.descriptionPlaceholder')"
              class="form-textarea"
              rows="3"
            ></textarea>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="showCreateDialog = false">
            {{ $t('common.cancel') }}
          </button>
          <button
            class="btn-confirm"
            @click="handleCreateTask"
            :disabled="!newTask.title.trim() || isCreating"
          >
            {{ isCreating ? $t('common.creating') : $t('common.create') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTaskStore } from '@/stores/task'
import type { Task, TaskFile } from '@/types'

const { t } = useI18n()
const taskStore = useTaskStore()

const searchQuery = ref('')
const showCreateDialog = ref(false)
const isCreating = ref(false)
const taskListRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const currentPath = ref('')
const newTask = ref({
  title: '',
  description: ''
})

// 允许的文件类型
const allowedFileTypes = '.pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.zip,.json'

const filteredTasks = computed(() => {
  if (!searchQuery.value.trim()) {
    return taskStore.activeTasks
  }
  const query = searchQuery.value.toLowerCase()
  return taskStore.activeTasks.filter(task =>
    task.title.toLowerCase().includes(query) ||
    task.description?.toLowerCase().includes(query) ||
    task.task_id.toLowerCase().includes(query)
  )
})

// 监听任务模式变化，加载文件
watch(() => taskStore.isInTaskMode, async (isInMode) => {
  if (isInMode) {
    currentPath.value = ''
    await taskStore.loadTaskFiles()
  }
})

const handleSelectTask = (task: Task) => {
  // 直接进入任务（同步操作，只更新本地状态）
  taskStore.enterTask(task)
}

const handleExitTask = () => {
  taskStore.exitTask()
}

const handleCreateTask = async () => {
  if (!newTask.value.title.trim() || isCreating.value) return

  isCreating.value = true
  try {
    const task = await taskStore.createTask({
      title: newTask.value.title.trim(),
      description: newTask.value.description.trim() || undefined
    })
    // 创建成功后清空表单并关闭对话框
    newTask.value = { title: '', description: '' }
    showCreateDialog.value = false
    // 自动进入新创建的任务（同步操作）
    taskStore.enterTask(task)
  } catch (error) {
    console.error('Failed to create task:', error)
  } finally {
    isCreating.value = false
  }
}

// 文件管理相关
const triggerUpload = () => {
  fileInputRef.value?.click()
}

const handleFileUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    await taskStore.uploadFile(file, currentPath.value || undefined)
    // 清空 input 以便重复上传同一文件
    input.value = ''
  } catch (error) {
    console.error('Failed to upload file:', error)
  }
}

const handleFileClick = async (file: TaskFile) => {
  if (file.is_directory) {
    // 进入目录
    currentPath.value = currentPath.value 
      ? `${currentPath.value}/${file.name}` 
      : file.name
    await taskStore.loadTaskFiles(currentPath.value)
  }
  // TODO: 处理文件点击（下载或预览）
}

const navigateTo = async (path?: string) => {
  currentPath.value = path || ''
  await taskStore.loadTaskFiles(currentPath.value || undefined)
}

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
  }
  return iconMap[ext] || '📄'
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    return t('tasks.today')
  } else if (days === 1) {
    return t('tasks.yesterday')
  } else if (days < 7) {
    return t('tasks.daysAgo', { count: days })
  } else {
    return date.toLocaleDateString()
  }
}

const truncate = (text: string, maxLength: number) => {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

onMounted(() => {
  taskStore.loadTasks()
})
</script>

<style scoped>
.tasks-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--sidebar-bg, #f5f5f5);
}

/* Workspace Header */
.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--primary-bg, #e3f2fd);
}

.workspace-info {
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

.workspace-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.task-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.task-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-upload {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-color, #2196f3);
  border: none;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  flex-shrink: 0;
}

.btn-upload:hover {
  background: var(--primary-hover, #1976d2);
}

/* Breadcrumb */
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

.separator {
  margin: 0 4px;
  color: var(--text-secondary, #999);
}

/* File List */
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

/* Tasks List Mode */
.tasks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.btn-create {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-color, #2196f3);
  border: none;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-create:hover {
  background: var(--primary-hover, #1976d2);
}

.btn-create .icon {
  font-size: 20px;
  font-weight: bold;
}

.search-box {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #333);
}

.search-input:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.task-items {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.loading,
.empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #666);
}

.task-item {
  padding: 12px;
  margin-bottom: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.task-item:hover {
  background: var(--hover-bg, #e8e8e8);
}

.task-item.active {
  background: var(--active-bg, #e3f2fd);
}

.task-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
  margin-bottom: 4px;
}

.task-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-bottom: 4px;
}

.task-description {
  font-size: 12px;
  color: var(--text-secondary, #666);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Dialog Styles */
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
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
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
  font-size: 20px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  border-radius: 4px;
}

.btn-close:hover {
  background: var(--hover-bg, #e8e8e8);
}

.dialog-body {
  padding: 20px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
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
  min-height: 80px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.btn-cancel,
.btn-confirm {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
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
</style>
