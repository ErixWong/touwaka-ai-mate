import { ref, onMounted, onUnmounted } from 'vue'
import apiClient from '@/api/client'

/**
 * 网络状态检测 Composable
 *
 * 用于检测后端服务是否可用，支持：
 * - 定期健康检查（可被 SSE 心跳替代）
 * - 网络状态变化监听
 * - 后端恢复自动检测
 *
 * 当 SSE 连接活跃时，可以调用 pauseHealthCheck() 暂停健康检查，
 * 因为 SSE 心跳已经能够检测后端可用性。
 */

const CHECK_INTERVAL = 5000 // 健康检查间隔 5 秒
const MAX_RETRY_ATTEMPTS = 3 // 每次检查的最大重试次数

export function useNetworkStatus() {
  const isOnline = ref(navigator.onLine)
  const isBackendAvailable = ref(true)
  const isChecking = ref(false)
  const lastCheckTime = ref<Date | null>(null)
  const isHealthCheckPaused = ref(false) // 是否暂停健康检查（SSE 活跃时）
  
  let checkTimer: ReturnType<typeof setInterval> | null = null
  let abortController: AbortController | null = null

  /**
   * 执行健康检查
   */
  const checkHealth = async (): Promise<boolean> => {
    if (isChecking.value) return isBackendAvailable.value
    
    isChecking.value = true
    abortController = new AbortController()
    
    try {
      // 尝试调用健康检查端点
      await apiClient.get('/health', {
        timeout: 5000,
        signal: abortController.signal,
      })
      
      isBackendAvailable.value = true
      lastCheckTime.value = new Date()
      return true
    } catch (error) {
      // 如果健康检查端点不存在，尝试调用一个轻量级 API
      try {
        abortController = new AbortController()
        await apiClient.get('/models', {
          timeout: 5000,
          signal: abortController.signal,
        })
        isBackendAvailable.value = true
        lastCheckTime.value = new Date()
        return true
      } catch {
        isBackendAvailable.value = false
        return false
      }
    } finally {
      isChecking.value = false
      abortController = null
    }
  }

  /**
   * 开始定期健康检查
   */
  const startHealthCheck = () => {
    if (checkTimer) return
    
    // 立即执行一次检查
    checkHealth()
    
    // 定期检查
    checkTimer = setInterval(() => {
      // 如果健康检查被暂停（SSE 活跃），跳过本次检查
      if (isHealthCheckPaused.value) {
        return
      }
      checkHealth()
    }, CHECK_INTERVAL)
  }

  /**
   * 停止健康检查
   */
  const stopHealthCheck = () => {
    if (checkTimer) {
      clearInterval(checkTimer)
      checkTimer = null
    }
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  /**
   * 暂停健康检查（当 SSE 连接活跃时调用）
   * SSE 心跳已经能够检测后端可用性，无需额外的 health 检查
   */
  const pauseHealthCheck = () => {
    isHealthCheckPaused.value = true
    // 同时标记后端可用（因为 SSE 连接活跃）
    isBackendAvailable.value = true
    lastCheckTime.value = new Date()
  }

  /**
   * 恢复健康检查（当 SSE 连接断开时调用）
   */
  const resumeHealthCheck = () => {
    isHealthCheckPaused.value = false
    // 立即执行一次检查
    checkHealth()
  }

  /**
   * 等待后端恢复
   * 返回一个 Promise，在后端可用时 resolve
   */
  const waitForBackend = async (timeout: number = 60000): Promise<boolean> => {
    const startTime = Date.now()
    
    while (Date.now() - startTime < timeout) {
      const isAvailable = await checkHealth()
      if (isAvailable) return true
      
      // 等待一段时间后重试
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    
    return false
  }

  // 监听浏览器在线状态
  const handleOnline = () => {
    isOnline.value = true
    // 网络恢复后检查后端
    checkHealth()
  }

  const handleOffline = () => {
    isOnline.value = false
    isBackendAvailable.value = false
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    startHealthCheck()
  })

  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    stopHealthCheck()
  })

  return {
    isOnline,
    isBackendAvailable,
    isChecking,
    lastCheckTime,
    isHealthCheckPaused,
    checkHealth,
    startHealthCheck,
    stopHealthCheck,
    pauseHealthCheck,
    resumeHealthCheck,
    waitForBackend,
  }
}

export default useNetworkStatus
