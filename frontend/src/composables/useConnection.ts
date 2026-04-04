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
  let isConnecting: boolean = false  // 连接锁，防止并发连接

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
    } catch (err) {
      console.warn('[useConnection] Token parsing error:', err)
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
    } catch (err) {
      console.error('[useConnection] Token refresh failed:', err)
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
  
  /**
   * 解析 SSE 事件
   * 注意：只解析完整的事件（以 \n\n 结尾的事件）
   * 不完整的事件会留在 buffer 中等待下一次处理
   */
  function parseSSEEvents(text: string): SSEEvent[] {
    const events: SSEEvent[] = []
    const lines = text.split('\n')
    let currentEvent: Partial<SSEEvent> = {}
    
    for (const line of lines) {
      if (line === '') {
        // 空行表示事件结束，只有完整的事件才 push
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
    
    // ★ 关键修复：不要把不完整的事件 push 出去
    // 不完整的事件（没有以 \n\n 结尾）会留在 buffer 中，等待下一次处理
    // 这样避免了事件被重复处理的问题
    
    return events
  }

  // ========== 心跳检测 ==========
  
  function updateHeartbeat() {
    lastHeartbeatTime = Date.now()
    backendAvailable.value = true // 收到心跳说明后端可用
  }

  function isHeartbeatTimeout(): boolean {
    if (!lastHeartbeatTime) return true
    return Date.now() - lastHeartbeatTime > HEARTBEAT_TIMEOUT
  }

  // ========== 统一检测定时器 ==========
  
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
    } catch (err) {
      console.warn('[useConnection] Health check failed:', err)
      backendAvailable.value = false
      return false
    }
  }

  function startHealthCheck() {
    if (checkTimer) return
    
    checkTimer = setInterval(async () => {
      // SSE 连接活跃且心跳正常，跳过 HTTP 检查
      if (connectionState.value === 'connected' && !isHeartbeatTimeout()) {
        backendAvailable.value = true
        return
      }
      
      // 心跳超时，触发重连（但不要打断正在进行的连接）
      if (connectionState.value === 'connected' && isHeartbeatTimeout() && !isConnecting) {
        console.warn(`[Connection] Heartbeat timeout, reconnecting...`)
        // 保存参数，因为 disconnect() 会清除 currentExpertId
        const savedExpertId = currentExpertId
        const savedOptions = currentOptions
        await disconnect()
        if (savedExpertId) {
          connect(savedExpertId, savedOptions)
        }
        return
      }
      
      // SSE 未连接，检查后端健康
      const isAvailable = await checkBackendHealth()
      
      // 关键修复：后端可用但 SSE 未连接（非重连中），主动重连
      // 注意：只在 'disconnected' 状态触发，且没有正在进行的连接
      if (isAvailable && connectionState.value === 'disconnected' && currentExpertId && !isConnecting) {
        console.log('[Connection] Backend available but SSE disconnected, reconnecting...')
        connect(currentExpertId, currentOptions)
      }
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
    // 调试日志：记录所有接收到的事件
    console.log('[SSE] Received event:', event.event, event.data?.substring(0, 100))
    
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
      } catch (err) {
        console.warn('[useConnection] Heartbeat parse error:', err)
      }
      return
    }
    
    // 调用用户回调
    currentOptions.onEvent?.(event)
  }

  // ========== 核心连接方法 ==========
  
  async function connect(expertId: string, options: ConnectionOptions = {}): Promise<boolean> {
    // 连接锁：防止并发连接
    if (isConnecting) {
      console.log('[SSE] Connection already in progress, skipping...')
      return false
    }
    isConnecting = true
    
    try {
      // 先保存参数，因为 disconnect() 会清除 currentExpertId
      const targetExpertId = expertId
      const targetOptions = options
      
      currentExpertId = targetExpertId
      currentOptions = targetOptions
      
      // 清理旧连接（注意：disconnect() 会清除 currentExpertId，所以上面先保存）
      await disconnect()
      
      // 恢复参数
      currentExpertId = targetExpertId
      currentOptions = targetOptions
    
      // 确保 token 有效
      const token = await ensureValidToken()
      if (!token) {
        options.onError?.(new Error('No valid token'))
        return false
      }
      
      connectionState.value = 'connecting'
      const timeout = options.timeout || DEFAULT_TIMEOUT
      
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
            isConnecting = false  // 释放锁后再递归
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
      lastHeartbeatTime = Date.now() // 初始化心跳时间
      options.onConnectionChange?.(true)
      
      // 读取流
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      
      try {
        while (true) {
          // 检查 reader 是否仍然有效（可能被 disconnect() 清除）
          if (!reader) {
            console.log('[SSE] Reader was cleared, stopping read loop')
            break
          }
          
          const { done, value } = await reader.read()
          
          if (done) {
            console.log('SSE stream ended')
            // ★ 关键修复：流结束时，处理 buffer 中剩余的内容
            // 最后一个 complete 事件可能没有以 \n\n 结尾，但仍然需要处理
            if (buffer.trim()) {
              console.log('[SSE] Processing remaining buffer on stream end:', buffer.substring(0, 100))
              const remainingEvents = parseSSEEvents(buffer)
              for (const event of remainingEvents) {
                handleEvent(event)
              }
              // 如果 parseSSEEvents 没有解析出事件，但 buffer 中有内容
              // 尝试手动解析（处理没有 \n\n 结尾的情况）
              if (remainingEvents.length === 0 && buffer.includes('event:')) {
                const lines = buffer.split('\n')
                const currentEvent: Partial<SSEEvent> = {}
                for (const line of lines) {
                  const colonIndex = line.indexOf(':')
                  if (colonIndex !== -1) {
                    const field = line.slice(0, colonIndex).trim()
                    const value = line.slice(colonIndex + 1).trim()
                    if (field === 'event') currentEvent.event = value
                    if (field === 'data') currentEvent.data = (currentEvent.data || '') + value
                  }
                }
                if (currentEvent.event && currentEvent.data) {
                  console.log('[SSE] Forcing remaining event processing:', currentEvent.event)
                  handleEvent({
                    event: currentEvent.event,
                    data: currentEvent.data,
                  })
                }
              }
            }
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
    } finally {
      isConnecting = false  // 释放连接锁
    }
  }

  async function disconnect() {
    clearReconnectTimer()
    
    if (reader) {
      try {
        await reader.cancel()
      } catch (err) {
        console.warn('[useConnection] Reader cancel error:', err)
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
    lastHeartbeatTime = 0
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