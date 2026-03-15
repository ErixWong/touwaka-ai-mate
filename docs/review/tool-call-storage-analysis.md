# 工具调用存储与上下文构建分析报告

## 问题背景

用户提出的问题：
1. 工具调用的参数和结果，是否应该全部存入数据库？
2. 在构造上下文时，是否应该把工具调用的过程也编入上下文？编入多少？

## 设计原则

### 核心原则

1. **存储层应该完整保存**：数据库是"真相源"，不应该做截断，工具调用的参数和结果应该**完整存储**
2. **上下文构建应该智能决策**：根据场景动态决定使用哪些工具结果、使用多少，这是上下文组织策略的职责

### 错误的旧设计

```
❌ 旧设计：
存储时截断 → 永久丢失信息 → 上下文构建无法恢复
```

### 正确的新设计

```
✅ 新设计：
存储时完整 → 保留所有信息 → 上下文构建时按需截断
```

## 当前实现（已优化）

### 1. 工具调用存储机制（完整存储）

#### 1.1 助手消息中的工具调用存储

位置：[`lib/chat-service.js:389-420`](../../lib/chat-service.js:389)

```javascript
// 保存助手消息时，如果有工具调用，存储到 tool_calls 字段
if (allToolCalls.length > 0) {
  messageOptions.tool_calls = JSON.stringify(allToolCalls);
}
```

存储内容（`allToolCalls` 数组）：
```javascript
{
  tool_call_id: string,
  function: { name, arguments },
  result: { success, data, error },  // 执行结果（完整）
  duration: number,                   // 执行时长
  timestamp: string,                  // 时间戳
}
```

**结论**：助手消息中的 `tool_calls` 字段**完整存储**了工具调用参数和结果。

#### 1.2 工具消息的单独存储（已优化：完整存储）

位置：[`lib/chat-service.js:636-682`](../../lib/chat-service.js:636) `saveToolMessage()`

```javascript
// 构建 tool_calls 字段内容（完整存储）
const toolCallsData = {
  tool_call_id: toolResult.toolCallId,
  name: toolResult.toolName,
  arguments: toolResult.arguments || null,  // 工具调用参数（完整）
  success: toolResult.success,
  duration: toolResult.duration || 0,
  timestamp: new Date().toISOString(),
  context: toolResult.context || null,
};

// 完整存储工具返回结果（不再截断）
let content = '';
if (toolResult.data !== undefined) {
  content = typeof toolResult.data === 'string'
    ? toolResult.data
    : JSON.stringify(toolResult.data);
}
```

**存储结构**（已优化）：

| 字段 | 内容 | 是否截断 |
|------|------|----------|
| `tool_calls` | 工具元数据（含完整 `arguments`） | ❌ 不截断 |
| `content` | 工具返回结果 | ❌ **完整存储** |

**结论**：工具调用参数和结果**全部完整存储**

### 2. 工具调用在 LLM 上下文中的使用

#### 2.1 实时多轮调用中的工具上下文

位置：[`lib/chat-service.js:368-372`](../../lib/chat-service.js:368)

```javascript
// 多轮工具调用时，更新消息历史
currentMessages = [
  ...currentMessages,
  { role: 'assistant', content: roundContent || null, tool_calls: collectedToolCalls },
  ...expertService.toolManager.formatToolResultsForLLM(toolResults),
];
```

位置：[`lib/tool-manager.js:510-538`](../../lib/tool-manager.js:510) `formatToolResultsForLLM()`

```javascript
formatToolResultsForLLM(results, maxLength = 10000) {
  return results.map(result => {
    let content = JSON.stringify(
      { success: result.success, data: result.data, error: result.error }
    );

    // 截断过长的结果（实时上下文允许更长）
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) +
        `\n...[truncated, original ${content.length} chars]`;
    }

    return {
      role: 'tool',
      tool_call_id: result.toolCallId,
      name: result.toolName,
      content,
    };
  });
}
```

**实时上下文特点**：
- 工具结果截断阈值：**10000 字符**
- 用于多轮工具调用的即时反馈

#### 2.2 历史消息中的工具上下文（已优化：智能截断）

位置：[`lib/context-organizer/base-organizer.js:514-558`](../../lib/context-organizer/base-organizer.js:514) `buildMessages()`

```javascript
buildMessages(systemPrompt, messages, currentMessage, options = {}) {
  const { maxToolContentLength = 5000 } = options;  // 默认 5000 字符
  // ...
  
  // 处理 tool 角色消息
  if (msg.role === 'tool') {
    // 智能截断工具消息内容
    const truncatedContent = this.truncateToolContent(msg.content, maxToolContentLength);
    
    result.push({
      role: 'tool',
      tool_call_id: toolMetaData?.tool_call_id || '',
      name: toolMetaData?.name || 'unknown_tool',
      content: truncatedContent,
    });
  }
}
```

新增的智能截断方法 `truncateToolContent()`：

