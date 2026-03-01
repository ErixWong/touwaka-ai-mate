# Code Review: Health Check 与 SSE 心跳优化

> 提交: `pending` - Health Check 与 SSE 心跳优化
> 审查日期: 2026-03-01
> 审查人: Maria 🌸

---

## 📋 变更概览

| 文件 | 变更 |
|------|------|
| `server/controllers/stream.controller.js` | 心跳间隔 30s → 5s，改为命名事件 |
| `frontend/src/composables/useNetworkStatus.ts` | 移除 fallback，新增 SSE 心跳追踪 |
| `frontend/src/views/ChatView.vue` | 集成 SSE 心跳监听 |

---

## ✅ 优点

### 后端 (stream.controller.js)
1. **心跳间隔优化**：从 30 秒缩短到 5 秒，快速检测连接状态
2. **命名事件设计**：使用 `event: heartbeat` 而非注释，前端可监听
3. **连接状态检查**：发送心跳前检查 `writableEnded`，避免无效写入
4. **清理机制完善**：`cleanup` 函数正确处理连接关闭和心跳清理

### 前端 (useNetworkStatus.ts)
1. **移除冗余 fallback**：不再 fallback 到 `/models`，逻辑更清晰
2. **混合策略实现**：SSE 活跃时跳过 HTTP Health Check，减少请求
3. **全局状态共享**：`lastSSEHeartbeatTime` 和 `sseConnectionCount` 跨组件共享
4. **超时设计合理**：`SSE_HEARTBEAT_TIMEOUT = 10000`（2 个心跳周期）

### 前端 (ChatView.vue)
1. **心跳监听完整**：正确监听 `heartbeat` 事件并更新状态
2. **连接生命周期管理**：`registerSSEConnection` / `unregisterSSEConnection` 配对使用
3. **后端恢复自动重连**：监听 `isBackendAvailable` 变化自动重连 SSE

---

## ⚠️ 需要关注的问题

### 🔴 高优先级

#### 1. 🔴 SSE 认证架构问题（必须修复）

**问题 1：Token 通过 URL 传递存在安全风险**
**文件**: `ChatView.vue:226`
```javascript
const sseUrl = `/api/chat/stream?expert_id=${expert_id}&token=${encodeURIComponent(token || '')}`
```
- Token 在 URL 中传递，可能被服务器日志、浏览器历史记录、代理服务器记录
- Token 类型：JWT access_token，有效期 **15 分钟**

**问题 2：Token 过期导致 SSE 重连失败**
- access_token 有效期只有 15 分钟
- SSE 是长连接，超过 15 分钟的连接很正常
- SSE 连接期间 token 过期后，重连时使用旧 token 会导致 401 错误
- EventSource API 无法感知 token 过期，也无法动态更新 token

**推荐方案：使用 fetch + ReadableStream 替代 EventSource**

