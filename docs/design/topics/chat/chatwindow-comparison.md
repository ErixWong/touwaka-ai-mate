# ChatWindow 对比分析与优化建议

## 概述

本文档对比分析 `references/pi-mono-main` 项目与当前项目 `Touwaka Mate v2` 的对话窗口实现，提出优化建议。

---

## 一、架构对比

### pi-mono-main (Reference)

| 组件 | 职责 |
|------|------|
| `ChatPanel` | 顶层容器，管理 Artifacts 面板与聊天界面的布局 |
| `AgentInterface` | 核心聊天界面，包含消息列表、输入区、统计信息 |
| `MessageList` | 稳定消息列表渲染（非流式） |
| `StreamingMessageContainer` | 流式消息容器，使用 RAF 批量更新 |
| `MessageEditor` | 输入编辑器，支持附件、拖拽、粘贴 |
| `ThinkingBlock` | AI 思考过程展示（可折叠） |
| `ArtifactsPanel` | 独立面板，展示生成的代码、文档等 |

**技术栈**：Lit (Web Components) + TypeScript

### Touwaka Mate v2 (当前项目)

| 组件 | 职责 |
|------|------|
| `ChatWindow.vue` | 单一组件，包含消息列表、输入区、滚动控制 |
| `ChatView.vue` | 页面容器，组合 ChatWindow 与其他面板 |

**技术栈**：Vue 3 + TypeScript

---

## 二、功能对比

| 功能 | pi-mono-main | Touwaka Mate v2 | 状态 |
|------|-------------|-----------------|------|
| 消息列表渲染 | ✅ | ✅ | ✅ 已实现 |
| 流式消息处理 | ✅ RAF 批量更新 | ✅ 基础实现 | ✅ 已实现 |
| 思考过程展示 | ✅ ThinkingBlock（可折叠） | ❌ | 🚧 **待实现** |
| 工具调用可视化 | ✅ ToolRenderer 注册机制 | ❌ | 🚧 **待实现** |
| 文件附件支持 | ✅ 拖拽/粘贴/选择 | ✅ Task 目录结构 | ✅ 已实现 |
| Artifacts 面板 | ✅ 独立分屏面板 | ✅ Tasks TabPage | ✅ 已实现 |
| Token/成本统计 | ✅ 实时显示 | ❌ | 📋 **待规划** |
| 历史消息加载 | ✅ | ✅ | ✅ 已实现 |
| 快捷指令提示 | ❌ | ✅ | ✅ 优势 |
| 专家头像背景 | ❌ | ✅ | ✅ 优势 |
| 时间格式化 | ❌ | ✅ | ✅ 已实现 |
| 滚动到底部 | ✅ | ✅ | ✅ 已实现 |
| 停止生成 | ✅ | ✅ | ✅ 已实现 |

---

## 三、优化建议

### 3.1 【高优先级】思考过程展示 (ThinkingBlock)

**问题**：当前项目无法展示 AI 的思考/推理过程，用户无法了解 AI 的推理链。

**参考实现**：[`ThinkingBlock.ts`](../../references/pi-mono-main/packages/web-ui/src/components/ThinkingBlock.ts)

**建议实现**：

```vue
<!-- ThinkingBlock.vue -->
<template>
  <div class="thinking-block">
    <div class="thinking-header" @click="toggleExpanded">
      <span class="chevron" :class="{ expanded }">▶</span>
      <span class="thinking-label">思考中...</span>
    </div>
    <div v-if="expanded" class="thinking-content">
      <MarkdownBlock :content="content" />
    </div>
  </div>
</template>
```

**功能点**：
- 可折叠的思考过程展示
- 流式状态时显示动画效果
- 区分思考内容与最终回复

---

### 3.2 【高优先级】工具调用可视化

**问题**：当前项目无法展示 Skill/工具的调用状态和结果，用户不知道 AI 正在执行什么操作。

**参考实现**：
- [`renderer-registry.ts`](../../references/pi-mono-main/packages/web-ui/src/tools/renderer-registry.ts)
- [`Messages.ts`](../../references/pi-mono-main/packages/web-ui/src/components/Messages.ts) 中的 `ToolMessage`

**建议实现**：

