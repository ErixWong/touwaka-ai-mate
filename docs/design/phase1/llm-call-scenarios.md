# LLM 调用场景汇总

> 最后更新：2026-02-23

本文档梳理了系统中所有调用 LLM 的场景，帮助理解系统架构和优化重试策略。

## 调用场景一览

| # | 场景 | 文件 | 方法 | 触发时机 | 重要性 |
|---|------|------|------|----------|--------|
| 1 | 对话（主流程） | `chat-service.js` | `callStream()` / `call()` | 用户发送消息 | ⭐⭐⭐ 高 |
| 2 | 反思心智 | `reflective-mind.js` | `callReflective()` | 每次对话后 | ⭐⭐ 中 |
| 3 | 历史归档-总结 | `memory-system.js` | `callExpressive()` | 消息数 >= 6 | ⭐ 低 |
| 4 | 历史归档-匹配 | `memory-system.js` | `callExpressive()` | 消息数 >= 6 | ⭐ 低 |
| 5 | 话题检测 | `topic-detector.js` | `callExpressive()` | 检测话题切换 | ⭐ 低 |

---

## 详细说明

### 1. 对话（主流程）

**文件位置：** [`lib/chat-service.js`](../../../lib/chat-service.js)

**调用方法：**
- 流式：`llmClient.callStream()` (第 145 行)
- 非流式：`llmClient.call()` (第 322, 334, 341, 678 行)

**触发时机：** 用户发送消息时

**功能说明：**
- 生成 AI 回复
- 支持工具调用（Function Calling）
- 流式输出到前端

**重要性：** ⭐⭐⭐ 高（核心功能）

**重试策略：** 需要完整重试（3 次），保证用户体验

---

### 2. 反思心智（Reflective Mind）

**文件位置：** [`lib/reflective-mind.js`](../../../lib/reflective-mind.js)

**调用方法：** `llmClient.callReflective()` (第 61 行)

**触发时机：** 每次对话生成回复后

**功能说明：**
- 生成内心独白（Inner Voice）
- 自我评价回复质量
- 为下一轮对话提供建议

**重要性：** ⭐⭐ 中（增强体验，非必需）

**重试策略：** 2 次重试即可，失败不影响主流程

---

### 3. 历史归档 - 对话总结

**文件位置：** [`lib/memory-system.js`](../../../lib/memory-system.js)

**调用方法：** `llmClient.callExpressive()` → `summarizeConversation()` (第 489 行)

**触发时机：** 历史消息归档时（消息数 >= 6 条）

**功能说明：** **一次 LLM 调用同时完成以下任务：**
- 生成话题标题（topicName，8-15 字）
- 生成话题描述（topicDescription，30-60 字）
- 提取关键词（keywords）
- 分类（category）
- 生成用户画像（userProfile）
- 提取用户信息（userInfo：性别/年龄/称呼偏好/职业/所在地）

**重要性：** ⭐ 低（后台任务）

**重试策略：** 1 次重试，失败使用默认标题

---

### 4. 历史归档 - Topic 匹配

**文件位置：** [`lib/memory-system.js`](../../../lib/memory-system.js)

**调用方法：** `llmClient.callExpressive()` → `matchOrCreateTopic()` (第 567 行)

**触发时机：** 历史消息归档时（在 `summarizeConversation` 之后）

**功能说明：**
- 判断新对话是否属于现有 Topic
- 决定是追加到现有 Topic 还是创建新 Topic

**重要性：** ⭐ 低（后台任务）

**重试策略：** 1 次重试，失败默认创建新 Topic

---

### 5. 话题检测

**文件位置：** [`lib/topic-detector.js`](../../../lib/topic-detector.js)

**调用方法：** `llmClient.callExpressive()` → `detectTopicShift()` (第 47 行)

**触发时机：** 检测话题切换时（需要 >= 6 条消息）

**功能说明：**
- 判断用户是否开启了新话题
- 生成建议的话题标题

**重要性：** ⭐ 低（优化功能）

**重试策略：** 1 次重试，失败默认不切换

---

## 重试策略建议

不同场景对重试的需求不同，建议差异化处理：

| 场景 | 重试次数 | 间隔 | 失败处理 |
|------|---------|------|----------|
| 对话（主流程） | 3 次 | 10s, 20s, 40s | 报错给用户 |
| 反思心智 | 2 次 | 10s, 20s | 跳过反思 |
| 后台任务（归档/话题） | 1 次 | 10s | 使用默认值 |

### 实现方式

可以通过 `options` 参数传递重试配置：

```javascript
// 对话主流程
await llmClient.callWithRetry(model, messages, { 
  maxRetries: 3,
  retryDelay: 10000  // 起始间隔 10s
});

// 反思心智
await llmClient.callWithRetry(model, messages, { 
  maxRetries: 2,
  retryDelay: 10000
});

// 后台任务
await llmClient.callWithRetry(model, messages, { 
  maxRetries: 1,
  retryDelay: 10000
});
```

---

## 调用流程图

```
用户发送消息
    │
    ▼
┌─────────────────────────────────────┐
│  1. 对话（主流程）                    │
│     - 生成回复                       │
│     - 工具调用（如有）                │
│     - LLM 调用: 1 次                 │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  2. 反思心智                         │
│     - 生成内心独白                   │
│     - 自我评价                       │
│     - LLM 调用: 1 次                 │
└─────────────────────────────────────┘
    │
    ▼ (消息数 >= 6)
┌─────────────────────────────────────┐
│  3. 历史归档                         │
│     ├─ summarizeConversation()      │
│     │  - 话题标题/描述/关键词        │
│     │  - 用户画像/用户信息           │
│     │  - LLM 调用: 1 次             │
│     │                               │
│     └─ matchOrCreateTopic()         │
│        - Topic 匹配判断             │
│        - LLM 调用: 1 次             │
│                                     │
│  总计 LLM 调用: 2 次                 │
└─────────────────────────────────────┘
```

---

## LLM 调用次数统计

| 触发场景 | LLM 调用次数 | 说明 |
|---------|-------------|------|
| 用户发送消息 | 1 次 | 对话主流程 |
| 对话完成后 | 1 次 | 反思心智 |
| 历史归档时 | 2 次 | 总结 + Topic 匹配 |
| 话题检测时 | 1 次 | 检测话题切换 |

**单次对话最多触发：** 1 + 1 + 2 = **4 次 LLM 调用**（对话 + 反思 + 归档）

---

## 相关文档

- [LLM Client 设计](../../../lib/llm-client.js) - LLM 调用客户端
- [双心智架构](./architecture-analysis-report.md) - Expressive Mind + Reflective Mind
- [记忆系统](../../../lib/memory-system.js) - 历史归档实现
