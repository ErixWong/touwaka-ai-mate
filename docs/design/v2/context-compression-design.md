# 上下文压缩与话题总结设计 v2

> 最后更新：2026-02-23

## 核心理念

**消息与 Topic 的关系：**
- 新消息的 `topic_id` 为 **NULL**（未归档状态）
- 压缩时：识别话题 → 创建 Topic → 批量更新 `topic_id`
- 发送给 LLM 的上下文 = **Topic 总结** + **未归档消息**

```
┌─────────────────────────────────────────────────────────────┐
│ messages 表                                                 │
│                                                             │
│ [已归档] topic_id = "topic_001"  ← 话题：React性能优化       │
│ [已归档] topic_id = "topic_001"                             │
│ [已归档] topic_id = "topic_002"  ← 话题：用户登录方案        │
│ [已归档] topic_id = "topic_002"                             │
│ [未归档] topic_id = NULL         ← 最近对话（待压缩）        │
│ [未归档] topic_id = NULL                                    │
│ [未归档] topic_id = NULL                                    │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

## 上下文结构

发送给 LLM 的上下文：

```
┌─────────────────────────────────────────────────────────────┐
│ 1. System Prompt（系统提示词）                               │
│    - 专家人设、行为准则等                                    │
│    - 约 2-5k tokens                                         │
├─────────────────────────────────────────────────────────────┤
│ 2. Topic Summaries（话题总结）                               │
│    - 从 topics 表加载，按时间倒序                            │
│    - "【话题1】React性能优化：讨论了useMemo..."              │
│    - "【话题2】用户登录方案：对比了JWT和Session..."          │
│    - 约 5-20k tokens                                        │
├─────────────────────────────────────────────────────────────┤
│ 3. Recent Messages（未归档消息）                             │
│    - 从 messages 表加载，topic_id IS NULL                   │
│    - 最近 20-40 轮对话                                      │
│    - 约 10-40k tokens                                       │
└─────────────────────────────────────────────────────────────┘
```

## 流程设计

### 1. 对话流程（主流程）

```
用户发送消息
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. 保存用户消息                                              │
│    - topic_id = NULL（未归档）                               │
│                                                             │
│ 2. 构建上下文                                                │
│    a. 加载 System Prompt                                    │
│    b. 加载 Topic Summaries（topics 表）                      │
│    c. 加载未归档消息（messages WHERE topic_id IS NULL）       │
│    d. 估算 Token 数                                          │
│                                                             │
│ 3. 检查是否需要压缩                                          │
│    - 如果 tokens >= 阈值 × 上下文限制：                       │
│      → 同步执行压缩（阻塞，但必要）                           │
│      → 重新构建上下文                                        │
│                                                             │
│ 4. 调用 LLM                                                  │
│                                                             │
│ 5. 保存助手消息                                              │
│    - topic_id = NULL（未归档）                               │
│                                                             │
│ 6. 返回给前端                                                │
└─────────────────────────────────────────────────────────────┘
    │
    ▼ (后台任务)
┌─────────────────────────────────────────────────────────────┐
│ 后台任务（串行执行）                                          │
│                                                             │
│ 1. 反思心智（每次）                                          │
│    - 生成内心独白                                            │
│    - 更新消息的 inner_voice                                  │
└─────────────────────────────────────────────────────────────┘
```

### 2. 上下文压缩流程

```
compressContext(userId)
    │
    ├─► 1. 获取未归档消息
    │       SELECT * FROM messages 
    │       WHERE expert_id = ? AND user_id = ? AND topic_id IS NULL
    │       ORDER BY created_at ASC
    │
    ├─► 2. 检查是否需要压缩
    │       - 如果消息数 < 最小阈值（如 20 条）：跳过
    │       - 如果 Token 数 < 压缩阈值：跳过
    │
    ├─► 3. 话题识别（LLM 调用）
    │       - 输入：未归档消息列表
    │       - 输出：话题边界 [{ title, startIdx, endIdx, summary }, ...]
    │       - 一次性识别所有话题
    │
    ├─► 4. 创建 Topic 并关联消息
    │       for each topic:
    │         a. 创建 Topic 记录（title, summary）
    │         b. 更新消息的 topic_id
    │            UPDATE messages SET topic_id = ? 
    │            WHERE id IN (...)
    │
    └─► 5. 更新用户信息
            - 从话题总结中提取用户信息
            - 更新 user_profiles 表
```

### 3. 话题识别 Prompt

```javascript
const prompt = `分析以下对话，识别话题并生成总结。

对话内容：
${messages.map((m, i) => `[${i}] ${m.role}: ${m.content}`).join('\n')}

## 任务
1. 识别话题边界（每个话题至少 10 条消息）
2. 为每个话题生成标题和总结
3. 提取用户信息（如果有的话）

## 输出格式（JSON）
{
  "topics": [
    {
      "title": "React性能优化",
      "summary": "讨论了useMemo和useCallback的使用场景...",
      "startIndex": 0,
      "endIndex": 15,
      "keywords": ["React", "性能", "useMemo"]
    },
    {
      "title": "用户登录方案",
      "summary": "对比了JWT和Session的优缺点...",
      "startIndex": 16,
      "endIndex": 30,
      "keywords": ["登录", "JWT", "Session"]
    }
  ],
  "userInfo": {
    "gender": null,
    "occupation": "前端开发者",
    "preferredName": null
  }
}

要求：
- 每个话题至少包含 10 条消息
- 标题简洁（8-15字）
- 总结详细（50-100字）
`;
```

## 数据库设计

### messages 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) | 主键 |
| expert_id | VARCHAR(32) | 专家ID |
| user_id | VARCHAR(32) | 用户ID |
| topic_id | VARCHAR(32) | **NULL = 未归档** |
| role | ENUM | user/assistant |
| content | TEXT | 消息内容 |
| inner_voice | TEXT | 内心独白（JSON） |
| created_at | TIMESTAMP | 创建时间 |

### topics 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) | 主键 |
| expert_id | VARCHAR(32) | 专家ID |
| user_id | VARCHAR(32) | 用户ID |
| title | VARCHAR(100) | 话题标题 |
| summary | TEXT | 话题总结 |
| keywords | JSON | 关键词 |
| message_count | INT | 消息数量 |
| status | ENUM | active/archived |
| created_at | TIMESTAMP | 创建时间 |

### experts 表（新增配置）

```sql
ALTER TABLE experts ADD COLUMN context_threshold DECIMAL(3,2) DEFAULT 0.70 
  COMMENT '上下文压缩阈值（占总上下文比例）';

