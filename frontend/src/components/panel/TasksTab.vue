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
        <div class="workspace-actions">
          <button class="btn-refresh" @click="handleRefreshFiles" :title="$t('tasks.refresh') || '刷新'" :disabled="taskStore.isLoadingFiles">
            <span class="icon">↻</span>
          </button>
          <button class="btn-upload" @click="triggerUpload" :title="$t('tasks.uploadFile')">
            <span class="icon">↑</span>
          </button>
        </div>
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
            <!-- 文件操作菜单 -->
            <div v-if="file.type === 'file'" class="file-menu" @click.stop>
              <button class="btn-menu-trigger" @click="toggleFileMenu(file)" :title="$t('tasks.moreActions') || '更多操作'">
                ⋯
              </button>
              <div v-if="activeMenuFile?.path === file.path" class="file-menu-dropdown">
                <button class="menu-item" @click="handleDownload(file)">
                  <span class="menu-icon">↓</span>
                  <span>{{ $t('tasks.download') || '下载' }}</span>
                </button>
                <button
                  v-if="canDeleteFile(file)"
                  class="menu-item menu-item-danger"
                  @click="confirmDeleteFile(file)"
                >
                  <span class="menu-icon">🗑</span>
                  <span>{{ $t('tasks.delete') || '删除' }}</span>
                </button>
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

    <!-- 文件预览对话框 -->
    <div v-if="showPreview" class="dialog-overlay preview-overlay" @click.self="closePreview">
      <div class="dialog preview-dialog">
        <div class="dialog-header">
          <h3>{{ previewFile?.name }}</h3>
          <div class="header-actions">
            <span v-if="isEditing" class="edit-indicator">{{ $t('tasks.editing') || '编辑中' }}</span>
            <button class="btn-close" @click="closePreview">×</button>
          </div>
        </div>
        <div class="dialog-body preview-body">
          <!-- 加载中 -->
          <div v-if="previewLoading" class="preview-loading">
            {{ $t('common.loading') || '加载中...' }}
          </div>
          <!-- 保存中 -->
          <div v-else-if="previewSaving" class="preview-loading">
            {{ $t('common.saving') || '保存中...' }}
          </div>
          <!-- 预览/编辑内容 -->
          <template v-else>
            <!-- 文本/代码编辑 -->
            <template v-if="previewType === 'text' || previewType === 'code'">
              <textarea
                v-if="isEditing"
                v-model="previewContent"
                class="preview-editor"
                :class="{ 'code-editor': previewType === 'code' }"
              ></textarea>
              <pre v-else class="preview-code" :class="{ 'code-preview': previewType === 'code' }">{{ previewContent }}</pre>
            </template>
            <!-- 图片预览 -->
            <div v-else-if="previewType === 'image'" class="preview-image">
              <img :src="previewUrl" :alt="previewFile?.name" />
            </div>
            <!-- PDF 预览 -->
            <iframe v-else-if="previewType === 'pdf'" :src="previewUrl" class="preview-pdf"></iframe>
            <!-- 不支持的类型 -->
            <div v-else class="preview-unsupported">
              <p>{{ $t('tasks.previewNotSupported') || '暂不支持此文件类型预览' }}</p>
              <button class="btn-confirm" @click="handleDownload(previewFile!)">
                {{ $t('tasks.download') || '下载文件' }}
              </button>
            </div>
          </template>
        </div>
        <div class="dialog-footer">
          <template v-if="previewType === 'text' || previewType === 'code'">
            <!-- 文本文件可编辑 -->
            <template v-if="canEditFile">
              <button v-if="!isEditing" class="btn-cancel" @click="startEdit">
                {{ $t('tasks.edit') || '编辑' }}
              </button>
              <template v-else>
                <button class="btn-cancel" @click="cancelEdit">
                  {{ $t('common.cancel') || '取消' }}
                </button>
                <button class="btn-confirm" @click="saveEdit" :disabled="previewSaving">
                  {{ $t('common.save') || '保存' }}
                </button>
              </template>
            </template>
            <button class="btn-confirm" @click="handleDownload(previewFile!)">
              {{ $t('tasks.download') || '下载' }}
            </button>
          </template>
          <template v-else>
            <button class="btn-confirm" @click="handleDownload(previewFile!)">
              {{ $t('tasks.download') || '下载文件' }}
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- 删除文件确认对话框 -->
    <div v-if="showDeleteFileConfirm" class="dialog-overlay" @click.self="showDeleteFileConfirm = false">
      <div class="dialog dialog-small">
        <div class="dialog-header">
          <h3>{{ $t('tasks.deleteConfirm') || '确认删除' }}</h3>
          <button class="btn-close" @click="showDeleteFileConfirm = false">×</button>
        </div>
        <div class="dialog-body">
          <p>{{ $t('tasks.deleteFileConfirmMessage', { name: fileToDelete?.name }) || `确定要删除文件"${fileToDelete?.name}"吗？此操作不可恢复。` }}</p>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="showDeleteFileConfirm = false">
            {{ $t('common.cancel') || '取消' }}
          </button>
          <button class="btn-confirm btn-danger" @click="handleDeleteFile">
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

