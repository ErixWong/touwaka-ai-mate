# 工具调用上下文优化：摘要 + 按需获取

## 背景

当前在构造新的上下文时，工具调用的结果可能非常大（如搜索结果、文件内容），导致：
- Token 使用效率不高
- 可能超过上下文限制

## 场景区分

1. **多轮工具调用期间**：上下文在整个调用链完成前不会重新构建，工具结果直接传递给下一轮 LLM，这部分不需要考虑截断问题
2. **新上下文构建时**（对话压缩后或新对话开始）：需要让 LLM 知道"过去发生了什么"

## 解决方案

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

### OpenAI 消息格式

工具消息是独立的，和 system/user/assistant 并列：

```javascript
[
  { role: 'user', content: '帮我搜索...' },
  { role: 'assistant', tool_calls: [
    { id: 'call_abc', function: { name: 'kb-search', arguments: '{"query":"test"}' }}
  ]},
  { role: 'tool', tool_call_id: 'call_abc', name: 'kb-search', content: '搜索结果...' },
  { role: 'assistant', content: '根据结果...' }
]
```

### 摘要格式

直接使用 `tool_call_id` 作为消息 ID：

```javascript
// 原来
{ role: 'tool', tool_call_id: 'call_abc', name: 'kb-search', content: '很长的搜索结果...' }

// 摘要模式
{ role: 'tool', tool_call_id: 'call_abc', name: 'kb-search', content: '工具: kb-search\n结果: 12345 字符\n→ 调用 get_message_content("call_abc")' }
```

### 新工具：get_message_content

```javascript
{
  name: 'get_message_content',
  description: '获取指定工具调用的完整结果',
  parameters: {
    type: 'object',
    properties: {
      tool_call_id: {
        type: 'string',
        description: '工具调用ID，从上下文中的 tool_call_id 字段获取'
      }
    },
    required: ['tool_call_id']
  }
}
```

## 实现任务

- [ ] 修改 `buildMessages` 中的工具消息处理（只处理 role='tool'）
- [ ] 实现 `get_message_content` 内置工具
- [ ] 添加到内置工具列表
- [ ] 测试验证

## 优势

1. **Token 效率最高**：上下文中只有元信息
2. **LLM 自主决策**：根据需要决定是否查看历史详情
3. **保持信息完整性**：数据库完整存储，随时可查
4. **实现简单**：只修改工具消息处理，复用 `tool_call_id`

## 相关文档

- 设计文档：`docs/design/tool-context-optimization.md`
- 相关 Issue：#154（上下文组织接口）