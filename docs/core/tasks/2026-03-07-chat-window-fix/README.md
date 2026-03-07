# 对话窗口修复

## 问题描述

根据 TODO.md 中的"对话窗口优化"任务，需要实现以下功能：

### 1. 停止按钮
- 在输入框旁边添加停止按钮（流式输出时显示）
- 点击后中断 SSE 连接，停止当前生成
- 保留已生成的内容，标记消息状态为"已停止"
- 后端需要支持取消正在进行的 LLM 请求

### 2. 消息分页加载
- 首次只加载最新 N 条消息（如 20 条）
- 滚动到顶部时自动加载更多（无限滚动）
- 后端 API 支持分页参数（`limit`, `before_id`）
- 前端实现虚拟滚动优化长列表渲染
- 新消息实时推送不受分页影响

## 当前状态

经代码审查发现：

### 已实现功能 ✅
1. **停止按钮** - `ChatWindow.vue` 已有停止按钮实现（第100-107行）
2. **滚动加载更多** - `ChatWindow.vue` 已实现滚动检测和加载更多（第214-234行）
3. **分页API** - 后端已支持 `limit` 和 `before_id` 参数

### 需要修复的问题 ⚠️
1. **HTML转义问题** - `formatMessage` 函数中的HTML转义有误（第297-300行）
   - `&` 被替换为 `&` 而不是 `&`
   - `<` 被替换为 `<` 而不是 `<`
   - `>` 被替换为 `>` 而不是 `>`

## 修复计划

### Phase 1: 修复 HTML 转义问题
- 修复 `formatMessage` 函数中的 HTML 实体转义

## 相关文件

- `frontend/src/components/ChatWindow.vue` - 对话窗口组件
- `frontend/src/views/ChatView.vue` - 聊天视图
- `frontend/src/stores/chat.ts` - 聊天状态管理
- `server/controllers/message.controller.js` - 消息 API

## 分支

- 分支名: `fix/chat-window-html-escape`