// 文件预览相关
const showPreview = ref(false)
const previewFile = ref<TaskFile | null>(null)
const previewType = ref<'text' | 'code' | 'image' | 'pdf' | 'unsupported'>('text')
const previewContent = ref('')
const previewOriginalContent = ref('')  // 保存原始内容，用于取消编辑
const previewUrl = ref('')
const previewLoading = ref(false)
const previewSaving = ref(false)
const isEditing = ref(false)

// 文件菜单相关
const activeMenuFile = ref<TaskFile | null>(null)
const showDeleteFileConfirm = ref(false)
const fileToDelete = ref<TaskFile | null>(null)

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

// 刷新文件列表
const handleRefreshFiles = async () => {
  await taskStore.loadTaskFiles(currentPath.value || undefined)
}

const handleFileUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    // 只允许上传到 input 目录
    // 如果当前在 input 子目录下，上传到该子目录；否则上传到 input 根目录
    let uploadPath = 'input'
    if (currentPath.value.startsWith('input')) {
      uploadPath = currentPath.value
    }

    await taskStore.uploadFile(file, uploadPath)
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
  } else {
    // 打开预览
    await openPreview(file)
  }
}

// 判断文件预览类型
const getPreviewType = (filename: string): 'text' | 'code' | 'image' | 'pdf' | 'unsupported' => {
  const ext = filename.split('.').pop()?.toLowerCase() || ''

  const textExts = ['txt', 'md', 'csv', 'log']
  const codeExts = ['js', 'ts', 'vue', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'css', 'scss', 'html', 'json', 'xml', 'yaml', 'yml', 'sh', 'sql']
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']

  if (textExts.includes(ext)) return 'text'
  if (codeExts.includes(ext)) return 'code'
  if (imageExts.includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'

  return 'unsupported'
}

// 打开文件预览
const openPreview = async (file: TaskFile) => {
  previewFile.value = file
  previewType.value = getPreviewType(file.name)
  previewContent.value = ''
  previewUrl.value = ''
  previewLoading.value = true
  showPreview.value = true

  try {
    const url = taskStore.getFilePreviewUrl(file.path)
    const token = localStorage.getItem('access_token')

    if (previewType.value === 'text' || previewType.value === 'code') {
      // 获取文本内容
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!response.ok) throw new Error('Failed to load file')
      previewContent.value = await response.text()
    } else if (previewType.value === 'image' || previewType.value === 'pdf') {
      // 获取 blob 并创建对象 URL
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!response.ok) throw new Error('Failed to load file')
      const blob = await response.blob()
      previewUrl.value = URL.createObjectURL(blob)
    }
  } catch (error) {
    console.error('Failed to load preview:', error)
    previewType.value = 'unsupported'
  } finally {
    previewLoading.value = false
  }
}

// 关闭预览
const closePreview = () => {
  // 释放 blob URL
  if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(previewUrl.value)
  }
  showPreview.value = false
  previewFile.value = null
  previewContent.value = ''
  previewOriginalContent.value = ''
  previewUrl.value = ''
  isEditing.value = false
}

// 下载文件
const handleDownload = async (file: TaskFile) => {
  activeMenuFile.value = null  // 关闭菜单
  try {
    await taskStore.downloadFile(file.path)
  } catch (error) {
    console.error('Failed to download file:', error)
  }
}

