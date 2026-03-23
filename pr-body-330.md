## 变更概述

为 `recall` 工具添加关键词搜索话题功能，支持在话题标题、描述、关键词字段中搜索匹配的话题。

## 变更详情

### 1. 数据库层 (`lib/db.js`)
- 新增 `searchTopicsByKeyword(expertId, userId, keyword, limit)` 方法
- 使用 `Op.like` 在 `title`、`description`、`keywords` 字段中搜索关键词

### 2. 记忆系统层 (`lib/memory-system.js`)
- 新增 `searchTopics(userId, keyword, limit)` 方法
- 调用数据库搜索方法

### 3. 工具层 (`lib/tool-manager.js`)
- 将 `recall_topic` 重命名为 `recall`
- 添加 `keyword` 参数和 `message_id` 参数
- 新增 `executeRecall()` 方法，支持四种调用方式：
  1. 提供 `message_id`：获取单条消息完整内容
  2. 提供 `topic_id`：获取话题消息列表
  3. 提供 `keyword`：搜索话题
  4. 无参数：列出最近话题
- 新增 `searchTopics()` 方法实现关键词搜索

### 4. 元数据 (`lib/skill-meta.js`)
- 添加 `recall` 工具元数据定义

## 使用示例

```json
// 搜索包含 "React" 的话题
{
  "keyword": "React",
  "count": 10
}

// 搜索包含 "性能优化" 的话题
{
  "keyword": "性能优化"
}
```

## 关联

Closes #330