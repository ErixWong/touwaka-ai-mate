## Summary

实现工具调用上下文优化：摘要 + 按需获取模式

### 主要变更

1. **[`lib/context-manager.js`](lib/context-manager.js)**
   - 新增 `buildToolMessageSummary()` 方法
   - 支持 full/simple 两种摘要策略
   - 在 `buildMessages()` 中添加 `summarizeToolMessages` 选项

2. **[`data/skills/message-reader/`](data/skills/message-reader/)**
   - 新增技能：`get_message_content` 工具
   - 通过 `tool_call_id` 检索完整消息内容
   - 使用 CommonJS 格式（VM 沙箱兼容）

3. **[`docs/review/code-review-154-155.md`](docs/review/code-review-154-155.md)**
   - 代码审计报告

### 技术设计

```javascript
// 工具消息摘要格式
const summary = `工具: ${toolName}
结果: ${contentLength} 字符
→ 调用 get_message_content("${toolCallId}") 获取完整结果`;
```

### 代码审计结果

✅ 通过 - 详见审计报告

## Test plan

- [ ] 验证 `message-reader` 技能可正常加载
- [ ] 验证 `get_message_content` 工具可检索消息
- [ ] 验证工具消息摘要功能

Closes #155