// 判断文件是否可编辑（在 input 目录下的文本文件）
const canEditFile = computed(() => {
  if (!previewFile.value) return false
  const path = previewFile.value.path
  // 只允许编辑 input 目录下的文件
  return (path.startsWith('input/') || path === previewFile.value.name || currentPath.value.startsWith('input')) &&
         (previewType.value === 'text' || previewType.value === 'code')
})

// 判断文件是否可删除（在 input 目录下）
const canDeleteFile = (file: TaskFile) => {
  const path = file.path
  // 文件在 input 目录下，或者当前在 input 目录中浏览
  return path.startsWith('input/') || currentPath.value.startsWith('input') || !path.includes('/')
}

// 开始编辑
const startEdit = () => {
  previewOriginalContent.value = previewContent.value
  isEditing.value = true
}

// 取消编辑
const cancelEdit = () => {
  previewContent.value = previewOriginalContent.value
  isEditing.value = false
}

// 保存编辑
const saveEdit = async () => {
  if (!previewFile.value) return

  previewSaving.value = true
  try {
    await taskStore.saveFileContent(previewFile.value.path, previewContent.value)
    isEditing.value = false
    previewOriginalContent.value = previewContent.value
  } catch (error) {
    console.error('Failed to save file:', error)
  } finally {
    previewSaving.value = false
  }
}

// 切换文件菜单
const toggleFileMenu = (file: TaskFile) => {
  if (activeMenuFile.value?.path === file.path) {
    activeMenuFile.value = null
  } else {
    activeMenuFile.value = file
  }
}

// 确认删除文件
const confirmDeleteFile = (file: TaskFile) => {
  activeMenuFile.value = null
  fileToDelete.value = file
  showDeleteFileConfirm.value = true
}

// 执行删除文件
const handleDeleteFile = async () => {
  if (!fileToDelete.value) return

  try {
    await taskStore.deleteFile(fileToDelete.value.path)
    showDeleteFileConfirm.value = false
    fileToDelete.value = null
  } catch (error) {
    console.error('Failed to delete file:', error)
  }
}

// 点击外部关闭菜单
onMounted(() => {
  document.addEventListener('click', () => {
    activeMenuFile.value = null
  })
})

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

.workspace-actions {
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.edit-indicator {
  font-size: 12px;
  color: var(--primary-color, #2196f3);
  background: rgba(33, 150, 243, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
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

/* Download Button */
.btn-download {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary, #666);
  opacity: 0;
  transition: all 0.2s;
  flex-shrink: 0;
}

.file-item:hover .btn-download {
  opacity: 1;
}

.btn-download:hover {
  background: var(--primary-color, #2196f3);
  border-color: var(--primary-color, #2196f3);
  color: white;
}

/* File Menu */
.file-menu {
  position: relative;
  flex-shrink: 0;
}

.btn-menu-trigger {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  color: var(--text-secondary, #666);
  opacity: 0;
  transition: all 0.2s;
  letter-spacing: 2px;
}

.file-item:hover .btn-menu-trigger {
  opacity: 1;
}

.btn-menu-trigger:hover {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--border-color, #e0e0e0);
}

.file-menu-dropdown {
  position: absolute;
  right: 0;
  top: 100%;
  margin-top: 4px;
  background: var(--dialog-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  min-width: 120px;
  overflow: hidden;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary, #333);
  text-align: left;
  transition: background 0.2s;
}

.menu-item:hover {
  background: var(--hover-bg, #f5f5f5);
}

.menu-item-danger {
  color: #f44336;
}

.menu-item-danger:hover {
  background: rgba(244, 67, 54, 0.1);
}

.menu-icon {
  font-size: 14px;
}

/* Preview Dialog */
.preview-overlay {
  z-index: 1001;
}

.preview-dialog {
  max-width: 800px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
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

.preview-code {
  margin: 0;
  padding: 16px;
  background: var(--code-bg, #f5f5f5);
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-x: auto;
}

.preview-code.code-preview {
  white-space: pre;
}

.preview-editor {
  width: 100%;
  min-height: 300px;
  padding: 16px;
  background: var(--code-bg, #f5f5f5);
  border: 1px solid var(--primary-color, #2196f3);
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}

.preview-editor.code-editor {
  white-space: pre;
  overflow-x: auto;
}

.preview-editor:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
  box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.2);
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

.preview-pdf {
  width: 100%;
  height: 50vh;
  border: none;
  border-radius: 4px;
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
</style>
