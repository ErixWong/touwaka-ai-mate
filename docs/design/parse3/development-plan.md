# App 平台开发计划 — 填补缺口

> 本文档基于 `parse3` 设计文档的实施现状分析，规划后续开发任务。
> 创建时间：2026-04-16
> 最后更新：2026-04-16（Phase 2A/2B/2C 已完成）

## 实施现状

| 模块 | 状态 | 已实现文件 |
|------|------|-----------|
| 数据库表（7/8） | ✅ | `scripts/upgrade-database.js` |
| 后端 API | ✅ | `server/routes/mini-app.routes.js`, `server/controllers/mini-app.controller.js`, `server/services/mini-app.service.js` |
| 前端路由 + 导航 | ✅ | `frontend/src/router/index.ts`, `frontend/src/components/AppHeader.vue` |
| 用户页面 | ✅ | `frontend/src/views/AppsView.vue`, `frontend/src/views/AppDetailView.vue` |
| 通用组件 | ✅ | `frontend/src/components/apps/GenericMiniApp.vue` (580行) |
| 字段组件（8/9） | ✅ | `TextField`, `TextAreaField`, `SelectField`, `NumberField`, `DateField`, `BooleanField`, `GroupField`, `RepeatingField` + `FieldRenderer` |
| 辅助组件 | ✅ | `FileUploader.vue`, `StateBadge.vue` |
| 初始化脚本 | ✅ | `scripts/init-contract-app.js` |
| 嵌套字段组件 | ✅ | `GroupField.vue`, `RepeatingField.vue` + 后端校验/汇总计算 |
| 系统管理页面 | ✅ | `AppManagementTab.vue`, `HandlerManagementTab.vue`, `StateDesigner.vue` + SettingsView 导航 |
| 时钟调度器 + 处理脚本 | ✅ | `lib/app-clock.js`（集成 MCP/LLM/Skill）, `ocr-service/`, `llm-extract/`, `fapiao-extract/` |
| 事件驱动 | ❌ | `app_event_handlers` 表 + 后端 + 管理页面 |

### 已完成 Phase 的实际文件清单

**Phase 2A — 系统管理页面**（commit `5928bd8` + `c9eb78f`）

| 文件 | 说明 |
|------|------|
| `frontend/src/components/settings/AppManagementTab.vue` | App 列表/创建/编辑/删除 + 字段设计器 + 状态设计器集成 |
| `frontend/src/components/settings/HandlerManagementTab.vue` | 脚本 CRUD + 执行日志查看 + 日志详情弹窗 |
| `frontend/src/components/settings/StateDesigner.vue` | 状态流转可视化设计器，卡片排序/脚本绑定/流转预览 |
| `frontend/src/views/SettingsView.vue` | 系统管理新增「App 管理」「处理脚本」两个 Tab |
| `frontend/src/api/mini-apps.ts` | 新增 Handler CRUD API 函数 |
| `frontend/src/i18n/locales/zh-CN.ts` / `en-US.ts` | 注册 appManagement + handlerManagement 完整 i18n key |

**Phase 2B — 时钟调度器 + 处理脚本**

| 文件 | 说明 |
|------|------|
| `lib/app-clock.js` | 修复 Attachment 引用 bug，实现 callMcp/callLlm/callSkill 真实集成 |
| `server/index.js` | 注入 InternalLLMService、SkillLoader、ResidentSkillManager 到 AppClock |
| `scripts/app-handlers/fapiao-extract/index.js` | 新增发票专用提取脚本，调用 fapiao 技能 |
| `scripts/app-handlers/llm-extract/index.js` | 修复 callLlm 返回格式兼容问题 |

**Phase 2C — 嵌套字段类型**

| 文件 | 说明 |
|------|------|
| `frontend/src/components/apps/fields/GroupField.vue` | 嵌套对象渲染，递归 FieldRenderer |
| `frontend/src/components/apps/fields/RepeatingField.vue` | 可编辑表格 + 增删行 + 汇总行 |
| `frontend/src/components/apps/FieldRenderer.vue` | 注册 group/repeating 类型 |
| `server/services/mini-app.service.js` | 新增 validateGroupField/validateRepeatingField/computeSummaries 方法 |

---

## Phase 2D — 事件驱动（未开始）

> **目标**：CRUD 操作自动触发脚本（自动编号、通知、关联检查）。
> **优先级**：低 — 锦上添花，可延后。

### 2D-1: 数据库建表

- **文件**：修改 `scripts/upgrade-database.js`
- **内容**：`app_event_handlers` 表（event_type, handler_id, priority, execution_mode, failure_policy, condition）

### 2D-2: 事件处理器后端

- **文件**：修改 `server/services/mini-app.service.js`
- **功能**：
  - Record CRUD 操作前后触发事件
  - 按优先级顺序执行脚本
  - 条件过滤（condition JSON 表达式）
  - 失败策略处理（block / log / ignore）

### 2D-3: 事件处理器管理

- **文件**：`frontend/src/views/system/EventHandlerView.vue`
- **路由**：`/system/apps/:appId/events`
- **API**：CRUD + 测试接口
- **功能**：为 App 绑定 create/update/delete 事件处理器

### 2D 依赖关系

```
2D-1 → 2D-2 → 2D-3
```

---

*让我们一起愉快地写代码吧！💪✨*
