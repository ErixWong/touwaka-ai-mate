# 助理系统失败处理简化方案

> 创建时间：2026-04-08
> 状态：设计方案
> 核心原则：不管成功还是失败，结果都必须传递回调用方专家

---

## 1. 问题定义

当前架构的问题：
- 助理执行完成后，**不会主动通知 Expert**
- Expert 需要轮询 `assistant_status` 查询，效率低下
- 助理执行失败时，错误信息没有传递回调用方 Expert

**解决目标**：
1. 助理执行完成后，**主动通知 Expert**
2. 不管成功还是失败，结果都传递给 Expert

---

## 2. 简化方案：消息通知机制

### 2.1 核心设计

**助理执行完成后，自动在 messages 表中插入一条消息，Expert 通过正常消息流收到通知。**

```
助理执行完成（成功或失败）
        ↓
插入 message 到 messages 表
        ↓
Expert 收到消息（通过正常消息流）
        ↓
Expert 处理结果
```

### 2.2 消息格式

**成功时插入的消息：**

```json
{
  "message_id": "msg_xxx",
  "contact_id": "expert_xxx",
  "sender_type": "assistant",
  "sender_id": "req_abc123",
  "content": {
    "type": "assistant_result",
    "request_id": "req_abc123",
    "assistant_type": "ocr",
    "status": "completed",
    "result": "助理执行结果..."
  },
  "created_at": "2024-01-01T10:00:03Z"
}
```

**失败时插入的消息：**

```json
{
  "message_id": "msg_xxx",
  "contact_id": "expert_xxx",
  "sender_type": "assistant",
  "sender_id": "req_abc123",
  "content": {
    "type": "assistant_result",
    "request_id": "req_abc123",
    "assistant_type": "ocr",
    "status": "failed",
    "result": null,
    "error": {
      "message": "执行失败的具体原因"
    }
  },
  "created_at": "2024-01-01T10:00:03Z"
}
```

### 2.3 执行流程

```
Expert 调用 assistant_summon
        ↓
   立即返回 request_id
        ↓
   [助理后台异步执行]
        ↓
   执行完成（成功或失败）
        ↓
   插入 message 到 messages 表
        ↓
   Expert 收到消息通知
        ↓
   Expert 处理结果（成功使用结果，失败处理错误）
```

### 2.4 Expert 收到消息后的处理

```javascript
// Expert 收到 assistant_result 消息
function onMessage(message) {
  if (message.content.type === 'assistant_result') {
    const { request_id, status, result, error } = message.content;
    
    if (status === 'completed') {
      // 成功：使用 result
      console.log('助理执行成功:', result);
    } else {
      // 失败：处理 error
      console.error('助理执行失败:', error.message);
      // Expert 自己决定：重试、换方案、告诉用户、忽略...
    }
  }
}
```

---

## 3. 实施步骤

| 步骤 | 任务 | 文件 | 时间 | 状态 |
|------|------|------|------|------|
| 1 | 修改 `notifyExpertResult` 插入消息到 messages 表 | `server/services/assistant/expert-notifier.js` | 30min | ✅ 已完成 |
| 2 | 修复 `chatService` 未使用问题 | `server/services/assistant/expert-notifier.js` | 5min | ✅ 已完成 |
| 3 | 修复 `result` 可能为 undefined 问题 | `server/services/assistant/expert-notifier.js` | 5min | ✅ 已完成 |
| 4 | 更新 `triggerExpertResponse` 注释 | `server/services/assistant/expert-notifier.js` | 5min | ✅ 已完成 |
| 5 | 移除未使用的 `constructedUserMessage` | `server/services/assistant/expert-notifier.js` | 5min | ✅ 已完成 |
| 6 | 修正消息角色逻辑 | `server/services/assistant/expert-notifier.js` | 10min | ✅ 已完成 |
| 7 | 修改 `resendNotification` 重发逻辑 | `server/services/assistant/expert-notifier.js` | 10min | ✅ 已完成 |
| 8 | 测试验证 | - | 20min | ⏳ 待测试 |

**总计：约 1.5 小时**

### 重发行为确认

**重发时**：
- ❌ 不插入新消息到 messages 表
- ✅ 触发 LLM 响应

这样 Expert 可以重新处理之前的结果，而不会产生重复的消息记录。

---

## 4. 关键代码修改

### 4.1 执行完成后插入消息

```javascript
// services/assistant-manager.js
async executeRequest(requestId) {
  const request = await this.db.assistant_requests.findByPk(requestId);
  
  try {
    // ... 执行助理逻辑 ...
    const result = await this.runAssistant(request);
    
    // 更新状态为完成
    await request.update({
      status: 'completed',
      result: result,
      completed_at: new Date()
    });
    
    // 插入成功消息到 messages 表
    await this.insertResultMessage(request, 'completed', result);
    
  } catch (error) {
    // 更新状态为失败
    await request.update({
      status: 'failed',
      error_message: error.message,
      completed_at: new Date()
    });
    
    // 插入失败消息到 messages 表
    await this.insertResultMessage(request, 'failed', null, error.message);
  }
}

// 插入结果消息到 messages 表
async insertResultMessage(request, status, result, errorMessage = null) {
  const messageContent = {
    type: 'assistant_result',
    request_id: request.request_id,
    assistant_type: request.assistant_type,
    status: status,
    result: result,
    error: errorMessage ? { message: errorMessage } : null
  };
  
  await this.db.messages.create({
    message_id: generateId(),
    contact_id: request.expert_id,  // 发送给调用方 Expert
    sender_type: 'assistant',
    sender_id: request.request_id,
    content: JSON.stringify(messageContent),
    created_at: new Date()
  });
  
  // 触发消息通知（通过 WebSocket 或 SSE）
  await this.notifyExpert(request.expert_id, messageContent);
}
```

---

## 5. 方案对比

| 方案 | 复杂度 | 实施时间 | 优点 | 缺点 |
|------|--------|----------|------|------|
| **消息通知（推荐）** | 低 | 1 小时 | 符合现有消息流，Expert 实时收到 | 需要修改 messages 表插入逻辑 |
| assistant_wait 阻塞 | 低 | 1.5 小时 | 简单直接 | Expert 需要阻塞等待 |
| 回调机制 | 中 | 半天 | 灵活 | 需要修改工具调用机制 |
| 消息总线 | 高 | 1-2 天 | 解耦 | 引入新组件 |

**推荐**：消息通知方案，利用现有的 messages 表和消息流机制，Expert 通过正常消息接收机制实时收到助理执行结果。

---

## 6. 说明

- 使用数据库表已有的 `error_message` 字段（在原设计中已定义）
- 使用现有的 `messages` 表插入消息
- 复用现有的消息通知机制（WebSocket/SSE）
- **核心改动**：助理执行完成后，自动插入一条 `assistant_result` 消息

---

*创建时间: 2026-04-08*
*状态: 简化设计方案 v4（消息通知机制）* 
