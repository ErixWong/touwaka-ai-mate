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
            <span class="file-icon">{{ file.type === 'directory' ? '📁' : getFileIcon(file.name) }}</span>
            <div class="file-info">
              <div class="file-name">{{ file.name }}</div>
              <div class="file-meta">
                <span v-if="file.type === 'file'" class="file-size">{{ formatSize(file.size || 0) }}</span>
                <span class="file-date">{{ formatDate(file.modified_at || '') }}</span>
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
        <div class="header-actions">
          <select v-model="statusFilter" class="status-filter">
            <option value="all">{{ $t('tasks.allStatus') || '全部' }}</option>
            <option value="active">{{ $t('tasks.activeStatus') || '进行中' }}</option>
            <option value="archived">{{ $t('tasks.archivedStatus') || '已归档' }}</option>
          </select>
          <button class="btn-create" @click="openCreateDialog" :title="$t('tasks.create')">
            <span class="icon">+</span>
          </button>
        </div>
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
            v-for="task in paginatedTasks"
            :key="task.id"
            class="task-item"
            :class="{
              'task-active': task.status === 'active',
              'task-archived': task.status === 'archived',
              'selected': task.id === taskStore.currentTask?.id
            }"
            @click="handleSelectTask(task)"
          >
            <div class="task-header">
              <div class="task-status-indicator" :class="task.status"></div>
              <div class="task-title-row">
                <span class="task-title">{{ task.title }}</span>
                <span class="task-id">{{ task.task_id }}</span>
              </div>
            </div>
            <div v-if="task.description" class="task-description">
              {{ truncate(task.description, 60) }}
            </div>
            <div class="task-footer">
              <span class="task-date">{{ formatDate(task.updated_at) }}</span>
              <div class="task-actions" @click.stop>
                <button
                  v-if="task.status === 'active'"
                  class="btn-task btn-archive"
                  @click="handleArchiveTask(task)"
                >
                  <span class="btn-icon">📦</span>
                  <span class="btn-label">{{ $t('tasks.archive') || '归档' }}</span>
                </button>
                <button
                  v-else
                  class="btn-task btn-restore"
                  @click="handleRestoreTask(task)"
                >
                  <span class="btn-icon">↩️</span>
                  <span class="btn-label">{{ $t('tasks.restore') || '恢复' }}</span>
                </button>
                <button
                  class="btn-task btn-edit"
                  @click="openEditDialog(task)"
                >
                  <span class="btn-icon">✏️</span>
                  <span class="btn-label">{{ $t('tasks.edit') || '编辑' }}</span>
                </button>
                <button
                  class="btn-task btn-delete"
                  @click="handleDeleteTask(task)"
                >
                  <span class="btn-icon">🗑️</span>
                  <span class="btn-label">{{ $t('tasks.delete') || '删除' }}</span>
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 分页 -->
      <Pagination
        v-if="totalPages > 1"
        :current-page="currentPage"
        :total-pages="totalPages"
        :total="totalItems"
        @change="handlePageChange"
      />
    </template>

    <!-- 创建/编辑任务对话框 -->
    <div v-if="showTaskDialog" class="dialog-overlay" @click.self="closeTaskDialog">
      <div class="dialog">
        <div class="dialog-header">
          <h3>{{ isEditMode ? ($t('tasks.editTitle') || '编辑任务') : ($t('tasks.createTitle') || '创建任务') }}</h3>
          <button class="btn-close" @click="closeTaskDialog">×</button>
        </div>
        <div class="dialog-body">
          <div class="form-group">
            <label>{{ $t('tasks.titleLabel') || '标题' }}</label>
            <input
              v-model="taskForm.title"
              type="text"
              :placeholder="$t('tasks.titlePlaceholder') || '输入任务标题'"
              class="form-input"
              @keyup.enter="handleSubmitTask"
            />
          </div>
          <div class="form-group">
            <label>{{ $t('tasks.descriptionLabel') || '描述' }}</label>
            <textarea
              v-model="taskForm.description"
              :placeholder="$t('tasks.descriptionPlaceholder') || '输入任务描述（可选）'"
              class="form-textarea"
              rows="3"
            ></textarea>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeTaskDialog">
            {{ $t('common.cancel') || '取消' }}
          </button>
          <button
            class="btn-confirm"
            @click="handleSubmitTask"
            :disabled="!taskForm.title.trim() || isSubmitting"
          >
            {{ isSubmitting ? ($t('common.saving') || '保存中...') : ($t('common.save') || '保存') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 删除确认对话框 -->
    <div v-if="showDeleteConfirm" class="dialog-overlay" @click.self="showDeleteConfirm = false">
      <div class="dialog dialog-small">
        <div class="dialog-header">
          <h3>{{ $t('tasks.deleteConfirm') || '确认删除' }}</h3>
          <button class="btn-close" @click="showDeleteConfirm = false">×</button>
        </div>
        <div class="dialog-body">
          <p>{{ $t('tasks.deleteConfirmMessage', { title: taskToDelete?.title }) || `确定要删除任务"${taskToDelete?.title}"吗？此操作不可恢复。` }}</p>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="showDeleteConfirm = false">
            {{ $t('common.cancel') || '取消' }}
          </button>
          <button class="btn-confirm btn-danger" @click="confirmDeleteTask">
            {{ $t('common.delete') || '删除' }}
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
import Pagination from '@/components/Pagination.vue'
import type { Task, TaskFile } from '@/types'

const { t } = useI18n()
const taskStore = useTaskStore()

const searchQuery = ref('')
const statusFilter = ref<'all' | 'active' | 'archived'>('all')
const showTaskDialog = ref(false)
const showDeleteConfirm = ref(false)
const isEditMode = ref(false)
const isSubmitting = ref(false)
const taskListRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const currentPath = ref('')
const editingTask = ref<Task | null>(null)
const taskToDelete = ref<Task | null>(null)

// 分页相关
const currentPage = ref(1)
const pageSize = ref(10)

const taskForm = ref({
  title: '',
  description: ''
})

// 允许的文件类型
const allowedFileTypes = '.pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.zip,.json'

// 根据状态和搜索过滤任务
const filteredTasks = computed(() => {
  let tasks = taskStore.tasks

  // 排除已删除的任务
  tasks = tasks.filter(task => task.status !== 'deleted')

  // 状态过滤
  if (statusFilter.value !== 'all') {
    tasks = tasks.filter(task => task.status === statusFilter.value)
  }

  // 搜索过滤
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    tasks = tasks.filter(task =>
      task.title.toLowerCase().includes(query) ||
      task.description?.toLowerCase().includes(query) ||
      task.task_id.toLowerCase().includes(query)
    )
  }

  return tasks
})

// 分页计算
const totalItems = computed(() => filteredTasks.value.length)
const totalPages = computed(() => Math.ceil(totalItems.value / pageSize.value))

// 当前页的任务列表
const paginatedTasks = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredTasks.value.slice(start, end)
})

