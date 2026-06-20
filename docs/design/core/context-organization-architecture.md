# 上下文组织架构梳理

## 概述

Touwaka Mate v2 实现了可插拔的上下文组织策略，通过策略模式支持多种上下文组织方式。

## 架构设计

### 核心接口

```
IContextOrganizer (interface.js)
├── organize(memorySystem, userId, options) → ContextResult
├── getName() → string
└── getDescription() → string
```

### 类层次结构

```
IContextOrganizer (接口)
    └── BaseContextOrganizer (基类)
            ├── FullContextOrganizer (完整上下文策略)
            └── SimpleContextOrganizer (简单上下文策略)
```

### 工厂模式

`ContextOrganizerFactory` 用于注册和获取不同的组织器实例。

---

## 已实现的策略

### 1. FullContextOrganizer (完整上下文策略)

**策略名称**: `full`

**特点**:
- 获取**全部未归档消息**（不限制数量，让上下文压缩机制自动处理）
- 获取最近 **3 条 Inner Voices**（反思心智的自我评估）
- 获取最近 **10 个 Topic 总结**
- 包含用户信息引导提示
- 工具消息内容截断限制: **8000 字符**

**适用场景**:
- 需要完整对话历史的复杂任务
- 专家需要深度理解用户背景
- 需要反思心智持续优化的场景

**数据流**:
```
1. getOrCreateUserProfile() → 确保用户档案存在
2. getUnarchivedMessages(userId, null) → 全部未归档消息
3. getRecentInnerVoices(userId, 3) → 最近 3 条反思
4. getTopics(userId, 10, 'active') → 最近 10 个话题
5. buildBaseSystemPrompt() → 构建系统提示
6. buildMessages() → 构建 LLM 消息数组
```

### 2. SimpleContextOrganizer (简单上下文策略)

**策略名称**: `simple`

**特点**:
- 获取最近 **10 条消息**
- 获取最近 **5 个 Topic 总结**
- **不包含 Inner Voices**（减少 token 消耗）
- 包含用户信息引导提示
- 工具消息内容截断限制: **3000 字符**

**适用场景**:
- 轻量级对话场景
- 需要快速响应的场景
- token 预算有限的情况

**数据流**:
```
1. getOrCreateUserProfile() → 确保用户档案存在
2. getUnarchivedMessages(userId, 10) → 最近 10 条消息
3. getRecentInnerVoices(userId, 2) → 可选，默认不获取
4. getTopics(userId, 5, 'active') → 最近 5 个话题
5. buildBaseSystemPrompt() → 构建系统提示
6. buildMessages() → 构建 LLM 消息数组
```

---

## 系统提示构建流程

`buildBaseSystemPrompt()` 按以下顺序构建系统提示：

1. **基础系统提示** - 专家的 `prompt_template` 或 `system_prompt`
2. **当前时间** - 中国标准时间（CST, UTC+8）
3. **Soul 增强** - 核心价值观、行为准则、禁忌、情感基调、说话风格
4. **可用技能** - 专家可调用的工具能力描述
5. **任务工作空间** - 当前任务的文件和目录信息
6. **Topic 总结** - 之前对话话题的摘要
7. **RAG 上下文** - 知识库检索结果
8. **Inner Voices** - 反思心智的自我评估
9. **用户信息引导** - 提示专家了解用户缺失信息

---

## 消息格式处理

### 多模态消息

`processSingleMultimodalMessage()` 处理多模态内容：
- 过滤无效图片 URL（占位符 `[图片]`、非 http/https 开头）
- 支持 JSON 格式的多模态数组
- 支持 Markdown 图片标记 `![alt](url)`

### 工具消息

`buildMessages()` 特殊处理 `role: 'tool'` 的消息：
- 从 `tool_calls` 字段解析 `tool_call_id` 和 `name`
- 智能截断工具返回内容（保留关键信息）

### 消息去重

检查最后一条消息是否已经是当前用户消息，避免重复添加。

---

## 文件结构

```
lib/context-organizer/
├── interface.js          # 接口定义和工厂类
├── base-organizer.js     # 基础组织器（通用功能）
├── full-organizer.js     # 完整上下文策略
└── simple-organizer.js   # 简单上下文策略
```

---

## 数据库支持

### experts 表

- `context_strategy` 字段：指定专家使用的上下文策略（`full` 或 `simple`）

### messages 表

- 存储对话历史，支持 `role: 'user' | 'assistant' | 'tool'`

### topics 表

- 存储对话话题总结，`status: 'active'` 表示活跃话题

### assistant_messages 表

- 存储 Inner Voices（`inner_voice` 字段）

---

## 使用示例

```javascript
// 创建上下文管理器
const contextManager = new ContextManager(expertConfig, memorySystem);

// 使用默认策略（从 expertConfig.expert.context_strategy 读取）
const result = await contextManager.buildContext(userId, {
  currentMessage: '你好',
  skills: [...],
  taskContext: {...},
});

// 切换策略
expertConfig.expert.context_strategy = 'simple';
```

---

## 相关 Issues

- #154: refactor: 创建上下文组织接口，支持多种上下文组织策略
- #155: feat: 工具调用上下文优化 - 摘要+按需获取

---

## 扩展指南

### 添加新的上下文策略

1. 创建新的组织器类，继承 `BaseContextOrganizer`：

```javascript
// lib/context-organizer/custom-organizer.js
import { BaseContextOrganizer } from './base-organizer.js';
import { ContextResult } from './interface.js';

export class CustomContextOrganizer extends BaseContextOrganizer {
  getName() {
    return 'custom';
  }

  getDescription() {
    return '自定义上下文策略描述';
  }

  async organize(memorySystem, userId, options = {}) {
    // 实现自定义逻辑
    // ...
    return new ContextResult({...});
  }
}
```

2. 在 `lib/context-manager.js` 中注册：

```javascript
import { CustomContextOrganizer } from './context-organizer/custom-organizer.js';

// 在 detectStrategy 或构造函数中注册
organizerFactory.register('custom', new CustomContextOrganizer(expertConfig));
```

3. 更新前端选择器（如需要）

---

*最后更新: 2026-03-16*
✌Bazinga！