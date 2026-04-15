# App 平台设计 - 自洽性审查报告

> 审查对象：[`app-platform-design.md`](app-platform-design.md)
> 审查日期：2026-04-14
> 审查目标：检查文档内部逻辑是否自洽、数据模型是否一致、方案是否可行
> 状态：✅ 已修复

## 审查结论：✅ 已修复

文档整体架构清晰，核心设计（多维表格 + 状态机 + 处理脚本）逻辑自洽。发现 **7 个问题** 和 **4 个优化建议**，已全部修复。

---

## 🔴 必须修复的问题

### 问题 1：`mini_apps` 表中 `statuses` 字段重复定义

**位置**：
- 第 203 行：`mini_apps` CREATE TABLE 语句中已包含 `statuses JSON`
- 第 832-846 行：又用 `ALTER TABLE mini_apps ADD COLUMN statuses JSON` 添加

**矛盾**：CREATE TABLE 已经定义了 `statuses`，后面的 ALTER TABLE 会报"字段已存在"错误。

**修复**：删除第 832-846 行的 ALTER TABLE 语句，或改为注释说明。

---

### 问题 2：`mini_app_rows.status` 默认值与状态机模型矛盾

**位置**：
- 第 286 行：`status VARCHAR(64) DEFAULT 'confirmed'`
- 第 854 行：`ALTER TABLE ... MODIFY COLUMN status VARCHAR(64) DEFAULT 'pending'`
- 状态机模型中：初始状态由 `mini_apps.statuses` 中的 `is_initial: true` 决定

**矛盾**：
1. CREATE TABLE 默认值是 `confirmed`，ALTER 又改成 `pending`，两处不一致
2. 不同 App 的初始状态不同（合同管理是 `pending_ocr`，发票是 `pending_process`，质量文档是 `confirmed`），硬编码默认值没有意义

**修复**：默认值应设为 `NULL` 或空字符串，由后端在创建记录时根据 App 的 `statuses` 中 `is_initial: true` 的状态来设置。

---

### 问题 3：`app_state_events` 唯一约束过于严格

**位置**：第 905 行

```sql
UNIQUE KEY uk_app_trigger (app_id, trigger_status)
```

**问题**：这个约束意味着每个 App 的每个状态只能绑定 **一个** 处理脚本。但文档第 903 行的 `sort_order` 字段注释说"同一状态多个处理器时"，暗示支持同一状态绑定多个脚本。

**矛盾**：唯一约束 vs 多处理器支持。

**修复方案**（二选一）：
- **方案 A**：去掉唯一约束，改为普通索引。同一状态的多个处理器按 `sort_order` 顺序执行
- **方案 B**：保留唯一约束，明确说明"每个状态只能绑定一个脚本"，删除 `sort_order` 字段

**推荐**：方案 A 更灵活，但需要时钟调度器支持串行执行同一状态的多个脚本。

---

### 问题 4：`batch_tasks` / `batch_results` 表与状态机模型重叠

**位置**：第 3258-3305 行

**问题**：文档已经设计了状态机模型（`mini_app_rows` + `app_state_events` + `app_row_handlers`），批量处理应该复用这个模型——每条记录独立走状态机。但 `batch_tasks` 和 `batch_results` 表又引入了一套独立的批量处理模型，两套模型功能重叠。

**矛盾**：
- 状态机模型中，批量上传 = 为每个文件创建一条 `mini_app_rows`（status = 初始状态），时钟自动处理
- `batch_tasks` / `batch_results` 模型中，批量上传 = 创建一个 batch_task，每个文件是 batch_result

**影响**：开发者不知道该用哪套模型实现批量处理。

**修复**：
- 明确 `batch_tasks` 仅用于**进度追踪**（记录总数、完成数、失败数）
- 实际数据处理仍然通过 `mini_app_rows` 的状态机
- `batch_results` 表可以删除，因为每条记录的处理结果已经在 `mini_app_rows.data` 和 `app_action_logs` 中

---

### 问题 5：`app_prompt_templates` 表与"处理脚本化"理念矛盾

**位置**：第 3312-3338 行

**问题**：文档第 785-792 行明确说"用状态机 + 脚本替代 AI 管线配置"，第 1250-1252 行也说"Prompt 模板可以在脚本内部硬编码或从配置文件读取，不再需要独立的模板表"。但第 3307-3371 行又详细设计了 `app_prompt_templates` 表。

**矛盾**：文档自己说不需要 Prompt 模板表，然后又设计了 Prompt 模板表。

**修复**：
- 将 `app_prompt_templates` 部分标记为"已废弃"或移到附录
- 或明确说明这是"可选增强"，Phase 1 不实现

---

### 问题 6：`mini_apps` 表中 `skill_id` 字段与新架构不匹配

**位置**：第 236 行

```sql
skill_id VARCHAR(32) COMMENT '关联的技能ID',
```

**问题**：新架构中，技能调用在处理脚本内部实现（`services.callSkill()`），一个 App 可能需要调用多个技能（如发票管理调用 `fapiao` + `xlsx`）。`skill_id` 只能关联一个技能，不够灵活，且与脚本化理念冲突。