// 监听任务模式变化，加载文件
watch(() => taskStore.isInTaskMode, async (isInMode) => {
  if (isInMode) {
    currentPath.value = ''
    await taskStore.loadTaskFiles()
  }
})

// 监听过滤器变化，重置页码
watch([searchQuery, statusFilter], () => {
  currentPage.value = 1
})

const handleSelectTask = (task: Task) => {
  // 直接进入任务（同步操作，只更新本地状态）
  taskStore.enterTask(task)
}

const handleExitTask = () => {
  taskStore.exitTask()
}

// 打开创建对话框
const openCreateDialog = () => {
  isEditMode.value = false
  editingTask.value = null
  taskForm.value = { title: '', description: '' }
  showTaskDialog.value = true
}

// 打开编辑对话框
const openEditDialog = (task: Task) => {
  isEditMode.value = true
  editingTask.value = task
  taskForm.value = {
    title: task.title,
    description: task.description || ''
  }
  showTaskDialog.value = true
}

// 关闭对话框
const closeTaskDialog = () => {
  showTaskDialog.value = false
  editingTask.value = null
  taskForm.value = { title: '', description: '' }
}

// 提交任务（创建或编辑）
const handleSubmitTask = async () => {
  if (!taskForm.value.title.trim() || isSubmitting.value) return

  isSubmitting.value = true
  try {
    if (isEditMode.value && editingTask.value) {
      // 编辑模式 - 先捕获 ID，防止响应式引用变化
      const taskId = editingTask.value.id

      await taskStore.updateTask(taskId, {
        title: taskForm.value.title.trim(),
        description: taskForm.value.description.trim() || null  // 使用 null 清空描述
      })
    } else {
      // 创建模式
      const task = await taskStore.createTask({
        title: taskForm.value.title.trim(),
        description: taskForm.value.description.trim() || undefined
      })
      // 自动进入新创建的任务（同步操作）
      taskStore.enterTask(task)
    }
    closeTaskDialog()
  } catch (error) {
    console.error('Failed to save task:', error)
  } finally {
    isSubmitting.value = false
  }
}

