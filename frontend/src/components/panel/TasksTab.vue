<template>
  <div class="tasks-tab">
    <!-- 任务模式：文件管理界面 -->
    <template v-if="taskStore.isInTaskMode && taskStore.currentTask">
      <!-- 嵌入式预览模式：替换整个文件管理界面 -->
      <template v-if="showEmbedPreview">
        <div class="embed-preview">
          <!-- 预览头部 -->
          <div class="embed-preview-header">
            <button class="btn-back" @click="closeEmbedPreview" :title="$t('tasks.backToFiles') || '返回文件列表'">
              <span class="icon">←</span>
            </button>
            <div class="preview-title-row">
              <span class="preview-icon">{{ getFileIcon(previewFile?.name || '') }}</span>
              <span class="preview-filename">{{ previewFile?.name }}</span>
            </div>
            <div class="preview-actions">
              <!-- HTML 源码/预览切换 -->
              <template v-if="previewType === 'html'">
                <button
                  class="btn-action"
                  :class="{ active: showHtmlSource }"
                  @click="toggleHtmlSourceMode"
                  :title="showHtmlSource ? $t('tasks.showPreview') : $t('tasks.showSource')"
                >
                  <span class="action-icon">{{ showHtmlSource ? '👁️' : '📝' }}</span>
                  <span class="action-label">{{ showHtmlSource ? ($t('tasks.preview') || '预览') : ($t('tasks.source') || '源码') }}</span>
                </button>
              </template>
              <!-- 自动刷新控制 -->
              <template v-if="previewType === 'html' || previewType === 'pdf'">
                <button
                  class="btn-action"
                  :class="{ active: autoRefreshEnabled }"
                  @click="toggleAutoRefresh"
                  :title="autoRefreshEnabled ? $t('tasks.stopAutoRefresh') : $t('tasks.startAutoRefresh')"
                >
                  <span class="action-icon">↻</span>
                  <span v-if="autoRefreshEnabled" class="action-label">{{ $t('tasks.refreshing') }}</span>
                  <span v-else class="action-label">{{ $t('tasks.auto') }}</span>
                </button>
                <button class="btn-action" @click="refreshPreview" :disabled="previewLoading" :title="$t('tasks.refreshNow')">
                  <span class="action-icon">⟳</span>
                  <span class="action-label">{{ $t('tasks.refreshLabel') }}</span>
                </button>
              </template>
              <button class="btn-action" @click="handleDownload(previewFile!)" :title="$t('tasks.downloadFile')">
                <span class="action-icon">↓</span>
                <span class="action-label">{{ $t('tasks.downloadLabel') }}</span>
              </button>
              <!-- 编辑/保存按钮（仅限可编辑文件） -->
              <template v-if="canEditFile && !previewLoading && !previewSaving">
                <button v-if="!isEditing" class="btn-action btn-edit-primary" @click="startEdit" :title="$t('tasks.edit') || '编辑'">
                  <span class="action-icon">✏️</span>
                  <span class="action-label">{{ $t('tasks.edit') || '编辑' }}</span>
                </button>
                <template v-else>
                  <button class="btn-action" @click="cancelEdit" :title="$t('common.cancel') || '取消'">
                    <span class="action-icon">✖️</span>
                    <span class="action-label">{{ $t('common.cancel') || '取消' }}</span>
                  </button>
                  <button class="btn-action btn-save-primary" @click="saveEdit" :title="$t('common.save') || '保存'">
                    <span class="action-icon">💾</span>
                    <span class="action-label">{{ $t('common.save') || '保存' }}</span>
                  </button>
                </template>
              </template>
            </div>
          </div>
          
          <!-- 预览内容区 -->
          <div class="embed-preview-body">
            <!-- 加载中 -->
            <div v-if="previewLoading" class="preview-loading">
              <span class="loading-spinner"></span>
              <span>{{ $t('common.loading') || '加载中...' }}</span>
            </div>
            
            <!-- 保存中 -->
            <div v-else-if="previewSaving" class="preview-loading">
              <span>{{ $t('common.saving') || '保存中...' }}</span>
            </div>
            
            <!-- 预览内容 -->
            <template v-else>
              <!-- HTML 预览（iframe 嵌入或源码查看） -->
              <template v-if="previewType === 'html'">
                <!-- 源码模式 -->
                <template v-if="showHtmlSource">
                  <textarea
                    v-if="isEditing"
                    v-model="previewContent"
                    class="embed-editor code-editor"
                  ></textarea>
                  <CodePreview
                    v-else
                    :code="previewContent"
                    language="html"
                    :show-line-numbers="true"
                    :show-copy-button="true"
                    theme="auto"
                  />
                </template>
                <!-- 预览模式 -->
                <iframe
                  v-else
                  :key="previewKey"
                  :src="previewUrl"
                  class="embed-iframe"
                  sandbox="allow-scripts allow-same-origin"
                  referrerpolicy="no-referrer"
                ></iframe>
              </template>
              
              <!-- PDF 预览（iframe 嵌入） -->
              <iframe
                v-else-if="previewType === 'pdf'"
                :key="previewKey"
                :src="previewUrl"
                class="embed-iframe"
              ></iframe>
              
              <!-- Markdown 预览 -->
              <template v-else-if="previewType === 'markdown'">
                <textarea
                  v-if="isEditing"
                  v-model="previewContent"
                  class="embed-editor markdown-editor"
                ></textarea>
                <div v-else class="embed-markdown" v-html="previewRenderedHtml"></div>
              </template>
              
              <!-- 文本/代码预览 -->
              <template v-else-if="previewType === 'text' || previewType === 'code'">
                <textarea
                  v-if="isEditing"
                  v-model="previewContent"
                  class="embed-editor"
                  :class="{ 'code-editor': previewType === 'code' }"
                ></textarea>
                <CodePreview
                  v-else
                  :code="previewContent"
                  :language="previewFileLanguage"
                  :show-line-numbers="true"
                  :show-copy-button="true"
                  theme="auto"
                />
              </template>
              
              <!-- 图片预览 -->
              <div v-else-if="previewType === 'image'" class="embed-image">
                <img :src="previewUrl" :alt="previewFile?.name" />
              </div>
              
              <!-- 不支持的类型 -->
              <div v-else class="preview-unsupported">
                <p>{{ $t('tasks.previewNotSupported') || '暂不支持此文件类型预览' }}</p>
                <button class="btn-confirm" @click="handleDownload(previewFile!)">
                  {{ $t('tasks.download') || '下载文件' }}
                </button>
              </div>
            </template>
          </div>
          
        </div>
      </template>
      
      <!-- 正常模式：文件管理界面 -->
      <template v-else>
        <div class="workspace-header">
          <div class="workspace-info">
            <button class="btn-back" @click="handleExitTask" :title="$t('tasks.backToList')">
              <span class="icon">←</span>
            </button>
            <div class="workspace-title">
              <span class="task-icon">📁</span>
              <span class="task-name">{{ taskStore.currentTask.title }}</span>
              <!-- 自动运行模式指示器 -->
              <span v-if="isAutonomousMode" class="autonomous-badge" :title="$t('tasks.autonomousModeHint') || 'AI 正在自主执行任务'">
                <span class="badge-icon">🤖</span>
                <span class="badge-text">{{ $t('tasks.autonomous') || '自动运行' }}</span>
              </span>
            </div>
          </div>
          <div class="workspace-actions">
            <!-- 自动运行切换按钮 -->
            <button
              class="btn-autonomous"
              :class="{ active: isAutonomousMode }"
              @click="toggleAutonomousMode"
              :title="isAutonomousMode ? ($t('tasks.disableAutonomous') || '关闭自动运行') : ($t('tasks.enableAutonomous') || '开启自动运行')"
              :disabled="isTogglingAutonomous"
            >
              <span class="icon">{{ isAutonomousMode ? '🤖' : '⚙️' }}</span>
            </button>
            <button class="btn-refresh" @click="handleRefreshFiles" :title="$t('tasks.refresh') || '刷新'" :disabled="taskStore.isLoadingFiles">
              <span class="icon">↻</span>
            </button>
            <button class="btn-upload" @click="triggerUpload" :title="$t('tasks.uploadFile')">
              <span class="icon">📤</span>
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
              'task-autonomous': task.status === 'autonomous' || task.status === 'autonomous_wait' || task.status === 'autonomous_working',
              'task-archived': task.status === 'archived',
              'selected': task.id === taskStore.currentTask?.id
            }"
            @click="handleSelectTask(task)"
          >
            <div class="task-header">
              <div class="task-status-indicator" :class="getTaskStatusClass(task.status)"></div>
              <div class="task-title-row">
                <span class="task-title">{{ task.title }}</span>
                <span v-if="isAutonomousStatus(task.status)" class="autonomous-indicator" :title="getAutonomousStatusHint(task.status)">🤖</span>
                <span class="task-id">{{ task.task_id }}</span>
              </div>
            </div>
            <div v-if="task.description" class="task-description">
              {{ truncate(task.description, 60) }}
            </div>
            <div class="task-footer">
              <span class="task-date">{{ formatDate(task.updated_at) }}</span>
              <div class="task-actions" @click.stop>
                <!-- 自动运行切换按钮（仅 active 或 autonomous 相关状态显示） -->
                <template v-if="task.status === 'active' || isAutonomousStatus(task.status)">
                  <button
                    class="btn-task"
                    :class="{ 'btn-autonomous-active': isAutonomousStatus(task.status) }"
                    @click="handleToggleAutonomousFromList(task, $event)"
                    :title="isAutonomousStatus(task.status) ? ($t('tasks.disableAutonomous') || '关闭自动运行') : ($t('tasks.enableAutonomous') || '开启自动运行')"
                  >
                    <span class="btn-icon">{{ isAutonomousStatus(task.status) ? '🤖' : '⚙️' }}</span>
                    <span class="btn-label">{{ isAutonomousStatus(task.status) ? ($t('tasks.autonomous') || '自动') : ($t('tasks.autoRun') || '自运') }}</span>
                  </button>
                </template>
                <button
                  v-if="task.status === 'active' || isAutonomousStatus(task.status)"
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
    <div v-if="showTaskDialog" class="dialog-overlay">
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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useTaskStore } from '@/stores/task'
import { useToastStore } from '@/stores/toast'
import Pagination from '@/components/Pagination.vue'
import CodePreview from '@/components/CodePreview.vue'
import type { Task, TaskFile, TaskStatus } from '@/types'
import { renderMermaidInHtml } from '@/utils/mermaid'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const taskStore = useTaskStore()
const toast = useToastStore()

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
const showEmbedPreview = ref(false)  // 嵌入式预览模式
const previewFile = ref<TaskFile | null>(null)
const previewType = ref<'text' | 'code' | 'markdown' | 'image' | 'pdf' | 'html' | 'unsupported'>('text')
const previewContent = ref('')
const previewOriginalContent = ref('')  // 保存原始内容，用于取消编辑
const previewRenderedHtml = ref('')  // 渲染后的 HTML（包含 Mermaid 图表）
const previewUrl = ref('')
const previewKey = ref(0)  // 用于强制刷新 iframe
const previewLoading = ref(false)
const previewSaving = ref(false)
const isEditing = ref(false)

