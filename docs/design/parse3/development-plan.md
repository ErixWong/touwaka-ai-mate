# App 平台开发计划 — 填补缺口

> 本文档基于 `parse3` 设计文档的实施现状分析，规划后续开发任务。
> 创建时间：2026-04-16

## 实施现状

| 模块 | 状态 | 已实现文件 |
|------|------|-----------|
| 数据库表（7/8） | ✅ | `scripts/upgrade-database.js` |
| 后端 API | ✅ | `server/routes/mini-app.routes.js`, `server/controllers/mini-app.controller.js`, `server/services/mini-app.service.js` |
| 前端路由 + 导航 | ✅ | `frontend/src/router/index.ts`, `frontend/src/components/AppHeader.vue` |
| 用户页面 | ✅ | `frontend/src/views/AppsView.vue`, `frontend/src/views/AppDetailView.vue` |
| 通用组件 | ✅ | `frontend/src/components/apps/GenericMiniApp.vue` (580行) |
| 字段组件（6/9） | ✅ | `TextField`, `TextAreaField`, `SelectField`, `NumberField`, `DateField`, `BooleanField` + `FieldRenderer` |
| 辅助组件 | ✅ | `FileUploader.vue`, `StateBadge.vue` |
| 初始化脚本 | ✅ | `scripts/init-contract-app.js` |
| 嵌套字段组件 | ❌ | `GroupField.vue`, `RepeatingField.vue` |
| 系统管理页面 | ❌ | `AppManagementView.vue`, `HandlerManagementView.vue` |
| 时钟调度器 + 处理脚本 | ❌ | `app-clock.service.js`, `ocr-service/`, `llm-extract/`, `fapiao-extract/` |
| 事件驱动 | ❌ | `app_event_handlers` 表 + 后端 + 管理页面 |

---

## Phase 2A — 系统管理页面

> **目标**：通过 UI 创建/管理 App、脚本和状态，不再依赖脚本初始化。
> **优先级**：最高 — 后续所有开发都依赖管理页面。

### 2A-1: App 管理页面

- **路由**：`/system/apps`
- **文件**：`frontend/src/views/system/AppManagementView.vue`
- **功能**：
  - App 列表（图标、名称、类型、状态、记录数）
  - 新建 App 表单（名称、图标、类型、描述）
  - 编辑 App（含字段设计器）
  - 删除 App（确认弹窗 + 级联提示）
- **依赖**：后端 API 已就绪

### 2A-2: 处理脚本管理页面

- **路由**：`/system/handlers`
- **文件**：`frontend/src/views/system/HandlerManagementView.vue`
- **功能**：
  - 脚本列表（名称、描述、handler、状态）
  - 新建/编辑脚本（并发控制、超时、重试）
  - 执行日志查看（时间、记录、结果、耗时）
  - 测试脚本（选择记录手动触发）

### 2A-3: 状态设计器组件

- **文件**：`frontend/src/components/apps/StateDesigner.vue`
- **功能**：
  - 状态卡片列表（拖拽排序）
  - 添加/编辑/删除状态
  - 设置状态属性（初始/终态/错误）
  - 绑定处理脚本 + 成功/失败流转目标
  - 流转顺序可视化
- **嵌入位置**：App 编辑表单内

### 2A-4: 系统管理导航更新

- **文件**：`frontend/src/views/SettingsView.vue` 或系统管理子导航组件
- **新增**：
  - 「App 管理」→ `/system/apps`
  - 「处理脚本」→ `/system/handlers`

### 2A 依赖关系

```
2A-1 → 2A-4（页面先上，导航随后）
2A-3 → 集成到 2A-1 的编辑表单中
2A-2 独立开发
```

---

## Phase 2B — 时钟调度器 + 处理脚本

> **目标**：实现 AI 自动处理流程，记录从「待OCR」自动流转到「已确认」。
> **优先级**：高 — 核心引擎，App 平台的自动化价值所在。

### 2B-1: 时钟调度器

- **文件**：`server/services/app-clock.service.js`
- **功能**：
  - 定时扫描 `app_state` 中有 `handler_id` 的状态
  - 查询 `mini_app_rows` 中匹配 `_status` 的记录
  - 加载脚本 handler，调用 `process(context)`
  - 根据结果更新状态（success_next_state / failure_next_state）
  - 写入 `app_action_logs`
  - 并发控制（每个脚本最大并发 + 全局最大并发）
  - 超时处理 + 重试计数
- **配置**：
  ```json
  { "interval": 10, "batch_size": 10, "global_concurrency": 5 }
  ```
- **集成**：在 `server/app.js` 中随服务启动

### 2B-2: OCR 处理脚本

- **文件**：`scripts/ocr-service/index.js`
- **功能**：
  - 获取关联文件路径
  - 调用 markitdown MCP 服务进行 OCR
  - markitdown 失败时回退到 mineru
  - 返回 `{ _ocr_text, _ocr_service, _ocr_status }`

### 2B-3: LLM 提取脚本

- **文件**：`scripts/llm-extract/index.js`
- **功能**：
  - 读取 `record.data._ocr_text`
  - 根据 `app.fields` 构建 AI 可提取字段的 Prompt
  - 调用 LLM 提取结构化 JSON
  - 返回提取结果合并到 `record.data`

### 2B-4: fapiao 提取脚本

- **文件**：`scripts/fapiao-extract/index.js`
- **功能**：
  - 获取关联文件
  - 调用 fapiao 技能一步提取发票信息
  - 返回结构化数据

### 2B 依赖关系

```
2B-1（调度器核心）→ 2B-2 → 2B-3 → 2B-4
```

---

## Phase 2C — 嵌套字段类型

> **目标**：支持 group（嵌套对象）和 repeating（可编辑数组），覆盖发票明细、付款计划等复杂场景。
> **优先级**：中 — 发票管理依赖此功能。

### 2C-1: GroupField 组件

- **文件**：`frontend/src/components/apps/fields/GroupField.vue`
- **功能**：
  - 渲染带边框的字段组
  - 递归调用 `FieldRenderer` 渲染子字段
  - 支持只读/编辑模式

### 2C-2: RepeatingField 组件

- **文件**：`frontend/src/components/apps/fields/RepeatingField.vue`
- **功能**：
  - 可编辑表格（行 = 数组元素，列 = 子字段）
  - 添加行 / 删除选中行
  - 底部汇总行（`summary_fields` 配置）
  - 前端自动计算汇总值

### 2C-3: 后端嵌套字段校验 + 汇总

- **文件**：修改 `server/services/mini-app.service.js`
- **功能**：
  - `validateField()` 支持 group/repeating 递归校验
  - `computeSummaries()` 自动计算 repeating 的汇总字段

### 2C-4: 嵌套字段 AI 提取

- **文件**：修改 `scripts/llm-extract/index.js`
- **功能**：
  - `buildFieldPrompt()` 递归处理 group/repeating
  - group → 嵌套对象描述
  - repeating → 数组描述 + min/max 限制

### 2C 依赖关系

```
2C-1 + 2C-2（前端组件，可并行）
     ↓
2C-3（后端校验）→ 2C-4（AI 提取）
```

---

## Phase 2D — 事件驱动

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

## 总体执行路线

```
Phase 2A ─── 系统管理页面（1-2 周）
    ↓
Phase 2B ─── 时钟调度器 + 处理脚本（1-2 周）
    ↓
Phase 2C ─── 嵌套字段类型（1 周）
    ↓
Phase 2D ─── 事件驱动（1 周，可延后）
```

每个子任务（如 2A-1）对应一个 GitHub Issue + 特性分支。

---

*让我们一起愉快地写代码吧！💪✨*
