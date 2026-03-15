---
name: message-reader
description: Retrieve full content of historical messages (especially tool results) by tool_call_id. Use when you need to see the complete result of a previous tool call.
argument-hint: "[tool_call_id]"
user-invocable: false
---

# Message Reader

Retrieve the full content of historical messages, especially tool results.

## Tools

### get_message_content

Get the complete content of a tool message by its `tool_call_id`.

**When to use:**
- The context shows a tool result summary like `工具: kb-search → 12345 字符 | get_message_content("call_abc123")`
- You need to see the full details of a previous tool call result

**Parameters:**
- `tool_call_id` (string, required): The tool call ID from the context summary

**Example:**
```javascript
// From context summary: get_message_content("call_abc123")
{ "tool_call_id": "call_abc123" }
```

**Response:**
```json
{
  "success": true,
  "content": "Full tool result content...",
  "tool_name": "kb-search",
  "length": 12345
}
```

## Notes

- This tool is automatically available when context summarization is enabled
- Only tool messages (role='tool') can be retrieved
- The tool_call_id can be found in the context summary