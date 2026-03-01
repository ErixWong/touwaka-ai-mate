# 代码审计报告 - 2026-02-21

> 审计人：Maria 🌸  
> 审计时间：2026-02-21

## 概述

本次审计涵盖 13 个修改文件和 1 个删除文件，主要涉及：
- 右侧面板功能简化（移除 DocsTab）
- Topics 功能增强（分页、过滤、消息计数）
- 后端 API 增强（复杂查询支持）

---

## 📁 文件变更清单

### 删除的文件

| 文件 | 行数 | 说明 |
|------|------|------|
| `frontend/src/components/panel/DocsTab.vue` | 333 | 文档 Tab 组件（已删除） |

### 修改的文件

| 文件 | 类型 | 变更说明 |
|------|------|----------|
| `frontend/src/api/services.ts` | API | 添加 `expert_id` 参数 |
| `frontend/src/components/panel/RightPanel.vue` | 组件 | 移除 DocsTab，简化为 2 个 Tab |
| `frontend/src/components/panel/TopicsTab.vue` | 组件 | 重构，使用 chatStore 管理 |
| `frontend/src/i18n/locales/zh-CN.ts` | i18n | 移除 docs 相关翻译 |
| `frontend/src/i18n/locales/en-US.ts` | i18n | 移除 docs 相关翻译 |
| `frontend/src/stores/chat.ts` | Store | 添加 topics 状态和方法 |
| `frontend/src/stores/panel.ts` | Store | 移除 'docs' Tab 类型 |
| `lib/chat-service.js` | 后端 | 添加消息计数、默认标题 |
| `lib/db.js` | 后端 | 添加 updateTopic 方法 |
| `lib/memory-system.js` | 后端 | 重构 processHistory |
| `server/controllers/topic.controller.js` | 后端 | 添加 query 方法 |
| `server/routes/topic.routes.js` | 后端 | 添加 POST /query 路由 |

---

## ✅ 优点

### 1. 代码质量

- **遵循 snake_case 铁律**：全栈字段名保持一致，符合项目规范
- **类型定义完善**：TypeScript 类型定义清晰
- **国际化支持**：中英文翻译同步更新

### 2. 架构设计

- **状态管理集中化**：Topics 状态从组件移到 chatStore，便于复用
- **API 设计规范**：新增的 `/query` 端点遵循 RESTful 风格
- **向后兼容**：保留简单 GET 查询，同时新增复杂 POST 查询

### 3. 功能增强

- **Topic 消息计数**：新增 `message_count` 字段，实时更新
- **默认标题**：新对话有默认标题，提升用户体验
- **标题自动更新**：MemorySystem 在总结时更新当前话题标题

---

## ⚠️ 问题与建议

### 1. 删除 DocsTab 的影响

**问题**：DocsTab 被完全删除，但 TODO.md 中仍显示 Docs 功能待实现。

**建议**：
- 如果 Docs 功能暂时不需要，建议在 TODO.md 中标注「已延期」
- 如果后续需要，建议保留组件骨架，仅注释掉实现

### 2. i18n 遗留问题

**问题**：`zh-CN.ts` 和 `en-US.ts` 中移除了 `docs` 相关翻译，但未移除 `topics` 相关的 `daysAgo` 翻译键。

**位置**：
- `frontend/src/i18n/locales/zh-CN.ts` - 缺少 `daysAgo` 键
- `frontend/src/components/panel/TopicsTab.vue:126` - 使用了 `t('topic.daysAgo')`

**建议**：添加缺失的翻译键：
```typescript
// zh-CN.ts
topic: {
  // ...
  daysAgo: '天前',
}

// en-US.ts
topic: {
  // ...
  daysAgo: 'days ago',
}
```

### 3. 代码逻辑问题

**问题**：`TopicsTab.vue:126` 使用了 fallback 值处理

```typescript
if (days < 7) return `${days}${t('topic.daysAgo') || '天前'} ${time}`
```

**建议**：这是临时方案，应正确添加 i18n 键

### 4. API 响应格式不一致

**问题**：`topic.controller.js` 的 `list` 方法返回格式从 `list` + `pageSize` + `totalPages` 改为 `items` + `size` + `pages`

**位置**：`server/controllers/topic.controller.js:90-93`

**影响**：可能导致前端分页组件显示异常

**建议**：
1. 确认前端 `Pagination.vue` 使用的字段名
2. 统一全项目分页响应格式

### 5. 潜在性能问题

**问题**：`memory-system.js:278` 每次处理历史时都获取全部 100 条消息

```javascript
const allMessages = await this.getRecentMessages(userId, 100);
```

**建议**：
- 考虑添加缓存机制
- 对于活跃用户，100 条可能不够

### 6. 错误处理不完善

**问题**：`chat-service.js:339` `incrementTopicMessageCount` 缺少错误处理

```javascript
async incrementTopicMessageCount(topic_id) {
  await this.Topic.increment('message_count', { by: 1, where: { id: topic_id } });
}
```

**建议**：添加 try-catch 和日志记录

### 7. CRLF/LF 换行符警告

**问题**：Git 显示多个文件有 CRLF 警告

**建议**：配置 `.gitattributes` 统一换行符：
```
* text=auto eol=lf
*.bat text eol=crlf
```

---

## 📋 检查清单

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 字段名 snake_case 一致性 | ✅ | 符合规范 |
| TypeScript 类型定义 | ✅ | 类型完整 |
| i18n 翻译完整性 | ⚠️ | 缺少 `daysAgo` 键 |
| 错误处理 | ⚠️ | 部分方法缺少 try-catch |
| 日志记录 | ✅ | 关键操作有日志 |
| API 响应格式 | ⚠️ | 分页字段名变更需确认 |
| 代码注释 | ✅ | 方法有 JSDoc 注释 |

---

## 🎯 建议的后续行动

### 高优先级

1. **添加缺失的 i18n 键**：`topic.daysAgo`
2. **确认分页响应格式**：统一 `items/size/pages` 或 `list/pageSize/totalPages`
3. **更新 TODO.md**：标注 Docs 功能状态

### 中优先级

4. **添加错误处理**：`incrementTopicMessageCount` 方法
5. **配置 .gitattributes**：统一换行符

### 低优先级

6. **考虑缓存机制**：MemorySystem 历史消息获取
7. **添加单元测试**：新增的 query 方法

---

*审计完成！如有问题请随时沟通，亲爱的* 💪✨
