# Code Review: Topic Updated Event 修复

## 修改日期
2026-03-01

## 修改概述

本次修改解决了 Topic 列表更新的多个问题：
1. 前端未监听 `topic_updated` SSE 事件
2. `start` 事件缺少 `is_new_topic` 字段
3. 反思压缩阈值过高（20条→5条）
4. 每次对话完成都发送 `topic_updated` 事件（改为只在压缩时发送）
5. 添加手动触发压缩功能

---

## 文件修改清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `lib/chat-service.js` | 修改 | 压缩阈值改为5，添加压缩成功事件 |
| `lib/memory-system.js` | 修改 | 默认压缩阈值改为5 |
| `server/controllers/stream.controller.js` | 修改 | 添加 is_new_topic 字段，添加 topic_updated 事件处理 |
| `server/controllers/topic.controller.js` | 修改 | 添加 compress 方法 |
| `server/routes/topic.routes.js` | 修改 | 添加 /compress 路由 |
| `server/index.js` | 修改 | TopicController 注入 chatService |
| `frontend/src/views/ChatView.vue` | 修改 | 添加 topic_updated 事件监听 |
| `frontend/src/components/panel/TopicsTab.vue` | 修改 | 刷新按钮触发压缩 API |
| `frontend/src/api/services.ts` | 修改 | 添加 topicApi.compress() |

---

## Code Review 详情

### 1. 后端 - `server/controllers/topic.controller.js`

**新增 `compress` 方法**

```javascript
async compress(ctx) {
  const { expert_id } = ctx.request.body || {};
  const userId = ctx.state.userId;

  // 获取用户的所有专家
  const experts = await this.db.models.expert_user.findAll({
    where: { user_id: userId },
    attributes: ['expert_id'],
    raw: true,
  });

  const expertIds = experts.map(e => e.expert_id);
  const targetExpertIds = expert_id ? [expert_id] : expertIds;

  const results = [];
  for (const eid of targetExpertIds) {
    try {
      const expertService = await this.chatService.getExpertService(eid);
      const result = await expertService.checkAndCompressContext(userId);
      results.push({ expert_id: eid, ...result });
    } catch (err) {
      results.push({ expert_id: eid, success: false, error: err.message });
    }
  }

  ctx.success({ message: '压缩检查完成', results });
}
```

**评价**：
- ✅ 正确处理了可选的 `expert_id` 参数
- ✅ 遍历所有专家时捕获单个错误，不影响其他专家的处理
- ✅ 返回详细的结果列表

**潜在问题**：
- ⚠️ 如果用户有很多专家，串行处理可能较慢。可以考虑 `Promise.all` 并行处理
- ⚠️ 没有检查用户是否有权限访问这些专家

### 2. 前端 - `frontend/src/components/panel/TopicsTab.vue`

**刷新按钮逻辑**

```typescript
const handleRefresh = async () => {
  try {
    isCompressing.value = true
    const result = await topicApi.compress()
    console.log('Compress result:', result)
    await loadTopics()
  } catch (error) {
    console.error('Failed to compress topics:', error)
  } finally {
    isCompressing.value = false
  }
}
```

**评价**：
- ✅ 正确使用 `isCompressing` 状态控制按钮禁用
- ✅ 正确处理错误情况
- ✅ 使用 `finally` 确保状态重置

**潜在问题**：
- ⚠️ 没有向用户显示压缩结果（成功/失败/创建了多少Topic）
- ⚠️ `console.log` 应该在生产环境中移除

### 3. SSE 事件处理 - `frontend/src/views/ChatView.vue`

```typescript
eventSource.value.addEventListener('topic_updated', (event) => {
  try {
    const data = JSON.parse(event.data)
    console.log('Topic updated:', data)
    chatStore.loadTopics({ expert_id: currentExpertId.value })
  } catch (e) {
    console.error('Parse topic_updated error:', e)
  }
})
```

**评价**：
- ✅ 正确解析 JSON
- ✅ 正确处理错误

### 4. 后端事件发送 - `lib/chat-service.js`

```javascript
if (compressResult.success && compressResult.topicsCreated > 0) {
  onDelta?.({ type: 'topic_updated', topicsCreated: compressResult.topicsCreated });
}
```

**评价**：
- ✅ 只在成功创建 Topic 时才发送事件
- ✅ 使用可选链避免空指针

---

## 改进建议

### 1. 并行处理专家压缩

```javascript
// 改进前（串行）
for (const eid of targetExpertIds) {
  const result = await expertService.checkAndCompressContext(userId);
}

// 改进后（并行）
const results = await Promise.allSettled(
  targetExpertIds.map(async (eid) => {
    const expertService = await this.chatService.getExpertService(eid);
    return expertService.checkAndCompressContext(userId);
  })
);
```

### 2. 用户反馈

建议在前端添加压缩结果提示：

```typescript
const result = await topicApi.compress()
if (result.results.some(r => r.topicsCreated > 0)) {
  // 显示 toast 提示：创建了 X 个新 Topic
}
```

### 3. 移除调试日志

生产环境应移除 `console.log` 语句。

---

## 测试建议

1. **单元测试**
   - 测试 `TopicController.compress` 方法
   - 测试压缩阈值改为5后的行为

2. **集成测试**
   - 测试 SSE 事件 `topic_updated` 的发送和接收
   - 测试手动压缩按钮功能

3. **手动测试**
   - 与 Expert 聊天 5 条消息后，检查是否触发压缩
   - 点击刷新按钮，检查 Topic 列表是否更新

---

## 状态

✅ Code Review 完成

## 审查人
Maria 🌸