ALTER TABLE experts ADD COLUMN min_archive_messages INT DEFAULT 20 
  COMMENT '最小归档消息数';
```

## 代码实现

### 1. 保存消息（topic_id = NULL）

```javascript
// chat-service.js
async saveUserMessage(expert_id, user_id, content) {
  const message_id = Utils.newID(20);
  
  await this.Message.create({
    id: message_id,
    expert_id,
    user_id,
    topic_id: null,  // 未归档
    role: 'user',
    content,
  });
  
  return message_id;
}
```

### 2. 构建上下文

```javascript
// context-manager.js
async buildContext(expertId, userId) {
  const messages = [];
  
  // 1. System Prompt
  const systemPrompt = this.buildSystemPrompt();
  messages.push({ role: 'system', content: systemPrompt });
  
  // 2. Topic Summaries
  const topics = await this.db.getTopics(expertId, userId, 10);
  if (topics.length > 0) {
    const summaryText = topics.reverse().map(t => 
      `【${t.title}】${t.summary}`
    ).join('\n\n');
    messages.push({ 
      role: 'system', 
      content: `以下是之前的对话话题总结：\n\n${summaryText}` 
    });
  }
  
  // 3. 未归档消息
  const unarchivedMessages = await this.db.getUnarchivedMessages(expertId, userId, 50);
  messages.push(...unarchivedMessages.map(m => ({
    role: m.role,
    content: m.content,
  })));
  
  return messages;
}
```

### 3. 压缩上下文

```javascript
// memory-system.js
async compressContext(userId, options = {}) {
  const { minMessages = 20, threshold = 0.7 } = options;
  
  // 1. 获取未归档消息
  const unarchivedMessages = await this.db.getUnarchivedMessages(
    this.expertId, userId, 1000
  );
  
  if (unarchivedMessages.length < minMessages) {
    logger.debug(`[MemorySystem] 未归档消息不足 ${minMessages} 条，跳过压缩`);
    return;
  }
  
  // 2. 估算 Token
  const tokens = this.estimateTokens(unarchivedMessages);
  const contextSize = this.getContextSize();
  
  if (tokens < contextSize * threshold) {
    logger.debug(`[MemorySystem] Token 数 ${tokens} 未超阈值，跳过压缩`);
    return;
  }
  
  // 3. 话题识别（LLM 调用）
  const topics = await this.identifyTopics(unarchivedMessages);
  
  // 4. 创建 Topic 并关联消息
  for (const topic of topics) {
    const topicId = Utils.newID(20);
    
    // 创建 Topic
    await this.db.createTopic({
      id: topicId,
      expertId: this.expertId,
      userId,
      title: topic.title,
      summary: topic.summary,
      keywords: topic.keywords,
    });
    
    // 关联消息
    const messageIds = unarchivedMessages
      .slice(topic.startIndex, topic.endIndex + 1)
      .map(m => m.id);
    
    await this.db.updateMessageTopicId(messageIds, topicId);
  }
  
  // 5. 更新用户信息
  // ...
  
  logger.info(`[MemorySystem] 压缩完成: 创建 ${topics.length} 个话题`);
}
```

### 4. 数据库方法

```javascript
// db.js
async getUnarchivedMessages(expertId, userId, limit = 50) {
  return await this.models.message.findAll({
    where: {
      expert_id: expertId,
      user_id: userId,
      topic_id: null,  // 未归档
    },
    order: [['created_at', 'ASC']],
    limit,
    raw: true,
  });
}
```

## LLM 调用次数

| 场景 | 调用次数 | 说明 |
|------|---------|------|
| 每次对话 | 2 次 | 对话 + 反思 |
| 压缩 | 1 次 | 话题识别（批量） |

**压缩频率**：约每 20-40 轮对话触发一次

## 配置建议

| 模型上下文 | 压缩阈值 | 最小归档消息 |
|-----------|---------|-------------|
| 32k | 0.60 | 10 |
| 64k | 0.70 | 15 |
| 128k | 0.70 | 20 |

## 与现有代码的差异

| 项目 | 当前实现 | 新设计 |
|------|---------|--------|
| 新消息 topic_id | 关联到当前 Topic | **NULL** |
| 话题识别时机 | 每次对话前 | **压缩时** |
| 话题识别方式 | 单个检测 | **批量识别** |
| 归档触发 | 消息数 >= 6 | **Token 超阈值** |

## 迁移计划

1. **数据库迁移**：添加专家配置字段
2. **修改消息保存**：topic_id 设为 NULL
3. **修改上下文构建**：加载 Topic 总结 + 未归档消息
4. **实现压缩逻辑**：话题识别 + 批量归档
5. **移除旧逻辑**：checkAndHandleTopicShift、processHistoryIfNeeded

---

## 相关文档

- [后台任务调度器设计](./background-task-scheduler-design.md)
- [LLM 调用场景汇总](../v1/llm-call-scenarios.md)
