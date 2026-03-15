## 背景

当前系统的上下文组织方式由 `ContextManager` 类负责，主要逻辑包括：
- 获取全部未归档消息（不限制数量，让上下文压缩机制自动处理）
- 获取最近的 Inner Voices（默认 3 条）
- 获取 Topic 总结（从 topics 表加载，默认 10 个）
- 构建完整的系统提示（包含 Soul、Skills、Task Context、Topic Summaries、RAG Context、Inner Voices 等）

这种组织方式虽然功能完整，但在某些轻量级场景下可能过于复杂，消耗较多 token。

## 需求

1. **梳理当前上下文组织方式**：分析 `ContextManager.buildContext` 方法的实现逻辑
2. **创建上下文组织接口**：定义 `IContextOrganizer` 接口，统一上下文组织的标准
3. **实现两种组织策略**：
   - **FullContextOrganizer**：保留当前的完整上下文组织方式
   - **SimpleContextOrganizer**：轻量级策略，仅获取最近 10 条消息 + 最近 5 个 Topic 总结

## 实现方案

### 1. 当前上下文组织方式梳理

`ContextManager.buildContext` 的核心逻辑：

```javascript
// 1. 获取全部未归档消息（不限制数量）
const unarchivedMessages = await memorySystem.getUnarchivedMessages(userId, null);

// 2. 获取 Inner Voices（默认 3 条）
const innerVoices = await memorySystem.getRecentInnerVoices(userId, 3);

// 3. 获取 Topic 总结（默认 10 个）
const topicSummaries = await this.buildTopicSummaries(memorySystem, userId);

// 4. 构建系统提示（包含 Soul、Skills、Task Context、Topic Summaries、RAG Context、Inner Voices）
const systemPrompt = this.buildSystemPromptWithTopics(...);

// 5. 构建 LLM 消息数组
const messages = this.buildMessages(systemPrompt, unarchivedMessages, currentMessage);
```

### 2. 上下文组织接口设计

创建 `lib/context-organizer/` 目录结构：

```
lib/context-organizer/
├── interface.js        # IContextOrganizer 接口定义
├── base-organizer.js   # BaseContextOrganizer 基础类
├── full-organizer.js   # FullContextOrganizer 完整策略
├── simple-organizer.js # SimpleContextOrganizer 简单策略
└── index.js            # 模块导出
```

### 3. 接口定义

```javascript
export class IContextOrganizer {
  async organize(memorySystem, userId, options = {}) {
    throw new Error('必须实现 organize 方法');
  }

  getName() {
    throw new Error('必须实现 getName 方法');
  }

  getDescription() {
    throw new Error('必须实现 getDescription 方法');
  }
}
```

### 4. 两种策略对比

| 特性 | FullContextOrganizer | SimpleContextOrganizer |
|------|---------------------|----------------------|
| 消息数量 | 全部未归档消息 | 最近 10 条 |
| Inner Voices | 3 条 | 0 条（可选） |
| Topic 数量 | 10 个 | 5 个 |
| 适用场景 | 复杂对话、需要完整上下文 | 轻量级对话、快速响应 |
| Token 消耗 | 较高 | 较低 |

## 代码变更

### 新增文件
- `lib/context-organizer/interface.js`
- `lib/context-organizer/base-organizer.js`
- `lib/context-organizer/full-organizer.js`
- `lib/context-organizer/simple-organizer.js`
- `lib/context-organizer/index.js`

### 修复：Topic 状态处理

在检查过程中发现 `getTopics` 方法没有正确处理 Topic 状态，导致可能返回已删除或已归档的 Topic。已修复以下文件：

1. **`lib/db.js`** - `getTopicsByExpertAndUser` 方法添加 `status` 参数（默认 `'active'`）
2. **`lib/memory-system.js`** - `getTopics` 方法添加 `status` 参数（默认 `'active'`）
3. **`lib/context-manager.js`** - 更新 `buildTopicSummaries` 和 `buildTopicContext` 调用，明确传入 `'active'` 状态
4. **`lib/context-organizer/full-organizer.js`** - 更新 `buildTopicSummaries` 调用，明确传入 `'active'` 状态
5. **`lib/context-organizer/simple-organizer.js`** - 更新 `buildTopicSummaries` 调用，明确传入 `'active'` 状态

修复后，所有获取 Topic 的地方默认只返回 `active` 状态的 Topic，避免已删除或已归档的 Topic 被错误地包含在上下文组织中。

## 后续工作

1. 在 `ContextManager` 中集成 `ContextOrganizerFactory`，支持动态切换策略
2. 在专家配置中添加 `contextStrategy` 字段，允许为不同专家指定不同的上下文组织策略
3. 添加性能测试，对比两种策略的 token 消耗和响应质量

## 标签

`enhancement` `refactor` `architecture` `bugfix`