```typescript
// 推荐实现方案
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
1. ✅ Token 在 Authorization header 中传递，更安全
2. ✅ 可以在重连前检查 token 是否过期，自动刷新
3. ✅ 更灵活的错误处理和重连逻辑
4. ✅ 可以设置请求超时
5. ✅ 避免token 出现在 URL 中

**替代方案**（如果不想重构）：
- 使用 Cookie 认证（需要后端配合）
- 为 SSE 创建专门的长效 token（如 1 小时）

#### 2. 后端 Promise 永不 resolve 可能导致内存问题
**文件**: `stream.controller.js:254`
```javascript
return new Promise(() => {});
```
**问题**: 永不 resolve 的 Promise 可能导致 Koa 中间件内存泄漏。
**建议**: 考虑使用更标准的 SSE 长连接管理方式，如 Koa 的 `ctx.req.on('close')` 事件处理。

### 🟡 中优先级

#### 2. 发送消息前未检查 SSE 连接状态
**文件**: `ChatView.vue:421-436`
```javascript
// 只检查后端是否可用，没有检查 SSE 连接状态
if (!isBackendAvailable.value) {
  // ...
}
// 问题：如果 SSE 断开但后端可用，消息发送成功但响应丢失！
```
**问题**:
- 前端发送消息前只检查 `isBackendAvailable`，没有检查 `isConnected`（SSE 连接状态）
- 如果 SSE 断开但后端可用，消息发送成功但响应会丢失
- 后端只打印 warn 日志，前端不知道响应丢失

**建议**:
- 发送消息前检查 `isConnected` 状态
- 如果 SSE 未连接，等待重连或提示用户
- 后端应返回错误码告知前端 SSE 连接不存在

#### 3. SSE 连接数无限制

#### 3. SSE 连接数无限制
**文件**: `stream.controller.js:219-224`
```javascript
if (!this.expertConnections.has(expert_id)) {
  this.expertConnections.set(expert_id, new Set());
}
this.expertConnections.get(expert_id).add(connection);
```
**问题**: 没有对单个用户或单个 Expert 的连接数进行限制，可能被滥用。
**建议**: 添加连接数限制，如每用户最多 5 个并发 SSE 连接。

#### 4. 全局变量的竞态条件
**文件**: `useNetworkStatus.ts:18-19`
```typescript
let lastSSEHeartbeatTime: number | null = null
let sseConnectionCount = 0
```
**问题**: 模块级全局变量在多组件并发访问时可能存在竞态条件。
**建议**: 考虑使用 Vue reactive 对象或 Pinia store 管理状态。

#### 5. 错误处理不完整
**文件**: `useNetworkStatus.ts:85-88`
```typescript
} catch {
  // health 端点失败即认为后端不可用
  isBackendAvailable.value = false
  return false
}
```
**问题**: catch 块没有记录具体错误信息，不利于调试。
**建议**: 添加 `console.warn('Health check failed:', error)` 或使用 logger。

### 🟢 低优先级

#### 6. 重连逻辑可能冲突
**文件**: `ChatView.vue:388-409` 和 `ChatView.vue:567-581`
**问题**: 既有 SSE `onerror` 重连，又有后端恢复重连，可能同时触发。
**建议**: 统一重连入口，避免重复连接。

#### 7. 心跳数据为空对象
**文件**: `stream.controller.js:235`
```javascript
ctx.res.write('event: heartbeat\ndata: {}\n\n');
```
**问题**: 发送空对象 `{}`，可以优化为不发送 data 或发送时间戳。
**建议**: 考虑发送 `data: {"ts": ${Date.now()}}` 便于调试。

---

## 📊 性能对比

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| HTTP 请求频率 | 每 5 秒（无差别） | SSE 活跃时跳过 |
| SSE 心跳间隔 | 30 秒 | 5 秒 |
| 单次心跳数据量 | 14 字节（注释） | 24 字节（命名事件） |
| 故障检测速度 | 5 秒 | 5 秒（SSE 或 HTTP） |
| 空闲时流量 | ~4-6 KB/分钟 | ~0.3 KB/分钟（仅心跳） |

---

## ✅ 验收标准检查

| 标准 | 状态 | 备注 |
|------|------|------|
| 移除 `useNetworkStatus.ts` 中的 fallback 逻辑 | ✅ 通过 | 已移除 `/models` fallback |
| SSE 心跳间隔改为 5 秒 | ✅ 通过 | `stream.controller.js:236` |
| SSE 连接活跃时跳过 HTTP Health Check | ✅ 通过 | `useNetworkStatus.ts:107-111` |
| 前端能正确监听 SSE 心跳并更新状态 | ✅ 通过 | `ChatView.vue:242-244` |
| 无 SSE 连接时仍能通过 HTTP Health Check 检测后端 | ✅ 通过 | `useNetworkStatus.ts:106-113` |

---

## 🔧 测试清单

- [ ] 后端启动后访问 `/api/health` 返回正常
- [ ] SSE 连接建立后收到 `connected` 事件
- [ ] SSE 连接后每 5 秒收到 `heartbeat` 事件
- [ ] SSE 活跃时前端不再发起 HTTP Health Check
- [ ] 关闭 SSE 连接后恢复 HTTP Health Check
- [ ] 后端停止后前端正确显示离线状态
- [ ] 后端恢复后 SSE 自动重连
- [ ] 多标签页同时使用时状态正确

---

## 📝 审计结论

**总体评价**: 🟡 **可以合并，但建议修复高优先级问题**

本次优化实现了预期目标，代码质量良好，SSE 心跳机制和 HTTP Health Check 的混合策略设计合理。但存在以下需要关注的问题：

1. **必须修复**: Token 通过 URL 传递的安全风险
2. **建议修复**: 后端 Promise 内存问题、连接数限制

---

## 📝 备注

- SSE 心跳使用命名事件 `event: heartbeat` 而非注释 `: heartbeat`，因为 EventSource 无法监听注释
- 全局变量 `lastSSEHeartbeatTime` 和 `sseConnectionCount` 用于跨组件共享状态
- 建议后续将 SSE 状态管理迁移到 Pinia store

---

## 🔗 相关链接

- 任务文档: [README.md](./README.md)
- **解决方案: [solution.md](./solution.md)**

---

*审查完成于 2026-03-01 亲爱的* 💪✨
