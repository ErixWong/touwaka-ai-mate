# 上下文压缩与话题总结重构

**状态：** ✅ 已完成  
**优先级：** 高  
**创建日期：** 2026-02-22
**完成日期：** 2026-02-23

## 描述

重构上下文压缩和话题总结机制，解决当前实现的问题：
- 话题检测阻塞主对话流程
- 归档触发过于频繁（每 6 条消息）
- 新消息立即分配 topic_id，无法真正压缩

## 核心改动

1. **新消息 topic_id = NULL**：保存消息时不分配话题
2. **阈值触发压缩**：Token >= 阈值 × 上下文大小（如 70% of 128k）
3. **批量话题识别**：压缩时 1 次 LLM 调用识别所有话题
4. **上下文结构**：System Prompt + Topic 总结 + 未归档消息

---

## 已完成

### 基础设施
- [x] 数据库迁移：添加 `experts.context_threshold` 字段（默认 0.70）
- [x] Sequelize 模型：重新生成 `models/expert.js`
- [x] 前端类型：`types/index.ts` 添加 `context_threshold` 字段
- [x] 设置界面：`SettingsView.vue` 添加压缩阈值输入框
- [x] 国际化：中/英文翻译

### 核心实现
- [x] 修改 `chat-service.js`：saveUserMessage/saveAssistantMessage 设置 topic_id = NULL
- [x] 添加 `db.js`：getUnarchivedMessages() 方法
- [x] 实现 `memory-system.js`：compressContext() 压缩流程
- [x] 实现 `memory-system.js`：identifyTopics() 话题识别
- [x] 修改 `context-manager.js`：buildContext() 加载 Topic 总结 + 未归档消息
- [x] 添加 `context-manager.js`：buildSystemPromptWithTopics() 和 buildTopicSummaries()

---

## 技术细节

### 上下文结构（发送给 LLM）

```
┌─────────────────────────────────────────────────────────────┐
│ 1. System Prompt（系统提示词）                               │
│    - 专家人设、行为准则等                                    │
├─────────────────────────────────────────────────────────────┤
│ 2. Topic Summaries（话题总结）                               │
│    - 从 topics 表加载，按时间倒序                            │
│    - "【话题1】React性能优化：讨论了useMemo..."              │
├─────────────────────────────────────────────────────────────┤
│ 3. Unarchived Messages（未归档消息）                         │
│    - 从 messages 表加载，topic_id IS NULL                   │
└─────────────────────────────────────────────────────────────┘
```

### 压缩流程

```
compressContext(userId)
    ├─► 1. 获取未归档消息（topic_id IS NULL）
    ├─► 2. 检查是否需要压缩（Token >= 阈值）
    ├─► 3. 话题识别（LLM 调用，批量识别）
    ├─► 4. 创建 Topic 并关联消息
    └─► 5. 更新用户信息
```

### LLM 调用次数

| 场景 | 调用次数 | 说明 |
|------|---------|------|
| 每次对话 | 2 次 | 对话 + 反思 |
| 压缩 | 1 次 | 话题识别（批量） |

---

## 相关文档

- [上下文压缩设计 v2](../../design/v2/context-compression-design.md) ⭐ 核心设计
- [LLM 调用场景分析](../../design/v1/llm-call-scenarios.md) - 5 种 LLM 调用场景
- [后台任务调度器设计](../../design/v2/background-task-scheduler-design.md) - 串行任务执行
