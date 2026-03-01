# Topic Updated Event 修复

## 问题描述

### 问题 1: 前端未监听 `topic_updated` 事件
后端在 `stream.controller.js` 发送了 `topic_updated` SSE 事件，但前端没有监听这个事件，导致 Topic 列表在某些场景下不及时更新。

### 问题 2: `start` 事件缺少 `is_new_topic` 字段
`chat-service.js` 传递了 `is_new_topic` 字段，但 `stream.controller.js` 在转发时丢失了，导致前端无法判断是否是新创建的 Topic。

### 问题 3: 反思压缩阈值过高
原来需要 20 条消息才触发反思压缩，用户希望改为 5 条。

### 问题 4: 每次对话完成都发送 `topic_updated` 事件
原来每次对话完成都发送事件，但实际上只有在压缩创建新 Topic 时才需要通知前端。

## 解决方案

1. 在 `ChatView.vue` 的 SSE 事件监听中添加对 `topic_updated` 事件的处理
2. 修复 `stream.controller.js` 中 `start` 事件，添加 `is_new_topic` 字段
3. 将最小消息数从 20 改为 5
4. 移除每次对话完成都发送的 `topic_updated` 事件，只在 `compressContext` 成功创建 Topic 时才发送

## 验收标准

- [x] 后端 `start` 事件正确传递 `is_new_topic` 字段
- [x] 前端正确监听 `topic_updated` SSE 事件
- [x] 最小消息数改为 5 条
- [x] 只在压缩创建新 Topic 时才发送 `topic_updated` 事件
- [x] 不影响现有的对话功能

## 相关文件

- `frontend/src/views/ChatView.vue` - 添加 SSE 事件监听
- `server/controllers/stream.controller.js` - 修复事件发送逻辑
- `lib/chat-service.js` - 修改压缩阈值和事件触发
- `lib/memory-system.js` - 修改默认压缩阈值