// 自动刷新相关
const autoRefreshEnabled = ref(false)
const autoRefreshInterval = ref<number | null>(null)
const AUTO_REFRESH_DELAY = 5000  // 5秒

// HTML 源码查看模式
const showHtmlSource = ref(false)

// 文件菜单相关
const activeMenuFile = ref<TaskFile | null>(null)
const showDeleteFileConfirm = ref(false)
const fileToDelete = ref<TaskFile | null>(null)

// 自动运行模式相关
const isTogglingAutonomous = ref(false)

// 计算属性：是否为自动运行模式（包括等待和执行中状态）
const isAutonomousMode = computed(() => {
  const status = taskStore.currentTask?.status
  return status === 'autonomous_wait' || status === 'autonomous_working'
})

// 计算属性：是否正在执行中（用于 UI 指示器）
const isAutonomousWorking = computed(() => {
  return taskStore.currentTask?.status === 'autonomous_working'
})

// 辅助函数：判断是否为自动运行相关状态
const isAutonomousStatus = (status: string): boolean => {
  return status === 'autonomous_wait' || status === 'autonomous_working'
}

// 辅助函数：获取任务状态指示器的 CSS 类名
const getTaskStatusClass = (status: string): string => {
  if (status === 'autonomous_wait' || status === 'autonomous_working') {
    return 'autonomous'
  }
  return status
}

