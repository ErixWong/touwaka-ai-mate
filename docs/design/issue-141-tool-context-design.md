# Issue #141 设计方案：工具调用状态文本实时更新到对应消息

> **状态：✅ 已验证可行，可进入开发阶段**
>
> **验证结论**：整体方案可行，采用"接受重复显示"简化方案，降低实现复杂度。

## 问题描述

在一次流式调用中，LLM 可能会多次调用工具。在调用工具的过程中，LLM 会输出一些状态更新文本，例如：

- "搜索完成，收获了丰富的官方回应素材！"
- "正在整理写入文件..."
- "现在更新 TODO 状态..."

这些内容是流式返回的，但目前这些状态文本会集中在最后一条 assistant message 中显示，缩成一团。

## 期望行为

每个工具调用过程中的状态文本，应该实时更新到对应的 tool message 的 context 字段中，而不是全部堆积在最后的 assistant message 里。

## 数据结构

### 当前 Message 表结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 消息ID |
| role | enum | `user` / `assistant` / `tool` |
| content | text | 消息内容 |
| tool_calls | json | 工具调用元数据 |
| ... | ... | ... |

### Message 类型说明

| Message 类型 | role 字段 | 内容 |
|-------------|----------|------|
| 用户消息 | `user` | 用户输入 |
| 助手消息 | `assistant` | LLM 文本回复 + tool_calls 元数据 |
| 工具消息 | `tool` | 工具执行结果 |

**它们是独立的 message 记录，不是同一个 message。**

### 新增字段

在 tool message 的 `tool_calls` JSON 字段中新增 `context` 字段：

```json
{
  "tool_call_id": "call_xxx",
  "name": "tool-name",
  "arguments": {...},
  "context": "让我打开文件...",  // 新增：LLM 在调用工具前的状态文本
  "success": true,
  "duration": 1234,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## 技术方案

### 1. 修改 `lib/llm-client.js` - 捕获每个工具的 context

在流式处理中，当检测到新的 tool_call index 时，立即捕获当前累积的文本作为该工具的 context：

```javascript
// callStream 方法中

let pendingContent = '';  // 当前累积的文本
let toolCallContexts = {};  // 按工具 index 存储 context

res.on('data', (chunk) => {
  // ...
  if (delta?.content) {
    pendingContent += delta.content;
    onDelta?.(delta.content);
  }
  
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index;
      if (!accumulatedToolCalls[idx]) {
        // ★ 关键：新的工具调用开始，捕获当前累积的文本作为 context
        accumulatedToolCalls[idx] = { index: idx, function: {} };
        toolCallContexts[idx] = pendingContent.trim();
        pendingContent = '';  // 清空，准备下一个工具的状态文本
      }
      // 累积工具调用字段...
    }
  }
});

// 流结束时，将 context 附加到每个工具调用
const finalToolCalls = Object.values(accumulatedToolCalls)
  .map(tc => ({
    ...tc,
    context: toolCallContexts[tc.index] || '',
  }));
onToolCall?.(finalToolCalls);
```

### 2. 修改 `lib/chat-service.js` - 传递 context 并从 assistant message 中移除

```javascript
// streamChat 方法中

let roundContent = '';  // 本轮完整输出
let toolCallContexts = {};  // 每个工具的 context

await expertService.llmClient.callStream(
  modelConfig,
  currentMessages,
  {
    tools,
    onDelta: (delta) => {
      roundContent += delta;
      onDelta?.({ type: 'delta', content: delta });
    },
    onToolCall: (toolCalls) => {
      // toolCalls 已包含 context（由 llm-client 捕获）
      toolCalls.forEach(tc => {
        toolCallContexts[tc.id] = tc.context;
      });
      // ... 后续处理
    },
  }
);

// 执行工具时传递 context
const toolResults = await expertService.handleToolCalls(
  collectedToolCalls,
  user_id,
  access_token,
  taskContext,
  async (toolResult) => {
    // 关联 context
    toolResult.context = toolCallContexts[toolResult.toolCallId];
    await this.saveToolMessage(topic_id, user_id, toolResult, expert_id);
    onDelta?.({ type: 'tool_result', result: toolResult });
  }
);

// 简化方案：不从 roundContent 中移除 context
// 状态文本会同时在 tool message 和 assistant message 中显示
// 用户确认接受此行为
fullContent += roundContent;
```

### 3. 修改 `saveToolMessage()` - 保存 context 字段

```javascript
async saveToolMessage(topic_id, user_id, toolResult, expert_id = null) {
  const toolCallsData = {
    tool_call_id: toolResult.toolCallId,
    name: toolResult.toolName,
    arguments: toolResult.arguments || null,
    context: toolResult.context || null,  // 新增：状态文本
    success: toolResult.success,
    duration: toolResult.duration || 0,
    timestamp: new Date().toISOString(),
  };
  // ...
}
```

### 4. 前端展示修改

在 `ChatWindow.vue` 的工具消息面板中展示 `context` 字段。

## 数据流示意

```
时间线:
chunk 1: delta.content = "让我打开文件..."
         pendingContent = "让我打开文件..."
         
chunk 2: delta.tool_calls = [{index: 0, id: "call_1", function: {name: "toolA"}}]
         → 新 index 0，捕获 context = "让我打开文件..."
         → pendingContent 清空
         
chunk 3: delta.content = "搜索完成..."
         pendingContent = "搜索完成..."
         
chunk 4: delta.tool_calls = [{index: 1, id: "call_2", function: {name: "toolB"}}]
         → 新 index 1，捕获 context = "搜索完成..."
         → pendingContent 清空
         
chunk 5: delta.content = "整理完成"
         pendingContent = "整理完成"
         
最终存储:
  tool message A: context = "让我打开文件..."
  tool message B: context = "搜索完成..."
  assistant message: content = "整理完成"
```

## 边界情况处理

| 场景 | 行为 |
|------|------|
| 多个工具同时开始（同一 chunk） | 共享相同的 context（合理，因为 LLM 没有区分） |
| 工具之间有文本输出 | 每个工具获得各自的状态文本 |
| 无文本输出直接调用工具 | context 为空字符串 |
| 纯文本响应无工具调用 | 正常流式输出，全部保存到 assistant message |

## 需要修改的文件

1. **`lib/llm-client.js`**：在流式处理中捕获每个工具的 context
2. **`lib/chat-service.js`**：传递 context 到 `saveToolMessage()`，从 assistant message 中移除已关联的文本
3. **前端 `ChatWindow.vue`**：在工具消息面板展示 context

## 注意事项

1. **不影响 LLM 上下文**：状态文本仅保存到数据库用于前端展示，不回传给 LLM
2. **幂等性**：同一个工具调用不会重复保存
3. **向后兼容**：`context` 字段可选，旧数据正常显示
4. **文本匹配**：使用简单的字符串替换，如果 LLM 输出有变化可能匹配失败，需要考虑更健壮的方案