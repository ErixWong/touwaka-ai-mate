# 工具调用上下文优化：摘要 + 按需获取

## 背景

当前在构造新的上下文时，工具调用的结果处理方式不够优化：
- 预判截断长度（如 5000 或 8000 字符）
- 可能丢失重要信息
- Token 使用效率不高

## 场景区分

1. **多轮工具调用期间**：上下文在整个调用链完成前不会重新构建，工具结果直接传递给下一轮 LLM，这部分不需要考虑截断问题
2. **新上下文构建时**（对话压缩后或新对话开始）：需要让 LLM 知道"过去发生了什么"

## 解决方案

### 核心思想

上下文中只包含工具调用的摘要信息（message_id、工具名、参数摘要、token 数、tool_calls 大小），如果 LLM 需要完整内容，调用 `get_message_content` 工具按需获取。

### 摘要格式

**工具消息**：
```
[消息ID: msg_xxx | tokens: 1234 | tool_calls: 5678 字符]
调用了工具: kb-search
参数: {"query": "测试查询", "top_k": 5}
结果: 成功 (返回 5 条记录，共 12345 字符)
→ 如需完整结果，调用 get_message_content("msg_xxx")
```

**普通消息**：
```
[消息ID: msg_yyy | tokens: 567]
用户: 你好，请帮我...
```

### 新工具：get_message_content

```javascript
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
```

## 实现任务

- [ ] 定义工具消息摘要格式
- [ ] 修改 `buildMessages` 中的工具消息处理
- [ ] 实现 `get_message_content` 工具
- [ ] 添加到内置工具列表
- [ ] 测试验证

## 优势

1. **Token 效率最高**：上下文中只有元信息
2. **LLM 自主决策**：根据需要决定是否查看历史详情
3. **保持信息完整性**：数据库完整存储，随时可查

## 相关文档

- 设计文档：`docs/design/tool-context-optimization.md`
- 相关 Issue：#154（上下文组织接口）