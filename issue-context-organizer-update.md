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

### 3. 两种策略对比

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

---

## Code Review 发现的问题

详见 [`docs/review/context-organizer-review.md`](../docs/review/context-organizer-review.md)

### 🔴 需要修复的问题

#### 1. 重复代码问题

`ContextManager` 和 `BaseContextOrganizer` 存在大量重复代码：

| 方法 | ContextManager | BaseContextOrganizer |
|------|----------------|---------------------|
| processSingleMultimodalMessage | ✅ | ✅ (重复) |
| extractSoul | ✅ | ✅ (重复) |
| enhanceWithTimestamp | ✅ | ✅ (重复) |
| enhanceWithSoul | ✅ | ✅ (重复) |
| enhanceWithSkills | ✅ | ✅ (重复) |
| enhanceWithTaskContext | ✅ | ✅ (重复) |
| enhanceWithTopicSummaries | ✅ | ✅ (重复) |
| enhanceWithRAGContext | ✅ | ✅ (重复) |
| enhanceWithInnerVoices | ✅ | ✅ (重复) |
| buildUserProfileContext | ✅ | ✅ (重复) |
| generateUserInfoGuidance | ✅ | ✅ (重复) |
| analyzeTrend | ✅ | ✅ (重复) |

**建议方案**：
- 方案 A：`ContextManager` 内部使用 `ContextOrganizer`，自身只做协调
- 方案 B：将 `ContextManager` 标记为 deprecated，统一使用 Organizer

#### 2. 行为不一致问题

`SimpleContextOrganizer` 使用 `getRecentMessages`（包含已归档消息），而 `FullContextOrganizer` 使用 `getUnarchivedMessages`（只返回未归档消息）。

```javascript
// FullContextOrganizer
const unarchivedMessages = await memorySystem.getUnarchivedMessages(userId, null);

// SimpleContextOrganizer - 行为不一致！
const recentMessages = await memorySystem.getRecentMessages(userId, this.messageCount);
```

**修复方案**：`SimpleContextOrganizer` 应该改用 `getUnarchivedMessages`：

```javascript
// 修复后
const recentMessages = await memorySystem.getUnarchivedMessages(userId, this.messageCount);
```

#### 3. Topic 创建时缺少字段

`compressContext` 创建 topic 时没有显式设置 `status`、`startTime`、`endTime`：

```javascript
// 当前实现（lib/memory-system.js:422-429）
await this.db.createTopic({
  id: topicId,
  expertId: this.expertId,
  userId: userId,
  name: topic.title,
  description: topic.summary,
  category: topic.category || 'general',
  // 缺少: status, startTime, endTime
});
```

**修复方案**：补充缺失字段：

```javascript
await this.db.createTopic({
  id: topicId,
  expertId: this.expertId,
  userId: userId,
  name: topic.title,
  description: topic.summary,
  category: topic.category || 'general',
  status: 'active',  // 显式设置
  startTime: unarchivedMessages[topic.startIndex]?.timestamp 
    ? new Date(unarchivedMessages[topic.startIndex].timestamp) 
    : new Date(),
  endTime: unarchivedMessages[topic.endIndex]?.timestamp 
    ? new Date(unarchivedMessages[topic.endIndex].timestamp) 
    : new Date(),
});
```

### 🟡 建议改进

#### 4. 添加策略选择配置入口

在专家配置中添加 `context_strategy` 字段：

```javascript
// 专家配置
{
  "id": "expert_xxx",
  "context_strategy": "full",  // 'full' | 'simple' | 'custom'
  // ...
}
```

#### 5. 完善接口定义

添加配置验证方法和能力声明：

```javascript
export class IContextOrganizer {
  // 现有方法...
  
  // 新增：验证配置
  validateOptions(options) {
    return { valid: true };
  }
  
  // 新增：能力声明
  getCapabilities() {
    return {
      supportsInnerVoices: true,
      supportsTopicSummaries: true,
      supportsRagContext: true,
    };
  }
}
```

---

## 后续工作

### P0 - 必须修复
- [ ] 修复 `SimpleContextOrganizer` 消息获取逻辑（改用 `getUnarchivedMessages`）
- [ ] 补充 `compressContext` 创建 topic 时的字段设置

### P1 - 应该修复
- [ ] 重构 `ContextManager` 消除重复代码
- [ ] 添加策略选择的配置入口

### P2 - 可以改进
- [ ] 添加性能测试，对比两种策略的 token 消耗
- [ ] 完善接口定义（配置验证、能力声明）

## 标签

`enhancement` `refactor` `architecture` `bugfix`