## 背景

Issue #325 提出工具调用结果存储优化方案，参考业界最佳实践（Anthropic、LangChain、OpenAI），实现 **Content 摘要 + Tool_calls 完整存储** 的策略。

## 实现方案

### 阈值策略

```javascript
const SUMMARY_THRESHOLD = 500; // 字符数

if (toolResult.length > SUMMARY_THRESHOLD) {
  // 生成摘要，完整结果存 tool_calls.result
  message.content = buildToolSummary(toolName, toolResult, messageId);
  message.tool_calls.result = toolResult;
} else {
  // 短结果直接存 content
  message.content = toolResult;
}
```

### 数据结构调整

```json
// tool_calls JSON 结构
{
  "tool_call_id": "call_xxx",
  "name": "file-operations/fs_info",
  "arguments": {"path": "skills/docx/SKILL.md"},
  "success": true,
  "duration": 247,
  "timestamp": "2026-03-22T17:34:09.047Z",
  "result_length": 1234,  // 新增：结果长度
  "result": "..."         // 新增：完整结果（超过阈值时）
}
```

## 修改文件

| 文件 | 修改内容 |
|------|----------|
| `lib/chat-service.js` | `saveToolMessage()` 添加阈值判断，content 存摘要，tool_calls.result 存完整结果 |
| `data/skills/message-reader/index.js` | `get_message_content()` 优先从 tool_calls.result 获取完整结果 |
| `data/skills/message-reader/SKILL.md` | 更新文档说明新的存储方式 |

## 优点

1. **大幅减少上下文 token 消耗**：长工具结果不再占用上下文
2. **保留完整数据供后续检索**：通过 message-reader 技能可召回完整结果
3. **LLM 仍能理解"做了什么"**：摘要包含工具名、结果长度、召回方式
4. **向后兼容**：短结果仍直接存储，不影响现有逻辑

## 测试

- [x] 语法检查通过
- [x] 代码提交成功

Closes #325