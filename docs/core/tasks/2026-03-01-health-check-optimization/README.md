# Health Check 与 SSE 心跳优化

> 创建日期: 2026-03-01
> 状态: 🔴 审计中发现问题，需要修复
> 分支: feature/health-check-optimization

---

## 📋 需求概述

### 背景

当前系统存在两套后端存活检测机制：
1. **HTTP Health Check**：前端每 5 秒发起 `GET /api/health` 请求
2. **SSE 心跳**：后端每 30 秒发送 `: heartbeat` 注释

这导致不必要的 HTTP 请求开销，且 SSE 心跳间隔过长无法快速检测连接状态。

### 目标

1. 移除 HTTP Health Check 的 fallback 逻辑（`/api/models`）
2. 将 SSE 心跳间隔从 30 秒缩短到 5 秒
3. 实现混合策略：SSE 连接活跃时跳过 HTTP Health Check

---

## 🎯 验收标准

- [x] 移除 `useNetworkStatus.ts` 中的 fallback 逻辑
- [x] SSE 心跳间隔改为 5 秒
- [x] SSE 连接活跃时跳过 HTTP Health Check
- [x] 前端能正确监听 SSE 心跳并更新状态
- [x] 无 SSE 连接时仍能通过 HTTP Health Check 检测后端

---

## ⚠️ 审计发现的问题

### 🔴 高优先级（必须修复）

#### 1. SSE 认证架构问题

**问题描述**：
- Token 通过 URL query 参数传递，存在安全风险
- JWT access_token 有效期只有 15 分钟
- SSE 长连接超过 15 分钟后，重连时 token 已过期
- EventSource API 无法自定义 Headers，无法动态刷新 token

**当前实现**：
```javascript
// ChatView.vue:225-226
const token = localStorage.getItem('access_token')
const sseUrl = `/api/chat/stream?expert_id=${expert_id}&token=${encodeURIComponent(token || '')}`
```

**推荐方案**：使用 fetch + ReadableStream 替代 EventSource

```typescript
async function connectSSE(expertId: string) {
  const response = await fetch(`/api/chat/stream?expert_id=${expertId}`, {
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`,
      'Accept': 'text/event-stream',
    },
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const text = decoder.decode(value);
    // 解析 SSE 事件...
  }
}
```

**优点**：
- ✅ Token 在 Authorization header 中传递，更安全
- ✅ 重连前可检查/刷新 token
- ✅ 更灵活的错误处理
- ✅ 避免 token 出现在 URL 中

### 🟡 中优先级（建议修复）

#### 2. 发送消息前未检查 SSE 连接状态

**问题描述**：
- 前端发送消息前只检查 `isBackendAvailable`，没有检查 `isConnected`（SSE 连接状态）
- 如果 SSE 断开但后端可用，消息发送成功但响应会丢失
- 后端只打印 warn 日志，前端不知道响应丢失

**当前实现**：
```javascript
// ChatView.vue:421-436
// 只检查后端是否可用，没有检查 SSE 连接状态
if (!isBackendAvailable.value) {
  // ...
}
// 问题：如果 SSE 断开但后端可用，消息发送成功但响应丢失！
```

**建议**：
- 发送消息前检查 `isConnected` 状态
- 如果 SSE 未连接，等待重连或提示用户
- 后端应返回错误码告知前端 SSE 连接不存在

#### 3. SSE 连接数无限制
- 没有对单个用户或 Expert 的连接数进行限制
- 可能被滥用导致资源耗尽

#### 3. 全局变量竞态条件
- `useNetworkStatus.ts` 使用模块级全局变量
- 多组件并发访问时可能存在竞态条件
- 建议迁移到 Pinia store

---

##  技术方案

### 1. 后端改动（已实现）

**文件：** `server/controllers/stream.controller.js`

```javascript
// 心跳保活 - 5秒间隔，用于快速检测连接状态
const heartbeat = setInterval(() => {
  if (ctx.res.writableEnded) {
    clearInterval(heartbeat);
    return;
  }
  // 发送命名事件而非注释，前端可以监听
  ctx.res.write('event: heartbeat\ndata: {}\n\n');
}, 5000);
```

### 2. 前端改动（已实现）

**文件：** `frontend/src/composables/useNetworkStatus.ts`

```typescript
// 移除 fallback 逻辑，直接调用 /health
const checkHealth = async (): Promise<boolean> => {
  await apiClient.get('/health', { timeout: 5000 });
  // ...
};

// SSE 连接状态追踪（全局共享）
let lastSSEHeartbeatTime: number | null = null;
let sseConnectionCount = 0;

// SSE 活跃时跳过 HTTP 检查
const startHealthCheck = () => {
  checkTimer = setInterval(() => {
    if (isSSEActive()) {
      isBackendAvailable.value = true;
      return;
    }
    checkHealth();
  }, CHECK_INTERVAL);
};
```

### 3. 性能对比

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| HTTP 请求频率 | 每 5 秒（无差别） | SSE 活跃时跳过 |
| SSE 心跳间隔 | 30 秒 | 5 秒 |
| 故障检测速度 | 5 秒 | 5 秒（SSE 或 HTTP） |
| 空闲时流量 | ~4-6 KB/分钟 | ~0.3 KB/分钟（仅心跳） |

---

## 📁 相关文件

| 文件 | 改动 |
|------|------|
| `server/controllers/stream.controller.js` | 心跳间隔 30s → 5s，命名事件 |
| `frontend/src/composables/useNetworkStatus.ts` | 移除 fallback，SSE 心跳追踪 |
| `frontend/src/views/ChatView.vue` | 集成 SSE 心跳监听 |

---

## 🔗 相关链接

- Code Review: [review.md](./review.md)
- 解决方案: [solution.md](./solution.md)

---

## 📝 后续任务

1. [ ] 使用 fetch + ReadableStream 替代 EventSource（解决 token 过期问题）
2. [ ] 发送消息前检查 SSE 连接状态（避免响应丢失）
3. [ ] 后端返回错误码告知 SSE 连接不存在
4. [ ] 添加 SSE 连接数限制
5. [ ] 将 SSE 状态迁移到 Pinia store
