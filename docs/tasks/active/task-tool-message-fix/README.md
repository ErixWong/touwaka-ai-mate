# 修复工具消息未保存的问题

## 问题描述

前端对话页面中的工具调用，工具名称变成了 `unknown_tool`，展开后只有参数没有结果。

## 根本原因

自主任务执行器 (`autonomous-task-executor.js`) 使用了非流式的 `chat` 方法，而 `chat` 方法的工具调用处理不如 `streamChat` 完善：

1. `chat` 方法没有多轮工具调用循环
2. 工具消息保存逻辑不完整

## 修复方案

### 方案选择

经过分析，最佳方案是让自主任务执行器使用 `streamChat` 方法，而不是修复 `chat` 方法：

**优势**：
- `streamChat` 有完整的多轮工具调用循环逻辑
- 每执行完一个工具就保存消息并通知前端
- 与用户对话使用相同的代码路径，保持一致性
- 避免维护两套类似的工具调用逻辑

### 修改内容

修改 `lib/autonomous-task-executor.js`：
- 将 `chatService.chat()` 改为 `chatService.streamChat()`
- 使用 Promise 包装流式调用，等待完成
- 忽略流式事件（后台任务不需要实时反馈）

## 修改的文件

- `lib/autonomous-task-executor.js` - 改用 streamChat 方法
- `lib/chat-service.js` - 保留 chat 方法的工具消息保存修复（作为备用）

## 测试验证

1. 启动后端服务
2. 触发自主任务执行（status='autonomous'）
3. 检查数据库 messages 表，确认有 `role: 'tool'` 的消息
4. 前端对话页面正确显示工具调用信息

## 相关文件

- `lib/chat-service.js` - 核心聊天服务
- `lib/autonomous-task-executor.js` - 自主任务执行器
- `frontend/src/components/ChatWindow.vue` - 前端消息显示组件