// 辅助函数：获取自动运行状态的提示文本
const getAutonomousStatusHint = (status: string): string => {
  if (status === 'autonomous_working') {
    return t('tasks.autonomousWorkingHint') || 'AI 正在执行任务...'
  }
  return t('tasks.autonomousModeHint') || 'AI 正在自主执行任务'
}

// 切换自动运行模式
const toggleAutonomousMode = async () => {
  if (!taskStore.currentTask || isTogglingAutonomous.value) return

  isTogglingAutonomous.value = true
  try {
    const newStatus: TaskStatus = isAutonomousMode.value ? 'active' : 'autonomous_wait'
    const updateData: { status: TaskStatus; expert_id?: string } = { status: newStatus }
    
    // 开启自主模式时，设置当前专家ID
    if (newStatus === 'autonomous_wait') {
      const expertId = route.params.expertId as string
      if (expertId) {
        updateData.expert_id = expertId
      } else {
        // 没有专家ID，无法开启自主模式
        toast.warning(t('tasks.noExpertForAutonomous') || '请先选择一个专家再开启自动运行模式')
        return
      }
    }
    
    await taskStore.updateTask(taskStore.currentTask.id, updateData)
  } catch (error) {
    console.error('Failed to toggle autonomous mode:', error)
    toast.error(t('tasks.toggleAutonomousFailed') || '切换自动运行模式失败')
  } finally {
    isTogglingAutonomous.value = false
  }
}