```javascript
truncateToolContent(content, maxLength = 5000) {
  if (!content || content.length <= maxLength) {
    return content;
  }

  // 尝试智能截断：JSON 格式提取关键信息
  try {
    const parsed = JSON.parse(content);
    
    if (Array.isArray(parsed)) {
      // 数组：保留前面的元素，指示总数
      return JSON.stringify({
        _truncated: true,
        totalItems: parsed.length,
        preview: parsed.slice(0, 5),
        _hint: `已截断，共 ${parsed.length} 项`
      }, null, 2);
    }
    
    if (parsed.success !== undefined) {
      // 工具返回格式 { success, data, error }
      // 尝试保留部分 data...
    }
  } catch (e) {
    // 不是 JSON，简单截断
  }

  return content.substring(0, maxLength - 100) +
    `\n\n... [上下文构建时截断，原始 ${content.length} 字符]`;
}
```

**历史上下文特点**（已优化）：
- 从数据库读取**完整内容**
- 上下文构建时**智能截断**（默认 5000 字符）
- 支持 JSON 结构化数据的智能摘要

### 3. 数据流总结（已优化）

```
工具执行
    │
    ├─→ saveToolMessage() ──→ 数据库存储
    │       ├─ tool_calls: 完整参数 + 元数据
    │       └─ content: 完整结果（不再截断）✅
    │
    └─→ formatToolResultsForLLM() ──→ 实时 LLM 上下文
            └─ content: 截断到 10000 字符

历史上下文构建
    │
    └─→ buildMessages() ──→ 从数据库读取完整内容
            └─ truncateToolContent() ──→ 智能截断到 5000 字符
```

## 已实施的优化

### 优化 1：存储层完整保存

**修改文件**：[`lib/chat-service.js`](../../lib/chat-service.js) `saveToolMessage()`

**变更内容**：
- 移除 `MAX_CONTENT_LENGTH = 1000` 的截断逻辑
- 工具返回结果**完整存储**到 `content` 字段

### 优化 2：上下文构建智能截断

**修改文件**：[`lib/context-organizer/base-organizer.js`](../../lib/context-organizer/base-organizer.js)

**新增方法**：
- `truncateToolContent(content, maxLength)` - 智能截断工具消息内容
- 支持结构化数据的智能摘要（数组、对象）
- 默认截断阈值：**5000 字符**（可在 `buildMessages()` 中配置）

### 优化 3：可配置的截断策略

```javascript
// 不同上下文组织策略可以配置不同的截断阈值
class FullContextOrganizer {
  buildMessages(systemPrompt, messages, currentMessage) {
    return super.buildMessages(systemPrompt, messages, currentMessage, {
      maxToolContentLength: 8000,  // Full 策略使用更长的内容
    });
  }
}

class SimpleContextOrganizer {
  buildMessages(systemPrompt, messages, currentMessage) {
    return super.buildMessages(systemPrompt, messages, currentMessage, {
      maxToolContentLength: 3000,  // Simple 策略保持简洁
    });
  }
}
```

## 后续优化方向

### 1. 工具类型感知截断

根据工具类型智能决定截断策略：

```javascript
const TOOL_TRUNCATION_CONFIG = {
  'file-operations': { preservePaths: true, maxLength: 3000 },
  'kb-search': { preserveSummary: true, maxItems: 5 },
  'http-client': { preserveStatus: true, maxLength: 2000 },
  'default': { maxLength: 5000 },
};
```

### 2. 专家级配置

在专家配置中添加工具结果处理选项：

```javascript
{
  "expert": {
    "tool_result_in_context": {
      "max_length": 5000,           // 上下文中的最大长度
      "strategy": "smart" | "simple"  // 截断策略
    }
  }
}
```

### 3. Token 预算管理

根据 Token 预算动态调整工具结果长度：

```javascript
// 在 buildMessages() 中
const tokenBudget = this.calculateTokenBudget(messages, systemPrompt);
const maxToolContentLength = Math.min(5000, tokenBudget / 3);
```

## 结论

| 问题 | 旧状态 | 新状态 |
|------|--------|--------|
| 工具参数是否完整存储 | ✅ 是 | ✅ 保持 |
| 工具结果是否完整存储 | ❌ 截断到 1000 字符 | ✅ **完整存储** |
| 实时上下文工具结果长度 | 10000 字符 | 10000 字符（保持） |
| 历史上下文工具结果长度 | 1000 字符（数据库截断） | **5000 字符（智能截断）** |
| 不同上下文策略是否区分 | ❌ 不区分 | ✅ **可配置** |

---

*分析时间：2026-03-15*
*优化实施：2026-03-15*
*相关文件：[`lib/chat-service.js`](../../lib/chat-service.js), [`lib/tool-manager.js`](../../lib/tool-manager.js), [`lib/context-organizer/base-organizer.js`](../../lib/context-organizer/base-organizer.js)*