import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { taskApi } from '@/api/services'
import type { Task, CreateTaskRequest, TaskFile } from '@/types'

/**
 * 预览 Token 缓存接口
 */
interface PreviewTokenCache {
  token: string
  expiresAt: number  // 时间戳（毫秒）
  taskId: string
}

/**
 * Task Store
 *
 * 任务工作空间状态管理
 * - 管理用户的任务列表
 * - 跟踪当前进入的任务工作空间
 * - 在发送消息时附加任务上下文（task_id, task_path）
 * - 管理嵌入式文件预览的 Token
 *
 * 设计说明：
 * - 进入/退出任务只更新本地状态，不调用 API
 * - 任务上下文在 ChatView 发送消息时附加到消息参数中
 * - 支持多标签页/多窗口场景
 * - 预览 Token 有效期 15 分钟，剩余 >1 分钟时复用
 */
export const useTaskStore = defineStore('task', () => {
  // State
  const tasks = ref<Task[]>([])
  const currentTask = ref<Task | null>(null)
  const isInTaskMode = ref(false)
  const currentBrowsePath = ref<string>('')  // 当前浏览的目录路径
  const isLoading = ref(false)
  const isLoadingFiles = ref(false)
  const currentFiles = ref<TaskFile[]>([])
  const error = ref<string | null>(null)

  // 预览 Token 缓存（用于嵌入式文件预览）
  const previewTokenCache = ref<PreviewTokenCache | null>(null)

  // Getters
  const activeTasks = computed(() =>
    tasks.value.filter(t => t.status === 'active')
  )

  const currentTaskId = computed(() =>
    currentTask.value?.id || null
  )

  // 当前浏览路径（用于传递给 LLM）
  const currentPath = computed(() => currentBrowsePath.value)

  // Actions

  /**
   * 加载任务列表
   */
  const loadTasks = async (params?: { status?: string; page?: number; limit?: number }) => {
    isLoading.value = true
    error.value = null
    try {
      const response = await taskApi.getTasks(params)
      tasks.value = response.items || []
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load tasks'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 创建任务
   */
  const createTask = async (data: CreateTaskRequest) => {
    isLoading.value = true
    error.value = null
    try {
      const task = await taskApi.createTask(data)
      tasks.value.unshift(task)
      return task
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create task'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 更新任务
   */
  const updateTask = async (id: string, data: Partial<Task>) => {
    error.value = null
    try {
      const updated = await taskApi.updateTask(id, data)
      const index = tasks.value.findIndex(t => t.id === id)
      if (index !== -1) {
        tasks.value[index] = updated
      }
      if (currentTask.value?.id === id) {
        currentTask.value = updated
      }
      return updated
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update task'
      throw err
    }
  }

  /**
   * 删除任务（归档）
   */
  const deleteTask = async (id: string) => {
    error.value = null
    try {
      await taskApi.deleteTask(id)
      tasks.value = tasks.value.filter(t => t.id !== id)
      if (currentTask.value?.id === id) {
        exitTask()
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete task'
      throw err
    }
  }

  /**
   * 进入任务工作空间
   * 只更新本地状态，不调用 API
   * 任务上下文在发送消息时附加到消息参数中
   */
  const enterTask = (task: Task) => {
    if (!task || !task.id) {
      console.warn('enterTask called with invalid task')
      return
    }
    currentTask.value = task
    isInTaskMode.value = true
    currentBrowsePath.value = ''
    currentFiles.value = []
  }

  /**
   * 通过任务 ID 加载并进入任务工作空间
   * 用于从路由参数恢复任务状态
   * @param taskId 任务 ID
   * @returns Promise<boolean> 是否成功进入任务
   */
  const loadAndEnterTask = async (taskId: string): Promise<boolean> => {
    if (!taskId) {
      console.warn('loadAndEnterTask called with empty taskId')
      return false
    }

    // 如果已经在该任务中，无需重复加载
    if (currentTask.value?.id === taskId) {
      return true
    }

    isLoading.value = true
    error.value = null
    try {
      // 从 API 加载任务详情
      const task = await taskApi.getTask(taskId)
      if (task) {
        enterTask(task)
        return true
      }
      return false
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load task'
      console.error('loadAndEnterTask error:', err)
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 退出任务工作空间
   * 只清除本地状态，不调用 API
   */
  const exitTask = () => {
    if (!isInTaskMode.value) return

    currentTask.value = null
    isInTaskMode.value = false
    currentFiles.value = []
    currentBrowsePath.value = ''
    previewTokenCache.value = null  // 清除预览 Token 缓存
  }

  /**
   * 加载任务文件列表
   */
  const loadTaskFiles = async (subdir?: string) => {
    if (!currentTask.value) return

    // 更新当前浏览路径
    currentBrowsePath.value = subdir || ''

    isLoadingFiles.value = true
    try {
      const response = await taskApi.getTaskFiles(currentTask.value.id, subdir)
      currentFiles.value = response.files || []
      return response.files
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load files'
      throw err
    } finally {
      isLoadingFiles.value = false
    }
  }

  /**
   * 上传文件到任务工作空间
   */
  const uploadFile = async (file: File, subdir?: string) => {
    if (!currentTask.value) throw new Error('Not in task mode')

    error.value = null
    try {
      const result = await taskApi.uploadFile(currentTask.value.id, file, subdir)
      // 刷新文件列表
      await loadTaskFiles(subdir)
      return result
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to upload file'
      throw err
    }
  }

  /**
   * 下载文件（使用静态 URL）
   */
  const downloadFile = async (filePath: string) => {
    if (!currentTask.value) throw new Error('Not in task mode')

    try {
      // 使用静态文件服务 URL（Token 在路径中）
      const url = await getEmbedPreviewUrl(filePath)
      const link = document.createElement('a')
      link.href = url
      link.download = filePath.split('/').pop() || 'download'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to download file'
      throw err
    }
  }

  /**
   * 获取预览 Token（用于嵌入式文件预览）
   * - 复用有效 Token（剩余时间 > 1 分钟）
   * - 自动获取新 Token（过期或无缓存时）
   */
  const getPreviewToken = async (): Promise<string> => {
    if (!currentTask.value) throw new Error('Not in task mode')

    const now = Date.now()
    const ONE_MINUTE = 60 * 1000

    // 检查缓存是否有效（同一任务 + 剩余时间 > 1 分钟）
    if (
      previewTokenCache.value &&
      previewTokenCache.value.taskId === currentTask.value.id &&
      previewTokenCache.value.expiresAt > now + ONE_MINUTE
    ) {
      return previewTokenCache.value.token
    }

    // 获取新 Token
    try {
      const response = await taskApi.getPreviewToken(currentTask.value.id)
      const expiresAt = new Date(response.expires_at).getTime()

      previewTokenCache.value = {
        token: response.token,
        expiresAt,
        taskId: currentTask.value.id,
      }

      return response.token
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to get preview token'
      throw err
    }
  }

  /**
   * 刷新预览 Token
   * - 强制获取新 Token（不检查缓存）
   */
  const refreshPreviewToken = async (): Promise<string> => {
    if (!currentTask.value) throw new Error('Not in task mode')

    try {
      const response = await taskApi.refreshPreviewToken(currentTask.value.id)
      const expiresAt = new Date(response.expires_at).getTime()

      previewTokenCache.value = {
        token: response.token,
        expiresAt,
        taskId: currentTask.value.id,
      }

      return response.token
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to refresh preview token'
      throw err
    }
  }

  /**
   * 获取嵌入式预览 URL（Token 在路径中）
   * - 用于 iframe 嵌入式预览
   * - HTML 相对路径资源自动继承 Token
   *
   * @param filePath 文件路径（相对于任务工作空间根目录）
   * @returns 完整的预览 URL
   */
  const getEmbedPreviewUrl = async (filePath: string): Promise<string> => {
    const token = await getPreviewToken()
    // Token 在 URL 路径中，HTML 相对路径资源自动继承
    return `/task-static/${token}/${filePath}`
  }

  /**
   * 清除预览 Token 缓存
   * - 切换任务时调用
   */
  const clearPreviewToken = () => {
    previewTokenCache.value = null
  }

  /**
   * 删除文件
   */
  const deleteFile = async (filePath: string) => {
    if (!currentTask.value) throw new Error('Not in task mode')

    error.value = null
    try {
      await taskApi.deleteFile(currentTask.value.id, filePath)
      // 刷新文件列表
      await loadTaskFiles(currentBrowsePath.value || undefined)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete file'
      throw err
    }
  }

  /**
   * 保存文件内容
   */
  const saveFileContent = async (filePath: string, content: string) => {
    if (!currentTask.value) throw new Error('Not in task mode')

    error.value = null
    try {
      await taskApi.saveFileContent(currentTask.value.id, filePath, content)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save file'
      throw err
    }
  }

  /**
   * 清除错误
   */
  const clearError = () => {
    error.value = null
  }

  return {
    // State
    tasks,
    currentTask,
    isInTaskMode,
    currentBrowsePath,
    isLoading,
    isLoadingFiles,
    currentFiles,
    error,
    previewTokenCache,

    // Getters
    activeTasks,
    currentTaskId,
    currentPath,

    // Actions
    loadTasks,
    createTask,
    updateTask,
    deleteTask,
    enterTask,
    loadAndEnterTask,
    exitTask,
    loadTaskFiles,
    uploadFile,
    downloadFile,
    getPreviewToken,
    refreshPreviewToken,
    getEmbedPreviewUrl,
    clearPreviewToken,
    deleteFile,
    saveFileContent,
    clearError,
  }
})
