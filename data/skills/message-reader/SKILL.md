---
name: message-reader
description: "消息内容检索技能。用于上下文优化中的按需获取，当工具消息被摘要后，AI 可通过此技能获取完整消息内容。"
argument-hint: "get_message_content --tool_call_id=xxx"
user-invocable: false
allowed-tools: []
---

# Message Reader - 消息内容检索技能

提供消息内容检索能力，用于上下文优化中的按需获取。

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `get_message_content` | 获取完整消息内容 | `tool_call_id` |

## get_message_content

获取指定工具消息的完整内容。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| tool_call_id | string | 是 | 工具调用 ID，从上下文摘要中获取 |

**返回值：**

```json
{
  "success": true,
  "tool_call_id": "call_xxx",
  "tool_name": "search",
  "content": "完整的消息内容...",
  "content_length": 1234,
  "created_at": "2026-03-15T12:00:00.000Z"
}
```

## 使用场景

在 Simple 上下文策略中，工具消息会被摘要为：

```
search → 1234 字符 | get_message_content("call_xxx")
```

AI 看到此提示后，可以调用 `get_message_content` 工具获取完整结果。

## 技术说明

- 使用 `tool_call_id` 作为消息唯一标识
- 查询 `messages` 表中 `role='tool'` 的消息
- `tool_call_id` 存储在 `tool_calls` 字段的 JSON 中