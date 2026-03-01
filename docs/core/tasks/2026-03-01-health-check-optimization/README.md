# Health Check 与 SSE 心跳优化

> 创建日期: 2026-03-01
> 状态: 进行中
> 分支: feature/health-check-optimization

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

- [ ] 移除 `useNetworkStatus.ts` 中的 fallback 逻辑
- [ ] SSE 心跳间隔改为 5 秒
- [ ] SSE 连接活跃时跳过 HTTP Health Check
- [ ] 前端能正确监听 SSE 心跳并更新状态
- [ ] 无 SSE 连接时仍能通过 HTTP Health Check 检测后端

---

## 📝 技术方案

### 1. 后端改动

**文件：** `server/controllers/stream.controller.js`

```javascript
// 心跳保活 - 从 30 秒改为 5 秒
const heartbeat = setInterval(() => {
 if (ctx.res.writableEnded) {
 clearInterval(heartbeat);
 return;
 }
 ctx.res.write(': heartbeat\n\n');
}, 5000); // 改为 5 秒
```

### 2. 前端改动

**文件：** `frontend/src/composables/useNetworkStatus.ts`

```typescript
// 移除 fallback 逻辑
const checkHealth = async (): Promise<boolean> => {
 // ... 直接调用 /health，不再 fallback 到 /models
};

// 新增：SSE 连接状态追踪
let sseConnected = false;
let lastHeartbeatTime: number | null = null;

// 监听 SSE 心跳
const onSSEHeartbeat = () => {
 lastHeartbeatTime = Date.now();
 isBackendAvailable.value = true;
};

// 优化 Health Check 策略
const startHealthCheck = () => {
 checkTimer = setInterval(() => {
 // SSE 连接活跃且最近收到心跳，跳过 HTTP 检查
 if (sseConnected && lastHeartbeatTime && 
 Date.now() - lastHeartbeatTime < 10000) {
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
| 空闲时流量 | ~4-6 KB/分钟 | ~0.2 KB/分钟（仅心跳） |

---

## 📁 相关文件

| 文件 | 改动 |
|------|------|
| `server/controllers/stream.controller.js` | 心跳间隔 30s → 5s |
| `frontend/src/composables/useNetworkStatus.ts` | 移除 fallback，SSE 活跃时跳过 HTTP 检查 |
| `frontend/src/views/ChatView.vue` | 暴露 SSE 心跳状态（可选） |

---

## 🔗 相关链接

- Code Review: [review.md](./review.md)
