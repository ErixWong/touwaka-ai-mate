# 工具调用上下文优化设计方案

## 问题分析

### 当前问题

在构造新的上下文时，工具调用的结果如何处理？

1. **多轮工具调用期间**：上下文在整个调用链完成前不会重新构建，工具结果直接传递给下一轮 LLM，这部分不需要考虑历史截断问题
2. **新上下文构建时**（对话压缩后或新对话开始）：需要让 LLM 知道"过去发生了什么"

### 旧方案问题

- 预判截断长度（如 5000 或 8000 字符）
- 可能丢失重要信息
- Token 使用效率不高

## 新方案：摘要 + 按需获取

### 核心思想

```
只对工具消息（role='tool'）做摘要，使用 tool_call_id 作为消息 ID
如果 LLM 需要完整内容，调用 get_message_content 工具按需获取
```

### 为什么只对工具消息做摘要？

| 消息类型 | 是否需要摘要 | 原因 |
|---------|------------|------|
| 用户消息 | ❌ 不需要 | 通常很短 |
| Assistant 消息 | ❌ 不需要 | 通常不长 |
| **工具消息** | ✅ 需要 | 可能非常大（搜索结果、文件内容） |

### 设计细节

#### 1. OpenAI 消息格式

工具消息是独立的，和 system/user/assistant 并列：

```javascript
[
  { role: 'system', content: '...' },
  { role: 'user', content: '帮我搜索...' },
  { role: 'assistant', tool_calls: [
    { id: 'call_abc', function: { name: 'kb-search', arguments: '{"query":"test"}' }}
  ]},
  { role: 'tool', tool_call_id: 'call_abc', name: 'kb-search', content: '搜索结果...' },
  { role: 'assistant', content: '根据结果...' }
]
```

#### 2. 工具消息摘要格式

直接使用 `tool_call_id` 作为消息 ID：

```javascript
// 原来
{ role: 'tool', tool_call_id: 'call_abc', name: 'kb-search', content: '很长的搜索结果...' }

// 摘要模式
{ role: 'tool', tool_call_id: 'call_abc', name: 'kb-search', content: '工具: kb-search\n参数: {"query":"xxx"}\n结果: 成功 (5条)\n→ 调用 get_message_content("call_abc")' }
```

#### 3. 新工具：get_message_content

```javascript
// 工具定义
{
  name: 'get_message_content',
  description: '获取指定消息的完整内容，包括工具调用的完整结果',
  parameters: {
    type: 'object',
    properties: {
      message_id: {
        type: 'string',
        description: '消息ID，从上下文中的 [消息ID: xxx] 获取'
      }
    },
    required: ['message_id']
  }
}

// 工具实现
async function getMessageContent(messageId) {
  const message = await db.Message.findByPk(messageId);
  if (!message) {
    return { success: false, error: '消息不存在' };
  }
  return {
    success: true,
    content: message.content,
    tool_calls: message.tool_calls ? JSON.parse(message.tool_calls) : null
  };
}
```

### 实现要点

#### 1. 工具参数截断

工具参数也可能很长（如 `kb-editor` 的 `content` 参数），需要截断处理：

```javascript
function truncateArguments(args, maxLength = 200) {
  const str = JSON.stringify(args);
  if (str.length <= maxLength) {
    return str;
  }
  // 智能截断：保留关键参数
  const summary = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > 50) {
      summary[key] = value.substring(0, 50) + `... (${value.length} 字符)`;
    } else {
      summary[key] = value;
    }
  }
  const summaryStr = JSON.stringify(summary);
  if (summaryStr.length > maxLength) {
    return summaryStr.substring(0, maxLength) + '...';
  }
  return summaryStr;
}
```

#### 2. 修改 buildMessages

**只处理 tool 角色消息**：

```javascript
// 处理 tool 角色消息
if (msg.role === 'tool') {
  // 构建摘要内容
  const summary = buildToolSummary({
    toolCallId: msg.tool_call_id,  // 直接使用 tool_call_id 作为消息 ID
    toolName: msg.name,
    resultLength: msg.content?.length || 0
  });
  
  result.push({
    role: 'tool',
    tool_call_id: msg.tool_call_id,
    name: msg.name,
    content: summary  // 摘要而非完整内容
  });
}

// user/assistant 消息保持不变，不需要特殊处理
```

#### 3. 上下文策略差异化

```javascript
// Full 策略：包含更详细的摘要
function buildFullToolSummary(info) {
  return `工具: ${info.toolName}
结果: ${info.resultLength} 字符
→ 调用 get_message_content("${info.toolCallId}") 获取完整结果`;
}

// Simple 策略：更简洁的摘要
function buildSimpleToolSummary(info) {
  return `${info.toolName} → ${info.resultLength} 字符 | get_message_content("${info.toolCallId}")`;
}
```

#### 4. get_message_content 工具实现

需要根据 `tool_call_id` 查找对应的 tool 消息：

```javascript
async function getMessageContent(toolCallId) {
  // 根据 tool_call_id 查找消息
  const message = await db.Message.findOne({
    where: { tool_call_id: toolCallId }
  });
  
  if (!message) {
    return { success: false, error: '消息不存在' };
  }
  
  return {
    success: true,
    content: message.content  // 完整的工具结果
  };
}
```

### 优势

1. **Token 效率最高**：上下文中只有元信息
2. **LLM 自主决策**：根据需要决定是否查看历史详情
3. **保持信息完整性**：数据库完整存储，随时可查
4. **按需获取**：类似"懒加载"思想

### 待实现

1. [ ] 修改 `buildMessages` 中的工具消息处理（只处理 role='tool'）
2. [ ] 实现 `get_message_content` 内置工具
3. [ ] 添加到内置工具列表
4. [ ] 测试验证

---

*设计时间：2026-03-15*
*状态：已确认，待实施*
*Issue: #155*