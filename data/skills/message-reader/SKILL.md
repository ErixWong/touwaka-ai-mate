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
| tool_call_id | string | 是 | 消息 ID，从上下文摘要中获取（格式如 "msg_xxx"） |

**返回值：**

```json
{
  "success": true,
  "tool_call_id": "msg_xxx",
  "tool_name": "search",
  "content": "完整的消息内容...",
  "content_length": 1234,
  "result_length": 1234,
  "is_from_result": true,
  "created_at": "2026-03-15T12:00:00.000Z"
}
```

**返回字段说明：**

| 字段 | 说明 |
|------|------|
| `content` | 完整的消息内容 |
| `content_length` | 返回内容的长度 |
| `result_length` | 原始结果长度（存储时记录） |
| `is_from_result` | 内容是否来自 tool_calls.result（Issue #325 新增） |

## 使用场景

### Issue #325 优化后的存储方式

当工具结果超过阈值（500字符）时，系统会使用摘要存储：

```
工具: file-operations/fs_info
结果: 1234 字符 | 成功
→ 调用 get_message_content("msg_xxx") 获取完整结果
```

AI 看到此提示后，可以调用 `get_message_content` 工具获取完整结果。

### 获取逻辑

1. **优先从 `tool_calls.result` 获取**：新存储方式，完整结果存储在此字段
2. **回退到 `content` 字段**：旧存储方式或短结果

## 技术说明

- 使用消息主键 `id` 作为 `tool_call_id`
- 查询 `messages` 表中 `role='tool'` 的消息
- 完整结果可能存储在 `tool_calls.result` 或 `content` 字段
- `tool_calls.result_length` 记录原始结果长度