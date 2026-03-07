# 对话窗口修复

## 任务概述

修复对话窗口的多个问题，提升用户体验。

## 修复内容

### 1. HTML 转义问题（PR #13）

**问题**：`ChatWindow.vue` 中的 `formatMessage` 函数没有正确转义 HTML 实体，导致用户输入的 HTML 标签被解析执行。

**解决方案**：
```typescript
// 修复前
let formatted = content

// 修复后
let formatted = content
  .replace(/&/g, '&')
  .replace(/</g, '<')
  .replace(/>/g, '>')
```

### 2. 消息分页参数统一（PR #15）

**问题**：前后端消息分页参数不一致，前端使用 `pageSize`，后端同时支持 `limit` 和 `pageSize`。

**解决方案**：
- 统一使用 `pageSize` 参数
- 默认值从 50 改为 30 条
- 移除对 `limit` 参数的支持

**修改文件**：
- `frontend/src/stores/chat.ts` - loadMessagesByExpert 函数
- `server/controllers/message.controller.js` - listByExpert 函数

## 验收标准

- [x] HTML 标签正确转义显示
- [x] 消息分页使用统一的 `pageSize` 参数
- [x] 默认加载 30 条消息

## 相关链接

- PR #13: https://github.com/ErixWong/touwaka-ai-mate/pull/13
- PR #15: https://github.com/ErixWong/touwaka-ai-mate/pull/15
