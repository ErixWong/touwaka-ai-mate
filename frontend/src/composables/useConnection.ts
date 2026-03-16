import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 连接状态枚举
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/**
 * SSE 事件类型
 */
export interface SSEEvent {
  event: string
  data: string
  id?: string
}

/**
 * 连接选项
 */
export interface ConnectionOptions {
  /** 连接超时时间（毫秒） */
  timeout?: number
  /** 最大重连次数 */
  maxReconnectAttempts?: number
  /** 重连间隔（毫秒） */
  reconnectInterval?: number
  /** 事件回调 */
  onEvent?: (event: SSEEvent) => void
  /** 连接状态回调 */
  onConnectionChange?: (connected: boolean) => void
  /** 错误回调 */
  onError?: (error: Error) => void
}

/**
 * 统一连接管理 Composable
 * 
 * 整合 SSE 连接、心跳检测、后端健康检查，避免状态碎片化。
 * 
 * 设计原则：
 * - 单一状态源：connectionState 统一表示连接状态
 * - 单一心跳追踪：lastHeartbeatTime
 * - 单一检测定时器：checkTimer
 */
export function useConnection() {
  // ========== 核心状态 ==========
  const connectionState = ref<ConnectionState>('disconnected')
  const backendAvailable = ref(true)
  const isOnline = ref(navigator.onLine)
  const reconnectAttempts = ref(0)

  // ========== 内部变量 ==========
  let abortController: AbortController | null = null
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let checkTimer: ReturnType<typeof setInterval> | null = null
  let currentExpertId: string | null = null
  let currentOptions: ConnectionOptions = {}
  let lastHeartbeatTime: number = 0

  // ========== 常量 ==========
  const DEFAULT_TIMEOUT = 10000
  const DEFAULT_MAX_RECONNECT = 10
  const DEFAULT_RECONNECT_INTERVAL = 3000
  const HEARTBEAT_TIMEOUT = 15000 // 心跳超时（3 个心跳周期）
  const CHECK_INTERVAL = 5000 // 健康检查间隔

  // ========== Token 管理 ==========
  
  function getAccessToken(): string | null {
    return localStorage.getItem('access_token')
  }

  function isTokenExpiringSoon(): boolean {
    const token = getAccessToken()
    if (!token) return true
    
    try {
      const payload = token.split('.')[1]
      if (!payload) return true
      
      const decoded = JSON.parse(atob(payload))
      if (!decoded.exp) return false
      
      const expiresAt = decoded.exp * 1000
      const now = Date.now()
      const fiveMinutes = 5 * 60 * 1000
      
      return expiresAt - now < fiveMinutes
    } catch {
      return true
    }
  }

  async function refreshToken(): Promise<boolean> {
    const refreshToken = localStorage.getItem('refresh_token')
    if (!refreshToken) return false

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })

      if (!response.ok) return false

      const data = await response.json()
      const { access_token, refresh_token: new_refresh_token } = data.data || data
      
      localStorage.setItem('access_token', access_token)
      if (new_refresh_token) {
        localStorage.setItem('refresh_token', new_refresh_token)
      }
      
      return true
    } catch {
      return false
    }
  }

  async function ensureValidToken(): Promise<string | null> {
    if (isTokenExpiringSoon()) {
      await refreshToken()
    }
    return getAccessToken()
  }

  // ========== SSE 事件解析 ==========
  
  function parseSSEEvents(text: string): SSEEvent[] {
    const events: SSEEvent[] = []
    const lines = text.split('\n')
    let currentEvent: Partial<SSEEvent> = {}
    
    for (const line of lines) {
      if (line === '') {
        if (currentEvent.event || currentEvent.data) {
          events.push({
            event: currentEvent.event || 'message',
            data: currentEvent.data || '',
            id: currentEvent.id,
          })
        }
        currentEvent = {}
        continue
      }
      
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue
      
      const field = line.slice(0, colonIndex).trim()
      const value = line.slice(colonIndex + 1).trim()
      
      switch (field) {
        case 'event':
          currentEvent.event = value
          break
        case 'data':
          currentEvent.data = (currentEvent.data || '') + value
          break
        case 'id':
          currentEvent.id = value
          break
      }
    }
    
    if (currentEvent.event || currentEvent.data) {
      events.push({
        event: currentEvent.event || 'message',
        data: currentEvent.data || '',
        id: currentEvent.id,
      })
    }
    
    return events
  }

  // ========== 心跳检测 ==========
  
  function startHeartbeatCheck() {
    lastHeartbeatTime = Date.now()
  }

  function updateHeartbeat() {
    lastHeartbeatTime = Date.now()
    backendAvailable.value = true // 收到心跳说明后端可用
  }

  function isHeartbeatTimeout(): boolean {
    if (!lastHeartbeatTime) return true
    return Date.now() - lastHeartbeatTime > HEARTBEAT_TIMEOUT
  }

  // ========== 健康检查 ==========
  
  async function checkBackendHealth(): Promise<boolean> {
    // SSE 连接活跃时跳过 HTTP 检查
    if (connectionState.value === 'connected' && !isHeartbeatTimeout()) {
      return true
    }

    try {
      const response = await fetch('/api/health', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      backendAvailable.value = response.ok
      return response.ok
    } catch {
      backendAvailable.value = false
      return false
    }
  }

  function startHealthCheck() {
    if (checkTimer) return
    
    checkTimer = setInterval(() => {
      // SSE 连接活跃且心跳正常，跳过检查
      if (connectionState.value === 'connected' && !isHeartbeatTimeout()) {
        backendAvailable.value = true
        return
      }
      checkBackendHealth()
    }, CHECK_INTERVAL)
  }

  function stopHealthCheck() {
    if (checkTimer) {
      clearInterval(checkTimer)
      checkTimer = null
    }
  }

  // ========== 重连逻辑 ==========
  
  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  async function reconnect() {
    if (!currentExpertId) return
    
    const maxAttempts = currentOptions.maxReconnectAttempts || DEFAULT_MAX_RECONNECT
    
    if (reconnectAttempts.value >= maxAttempts) {
      console.error('Max reconnect attempts reached')
      connectionState.value = 'disconnected'
      currentOptions.onError?.(new Error('Max reconnect attempts reached'))
      return
    }
    
    reconnectAttempts.value++
    connectionState.value = 'reconnecting'
    
    console.log(`Reconnecting... (${reconnectAttempts.value}/${maxAttempts})`)
    
    await connect(currentExpertId, currentOptions)
  }

  // ========== SSE 事件处理 ==========
  
  function handleEvent(event: SSEEvent) {
    // 处理心跳事件
    if (event.event === 'heartbeat') {
      updateHeartbeat()
      // 解析心跳数据，传递给用户回调
      try {
        const data = event.data ? JSON.parse(event.data) : {}
        currentOptions.onEvent?.({
          event: 'heartbeat',
          data: JSON.stringify(data),
        })
      } catch {
        // 解析失败则忽略
      }
      return
    }
    
    // 调用用户回调
    currentOptions.onEvent?.(event)
  }

  // ========== 核心连接方法 ==========
  
  async function connect(expertId: string, options: ConnectionOptions = {}): Promise<boolean> {
    currentExpertId = expertId
    currentOptions = options
    
    // 清理旧连接
    await disconnect()
    
    // 确保 token 有效
    const token = await ensureValidToken()
    if (!token) {
      options.onError?.(new Error('No valid token'))
      return false
    }
    
    connectionState.value = 'connecting'
    const timeout = options.timeout || DEFAULT_TIMEOUT
    
    try {
      abortController = new AbortController()
      const timeoutId = setTimeout(() => {
        abortController?.abort()
      }, timeout)
      
      const response = await fetch(`/api/chat/stream?expert_id=${expertId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: abortController.signal,
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        const error = new Error(`SSE connection failed: ${response.status}`)
        options.onError?.(error)
        
        if (response.status === 401) {
          const refreshed = await refreshToken()
          if (refreshed) {
            return connect(expertId, options)
          }
        }
        
        connectionState.value = 'disconnected'
        return false
      }
      
      if (!response.body) {
        options.onError?.(new Error('Response body is null'))
        connectionState.value = 'disconnected'
        return false
      }
      
      // 连接成功
      connectionState.value = 'connected'
      reconnectAttempts.value = 0
      startHeartbeatCheck()
      options.onConnectionChange?.(true)
      
      // 读取流
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      
      try {
        while (true) {
          const { done, value } = await reader.read()
          
          if (done) {
            console.log('SSE stream ended')
            break
          }
          
          buffer += decoder.decode(value, { stream: true })
          const events = parseSSEEvents(buffer)
          
          for (const event of events) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
            handleEvent(event)
          }
          
          const lastDoubleNewline = buffer.lastIndexOf('\n\n')
          if (lastDoubleNewline !== -1) {
            buffer = buffer.slice(lastDoubleNewline + 2)
          }
        }
      } finally {
        connectionState.value = 'disconnected'
        options.onConnectionChange?.(false)
      }
      
      // 流正常结束，尝试重连
      if (currentExpertId === expertId) {
        clearReconnectTimer()
        reconnectTimer = setTimeout(() => {
          reconnect()
        }, options.reconnectInterval || DEFAULT_RECONNECT_INTERVAL)
      }
      
      return true
      
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('SSE connection aborted')
        return false
      }
      
      console.error('SSE connection error:', error)
      options.onError?.(error as Error)
      
      if (currentExpertId === expertId) {
        clearReconnectTimer()
        reconnectTimer = setTimeout(() => {
          reconnect()
        }, options.reconnectInterval || DEFAULT_RECONNECT_INTERVAL)
      }
      
      return false
    }
  }

  async function disconnect() {
    clearReconnectTimer()
    
    if (reader) {
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
      reader = null
    }
    
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    
    if (connectionState.value !== 'disconnected') {
      connectionState.value = 'disconnected'
      currentOptions.onConnectionChange?.(false)
    }
    
    currentExpertId = null
    reconnectAttempts.value = 0
  }

  /**
   * 检查连接是否可用
   * 如果心跳超时，返回 false
   */
  function checkConnection(): boolean {
    if (connectionState.value !== 'connected') {
      return false
    }
    return !isHeartbeatTimeout()
  }

  /**
   * 等待后端恢复
   */
  async function waitForBackend(timeout: number = 60000): Promise<boolean> {
    const startTime = Date.now()
    
    while (Date.now() - startTime < timeout) {
      const isAvailable = await checkBackendHealth()
      if (isAvailable) return true
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    
    return false
  }

  // ========== 浏览器在线状态监听 ==========
  
  const handleOnline = () => {
    isOnline.value = true
    checkBackendHealth()
  }

  const handleOffline = () => {
    isOnline.value = false
    backendAvailable.value = false
  }

  // ========== 生命周期 ==========
  
  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    startHealthCheck()
  })

  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    stopHealthCheck()
    disconnect()
  })

  // ========== 导出 ==========
  
  return {
    // 状态
    connectionState,
    backendAvailable,
    isOnline,
    reconnectAttempts,
    
    // 方法
    connect,
    disconnect,
    checkConnection,
    checkBackendHealth,
    waitForBackend,
  }
}

export default useConnection