// 归档任务
const handleArchiveTask = async (task: Task) => {
  try {
    await taskStore.updateTask(task.id, { status: 'archived' })
  } catch (error) {
    console.error('Failed to archive task:', error)
  }
}

// 恢复任务
const handleRestoreTask = async (task: Task) => {
  try {
    await taskStore.updateTask(task.id, { status: 'active' })
  } catch (error) {
    console.error('Failed to restore task:', error)
  }
}

// 删除任务
const handleDeleteTask = (task: Task) => {
  taskToDelete.value = task
  showDeleteConfirm.value = true
}

// 确认删除
const confirmDeleteTask = async () => {
  if (!taskToDelete.value) return

  try {
    await taskStore.deleteTask(taskToDelete.value.id)
    showDeleteConfirm.value = false
    taskToDelete.value = null
  } catch (error) {
    console.error('Failed to delete task:', error)
  }
}

// 分页变化
const handlePageChange = (page: number) => {
  currentPage.value = page
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
  if (file.type === 'directory') {
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
    return t('tasks.today') || '今天'
  } else if (days === 1) {
    return t('tasks.yesterday') || '昨天'
  } else if (days < 7) {
    return t('tasks.daysAgo', { count: days }) || `${days}天前`
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
  align-items: center;
  gap: 8px;
}

.status-filter {
  padding: 6px 10px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 12px;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #333);
  cursor: pointer;
}

.status-filter:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.btn-create {
  width: 28px;
  height: 28px;
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
  font-size: 18px;
  font-weight: bold;
}

.search-box {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 13px;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #333);
  box-sizing: border-box;
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

/* Task Item */
.task-item {
  padding: 10px 12px;
  margin-bottom: 6px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border-left: 3px solid transparent;
  background: var(--card-bg, #fff);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.task-item:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.task-item.selected {
  background: var(--active-bg, #e3f2fd);
}

/* 状态颜色 */
.task-item.task-active {
  border-left-color: #4caf50;
}

.task-item.task-active:hover {
  background: rgba(76, 175, 80, 0.08);
}

.task-item.task-archived {
  border-left-color: #9e9e9e;
  opacity: 0.7;
}

.task-item.task-archived:hover {
  opacity: 1;
  background: rgba(158, 158, 158, 0.08);
}

.task-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.task-status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
}

.task-status-indicator.active {
  background: #4caf50;
}

.task-status-indicator.archived {
  background: #9e9e9e;
}

.task-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.task-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-id {
  font-size: 11px;
  color: var(--text-hint, #999);
  font-family: monospace;
  flex-shrink: 0;
}

.task-description {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin: 4px 0 0 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  padding-left: 16px;
}

.task-date {
  font-size: 11px;
  color: var(--text-hint, #999);
}

.task-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.task-item:hover .task-actions {
  opacity: 1;
}

.btn-task {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-task .btn-icon {
  font-size: 12px;
}

.btn-task .btn-label {
  color: var(--text-secondary, #666);
}

.btn-task:hover {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--primary-color, #2196f3);
}

.btn-task:hover .btn-label {
  color: var(--primary-color, #2196f3);
}

.btn-archive:hover {
  background: rgba(158, 158, 158, 0.1);
  border-color: #9e9e9e;
}

.btn-archive:hover .btn-label {
  color: #9e9e9e;
}

.btn-restore:hover {
  background: rgba(76, 175, 80, 0.1);
  border-color: #4caf50;
}

.btn-restore:hover .btn-label {
  color: #4caf50;
}

.btn-delete:hover {
  background: rgba(244, 67, 54, 0.1);
  border-color: #f44336;
}

.btn-delete:hover .btn-label {
  color: #f44336;
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

.dialog-small {
  max-width: 320px;
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

.dialog-body p {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary, #666);
  line-height: 1.5;
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
  cursor: not allowed;
}

.btn-confirm.btn-danger {
  background: #f44336;
}

.btn-confirm.btn-danger:hover {
  background: #d32f2f;
}
</style>