// 从任务列表切换自动运行模式
const handleToggleAutonomousFromList = async (task: Task, event: Event) => {
  event.stopPropagation()  // 阻止事件冒泡，避免触发任务选择
  
  if (isTogglingAutonomous.value) return
  
  const newStatus: TaskStatus = isAutonomousStatus(task.status) ? 'active' : 'autonomous_wait'
  
  // 开启自主模式需要专家ID
  if (newStatus === 'autonomous_wait') {
    const expertId = route.params.expertId as string
    if (!expertId) {
      toast.warning(t('tasks.noExpertForAutonomous') || '请先选择一个专家再开启自动运行模式')
      return
    }
    
    // 确认对话框
    const confirmed = confirm(t('tasks.autonomousConfirm') || '开启自动运行后，AI 将自主执行任务，用户输入将被禁用。确定要开启吗？')
    if (!confirmed) return
    
    isTogglingAutonomous.value = true
    try {
      await taskStore.updateTask(task.id, {
        status: newStatus,
        expert_id: expertId
      })
    } catch (error) {
      console.error('Failed to enable autonomous mode:', error)
      toast.error(t('tasks.toggleAutonomousFailed') || '切换自动运行模式失败')
    } finally {
      isTogglingAutonomous.value = false
    }
  } else {
    // 关闭自主模式
    isTogglingAutonomous.value = true
    try {
      await taskStore.updateTask(task.id, { status: newStatus })
    } catch (error) {
      console.error('Failed to disable autonomous mode:', error)
      toast.error(t('tasks.toggleAutonomousFailed') || '切换自动运行模式失败')
    } finally {
      isTogglingAutonomous.value = false
    }
  }
}

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
}, { immediate: true })

// 监听过滤器变化，重置页码
watch([searchQuery, statusFilter], () => {
  currentPage.value = 1
})

const handleSelectTask = (task: Task) => {
  // 更新路由，让 ChatView 监听路由变化来加载任务
  const expertId = route.params.expertId
  if (expertId) {
    router.push({
      name: 'chat-with-task',
      params: { expertId, taskId: task.id }
    })
  }
}

const handleExitTask = () => {
  // 清除路由中的 taskId
  const expertId = route.params.expertId
  if (expertId) {
    router.push({
      name: 'chat',
      params: { expertId }
    })
  }
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
      // 自动进入新创建的任务，更新路由
      const expertId = route.params.expertId
      if (expertId) {
        router.push({
          name: 'chat-with-task',
          params: { expertId, taskId: task.id }
        })
      }
    }
    closeTaskDialog()
  } catch (error) {
    console.error('Failed to save task:', error)
    toast.error(t('tasks.saveTaskFailed') || '保存任务失败')
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
    toast.error(t('tasks.archiveTaskFailed') || '归档任务失败')
  }
}

