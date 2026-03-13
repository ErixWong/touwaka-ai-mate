import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { taskApi } from '@/api/services'
import type { Task, CreateTaskRequest, TaskFile } from '@/types'

/**
 * Task Store
 *
 * 任务工作空间状态管理
 * - 管理用户的任务列表
 * - 跟踪当前进入的任务工作空间
 * - 在发送消息时附加任务上下文（task_id, task_path）
 *
 * 设计说明：
 * - 进入/退出任务只更新本地状态，不调用 API
 * - 任务上下文在 ChatView 发送消息时附加到消息参数中
 * - 支持多标签页/多窗口场景
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
   * 下载文件
   */
  const downloadFile = async (filePath: string) => {
    if (!currentTask.value) throw new Error('Not in task mode')

    try {
      const response = await taskApi.downloadFile(currentTask.value.id, filePath)
      // 创建下载链接
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = filePath.split('/').pop() || 'download'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to download file'
      throw err
    }
  }

  /**
   * 获取文件预览 URL
   */
  const getFilePreviewUrl = (filePath: string) => {
    if (!currentTask.value) return ''
    return `/api/tasks/${currentTask.value.id}/files/download?path=${encodeURIComponent(filePath)}`
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
    getFilePreviewUrl,
    deleteFile,
    saveFileContent,
    clearError,
  }
})
