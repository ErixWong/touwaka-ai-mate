# Task #145: chatbox在"正在思考"状态下SSE消息不渲染

## 问题描述

在chatbox显示"正在思考"状态时，尽管SSE还在持续更新，前端界面会出现"冻结"现象：
- 只有工具调用（tool call）在加载显示
- 新的文本消息（delta事件）不显示
- 界面似乎卡住，无法正常渲染新内容

## 复现步骤

1. 发起一个会触发工具调用的对话
2. 观察chatbox显示"正在思考"状态
3. SSE持续推送delta事件，但前端不渲染

## 预期行为

SSE推送的delta事件内容应该实时显示在chatbox中，即使同时有工具调用在执行。

## 调查结果

### 1. SSE 事件处理阻塞主线程

在 [`useSSE.ts:317-342`](../../../frontend/src/composables/useSSE.ts:317) 中，事件处理是同步循环：

```javascript
while (true) {
  const { done, value } = await reader.read()
  // ...
  for (const event of events) {
    handleEvent(event, options)  // 同步处理所有事件
  }
}
```

当快速收到大量事件时，主线程会被阻塞，无法及时更新 UI。

### 2. Vue 响应式批量更新

在 [`ChatView.vue:310-316`](../../../frontend/src/views/ChatView.vue:310) 的 `delta` 事件处理中：

```javascript
case 'delta':
  if (currentAssistantMessage.value) {
    chatStore.updateMessageContent(
      currentAssistantMessage.value.id,
      currentAssistantMessage.value.content + data.content
    )
  }
  break
```

快速连续的更新会被 Vue 合并，导致 UI 看起来"冻结"。

### 3. 工具调用与文本消息的竞态条件

在 [`ChatView.vue:319-354`](../../../frontend/src/views/ChatView.vue:319)，`tool_call` 事件也会修改消息内容：

```javascript
case 'tool_call':
  if (currentAssistantMessage.value && data.toolCalls) {
    chatStore.updateMessageContent(
      currentAssistantMessage.value.id,
      currentAssistantMessage.value.content + `\n\n${toolDetails}\n`
    )
  }
  break
```

当 `tool_call` 和 `delta` 事件同时到达时，可能出现竞态条件。

### 4. Markdown 解析性能

在 [`ChatWindow.vue:439-490`](../../../frontend/src/components/ChatWindow.vue:439)，每次消息内容更新都会触发 `formatMessage`：

```javascript
const formatMessage = (content: string) => {
  // ...
  const rawHtml = marked.parse(content) as string  // 同步操作，可能耗时
  const cleanHtml = DOMPurify.sanitize(rawHtml, {...})  // 同步操作
  // ...
}
```

问题：由于 delta 每次都改变 content（增量更新），缓存无法命中。当内容变长时，每次解析都会更慢。

## 解决方案

### 方案一：优化 SSE 事件处理（推荐）

在事件处理中使用 `requestAnimationFrame` 让出主线程：

```javascript
// 在 useSSE.ts 中
for (const event of events) {
  await new Promise(resolve => requestAnimationFrame(resolve))
  handleEvent(event, options)
}
```

### 方案二：优化 Markdown 解析

对 `formatMessage` 添加防抖/节流：

```javascript
import { debounce } from 'lodash-es'

const formatMessageDebounced = debounce(formatMessage, 50)
```

### 方案三：分离工具调用显示

将工具调用和文本消息分开显示，避免竞态条件。

## 相关文件

- `frontend/src/composables/useSSE.ts`
- `frontend/src/views/ChatView.vue`
- `frontend/src/components/ChatWindow.vue`
- `frontend/src/stores/chat.ts`

## 状态

- [x] 问题调查
- [ ] 方案设计
- [ ] 实现
- [ ] 测试
- [ ] 代码审查