// 恢复任务
const handleRestoreTask = async (task: Task) => {
  try {
    await taskStore.updateTask(task.id, { status: 'active' })
  } catch (error) {
    console.error('Failed to restore task:', error)
    toast.error(t('tasks.restoreTaskFailed') || '恢复任务失败')
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
    toast.error(t('tasks.deleteTaskFailed') || '删除任务失败')
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
    toast.error(t('tasks.uploadFileFailed') || '上传文件失败')
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
const getPreviewType = (filename: string): 'text' | 'code' | 'markdown' | 'image' | 'pdf' | 'html' | 'unsupported' => {
  const ext = filename.split('.').pop()?.toLowerCase() || ''

  const textExts = ['txt', 'csv', 'log']
  const codeExts = ['js', 'ts', 'vue', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'sh', 'sql']
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']

  if (ext === 'md') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (textExts.includes(ext)) return 'text'
  if (codeExts.includes(ext)) return 'code'
  if (imageExts.includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'

  return 'unsupported'
}

// 打开文件预览（嵌入式）
const openPreview = async (file: TaskFile) => {
  previewFile.value = file
  previewType.value = getPreviewType(file.name)
  previewContent.value = ''
  previewUrl.value = ''
  previewLoading.value = true
  showEmbedPreview.value = true  // 使用嵌入式预览
  showHtmlSource.value = false   // 重置 HTML 源码模式

  try {
    // 对于 HTML 文件，同时获取预览 URL 和源码内容
    if (previewType.value === 'html') {
      const url = await taskStore.getEmbedPreviewUrl(file.path)
      previewUrl.value = url
      // 同时加载源码内容，用于切换到源码模式
      const response = await fetch(url)
      if (response.ok) {
        previewContent.value = await response.text()
        previewOriginalContent.value = previewContent.value
      }
      previewLoading.value = false
      return
    }

    // 对于 PDF 文件，使用嵌入式预览（Token 在路径中）
    if (previewType.value === 'pdf') {
      previewUrl.value = await taskStore.getEmbedPreviewUrl(file.path)
      previewLoading.value = false
      return
    }

    // 对于图片，也使用嵌入式预览 URL
    if (previewType.value === 'image') {
      previewUrl.value = await taskStore.getEmbedPreviewUrl(file.path)
      previewLoading.value = false
      return
    }

    // 文本/代码/Markdown 文件也使用静态文件服务
    // Token 在 URL 中，可以直接 fetch
    if (previewType.value === 'text' || previewType.value === 'code' || previewType.value === 'markdown') {
      const contentUrl = await taskStore.getEmbedPreviewUrl(file.path)
      const response = await fetch(contentUrl)
      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.status}`)
      }
      previewContent.value = await response.text()
      
      // 对于 Markdown 文件，异步渲染 Mermaid 图表
      if (previewType.value === 'markdown') {
        await renderMarkdownWithMermaid(previewContent.value)
      }
    }
  } catch (error) {
    console.error('Failed to load preview:', error)
    previewType.value = 'unsupported'
  } finally {
    previewLoading.value = false
  }
}

// 切换 HTML 源码/预览模式
const toggleHtmlSourceMode = async () => {
  showHtmlSource.value = !showHtmlSource.value

  // 切换到源码模式时，如果还没有加载源码，则加载
  if (showHtmlSource.value && !previewContent.value && previewFile.value) {
    previewLoading.value = true
    try {
      const contentUrl = await taskStore.getEmbedPreviewUrl(previewFile.value.path)
      const response = await fetch(contentUrl)
      if (response.ok) {
        previewContent.value = await response.text()
        previewOriginalContent.value = previewContent.value
      }
    } catch (error) {
      console.error('Failed to load HTML source:', error)
    } finally {
      previewLoading.value = false
    }
  }
}

// 关闭嵌入式预览
const closeEmbedPreview = () => {
  // 停止自动刷新
  stopAutoRefresh()

  showEmbedPreview.value = false
  previewFile.value = null
  previewContent.value = ''
  previewOriginalContent.value = ''
  previewRenderedHtml.value = ''  // 清理渲染后的 HTML
  previewUrl.value = ''
  previewKey.value = 0  // 重置 key
  isEditing.value = false
  previewLoading.value = false
  previewSaving.value = false
  showHtmlSource.value = false  // 重置 HTML 源码模式
}

// 启动自动刷新
const startAutoRefresh = () => {
  if (autoRefreshInterval.value) return  // 已经在刷新中

  autoRefreshEnabled.value = true
  autoRefreshInterval.value = window.setInterval(async () => {
    if (!previewFile.value) return

    try {
      // 刷新 Token 并重新加载
      previewUrl.value = await taskStore.getEmbedPreviewUrl(previewFile.value.path)
      // 增加 key 强制 iframe 重新加载
      previewKey.value++
    } catch (error) {
      console.error('Auto refresh failed:', error)
    }
  }, AUTO_REFRESH_DELAY)
}

// 停止自动刷新
const stopAutoRefresh = () => {
  if (autoRefreshInterval.value) {
    clearInterval(autoRefreshInterval.value)
    autoRefreshInterval.value = null
  }
  autoRefreshEnabled.value = false
}

// 切换自动刷新
const toggleAutoRefresh = () => {
  if (autoRefreshEnabled.value) {
    stopAutoRefresh()
  } else {
    startAutoRefresh()
  }
}

// 手动刷新预览
const refreshPreview = async () => {
  if (!previewFile.value) return

  previewLoading.value = true
  try {
    // 刷新 Token
    await taskStore.refreshPreviewToken()
    previewUrl.value = await taskStore.getEmbedPreviewUrl(previewFile.value.path)
    // 增加 key 强制 iframe 重新加载
    previewKey.value++
  } catch (error) {
    console.error('Refresh failed:', error)
  } finally {
    previewLoading.value = false
  }
}

// 下载文件
const handleDownload = async (file: TaskFile) => {
  activeMenuFile.value = null  // 关闭菜单
  try {
    await taskStore.downloadFile(file.path)
  } catch (error) {
    console.error('Failed to download file:', error)
    toast.error(t('tasks.downloadFileFailed') || '下载文件失败')
  }
}

// 获取预览文件的语言类型（用于代码高亮）
const previewFileLanguage = computed(() => {
  if (!previewFile.value) return 'plaintext'
  const filename = previewFile.value.name
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return ext
})

// 判断文件是否可编辑（在 input 目录下的文本文件，或 HTML 源码模式）
const canEditFile = computed(() => {
  if (!previewFile.value) return false
  const path = previewFile.value.path
  const isInInputDir = path.startsWith('input/') || path === previewFile.value.name || currentPath.value.startsWith('input')

  // 文本、代码、Markdown 文件在 input 目录下可编辑
  if (previewType.value === 'text' || previewType.value === 'code' || previewType.value === 'markdown') {
    return isInInputDir
  }

  // HTML 文件在源码模式下，如果在 input 目录下也可编辑
  if (previewType.value === 'html' && showHtmlSource.value) {
    return isInInputDir
  }

  return false
})

// 配置 marked 选项
marked.setOptions({
  breaks: true, // 支持 GitHub 风格的换行
  gfm: true, // 启用 GitHub Flavored Markdown
})

// 渲染 Markdown 内容（基础渲染，不含 Mermaid）
const renderMarkdown = (content: string): string => {
  if (!content) return ''
  try {
    const rawHtml = marked.parse(content) as string
    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'u', 's', 'del', 'ins',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote', 'pre', 'code',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'hr', 'div', 'span'
      ],
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'class',
        'target', 'rel',
        'width', 'height'
      ],
      ALLOW_DATA_ATTR: true,
    })
  } catch (error) {
    console.error('Markdown parsing error:', error)
    return content
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/\n/g, '<br>')
  }
}

// 检测内容是否包含 Mermaid 代码块
const containsMermaid = (content: string): boolean => {
  return /```mermaid\s*[\s\S]*?```/i.test(content)
}

// 渲染 Markdown 内容（含 Mermaid 图表异步渲染）
const renderMarkdownWithMermaid = async (content: string): Promise<void> => {
  if (!content) {
    previewRenderedHtml.value = ''
    return
  }
  
  try {
    // 先进行基础 Markdown 渲染
    let rawHtml = marked.parse(content) as string
    
    // 使用 DOMPurify 进行 XSS 清理（允许更多标签用于 Mermaid）
    let cleanHtml = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'u', 's', 'del', 'ins',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote', 'pre', 'code',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'hr', 'div', 'span',
        'svg', 'path', 'g', 'rect', 'circle', 'text', 'tspan', 'polygon', 'line', 'polyline', 'ellipse', 'foreignObject', 'tbody'
      ],
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'class',
        'target', 'rel',
        'width', 'height',
        'd', 'transform', 'fill', 'stroke', 'stroke-width', 'viewBox',
        'x', 'y', 'x1', 'y1', 'x2', 'y2',
        'cx', 'cy', 'r', 'rx', 'ry',
        'points', 'id', 'style', 'text-anchor', 'font-size', 'font-family', 'font-weight',
        'xmlns', 'version'
      ],
      ALLOW_DATA_ATTR: true,
    })
    
    // 如果包含 Mermaid 代码块，进行异步渲染
    if (containsMermaid(content)) {
      cleanHtml = await renderMermaidInHtml(cleanHtml)
    }
    
    previewRenderedHtml.value = cleanHtml
  } catch (error) {
    console.error('Markdown rendering error:', error)
    previewRenderedHtml.value = content
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/\n/g, '<br>')
  }
}

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
    toast.error(t('tasks.saveFileFailed') || '保存文件失败')
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
    toast.error(t('tasks.deleteFileFailed') || '删除文件失败')
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

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-'

  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return '-'  // 处理 Invalid Date

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

// 组件卸载时清理定时器
onUnmounted(() => {
  stopAutoRefresh()
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

/* 自动运行按钮样式 */
.btn-autonomous {
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

.btn-autonomous:hover:not(:disabled) {
  background: var(--hover-bg, #e8e8e8);
  border-color: #9c27b0;
  color: #9c27b0;
}

.btn-autonomous:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-autonomous.active {
  background: rgba(156, 39, 176, 0.15);
  border-color: #9c27b0;
  color: #9c27b0;
}

.btn-autonomous.active:hover:not(:disabled) {
  background: rgba(156, 39, 176, 0.25);
}

.btn-autonomous .icon {
  font-size: 16px;
}

/* 自动运行模式徽章样式 */
.autonomous-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: rgba(156, 39, 176, 0.15);
  border: 1px solid rgba(156, 39, 176, 0.3);
  border-radius: 12px;
  font-size: 11px;
  color: #9c27b0;
  white-space: nowrap;
  animation: pulse 2s ease-in-out infinite;
}

.autonomous-badge .badge-icon {
  font-size: 12px;
}

.autonomous-badge .badge-text {
  font-weight: 500;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
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

/* 自动运行状态样式 */
.task-item.task-autonomous {
  border-left-color: #9c27b0;
  background: rgba(156, 39, 176, 0.05);
}

.task-item.task-autonomous:hover {
  background: rgba(156, 39, 176, 0.1);
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

.task-status-indicator.autonomous {
  background: #9c27b0;
  animation: pulse-indicator 1.5s ease-in-out infinite;
}

.task-status-indicator.archived {
  background: #9e9e9e;
}

@keyframes pulse-indicator {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.2);
    opacity: 0.7;
  }
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

/* 自动运行按钮在任务卡片上的样式 */
.btn-task.btn-autonomous-active {
  background: rgba(156, 39, 176, 0.15);
  border-color: #9c27b0;
}

.btn-task.btn-autonomous-active .btn-icon,
.btn-task.btn-autonomous-active .btn-label {
  color: #9c27b0;
}

.btn-task.btn-autonomous-active:hover {
  background: rgba(156, 39, 176, 0.25);
}

/* 自动运行指示器图标 */
.autonomous-indicator {
  font-size: 12px;
  margin-left: 4px;
  animation: pulse-indicator 1.5s ease-in-out infinite;
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

.preview-html {
  width: 100%;
  height: 60vh;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  background: #fff;
}

/* Auto Refresh Controls */
.auto-refresh-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: auto;
}

.btn-auto-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-auto-refresh:hover {
  background: var(--hover-bg, #e8e8e8);
}

.btn-auto-refresh.active {
  background: rgba(33, 150, 243, 0.1);
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.btn-auto-refresh .refresh-icon {
  font-size: 14px;
  transition: transform 0.3s;
}

.btn-auto-refresh.active .refresh-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.btn-auto-refresh .refresh-label {
  font-size: 12px;
}

.btn-manual-refresh {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-manual-refresh:hover:not(:disabled) {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.btn-manual-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

/* Markdown Preview Styles */
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
.preview-markdown :deep(h2) { font-size: 1.35em; border-bottom: 1px solid var(--border-color, #e0e0e0); padding-bottom: 6px; }
.preview-markdown :deep(h3) { font-size: 1.2em; }
.preview-markdown :deep(h4) { font-size: 1.1em; }
.preview-markdown :deep(h5) { font-size: 1em; }
.preview-markdown :deep(h6) { font-size: 0.95em; color: var(--text-secondary, #666); }

.preview-markdown :deep(p) {
  margin: 8px 0;
}

.preview-markdown :deep(p:first-child) {
  margin-top: 0;
}

.preview-markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.preview-markdown :deep(ul),
.preview-markdown :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.preview-markdown :deep(li) {
  margin: 4px 0;
}

.preview-markdown :deep(ul) {
  list-style-type: disc;
}

.preview-markdown :deep(ol) {
  list-style-type: decimal;
}

.preview-markdown :deep(blockquote) {
  margin: 8px 0;
  padding: 8px 16px;
  border-left: 4px solid var(--primary-color, #2196f3);
  background: var(--blockquote-bg, #f8f9fa);
  color: var(--text-secondary, #666);
  border-radius: 0 4px 4px 0;
}

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

.preview-markdown :deep(table) {
  border-collapse: collapse;
  margin: 12px 0;
  width: 100%;
  font-size: 13px;
}

.preview-markdown :deep(th),
.preview-markdown :deep(td) {
  border: 1px solid var(--border-color, #e0e0e0);
  padding: 8px 12px;
  text-align: left;
}

.preview-markdown :deep(th) {
  background: var(--table-header-bg, #f5f5f5);
  font-weight: 600;
}

.preview-markdown :deep(tr:nth-child(even)) {
  background: var(--table-row-alt-bg, #fafafa);
}

.preview-markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color, #e0e0e0);
  margin: 16px 0;
}

.preview-markdown :deep(a) {
  color: var(--primary-color, #2196f3);
  text-decoration: none;
}

.preview-markdown :deep(a:hover) {
  text-decoration: underline;
}

.preview-markdown :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 8px 0;
}

.preview-markdown :deep(del),
.preview-markdown :deep(s) {
  color: var(--text-secondary, #666);
  text-decoration: line-through;
}

.preview-markdown :deep(strong) {
  font-weight: 600;
}

.preview-markdown :deep(em) {
  font-style: italic;
}

.markdown-editor {
  min-height: 400px;
}

/* ===== 嵌入式预览样式 ===== */
.embed-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--sidebar-bg, #f5f5f5);
}

.embed-preview-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--primary-bg, #e3f2fd);
}

.preview-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.preview-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.preview-filename {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-action {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-action:hover:not(:disabled) {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.btn-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-action.active {
  background: rgba(33, 150, 243, 0.1);
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.btn-action.active .action-icon {
  animation: spin 1s linear infinite;
}

/* 编辑按钮高亮样式 */
.btn-action.btn-edit-primary {
  background: rgba(33, 150, 243, 0.1);
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.btn-action.btn-edit-primary:hover:not(:disabled) {
  background: var(--primary-color, #2196f3);
  color: white;
}

/* 保存按钮高亮样式 */
.btn-action.btn-save-primary {
  background: rgba(76, 175, 80, 0.1);
  border-color: #4caf50;
  color: #4caf50;
}

.btn-action.btn-save-primary:hover:not(:disabled) {
  background: #4caf50;
  color: white;
}

.action-icon {
  font-size: 14px;
}

.action-label {
  font-size: 11px;
}

.embed-preview-body {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.embed-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.embed-image {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 16px;
  background: var(--code-bg, #f5f5f5);
}

.embed-image img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.embed-code {
  margin: 0;
  padding: 16px;
  height: 100%;
  background: var(--code-bg, #f5f5f5);
  border-radius: 0;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
  box-sizing: border-box;
}

.embed-code.code-preview {
  white-space: pre;
}

.embed-editor {
  width: 100%;
  height: 100%;
  padding: 16px;
  background: var(--code-bg, #f5f5f5);
  border: none;
  border-radius: 0;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  box-sizing: border-box;
}

.embed-editor:focus {
  outline: none;
  background: var(--input-bg, #fff);
}

.embed-markdown {
  padding: 16px;
  height: 100%;
  overflow: auto;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #333);
  background: var(--dialog-bg, #fff);
}

/* 继承 Markdown 样式 */
.embed-markdown :deep(h1),
.embed-markdown :deep(h2),
.embed-markdown :deep(h3),
.embed-markdown :deep(h4),
.embed-markdown :deep(h5),
.embed-markdown :deep(h6) {
  margin: 16px 0 8px 0;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary, #333);
}

.embed-markdown :deep(h1) { font-size: 1.5em; border-bottom: 1px solid var(--border-color, #e0e0e0); padding-bottom: 8px; }
.embed-markdown :deep(h2) { font-size: 1.35em; border-bottom: 1px solid var(--border-color, #e0e0e0); padding-bottom: 6px; }
.embed-markdown :deep(h3) { font-size: 1.2em; }
.embed-markdown :deep(h4) { font-size: 1.1em; }
.embed-markdown :deep(h5) { font-size: 1em; }
.embed-markdown :deep(h6) { font-size: 0.95em; color: var(--text-secondary, #666); }

.embed-markdown :deep(p) { margin: 8px 0; }
.embed-markdown :deep(p:first-child) { margin-top: 0; }
.embed-markdown :deep(p:last-child) { margin-bottom: 0; }

.embed-markdown :deep(ul),
.embed-markdown :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.embed-markdown :deep(li) { margin: 4px 0; }
.embed-markdown :deep(ul) { list-style-type: disc; }
.embed-markdown :deep(ol) { list-style-type: decimal; }

.embed-markdown :deep(blockquote) {
  margin: 8px 0;
  padding: 8px 16px;
  border-left: 4px solid var(--primary-color, #2196f3);
  background: var(--blockquote-bg, #f8f9fa);
  color: var(--text-secondary, #666);
  border-radius: 0 4px 4px 0;
}

.embed-markdown :deep(pre) {
  background: var(--code-bg, #1e1e1e);
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}

.embed-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
  color: #d4d4d4;
  font-size: 13px;
  line-height: 1.5;
}

.embed-markdown :deep(code) {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
}

.embed-markdown :deep(code:not(pre code)) {
  background: var(--code-bg, #f0f0f0);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--code-color, #d63384);
}

.embed-markdown :deep(table) {
  border-collapse: collapse;
  margin: 12px 0;
  width: 100%;
  font-size: 13px;
}

.embed-markdown :deep(th),
.embed-markdown :deep(td) {
  border: 1px solid var(--border-color, #e0e0e0);
  padding: 8px 12px;
  text-align: left;
}

.embed-markdown :deep(th) {
  background: var(--table-header-bg, #f5f5f5);
  font-weight: 600;
}

.embed-markdown :deep(tr:nth-child(even)) {
  background: var(--table-row-alt-bg, #fafafa);
}

.embed-markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color, #e0e0e0);
  margin: 16px 0;
}

.embed-markdown :deep(a) {
  color: var(--primary-color, #2196f3);
  text-decoration: none;
}

.embed-markdown :deep(a:hover) {
  text-decoration: underline;
}

.embed-markdown :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 8px 0;
}

.embed-preview-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  background: var(--sidebar-bg, #f5f5f5);
}

.btn-edit,
.btn-cancel-edit,
.btn-save {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-edit {
  background: transparent;
  border: 1px solid var(--border-color, #ccc);
  color: var(--text-secondary, #666);
}

.btn-edit:hover {
  background: var(--hover-bg, #e8e8e8);
}

.btn-cancel-edit {
  background: transparent;
  border: 1px solid var(--border-color, #ccc);
  color: var(--text-secondary, #666);
}

.btn-cancel-edit:hover {
  background: var(--hover-bg, #e8e8e8);
}

.btn-save {
  background: var(--primary-color, #2196f3);
  border: none;
  color: white;
}

.btn-save:hover {
  background: var(--primary-hover, #1976d2);
}

/* 加载动画 */
.loading-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-color, #e0e0e0);
  border-top-color: var(--primary-color, #2196f3);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-right: 8px;
}

/* Mermaid 图表样式 */
.embed-markdown :deep(.mermaid-container) {
  margin: 16px 0;
  padding: 16px;
  background: var(--code-bg, #f8f9fa);
  border-radius: 8px;
  overflow-x: auto;
  text-align: center;
}

.embed-markdown :deep(.mermaid-container svg) {
  max-width: 100%;
  height: auto;
}

.embed-markdown :deep(.mermaid-error) {
  color: #f44336;
  font-size: 13px;
  padding: 8px 12px;
  background: rgba(244, 67, 54, 0.1);
  border-radius: 4px;
  margin: 8px 0;
}
</style>
