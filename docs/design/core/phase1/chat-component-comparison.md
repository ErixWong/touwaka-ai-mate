# 聊天组件选型对比报告

## 一、评估的组件列表

### 1. Deep Chat
- **类型**: Web Components（框架无关，可在 Vue 3 中使用）
- **GitHub**: https://github.com/OvidijusParsiunas/deep-chat
- **Stars**: 1.5k+
- **特点**:
  - 支持多种 AI 服务（OpenAI、Claude、Gemini、Azure、自定义等）
  - 原生支持 SSE 流式输出
  - 内置消息历史、文件上传、代码高亮、Markdown 渲染
  - 可自定义主题和样式
  - 丰富的演示和文档
- **Vue 3 集成**: 通过 Web Component 方式使用，需要注册为自定义元素
- **优点**: 功能完整、文档丰富、社区活跃
- **缺点**: 非原生 Vue 组件，某些 Vue 特性（如 provide/inject）可能受限

### 2. naive-ui (完全自研)
- **类型**: Vue 3 UI 组件库
- **GitHub**: https://github.com/tusen-ai/naive-ui
- **Stars**: 16k+
- **特点**:
  - 纯 Vue 3 实现，TypeScript 支持
  - 组件丰富，性能优秀
  - 支持自定义主题
  - 无外部 CSS 依赖
- **聊天功能**: 需要基于 naive-ui 组件自研聊天界面
- **优点**: 完全可控、原生 Vue 3、可深度定制
- **缺点**: 开发工作量大，需要自行实现 SSE、消息管理等

### 3. Element Plus (完全自研)
- **类型**: Vue 3 UI 组件库
- **GitHub**: https://github.com/element-plus/element-plus
- **Stars**: 24k+
- **特点**:
  - 最流行的 Vue 3 组件库
  - 组件丰富，生态完善
  - 文档详细，社区活跃
- **聊天功能**: 需要基于 Element Plus 组件自研聊天界面
- **优点**: 团队熟悉度高、生态完善
- **缺点**: 同 naive-ui，需要大量自研工作

### 4. @aivue/chatbot
- **类型**: Vue 3 原生 AI 聊天组件库
- **NPM**: https://www.npmjs.com/package/@aivue/chatbot
- **特点**:
  - **纯 Vue 3 组件**，专为 AI 聊天设计
  - 内置 SSE 流式输出支持
  - 多语言支持（内置英、西、法、德、意等，支持自定义中文）
  - 内置 RAG（检索增强生成）支持
  - 语音输入输出（支持 50+ 语言，包括中文）
  - 代理模式（proxy）支持，增强 API 安全
  - Demo 模式（无需 API Key 即可展示）
  - 会话持久化（localStorage/Supabase/Firebase/MongoDB/PostgreSQL）
  - 浮动聊天按钮组件（AiChatToggle）
- **Vue 3 集成**: 原生 Vue 3 组件，无缝集成
- **优点**:
  - 原生 Vue 3，无需 Web Component 封装
  - 功能专为 AI 聊天设计
  - 内置 SSE、多语言、语音等高级功能
  - 支持自定义样式（CSS 变量）
- **缺点**:
  - 包体积较大（相比纯 UI 组件库）
  - 社区相对较新，长期维护有待观察
  - 某些内置功能（文件上传、消息编辑/删除/引用）在 V1 阶段不需要

### 5. TDesign Vue Next
- **类型**: Vue 3 UI 组件库（腾讯开源）
- **GitHub**: https://github.com/Tencent/tdesign-vue-next
- **Stars**: 3k+
- **特点**:
  - 企业级 UI 组件库
  - 支持深色模式和自定义主题
  - 支持 Tree-shaking
  - 与 TDesign 其他框架版本 API 一致
- **聊天功能**: 通用组件库，没有专门的聊天组件，需要自研
- **优点**: 企业级品质、设计系统完整
- **缺点**: 需要完全自研聊天界面

### 6. ChatUI / @tencent/chatui
- **类型**: React 聊天组件库
- **特点**:
  - 腾讯开源的专业聊天 UI
  - 支持消息气泡、输入框、语音等
- **Vue 3 集成**: **不兼容**，React 库无法在 Vue 3 中直接使用
- **结论**: 不适用于本项目

### 7. AI Elements Vue
- **类型**: 未找到对应的开源项目
- **状态**: 可能是 MDBootstrap 的未发布产品或商业产品
- **结论**: 无法评估，不考虑使用

---

## 二、功能对比矩阵