```typescript
// types/chat.ts
interface ToolCallMessage {
  role: 'tool_call'
  toolCallId: string
  toolName: string
  arguments: Record<string, any>
  status: 'pending' | 'running' | 'complete' | 'error'
  result?: any
}

// components/ToolMessage.vue
// 根据工具类型渲染不同的可视化效果
```

**工具状态可视化**：
- `pending` - 等待执行（灰色图标）
- `running` - 执行中（旋转动画）
- `complete` - 完成（绿色图标 + 可折叠结果）
- `error` - 错误（红色图标 + 错误信息）

---

### 3.3 ~~【中优先级】文件附件支持~~ ✅ 已实现

> **状态**：已通过 Task 目录结构实现文件附件功能。

---

### 3.4 【中优先级】Token/成本统计

**问题**：用户无法了解 API 调用的 token 消耗和成本。

**参考实现**：[`AgentInterface.ts`](../../references/pi-mono-main/packages/web-ui/src/components/AgentInterface.ts) 中的 `renderStats()`

**建议实现**：

```vue
<template>
  <div class="stats-bar">
    <span v-if="totalTokens">
      {{ formatTokens(totalTokens) }} tokens
      <span v-if="totalCost"> · ¥{{ totalCost.toFixed(4) }}</span>
    </span>
  </div>
</template>

<script setup>
const totalTokens = computed(() => {
  return messages.value
    .filter(m => m.role === 'assistant' && m.usage)
    .reduce((sum, m) => sum + m.usage.totalTokens, 0)
})
</script>
```

---

### 3.5 ~~【低优先级】Artifacts 面板~~ ✅ 已实现

> **状态**：已通过 Tasks TabPage 实现类似功能，展示生成的文件和内容。

---

### 3.6 【低优先级】流式消息性能优化

**问题**：当前流式更新可能导致频繁重渲染。

**参考实现**：[`StreamingMessageContainer.ts`](../../references/pi-mono-main/packages/web-ui/src/components/StreamingMessageContainer.ts)

**优化方案**：

```typescript
// 使用 RAF 批量更新
let pendingMessage = null
let updateScheduled = false

function setMessage(message, immediate = false) {
  pendingMessage = message
  
  if (immediate || message === null) {
    _message = message
    requestUpdate()
    return
  }
  
  if (!updateScheduled) {
    updateScheduled = true
    requestAnimationFrame(() => {
      _message = JSON.parse(JSON.stringify(pendingMessage))
      requestUpdate()
      updateScheduled = false
    })
  }
}
```

---

## 四、实施建议

### 第一阶段：核心功能增强（当前目标）

1. **ThinkingBlock** - 支持 AI 思考过程展示
2. **ToolMessage** - 支持工具调用可视化

### 第二阶段：高级功能（待规划）

3. **Token 统计** - 透明化 API 使用
4. ~~**Artifacts 面板**~~ - 已通过 Tasks TabPage 实现
5. **性能优化** - 流式消息批量更新

---

## 五、现有优势保持

当前项目相比 reference 有以下优势，建议保持：

1. **快捷指令提示** - `/import`, `/create` 等指令自动补全
2. **专家头像背景** - 增强视觉沉浸感
3. **时间格式化** - 友好的相对时间显示

---

## 六、参考文件索引

| 功能 | 参考文件 |
|------|---------|
| 整体架构 | `references/pi-mono-main/packages/web-ui/src/ChatPanel.ts` |
| 消息渲染 | `references/pi-mono-main/packages/web-ui/src/components/AgentInterface.ts` |
| 消息列表 | `references/pi-mono-main/packages/web-ui/src/components/MessageList.ts` |
| 消息组件 | `references/pi-mono-main/packages/web-ui/src/components/Messages.ts` |
| 输入编辑器 | `references/pi-mono-main/packages/web-ui/src/components/MessageEditor.ts` |
| 思考块 | `references/pi-mono-main/packages/web-ui/src/components/ThinkingBlock.ts` |
| 流式容器 | `references/pi-mono-main/packages/web-ui/src/components/StreamingMessageContainer.ts` |
| 工具渲染 | `references/pi-mono-main/packages/web-ui/src/tools/renderer-registry.ts` |
| Artifacts | `references/pi-mono-main/packages/web-ui/src/tools/artifacts/index.ts` |

---

*文档创建时间：2026-03-12*
*作者：Maria 🌸*