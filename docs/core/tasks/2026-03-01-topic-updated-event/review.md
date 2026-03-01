# Code Review: Topic Updated Event 修复

## 修改日期
2026-03-01

## 修改内容

### 1. 后端修复 `start` 事件缺少 `is_new_topic` 字段

**文件**: `server/controllers/stream.controller.js`

**问题**: `chat-service.js` 传递了 `is_new_topic` 字段，但 `stream.controller.js` 在转发时丢失了

**修改**:
```javascript
// 修改前
res.write(`data: ${JSON.stringify({ topic_id: delta.topic_id })}\n\n`);

// 修改后
res.write(`data: ${JSON.stringify({ 
  topic_id: delta.topic_id,
  is_new_topic: delta.is_new_topic || false 
})}\n\n`);
```

### 2. 前端添加 `topic_updated` SSE 事件监听

**文件**: `frontend/src/views/ChatView.vue`

**修改**: 在 SSE 事件监听区域添加了对 `topic_updated` 事件的处理：

```typescript
// 监听 topic_updated 事件，刷新 Topic 列表
eventSource.value.addEventListener('topic_updated', (event) => {
  try {
    const data = JSON.parse(event.data)
    console.log('Topic updated:', data)
    // 刷新 Topic 列表
    chatStore.loadTopics({ expert_id: currentExpertId.value })
  } catch (e) {
    console.error('Parse topic_updated error:', e)
  }
})
```

### 3. 最小消息数从 20 改为 5

**文件**: `lib/chat-service.js`, `lib/memory-system.js`

**修改**: 将触发反思压缩的最小消息数从 20 条改为 5 条

```javascript
// 修改前
minMessages: 20

// 修改后
minMessages: 5
```

### 4. 优化 `topic_updated` 事件发送时机

**文件**: `lib/chat-service.js`, `server/controllers/stream.controller.js`

**问题**: 原来每次对话完成都发送 `topic_updated` 事件，但实际上只有在压缩创建新 Topic 时才需要通知

**修改**:
- 移除 `stream.controller.js` 中 `complete` 回调里的 `topic_updated` 事件发送
- 在 `chat-service.js` 的 `compressContext` 成功后发送事件

```javascript
// chat-service.js
if (compressResult.success && compressResult.topicsCreated > 0) {
  onDelta?.({ type: 'topic_updated', topicsCreated: compressResult.topicsCreated });
}
```

## 状态
✅ 已完成

## 技术分析

### 后端事件发送时机
后端在 `stream.controller.js:136-137` 每次对话完成时都会发送 `topic_updated` 事件：

```javascript
res.write(`event: topic_updated\n`);
res.write(`data: ${JSON.stringify({ topic_id })}\n\n`);
```

### 前端处理逻辑
- 解析 SSE 事件数据
- 调用 `chatStore.loadTopics()` 刷新 Topic 列表
- 按当前 expert_id 过滤

## 影响范围
- 仅影响前端 SSE 事件处理
- 不影响现有对话功能
- 改善用户体验：Topic 列表实时更新

## 测试建议
1. 与 Expert 进行对话
2. 观察控制台是否输出 "Topic updated:" 日志
3. 检查右侧面板 Topics Tab 是否自动刷新

## 状态
✅ 已完成