| 功能特性 | Deep Chat | naive-ui<br>自研 | Element Plus<br>自研 | @aivue/chatbot |
|---------|-----------|-----------------|---------------------|----------------|
| **Vue 3 原生支持** | ⚠️ Web Component | ✅ 原生 | ✅ 原生 | ✅ 原生 |
| **SSE 流式输出** | ✅ 内置 | ⚠️ 需自研 | ⚠️ 需自研 | ✅ 内置 |
| **无限滚动加载历史** | ✅ 支持 | ⚠️ 需自研 | ⚠️ 需自研 | ✅ 支持 |
| **消息重发机制** | ✅ 内置 | ⚠️ 需自研 | ⚠️ 需自研 | ✅ 内置 |
| **多语言支持** | ⚠️ 需配置 | ✅ naive-ui 支持 | ✅ Element Plus 支持 | ✅ 内置多语言 |
| **深色模式** | ✅ 支持 | ✅ 支持 | ✅ 支持 | ✅ 支持 |
| **代码高亮** | ✅ 内置 | ⚠️ 需集成 | ⚠️ 需集成 | ✅ 内置 |
| **Markdown 渲染** | ✅ 内置 | ⚠️ 需集成 | ⚠️ 需集成 | ✅ 内置 |
| **RAG 支持** | ❌ 不支持 | ⚠️ 需自研 | ⚠️ 需自研 | ✅ 内置 |
| **语音输入输出** | ❌ 不支持 | ⚠️ 需自研 | ⚠️ 需自研 | ✅ 内置 |
| **Token 计数显示** | ❌ 不支持 | ⚠️ 需自研 | ⚠️ 需自研 | ⚠️ 需自研 |
| **调试信息展示** | ❌ 不支持 | ⚠️ 需自研 | ⚠️ 需自研 | ⚠️ 需自研 |
| **文件上传** | ✅ 内置 | ⚠️ 需自研 | ⚠️ 需自研 | ✅ 内置 |
| **消息撤回/修改** | ❌ 不支持 | ⚠️ 需自研 | ⚠️ 需自研 | ✅ 内置 |
| **包体积** | 中等 | 小 | 小 | 较大 |
| **开发工作量** | 低 | 高 | 高 | 低 |
| **定制灵活性** | 中 | 高 | 高 | 中 |

---

## 三、推荐决策

### 推荐方案：@aivue/chatbot

**决策理由**:

1. **原生 Vue 3 支持**: 纯 Vue 3 组件，无需 Web Component 封装，与项目技术栈完全契合

2. **功能匹配度高**: 内置 SSE、多语言、无限滚动等 V1 阶段需要的核心功能

3. **开发效率高**: 大幅减少自研工作量，团队可以专注于业务逻辑而非基础组件开发

4. **扩展性强**: 支持 RAG、语音等高级功能，为后续版本预留扩展空间

5. **安全考虑**: 支持代理模式（proxy），可以将 API 调用通过后端转发，避免前端暴露 API Key

**注意事项**:

1. **禁用不需要的功能**:
   - 文件上传功能（V1 阶段不需要，可在配置中禁用）
   - 消息编辑/删除/引用回复功能（在 V1 阶段隐藏相关按钮）

2. **Token 计数展示**:
   - 使用 @aivue/chatbot 的 `message` slot 自定义消息渲染
   - 在每条消息下方展示 Token 消耗统计

3. **调试信息展示**:
   - @aivue/chatbot 不直接支持调试面板
   - 需要在右侧独立面板展示，通过 props 传递数据

### 备选方案：Deep Chat

如果 @aivue/chatbot 在集成过程中遇到问题，可以选择 Deep Chat 作为备选：

- 更成熟的项目，社区更大
- 同样支持 SSE、多语言等核心功能
- 需要通过 Web Component 方式在 Vue 3 中使用

### 不推荐：完全自研

除非有特殊需求，否则不推荐基于 naive-ui 或 Element Plus 完全自研：

- 开发工作量大，延迟项目进度
- 需要处理 SSE、消息管理、无限滚动等复杂逻辑
- 难以达到成熟组件库的稳定性和用户体验

---

## 四、集成建议

### @aivue/chatbot 集成要点

```vue
<template>
  <AiChatWindow
    :provider="config.provider"
    :api-key="config.apiKey"
    :model="config.model"
    :system-prompt="config.systemPrompt"
    :streaming="true"
    :use-proxy="true"
    :proxy-url="'/api/chat'"
    :theme="isDarkMode ? 'dark' : 'light'"
    :language-texts="zhLanguageTexts"
    @message-sent="handleMessageSent"
    @response-received="handleResponseReceived"
    @error="handleError"
  >
    <!-- 自定义消息渲染，用于展示 Token 计数 -->
    <template #message="{ message, index }">
      <CustomMessageBubble
        :message="message"
        :token-count="getTokenCount(message.id)"
        :cost="getCost(message.id)"
      />
    </template>
  </AiChatWindow>
</template>

<script setup>
import { AiChatWindow } from '@aivue/chatbot';
import '@aivue/chatbot/dist/style.css';

// 中文语言配置
const zhLanguageTexts = {
  title: 'AI 助手',
  placeholder: '请输入消息...',
  sendButton: '发送',
  copyButton: '复制',
  retryButton: '重试',
  typing: '正在思考...',
  error: '出错了，请重试',
  noMessages: '暂无消息，开始对话吧',
};
</script>
```

### 需要自研的部分

1. **右侧调试面板**:
   - Token 消耗统计
   - 响应时间监控
   - 模型信息展示
   - 调试开关控制

2. **话题管理集成**:
   - 话题列表展示
   - 话题切换
   - 新建/删除话题

3. **Token 计数计算**:
   - 使用 `gpt-tokenizer` 或 `tiktoken` 在前端估算
   - 后端精确计算后通过 API 返回

---

## 五、最终决策

| 项目 | 决策 |
|------|------|
| **首选组件** | @aivue/chatbot |
| **备选组件** | Deep Chat |
| **历史消息加载** | 无限滚动（组件内置支持） |
| **SSE 管理** | 组件内置 + 后端 `/api/chat` 端点 |
| **文件上传** | 禁用（V1 阶段不需要） |
| **消息操作** | 仅支持重发，禁用编辑/删除/引用 |
| **多语言** | 组件内置 + Vue I18n 补充 |
| **Token 计数** | 前端估算展示 + 后端精确计算 |
