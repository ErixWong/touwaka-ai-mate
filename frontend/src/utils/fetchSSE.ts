/**
 * fetchSSE - 使用 fetch + ReadableStream 实现 SSE 连接
 * 
 * 相比 EventSource 的优势：
 * - Token 放在 Authorization header 中，不暴露在 URL 中
 * - 支持自定义请求头
 * - 更好的错误处理
 */

export interface SSEOptions {
  url: string
  token?: string
  onMessage?: (event: string, data: string) => void
  onError?: (error: Error) => void
  onOpen?: () => void
}

export interface SSEConnection {
  close: () => void
  isActive: () => boolean
}

/**
 * 解析 SSE 数据
 * SSE 格式：
 * event: xxx
 * data: xxx
 * 
 * 或只有：
 * data: xxx
 */
function parseSSEChunk(chunk: string): { event: string; data: string }[] {
  const results: { event: string; data: string }[] = []
  const lines = chunk.split('\n')
  
  let currentEvent = 'message'
  let currentData = ''
  
  for (const line of lines) {
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      currentData += (currentData ? '\n' : '') + line.slice(5).trim()
    } else if (line === '') {
      // 空行表示事件结束
      if (currentData) {
        results.push({ event: currentEvent, data: currentData })
      }
      currentEvent = 'message'
      currentData = ''
    }
  }
  
  // 处理最后一个事件（如果没有空行结尾）
  if (currentData) {
    results.push({ event: currentEvent, data: currentData })
  }
  
  return results
}

/**
 * 创建 SSE 连接
 */
export function fetchSSE(options: SSEOptions): SSEConnection {
  const { url, token, onMessage, onError, onOpen } = options
  
  const controller = new AbortController()
  let isActive = true
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  
  const headers: Record<string, string> = {
    'Accept': 'text/event-stream',
    'Cache-Control': 'no-cache',
  }
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  
  fetch(url, {
    method: 'GET',
    headers,
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      if (onOpen) {
        onOpen()
      }
      
      const body = response.body
      if (!body) {
        throw new Error('Response body is null')
      }
      
      reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      
      while (isActive) {
        const { done, value } = await reader.read()
        
        if (done) {
          // 连接正常关闭
          isActive = false
          break
        }
        
        buffer += decoder.decode(value, { stream: true })
        
        // 尝试解析完整的 SSE 事件
        // SSE 事件以双换行符分隔
        const eventEndIndex = buffer.lastIndexOf('\n\n')
        
        if (eventEndIndex !== -1) {
          const completeChunk = buffer.slice(0, eventEndIndex)
          buffer = buffer.slice(eventEndIndex + 2)
          
          const events = parseSSEChunk(completeChunk)
          for (const { event, data } of events) {
            if (onMessage && isActive) {
              onMessage(event, data)
            }
          }
        }
      }
    })
    .catch((error) => {
      if (error.name === 'AbortError') {
        // 主动取消，不触发错误回调
        return
      }
      isActive = false
      if (onError) {
        onError(error)
      }
    })
  
  return {
    close: () => {
      isActive = false
      controller.abort()
      if (reader) {
        reader.cancel().catch(() => {})
      }
    },
    isActive: () => isActive,
  }
}

export default fetchSSE
