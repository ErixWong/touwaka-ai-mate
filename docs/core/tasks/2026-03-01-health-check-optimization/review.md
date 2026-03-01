# Code Review: Health Check 与 SSE 心跳优化

> 提交: `pending` - Health Check 与 SSE 心跳优化
> 审查日期: 2026-03-01

## 📋 变更概览

| 文件 | 变更 |
|------|------|
| `server/controllers/stream.controller.js` | 心跳间隔 30s → 5s，改为命名事件 |
| `frontend/src/composables/useNetworkStatus.ts` | 移除 fallback，新增 SSE 心跳追踪 |
| `frontend/src/views/ChatView.vue` | 集成 SSE 心跳监听 |

---

## ✅ 优点

1. **减少 HTTP 请求**：SSE 活跃时跳过 HTTP Health Check
2. **快速故障检测**：心跳间隔从 30s 缩短到 5s
3. **移除冗余 fallback**：health 端点不存在就是问题，不需要 fallback
4. **全局状态管理**：SSE 心跳状态跨组件共享

---

## 📊 性能对比

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| HTTP 请求频率 | 每 5 秒（无差别） | SSE 活跃时跳过 |
| SSE 心跳间隔 | 30 秒 | 5 秒 |
| 单次心跳数据量 | 14 字节（注释） | 24 字节（命名事件） |
| 故障检测速度 | 5 秒 | 5 秒（SSE 或 HTTP） |

---

## 🔧 测试清单

- [ ] 后端启动后访问 `/api/health` 返回正常
- [ ] SSE 连接建立后收到 `connected` 事件
- [ ] SSE 连接后每 5 秒收到 `heartbeat` 事件
- [ ] SSE 活跃时前端不再发起 HTTP Health Check
- [ ] 关闭 SSE 连接后恢复 HTTP Health Check
- [ ] 后端停止后前端正确显示离线状态

---

## 📝 备注

- SSE 心跳使用命名事件 `event: heartbeat` 而非注释 `: heartbeat`，因为 EventSource 无法监听注释
- 全局变量 `lastSSEHeartbeatTime` 和 `sseConnectionCount` 用于跨组件共享状态
