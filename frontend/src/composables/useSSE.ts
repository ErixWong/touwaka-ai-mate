import { ref, onUnmounted } from 'vue'
import { updateSSEHeartbeat, registerSSEConnection, unregisterSSEConnection } from './useNetworkStatus'

/**
 * SSE 事件类型
 */
export interface SSEEvent {
  event: string
  data: string
  id?: string
}

/**
 * SSE 连接选项
 */
export interface SSEOptions {
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
 * SSE 连接 Composable
 * 
 * 使用 fetch + ReadableStream 替代 EventSource，支持：
 * - Authorization header 传递 token
 * - 自动重连
 * - 心跳检测
 * - 事件解析
 */
export function useSSE() {
  const isConnected = ref(false)
  const isReconnecting = ref(false)
  const reconnectAttempts = ref(0)
  
  let abortController: AbortController | null = null
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let currentExpertId: string | null = null
  let currentOptions: SSEOptions = {}

  const DEFAULT_TIMEOUT = 10000
  const DEFAULT_MAX_RECONNECT = 10
  const DEFAULT_RECONNECT_INTERVAL = 3000

  /**
   * 获取有效的 access token
   */
  function getAccessToken(): string | null {
    return localStorage.getItem('access_token')
  }

  /**
   * 检查 token 是否即将过期（5分钟内）
   */
  function isTokenExpiringSoon(): boolean {
    const token = getAccessToken()
    if (!token) return true
    
    try {
      // JWT token 格式: header.payload.signature
      const payload = token.split('.')[1]
      if (!payload) return true
      
      const decoded = JSON.parse(atob(payload))
      if (!decoded.exp) return false
      
      // exp 是秒级时间戳
      const expiresAt = decoded.exp * 1000
      const now = Date.now()
      const fiveMinutes = 5 * 60 * 1000
      
      return expiresAt - now < fiveMinutes
    } catch {
      return true
    }
  }

  /**
   * 刷新 token
   */
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

  /**
   * 确保 token 有效
   */
  async function ensureValidToken(): Promise<string | null> {
    // 如果 token 即将过期，尝试刷新
    if (isTokenExpiringSoon()) {
      const refreshed = await refreshToken()
      if (!refreshed) {
        console.warn('Token refresh failed')
      }
    }
    
    return getAccessToken()
  }

  /**
   * 解析 SSE 事件
   */
  function parseSSEEvents(text: string): SSEEvent[] {
    const events: SSEEvent[] = []
    const lines = text.split('\n')
    
    let currentEvent: Partial<SSEEvent> = {}
    
    for (const line of lines) {
      if (line === '') {
        // 空行表示事件结束
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
    
    // 处理最后一个事件（如果没有以空行结尾）
    if (currentEvent.event || currentEvent.data) {
      events.push({
        event: currentEvent.event || 'message',
        data: currentEvent.data || '',
        id: currentEvent.id,
      })
    }
    
    return events
  }

  /**
   * 处理 SSE 事件
   */
  function handleEvent(event: SSEEvent, options: SSEOptions) {
    // 处理心跳事件
    if (event.event === 'heartbeat') {
      updateSSEHeartbeat()
      // 解析心跳数据，传递给用户回调（包含最新消息ID）
      try {
        const data = event.data ? JSON.parse(event.data) : {}
        // 调用用户回调，让前端可以处理心跳中的消息ID
        options.onEvent?.({
          event: 'heartbeat',
          data: JSON.stringify(data),
        })
      } catch {
        // 解析失败则忽略
      }
      return
    }
    
    // 调用用户回调
    options.onEvent?.(event)
  }

  /**
   * 清理重连定时器
   */
  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  /**
   * 尝试重连
   */
  async function reconnect() {
    if (!currentExpertId) return
    
    const maxAttempts = currentOptions.maxReconnectAttempts || DEFAULT_MAX_RECONNECT
    
    if (reconnectAttempts.value >= maxAttempts) {
      console.error('Max reconnect attempts reached')
      isReconnecting.value = false
      currentOptions.onError?.(new Error('Max reconnect attempts reached'))
      return
    }
    
    reconnectAttempts.value++
    isReconnecting.value = true
    
    console.log(`Reconnecting... (${reconnectAttempts.value}/${maxAttempts})`)
    
    await connect(currentExpertId, currentOptions)
  }

  /**
   * 连接 SSE
   */
  async function connect(expertId: string, options: SSEOptions = {}): Promise<boolean> {
    // 保存当前连接参数
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
    
    const timeout = options.timeout || DEFAULT_TIMEOUT
    
    try {
      // 创建 AbortController 用于超时和取消
      abortController = new AbortController()
      const timeoutId = setTimeout(() => {
        abortController?.abort()
      }, timeout)
      
      // 发起请求
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
        
        // 401 表示 token 无效，尝试刷新后重连
        if (response.status === 401) {
          const refreshed = await refreshToken()
          if (refreshed) {
            return connect(expertId, options)
          }
        }
        
        return false
      }
      
      if (!response.body) {
        options.onError?.(new Error('Response body is null'))
        return false
      }
      
      // 连接成功
      isConnected.value = true
      isReconnecting.value = false
      reconnectAttempts.value = 0
      registerSSEConnection()
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
          
          // 解析完整的事件
          const events = parseSSEEvents(buffer)
          
          // 处理事件
          for (const event of events) {
            handleEvent(event, options)
          }
          
          // 清空已处理的 buffer（保留不完整的部分）
          // 注意：这里假设事件以双换行符分隔
          const lastDoubleNewline = buffer.lastIndexOf('\n\n')
          if (lastDoubleNewline !== -1) {
            buffer = buffer.slice(lastDoubleNewline + 2)
          }
        }
      } finally {
        // 连接断开
        isConnected.value = false
        unregisterSSEConnection()
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
      // 用户主动取消不重连
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('SSE connection aborted')
        return false
      }
      
      console.error('SSE connection error:', error)
      options.onError?.(error as Error)
      
      // 连接失败，尝试重连
      if (currentExpertId === expertId) {
        clearReconnectTimer()
        reconnectTimer = setTimeout(() => {
          reconnect()
        }, options.reconnectInterval || DEFAULT_RECONNECT_INTERVAL)
      }
      
      return false
    }
  }

  /**
   * 断开 SSE 连接
   */
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
    
    if (isConnected.value) {
      isConnected.value = false
      unregisterSSEConnection()
      currentOptions.onConnectionChange?.(false)
    }
    
    currentExpertId = null
    reconnectAttempts.value = 0
    isReconnecting.value = false
  }

  // 组件卸载时清理
  onUnmounted(() => {
    disconnect()
  })

  return {
    isConnected,
    isReconnecting,
    reconnectAttempts,
    connect,
    disconnect,
  }
}

export default useSSE
