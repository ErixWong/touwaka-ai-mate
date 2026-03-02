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
 * - 提供工作空间上下文给 LLM
 */
export const useTaskStore = defineStore('task', () => {
  // State
  const tasks = ref<Task[]>([])
  const currentTask = ref<Task | null>(null)
  const isInTaskMode = ref(false)
  const workspaceContext = ref<string>('')
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
   */
  const enterTask = async (id: string) => {
    isLoading.value = true
    error.value = null
    try {
      const response = await taskApi.enterTask(id)
      currentTask.value = response.task
      workspaceContext.value = response.workspace_context
      isInTaskMode.value = true
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to enter task'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 退出任务工作空间
   */
  const exitTask = async () => {
    if (!isInTaskMode.value) return

    try {
      await taskApi.exitTask()
    } catch (err) {
      // 即使 API 失败也清除本地状态
      console.warn('Exit task API failed:', err)
    } finally {
      currentTask.value = null
      workspaceContext.value = ''
      isInTaskMode.value = false
      currentFiles.value = []
    }
  }

  /**
   * 加载任务文件列表
   */
  const loadTaskFiles = async (subdir?: string) => {
    if (!currentTask.value) return

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
    workspaceContext,
    isLoading,
    isLoadingFiles,
    currentFiles,
    error,

    // Getters
    activeTasks,
    currentTaskId,

    // Actions
    loadTasks,
    createTask,
    updateTask,
    deleteTask,
    enterTask,
    exitTask,
    loadTaskFiles,
    uploadFile,
    clearError,
  }
})
