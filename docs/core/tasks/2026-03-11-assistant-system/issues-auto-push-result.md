# 助理系统问题修复: 自动推送结果

> **记录日期**: 2026-03-15
> **问题发现**: Claude Code + User
> **任务**: 修复助理委托结果自动推送给专家的问题

---

## 问题清单

| # | 问题 | 严重程度 | 状态 |
|---|------|----------|------|
| 1 | 助理执行错误时没有返回给专家 | 🔴 高 | ✅ 已修复 |
| 2 | 专家一直在轮询，而不是立即回复用户 | 🔴 高 | ✅ 已修复 |
| 3 | 预估时间无法准确预测，应该移除 | 🟡 中 | ✅ 已修复 |
| 4 | 工具返回内容不够清晰 | 🟡 中 | ✅ 已修复 |
| 5 | 活跃话题的 topic_id 为 NULL，查询消息失败 | 🔴 高 | ✅ 已修复 |
| 6 | Expert 上下文不包含 assistant 消息 | 🔴 高 | ✅ 已修复 |
| 7 | Expert 收到助理结果后不立即执行工具 | 🔴 高 | ❌ 未修复 |

---

## 问题详情与修复

### 问题 1: 助理执行错误时没有返回给专家

**位置**: `server/services/assistant-manager.js`

**问题描述**:
- 在 `executeRequest` 方法中，只有成功执行时才会调用 `notifyExpertResult`
- 当执行出错时（catch 块），只更新了数据库状态，但没有通知专家

**修复方案**:
```javascript
// 在 catch 块中也调用 notifyExpertResult
this.notifyExpertResult({
  ...failedRequest,
  status: 'failed',
  error_message: error.message,
}).catch(err => {
  logger.error(`[AssistantManager] 通知 Expert 失败: ${requestId}`, err.message);
});
```

**状态**: ✅ 已修复

---

### 问题 2: 专家一直在轮询

**位置**: `server/services/assistant-manager.js`, `lib/tool-manager.js`

**问题描述**:
- 工具返回的 message 包含"预计 X 秒完成"，暗示需要等待
- LLM 收到这个消息后会持续轮询状态

**修复方案**:
1. 移除 `assistant_status` 工具
2. 修改 `assistant_summon` 返回值，不包含预估时间
3. 工具描述中明确说明"不要轮询"

```javascript
// 修改后的返回值
return {
  request_id: requestId,
  message: '任务已提交，助理执行完结果会返回，请勿轮询',
};
```

**状态**: ✅ 已修复

---

### 问题 3: 预估时间无法准确预测

**问题描述**:
- 数据库有 `estimated_time` 字段（默认值 30 秒）
- 前端显示"预计等待: ~{time} 秒"
- 实际上根本无法准确预估执行时间

**修复方案**:
- 修改 `assistant_summon` 返回值，移除 `estimated_time` 字段
- 消息内容不再提示预估时间

**状态**: ✅ 已修复

---

### 问题 4: 工具返回内容不够清晰

**问题描述**:
- 当前返回 `request_id`, `status: 'pending'`, `estimated_time`, `message`
- 专家不知道如何使用 `request_id`
- `status: 'pending'` 暗示需要查询

**修复方案**:
```javascript
// 简化返回值
return {
  request_id: requestId,
  message: '任务已提交，助理执行完结果会返回，请勿轮询',
};
```

**状态**: ✅ 已修复

---

### 问题 5: 活跃话题的 topic_id 为 NULL，查询消息失败

**位置**: `server/services/assistant-manager.js`, `server/controllers/internal.controller.js`

**问题描述**:
- 活跃话题的消息 `topic_id` 为 NULL（未归档状态）
- 已归档话题的消息有 `topic_id`
- `notifyExpertResult` 查询历史消息时使用 `topic_id` 查询，活跃话题查不到

**修复方案**:
1. 在 `notifyExpertResult` 中检查话题状态
2. 根据话题状态选择查询方式：
   - 活跃话题：通过 `user_id + expert_id` 查询
   - 已归档话题：通过 `topic_id` 查询

```javascript
// 检查话题状态
const topic = await this.Topic.findByPk(finalTopicId, { raw: true });
const isTopicActive = topic?.status === 'active';

// 根据状态选择查询方式
if (isTopicActive) {
  messageWhere = { user_id: finalUserId, expert_id: finalExpertId };
} else {
  messageWhere = { topic_id: finalTopicId };
}
```

**状态**: ✅ 已修复

---

### 问题 6: Expert 上下文不包含 assistant 消息

**位置**: `server/controllers/internal.controller.js`

**问题描述**:
- 之前assistant 结果消息设置了 `topic_id`（与用户消息不一致）
- 导致查询时结果消息不在上下文中

**修复方案**:
- 所有消息统一使用 `topic_id: null`（未归档状态）

```javascript
// 创建消息时不分配 topic_id
const message = await this.Message.create({
  id: messageId,
  topic_id: null,  // 未归档状态，与用户消息和 Expert 回复保持一致
  ...
});
```

**状态**: ✅ 已修复

---

### 问题 7: Expert 收到助理结果后不立即执行工具

**位置**: `server/services/assistant-manager.js`

**问题描述**:
- 助理结果作为**普通文本消息**插入（role: 'assistant'）
- 消息内容包含 "⚡【立即执行】" 标记
- Expert 看到消息后**先回复用户**而不是**立即执行工具**

**原因分析**:
- 助理消息是普通文本消息，不是 tool_result 格式
- Expert 不知道要调用什么工具
- LLM 默认行为是"先回复用户"

**期望行为**:
```
Expert 收到助理消息
    ↓
识别出需要执行工具（如保存文件）
    ↓
立即调用工具执行
    ↓
工具执行完成后再回复用户
```

**实际行为**:
```
Expert 收到助理消息
    ↓
回复用户"好的，我现在去保存"
    ↓
用户问"为啥不保存啊！"
    ↓
Expert 才执行工具
```

**修复建议**:
将助理结果作为 **tool_result** 插入，而不是普通消息。这样 Expert 收到后会认为需要执行后续工具。

**状态**: ❌ 未修复

---

## 相关文件

| 文件 | 修改内容 |
|------|----------|
| `server/services/assistant-manager.js` | 添加自动推送、话题状态检查、错误通知 |
| `lib/chat-service.js` | 传递 topic_id 到 handleToolCalls |
| `server/controllers/internal.controller.js` | 消息 topic_id 统一为 NULL |
| `lib/tool-manager.js` | 移除 assistant_status 工具 |

---

## 总结

### 已修复问题

| 问题 | 状态 | 修复说明 |
|------|------|----------|
| 助理执行错误时没有返回给专家 | ✅ | 错误时也调用 notifyExpertResult |
| 专家一直在轮询 | ✅ | 移除 assistant_status 工具 |
| 预估时间无法准确预测 | ✅ | 移除 estimated_time 相关代码 |
| 工具返回内容不够清晰 | ✅ | 简化返回值 |
| 活跃话题 topic_id 为 NULL | ✅ | 根据话题状态选择查询方式 |
| 上下文不包含 assistant 消息 | ✅ | 统一使用 topic_id: null |

### 待解决问题

| 问题 | 状态 | 说明 |
|------|------|------|
| Expert 收到助理结果后不立即执行 | ❌ | 需要改为 tool_result 格式 |

---

## 下一步

实现问题 7 的修复：将助理结果作为 tool_result 插入 Expert 上下文，触发 Expert 自动执行后续工具。
