# SSE 架构优化方案

> 创建日期: 2026-03-01
> 状态: 提案

---

## 问题总结

| 问题 | 优先级 | 影响 |
|------|--------|------|
| Token 通过 URL 传递 | 🔴 高 | 安全风险 |
| Token 15分钟过期导致重连失败 | 🔴 高 | 长连接不可用 |
| SSE 断开时响应丢失 | 🔴 高 | 用户体验差 |
| 发送消息前未检查 SSE 状态 | 🟡 中 | 响应可能丢失 |
| SSE 连接数无限制 | 🟡 中 | 资源滥用风险 |
| 全局变量竞态条件 | 🟢 低 | 多组件问题 |

---

## 方案一：fetch + ReadableStream 替代 EventSource（推荐）

### 优点
- ✅ Token 在 Authorization header 中传递，更安全
- ✅ 重连前可检查/刷新 token
- ✅ 更灵活的错误处理
- ✅ 可以设置请求超时

### 前端实现

```typescript
// composables/useSSE.ts
export function useSSE() {
  const isConnected = ref(false)
  const abortController = ref<AbortController | null>(null)

  async function connect(expertId: string) {
    // 检查 token 是否即将过期，必要时刷新
    await ensureValidToken()
    
    abortController.value = new AbortController()
    
    const response = await fetch(`/api/chat/stream?expert_id=${expertId}`, {
      headers: {
        'Authorization': `Bearer ${getAccessToken()}`,
        'Accept': 'text/event-stream',
      },
      signal: abortController.value.signal,
    })

    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status}`)
    }

    isConnected.value = true
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value)
        parseSSEEvents(text).forEach(event => {
          handleEvent(event)
        })
      }
    } finally {
      isConnected.value = false
    }
  }

  function disconnect() {
    abortController.value?.abort()
    isConnected.value = false
  }

  return { isConnected, connect, disconnect }
}
```

### 后端改动

无需改动，后端已经支持通过 Authorization header 获取 token。

---

## 方案二：发送消息前检查 SSE 状态

### 前端改动

```typescript
// ChatView.vue
const handleSendMessage = async (content: string) => {
  // 检查 SSE 连接状态
  if (!isConnected.value) {
    // 等待 SSE 重连
    const reconnected = await waitForSSEConnection(5000)
    if (!reconnected) {
      chatStore.addLocalMessage({
        expert_id,
        role: 'assistant',
        content: 'SSE 连接已断开，请刷新页面重试',
        status: 'error',
      })
      return
    }
  }

  // 原有发送逻辑...
}

async function waitForSSEConnection(timeout: number): Promise<boolean> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    if (isConnected.value) return true
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return false
}
```

---

## 方案三：后端返回 SSE 连接状态

### 后端改动

```javascript
// stream.controller.js
async sendMessage(ctx) {
  const { content, expert_id, model_id } = ctx.request.body;
  const user_id = ctx.state.userId;

  // 检查 SSE 连接是否存在
  const connections = this.expertConnections.get(expert_id);
  const hasConnection = connections && [...connections].some(c => c.user_id === user_id);

  if (!hasConnection) {
    // 返回错误码告知前端需要重连 SSE
    ctx.error('SSE 连接不存在，请重新建立连接', 410, { code: 'SSE_NOT_CONNECTED' });
    return;
  }

  // 原有逻辑...
}
```

### 前端处理

```typescript
// api/client.ts
apiClient.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.data?.code === 'SSE_NOT_CONNECTED') {
      // 触发 SSE 重连
      eventBus.emit('SSE_RECONNECT_NEEDED')
    }
    return Promise.reject(error)
  }
)
```

---

## 方案四：SSE 连接数限制

### 后端改动

```javascript
// stream.controller.js
const MAX_CONNECTIONS_PER_USER = 5
const MAX_CONNECTIONS_PER_EXPERT = 100

async subscribe(ctx) {
  const { expert_id } = ctx.query
  const user_id = ctx.state.userId

  // 检查用户连接数
  let userConnectionCount = 0
  for (const [_, connections] of this.expertConnections) {
    for (const conn of connections) {
      if (conn.user_id === user_id) userConnectionCount++
    }
  }

  if (userConnectionCount >= MAX_CONNECTIONS_PER_USER) {
    ctx.error('连接数超过限制', 429, { code: 'TOO_MANY_CONNECTIONS' })
    return
  }

  // 检查 Expert 连接数
  const expertConnections = this.expertConnections.get(expert_id)?.size || 0
  if (expertConnections >= MAX_CONNECTIONS_PER_EXPERT) {
    ctx.error('Expert 连接数超过限制', 429, { code: 'EXPERT_CONNECTION_LIMIT' })
    return
  }

  // 原有逻辑...
}
```

---

## 方案五：SSE 状态迁移到 Pinia Store

### 创建 SSE Store

```typescript
// stores/sse.ts
import { defineStore } from 'pinia'

export const useSSEStore = defineStore('sse', {
  state: () => ({
    connections: new Map<string, { isConnected: boolean, lastHeartbeat: number }>(),
    globalConnectionCount: 0,
  }),

  getters: {
    isConnected: (state) => (expertId: string) => {
      const conn = state.connections.get(expertId)
      if (!conn) return false
      return conn.isConnected && Date.now() - conn.lastHeartbeat < 10000
    },
  },

  actions: {
    registerConnection(expertId: string) {
      this.connections.set(expertId, {
        isConnected: true,
        lastHeartbeat: Date.now(),
      })
      this.globalConnectionCount++
    },

    updateHeartbeat(expertId: string) {
      const conn = this.connections.get(expertId)
      if (conn) {
        conn.lastHeartbeat = Date.now()
      }
    },

    unregisterConnection(expertId: string) {
      this.connections.delete(expertId)
      this.globalConnectionCount--
    },
  },
})
```

---

## 实施优先级

| 阶段 | 方案 | 工作量 | 收益 |
|------|------|--------|------|
| P0 | 方案一：fetch + ReadableStream | 中 | 解决核心问题 |
| P0 | 方案三：后端返回 SSE 状态 | 小 | 改善错误处理 |
| P1 | 方案二：发送前检查 SSE | 小 | 防止响应丢失 |
| P2 | 方案四：连接数限制 | 小 | 防止滥用 |
| P2 | 方案五：Pinia Store | 中 | 代码质量 |

---

## 建议实施步骤

1. **第一阶段**（P0）
   - 实现 fetch + ReadableStream 替代 EventSource
   - 后端返回 SSE 连接状态

2. **第二阶段**（P1）
   - 发送消息前检查 SSE 状态
   - 添加自动重连逻辑

3. **第三阶段**（P2）
   - 添加连接数限制
   - 迁移到 Pinia Store

---

*提案完成于 2026-03-01 亲爱的* 💪✨