**修复**：删除 `skill_id` 字段。技能调用完全在脚本内部处理，App 配置不需要知道用了哪些技能。

---

### 问题 7：`_file_updates` 魔术键缺乏规范

**位置**：第 1043-1049 行

```javascript
return {
  success: true,
  data: {
    _file_updates: {
      [file.id]: { ocr_text: ocrText, ocr_status: 'completed' }
    }
  }
};
```

**问题**：`_file_updates` 是一个魔术键，没有在任何地方定义其规范。脚本的 `process()` 返回的 `data` 应该合并到 `record.data`，但 `_file_updates` 却要更新 `mini_app_files` 表。时钟调度器如何知道要特殊处理这个键？

**修复**：在"处理脚本的实现规范"章节中明确定义：
- `data` 中的普通键 → 合并到 `mini_app_rows.data`
- `_file_updates` → 更新 `mini_app_files` 的 `ocr_text` 和 `ocr_status`
- 或者改为在 `context` 中提供 `updateFile(fileId, updates)` 方法，更清晰

---

## 🟡 建议优化的问题

### 建议 1：文档过长，需要拆分

当前文档 3752 行，包含：
- 概述与架构
- 数据模型（含嵌套字段）
- 状态机与处理脚本
- 场景映射
- 前端 CRUD 策略
- 完整流程
- 配置模型
- 前端架构
- 后端架构
- 权限设计
- 系统集成
- 实施路线
- 运行时模型（深度思考）
- 文档库同步

建议拆分为：
1. `app-platform-overview.md` - 概述、架构、场景映射
2. `app-platform-data-model.md` - 数据模型、字段类型、嵌套字段
3. `app-platform-state-machine.md` - 状态机、处理脚本、时钟调度
4. `app-platform-frontend.md` - 前端架构、通用组件
5. `app-platform-backend.md` - 后端架构、API、服务层
6. `app-platform-permission.md` - 权限设计
7. `app-platform-integration.md` - 系统集成、知识库同步

### 建议 2：`mini_apps.mcp_services` 字段用途不明

第 239 行定义了 `mcp_services JSON`，但全文没有任何地方使用或解释这个字段。在新架构中，MCP 调用在脚本内部实现，App 配置不需要知道用了哪些 MCP 服务。

**建议**：删除此字段，或明确其用途（如用于前端展示"此 App 需要哪些 MCP 服务"）。

### 建议 3：`mini_apps.required_permission` 与 `visibility` 模型重叠

第 242 行定义了 `required_permission`，但第 2582-2599 行又设计了完整的 `visibility` + `mini_app_role_access` 权限模型。两者功能重叠。

**建议**：删除 `required_permission`，统一使用 `visibility` 模型。

### 建议 4：前端 `AppDetailView.vue` 中 `componentMap` 硬编码

第 2235-2248 行的 `componentMap` 是硬编码的，每新增一个自定义小程序都需要修改这个文件。

**建议**：改为动态导入，基于 `mini_apps.component` 字段的值自动构建组件路径：

```typescript
const miniAppComponent = computed(() => {
  const comp = currentApp.value?.component
  if (!comp) return GenericMiniApp
  return defineAsyncComponent(() =>
    import(`@/components/apps/mini-apps/${comp}.vue`)
  )
})
```

---

## ✅ 自洽的部分

| 方面 | 评价 |
|------|------|
| 多维表格三层模型（Table→Field→Record） | ✅ 逻辑清晰，与 APITable 对照有据 |
| 状态机驱动处理 | ✅ 核心设计自洽，状态→脚本→状态转换逻辑完整 |
| 处理脚本规范 | ✅ context 接口定义清晰，三个示例脚本覆盖主要场景 |
| 通用 CRUD API | ✅ 统一 API + 字段定义驱动的策略合理 |
| GenericMiniApp 组件 | ✅ 配置驱动的自动渲染思路可行 |
| 权限设计（Phase 1 简化） | ✅ 复用现有 RBAC，Phase 1 极简方案务实 |
| 知识库同步 | ✅ 状态即事件的设计巧妙，复用状态机模型 |
| 场景映射（A~E） | ✅ 五个场景都有清晰的用户流程和技术路径 |
| 嵌套字段（group + repeating） | ✅ 设计完整，含校验、汇总、前端渲染 |
| 与现有系统集成 | ✅ MCP Client、技能系统、表单系统的复用策略清晰 |

---

## 修复优先级

| 优先级 | 问题 | 影响 |
|--------|------|------|
| P0 | 问题 1：statuses 重复定义 | 执行 SQL 会报错 |
| P0 | 问题 2：status 默认值矛盾 | 新建记录状态不正确 |
| P1 | 问题 3：唯一约束 vs 多处理器 | 功能限制 |
| P1 | 问题 4：batch 表与状态机重叠 | 架构混乱 |
| P1 | 问题 5：prompt_templates 矛盾 | 设计方向不清 |
| P2 | 问题 6：skill_id 多余 | 字段冗余 |
| P2 | 问题 7：_file_updates 魔术键 | 实现歧义 |

---

*审查完毕 ✌Bazinga！亲爱的*
