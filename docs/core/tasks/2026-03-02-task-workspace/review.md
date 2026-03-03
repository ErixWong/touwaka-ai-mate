# Task 工作空间管理 - Code Review 审计报告

> 审计日期：2026-03-02
> 审计人：Maria 🌸
> 代码进度：Phase 3 完成
> 更新日期：2026-03-02 (修复严重问题后)

---

## 📊 总体评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | ⭐⭐⭐⭐⭐ (5/5) | 结构清晰，遵循项目规范，严重问题已修复 |
| 安全性 | ⭐⭐⭐⭐⭐ (5/5) | 路径遍历防护、文件类型校验、权限校验完善 |
| 可维护性 | ⭐⭐⭐⭐⭐ (5/5) | 模块化设计，易于扩展 |
| 测试覆盖 | ⭐☆☆☆☆ (1/5) | 缺少单元测试 |
| 文档完整性 | ⭐⭐⭐⭐⭐ (5/5) | README 详尽，注释充分 |

**综合评分：84/100** (修复后提升 8 分)

---

## ✅ 优点

### 1. 架构设计
- **关系清晰**：`messages → topics → tasks` 三层关系设计合理
- **职责分离**：Controller、Routes、Model 分离明确
- **统一规范**：遵循项目 snake_case 字段命名铁律

### 2. 安全措施
- **路径遍历防护**：[`task.controller.js:421-426`](../../../server/controllers/task.controller.js:421) 使用 `path.resolve()` 和 `startsWith()` 检查
- **权限校验**：每个操作都验证 `created_by === userId`
- **软删除**：使用 `status: 'deleted'` 而非物理删除
- **文件类型校验**：[`task.routes.js`](../../../server/routes/task.routes.js) 添加了文件类型白名单

### 3. 代码质量
- **错误处理**：统一的 try-catch 和日志记录
- **类型定义**：前端 TypeScript 类型完整
- **状态管理**：Pinia store 设计规范
- **ES Module 规范**：使用 `import { createReadStream } from 'fs'` 替代 `require()`

### 4. 文档
- README.md 需求分析详尽
- 代码注释清晰
- API 设计文档完整

---

## ✅ 已修复问题

### ~~C1. 路由文件上传逻辑重复~~ ✅ 已修复
**修复方案**：移除路由中的内联处理，统一使用 Controller：
- 抁取 `createUploadMiddleware()` 函数
- 添加文件类型白名单校验
- 路由只负责中间件配置，Controller 处理业务逻辑

### ~~C2. 迁移脚本与模型不一致~~ ✅ 已修复
**修复方案**：移除迁移脚本中的 `expert_id` 字段，保持与设计文档一致（Task 与 Expert 通过 Topic 关联）

### ~~M5. 下载文件使用 require()~~ ✅ 已修复
**修复方案**：使用 ES module import `import { createReadStream } from 'fs'`

---

## 🟠 中等问题 (Medium) - 待改进

### M1. ~~缺少文件类型校验~~ ✅ 已修复
已在 `createUploadMiddleware()` 中添加文件类型白名单：
```javascript
const ALLOWED_FILE_TYPES = [
  '.pdf', '.doc', '.docx', '.txt', '.md', '.csv', '.xlsx', 
  '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.json', '.xml'
];
```

### M2. 工作空间路径硬编码 - **建议改进**
Controller、Routes、迁移脚本各自定义 `WORKSPACE_ROOT`，建议抽取为共享配置模块。

### M3. 前端 API 响应类型不匹配 - **需要验证**
后端返回格式是 `{ items, pagination }`，需要确认前端类型定义是否匹配。

### M4. 缺少事务处理 - **建议改进**
创建任务失败时应回滚已创建的目录。

---

## 🟡 轻微问题 (Minor) - 待改进
- m1. 缺少输入验证（标题长度限制）
- m2. 前端 store 缺少持久化
- m3. 缺少国际化 key
- m4. 日志信息不够详细

---

## ✅ 已完成项（更新）
### Phase 1: 后端基础
- [x] 创建数据库迁移脚本
- [x] 创建 Task Controller
- [x] 创建 Task Routes
- [x] 注册路由到主应用
- [x] 添加 Task 模型到 Sequelize
- [x] **修改 Topic 创建逻辑，支持关联 Task** ✅

### Phase 2: 前端界面
- [x] 创建 Tasks Tab 组件
- [x] 实现任务列表展示
- [x] 实现创建任务对话框
- [x] 实现进入/退出 Task 模式的完整流程
- [ ] 顶部浮动 Task 指示器（聊天框顶部显示当前任务）
- [x] 实现文件上传/下载（只能上传到 input/）

### Phase 3: 对话集成 ✅ **全部完成**
- [x] 进入 Task 时设置当前 task 上下文
- [x] 创建 Topic 时关联 task_id
- [x] ChatService 注入 Task 上下文到系统提示词
- [x] 专家通过 taskContext 识别当前任务（发送消息时附加 task_id）

---

## 🔧 剩余改进建议优先级

| 优先级 | 问题 | 工作量 | 状态 |
|--------|------|--------|------|
| ~~P0~~ | ~~C1: 路由上传逻辑重复~~ | ~~1h~~ | ✅ 已修复 |
| ~~P0~~ | ~~C2: 迁移脚本与模型不一致~~ | ~~0.5h~~ | ✅ 已修复 |
| ~~P1~~ | ~~M1: 文件类型校验~~ | ~~0.5h~~ | ✅ 已修复 |
| P1 | M3: API 响应类型不匹配 | 0.5h | 待验证 |
| P2 | M2: 工作空间路径统一 | 1h | 待改进 |
| P2 | M4: 事务处理 | 1h | 待改进 |
| P3 | 其他轻微问题 | 2h | 待改进 |

---

## 📝 后续工作建议
1. **补充单元测试**：至少覆盖 Controller 的核心方法
2. **验证前端类型**：确认 API 响应类型匹配
3. **添加 API 文档**：考虑使用 Swagger/OpenAPI
4. **性能优化**：文件列表支持分页，大文件上传支持断点续传

---

*审计完成时间：2026-03-02*
*修复完成时间：2026-03-02*
*下次审计建议：单元测试补充后*

---

## 🔄 优化：任务状态管理重构

> 审计日期：2026-03-03
> 审计人：Claude Code Reviewer
> 变更类型：重构优化
> 分支：feature/task-state-management

### 变更概述

将任务状态管理从 API 驱动改为本地状态管理，消息上下文在发送时附加。

### 变更文件

| 文件 | 变更内容 |
|------|----------|
| `frontend/src/stores/task.ts` | 重构 `enterTask`/`exitTask` 为同步本地状态操作，移除 `workspaceContext` |
| `frontend/src/components/panel/TasksTab.vue` | 更新为同步调用，传递完整 Task 对象 |
| `frontend/src/api/services.ts` | 移除不再使用的 `enterTask`/`exitTask` API |
| `frontend/src/types/index.ts` | 移除不再使用的 `EnterTaskResponse` 类型 |

### 审查结果

#### ✅ 优点

1. **关注点分离**：`enterTask` 和 `exitTask` 现在只管理本地状态，同步且简单
2. **良好的文档**：更新的 JSDoc 注释清晰解释了新的设计方法
3. **清理彻底**：移除了未使用的 `workspaceContext`、API 方法和类型
4. **上下文注入保留**：ChatView.vue 中的消息上下文注入正确使用 `taskStore.currentTaskId` 和 `taskStore.currentPath`
5. **状态一致性**：`enterTask` 正确重置 `currentBrowsePath` 和 `currentFiles`

#### 🔧 已修复问题

**I1. enterTask 缺少参数验证** ✅ 已修复
- 问题：`enterTask` 接收 Task 对象但未验证必需属性
- 修复：添加了 null/undefined 检查
```typescript
const enterTask = (task: Task) => {
  if (!task || !task.id) {
    console.warn('enterTask called with invalid task')
    return
  }
  // ...
}
```

#### 💡 建议

1. **数据库变更分离**：`scripts/init-database.js` 的变更（添加 tasks 表、topics 添加 task_id）应单独提交
2. **命名清晰度**：考虑 `currentPath` vs `workspace_path` 的命名区分

### 需求对照

| 需求 | 状态 | 说明 |
|------|------|------|
| 前端维护任务状态 (name, id, path) | ✅ 已实现 | `currentTask` 存储完整 Task 对象 |
| 优化上下文注入逻辑 | ✅ 已实现 | 移除 API 调用，状态仅本地管理 |
| 消息附加状态提交 | ✅ 已存在 | ChatView.vue 正确注入 `task_id` 和 `task_path` |

### 安全与性能

- **无安全问题**：变更仅影响前端状态管理
- **性能提升**：消除 enter/exit task 的 API 调用，减少网络开销
- **多窗口支持**：Pinia 的响应式状态天然支持多标签页场景

### 最终评估

**通过** - 实现正确，符合设计要求。重构成功简化了代码，同时保持了所有必需功能。

---

*优化审查完成时间：2026-03-03*

---

## 🔄 优化：任务列表 UI 增强与功能完善

> 审计日期：2026-03-03
> 审计人：Claude Code Reviewer
> 变更类型：功能增强 + Bug 修复
> 分支：feature/task-state-management

### 变更概述

1. **任务列表视觉优化** - 状态颜色区分、卡片样式、操作按钮
2. **编辑和删除功能** - 任务编辑对话框、归档/恢复/删除功能
3. **分页组件接入** - 使用现有 Pagination 组件实现分页显示
4. **Bug 修复** - HTTP 方法不匹配（PATCH→PUT）、ID 响应式引用问题

### 变更文件

| 文件 | 变更内容 |
|------|----------|
| `frontend/src/components/panel/TasksTab.vue` | 任务列表 UI 重构，添加编辑/删除/分页功能 |
| `frontend/src/stores/task.ts` | 任务状态管理重构 |
| `frontend/src/api/services.ts` | 移除废弃 API，修复 HTTP 方法 (PATCH→PUT) |
| `frontend/src/types/index.ts` | 移除废弃类型 `EnterTaskResponse` |
| `frontend/src/views/ChatView.vue` | 修复 task_id 字段使用 |
| `frontend/src/i18n/locales/zh-CN.ts` | 添加新的翻译 key |
| `lib/chat-service.js` | 修复查询字段 (task_id → id) |
| `server/controllers/task.controller.js` | 修复 update 方法返回值和错误处理 |

---

### 📊 审查结果摘要

| 严重程度 | 数量 | 主要问题 |
|---------|------|---------|
| 🔴 Critical | 2 | TaskFile 类型不匹配、客户端分页 |
| 🟡 Important | 4 | 缺少错误反馈、调试日志、HTTP 方法、验证 |
| 🔵 Suggestion | 4 | 可复用对话框、乐观 UI、防抖、i18n |

---

### 🔴 Critical (必须修复)

#### 1. TaskFile 类型定义不匹配

**问题**：类型定义使用 `type: 'file' | 'directory'` 但组件检查 `file.is_directory`

```typescript
// 类型定义 (types/index.ts)
export interface TaskFile {
  type: 'file' | 'directory'  // <-- 错误的属性
}

// 组件使用 (TasksTab.vue)
<span>{{ file.is_directory ? '📁' : getFileIcon(file.name) }}</span>
```

**修复建议**：统一使用 `is_directory: boolean` 或 `type` 字段

#### 2. 分页为客户端实现

**问题**：当前加载所有任务后在前端分页，任务量大时会有性能问题

```typescript
const paginatedTasks = computed(() => {
  return filteredTasks.value.slice(start, end)  // 内存切片
})
```

**说明**：MVP 阶段可接受，但应记录为已知限制

---

### 🟡 Important (应该修复)

#### 1. 缺少错误处理用户反馈

**问题**：CRUD 操作失败只 console.error，用户看不到错误提示

```typescript
const handleArchiveTask = async (task: Task) => {
  try {
    await taskStore.updateTask(task.id, { status: 'archived' })
  } catch (error) {
    console.error('Failed to archive task:', error)  // 无用户反馈！
  }
}
```

**修复建议**：添加 toast/notification 组件显示错误

#### 2. 调试日志应移除

**问题**：多处 `console.log` 残留

```typescript
console.log('归档任务:', task.id, task.title)
console.log('归档结果:', result)
console.log('编辑任务 - ID:', ...)
```

**修复建议**：移除或使用可配置的日志工具

#### 3. HTTP 方法语义

**问题**：从 `PATCH` 改为 `PUT`

- `PUT` = 替换整个资源
- `PATCH` = 部分更新

后端支持部分更新，语义上 `PATCH` 更合适，但为匹配后端路由使用 `PUT`

#### 4. Vue 响应式引用问题 ✅ 已修复

**问题**：`editingTask.value.id` 可能在编辑期间被其他操作更新

**修复**：在提交时先捕获任务 ID
```typescript
const taskId = editingTask.value.id  // 先捕获
const updated = await taskStore.updateTask(taskId, { ... })
```

---

### 🔵 Suggestion (建议改进)

1. **提取可复用组件**：删除确认对话框可提取为通用组件
2. **乐观 UI 更新**：归档/恢复操作可先更新 UI 再同步服务器
3. **搜索防抖**：大量任务时可添加 debounce
4. **组件拆分**：TasksTab.vue 约 1120 行，可拆分为子组件

---

### ✅ 做得好的地方

1. **干净的重构** - 任务状态管理从 API 驱动改为本地状态
2. **完整的功能集** - 编辑、归档、恢复、删除、筛选、搜索、分页
3. **良好的 UI/UX** - 状态指示器、卡片样式、操作按钮
4. **正确的授权检查** - 后端 update 端点添加了所有权验证
5. **路径遍历保护** - 文件操作中保持了完善的安全检查

---

### 📋 修复优先级

| 优先级 | 问题 | 工作量 | 状态 |
|--------|------|--------|------|
| P0 | TaskFile 类型不匹配 | 0.5h | ✅ 已修复 |
| P1 | 错误处理用户反馈 | 1h | 待修复 |
| P1 | 移除调试日志 | 0.5h | ✅ 已修复 |
| P2 | 组件拆分 | 2h | 可选 |

---

### 🔧 2026-03-03 修复记录

#### P0: TaskFile 类型不匹配 ✅
- **问题**：类型定义使用 `type: 'file' | 'directory'` 但组件检查 `file.is_directory`
- **修复**：将 `file.is_directory` 改为 `file.type === 'directory'`
- **文件**：`frontend/src/components/panel/TasksTab.vue` (lines 59, 63, 465)

#### P1: 移除调试日志 ✅
- **问题**：多处 `console.log` 残留
- **修复**：移除所有调试日志，保留错误日志
- **文件**：`frontend/src/components/panel/TasksTab.vue`
  - 移除 `openEditDialog` 中的调试日志 (原 348-349 行)
  - 移除 `handleSubmitTask` 中的调试日志 (原 375, 381 行)
  - 移除 `handleArchiveTask` 中的调试日志 (原 401, 404 行)
  - 移除 `handleRestoreTask` 中的调试日志 (原 408, 411 行)

---

### 最终评估

**通过** - 代码质量良好，功能完整。建议修复 Critical 和 Important 问题后合并。

---

*审查完成时间：2026-03-03*
*修复完成时间：2026-03-03*

---

## 🔄 优化：路径上下文注入增强

> 审计日期：2026-03-03
> 审计人：Claude Code Reviewer
> 变更类型：Bug 修复 + 功能增强
> 分支：feature/task-state-management

### 问题描述

在任务工作空间模式下，AI 多次搞错文件路径，不知道完整的 `data/work/userId/taskId` 结构。

**对话记录示例：**
```
AI: 工作空间根目录: mma5xbpi1eysy2idlzs2/m33hk632pc  (❌ 缺少 data/work/ 前缀)
用户: 但是你写的时候放在了 data/mma5xbpi1eysy2idlzs2/m33hk632pc/output/...
用户: data/work/mma5xbpi1eysy2idlzs2/m33hk632pc 但其实应该是这个 (✅ 正确路径)
```

### 变更文件

| 文件 | 变更内容 |
|------|----------|
| `lib/chat-service.js` | 修复路径拼接 Bug，添加 `fullWorkspacePath`、`systemRoot`、`userId` 字段 |
| `lib/context-manager.js` | 增强上下文格式，添加目录树、完整路径、路径使用规则 |

---

### 📊 审查结果摘要

| 严重程度 | 数量 | 主要问题 |
|---------|------|---------|
| 🔴 Critical | 0 | 无 |
| 🟡 Important | 1 | WORKSPACE_ROOT 常量重复定义 |
| 🔵 Suggestion | 2 | 日志增强、单元测试 |

---

### ✅ 代码变更审查

#### 1. chat-service.js (lines 805-828)

**修复内容：**
```javascript
// 工作空间根目录
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './data/work';

// 构建任务上下文（包含完整路径信息）
const taskContext = {
  id: task.task_id,
  title: task.title,
  description: task.description,
  workspacePath: task.workspace_path,
  fullWorkspacePath: path.join(WORKSPACE_ROOT, task.workspace_path),  // ✅ 新增
  systemRoot: WORKSPACE_ROOT,                                           // ✅ 新增
  userId: user_id,                                                      // ✅ 新增
  currentPath: task_path || '',
  status: task.status,
};

// 确定要读取的目录（使用完整路径）
const targetDir = task_path
  ? path.join(WORKSPACE_ROOT, task.workspace_path, task_path)  // ✅ 修复
  : path.join(WORKSPACE_ROOT, task.workspace_path, 'input');   // ✅ 修复
```

**审查结果：** ✅ 通过
- Bug 修复正确：原来缺少 `WORKSPACE_ROOT` 前缀
- 新增字段合理：`fullWorkspacePath`、`systemRoot`、`userId` 为上下文增强提供数据
- 向后兼容：保留了原有 `workspacePath` 字段

#### 2. context-manager.js (lines 280-345)

**修复内容：**
- 添加可视化目录树结构
- 显示完整路径信息 (`fullPath`)
- 添加路径使用规则说明
- 引导 AI 使用 `data/work/` 前缀

**审查结果：** ✅ 通过
- 目录树清晰展示层级关系
- 路径规则明确，减少 AI 混淆
- 示例路径包含完整前缀
- 添加了路径探测引导

---

### 🟡 Important (建议改进)

#### I1. WORKSPACE_ROOT 常量重复定义

**问题：** `WORKSPACE_ROOT` 在多个文件中重复定义

```javascript
// task.controller.js:18
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './data/work';

// chat-service.js:810 (新增)
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './data/work';

// task.routes.js (可能也有)
```

**建议：** 抽取到共享配置模块

```javascript
// config/workspace.js
module.exports = {
  WORKSPACE_ROOT: process.env.WORKSPACE_ROOT || './data/work'
};
```

**优先级：** P2 (可后续优化)

---

### 🔵 Suggestion (建议改进)

#### S1. 添加路径调试日志

**建议：** 在 `getTaskContext` 中添加路径日志，便于调试

```javascript
logger.debug(`[ChatService] 任务上下文路径: ${fullPath}`);
logger.debug(`[ChatService] 目标目录: ${targetDir}`);
```

#### S2. 补充单元测试

**建议：** 添加测试用例验证路径拼接正确性

---

### ✅ 验收标准检查

| 标准 | 状态 | 说明 |
|------|------|------|
| AI 能正确说出完整路径 | ⏳ 待验证 | 需手动测试 |
| 文件写入到正确目录 | ⏳ 待验证 | 需手动测试 |
| 文件列表读取正常 | ⏳ 待验证 | 需手动测试 |
| 非任务模式无影响 | ✅ 通过 | 修改仅在 task 模式下生效 |

---

### 📋 测试计划

1. **重启服务**
   ```bash
   npm run dev
   ```

2. **创建/打开任务**
   - 打开一个现有任务

3. **验证路径显示**
   - 发送消息："当前的任务目录是什么"
   - 预期：AI 返回 `data/work/{userId}/{taskId}` 完整路径

4. **验证文件操作**
   - 发送消息："创建一个测试文件到 output 目录"
   - 预期：文件创建在 `data/work/{userId}/{taskId}/output/`

5. **验证文件列表**
   - 发送消息："列出当前目录的文件"
   - 预期：正确列出文件

---

### 最终评估

**通过** - Bug 修复正确，上下文增强设计合理。建议进行手动测试验证功能正常。

---

*审查完成时间：2026-03-03*
*待验证：手动测试*

---

## 🔄 优化：跨平台兼容性与路径修复（第二轮）

> 审计日期：2026-03-03
> 审计人：Claude Code Reviewer
> 变更类型：Bug 修复 + 跨平台兼容
> 分支：feature/task-state-management
> 提交：877c1a9

### 变更概述

1. **路径上下文修复** - AI 路径多一层 `data/` 的问题
2. **跨平台路径分隔符** - Windows 反斜杠兼容
3. **Python 命令检测** - macOS/Linux `python3` 支持
4. **任务文件管理** - 删除、编辑、下载功能

---

### 🔧 修复记录

#### 1. 路径多一层 data/ 问题

**问题：** AI 创建文件时路径变成 `data/data/work/...`

**原因：** 提示词说"包含 `data/work/` 前缀"，但 `fullPath` 已经是相对于 `data/` 的路径

**修复：**
```javascript
// context-manager.js - 修改提示词说明
### 路径使用规则
- 路径是相对于系统 data/ 目录的，不需要再加 data/ 前缀
- ⚠️ 注意：路径已经是相对于 data/ 的，不要再加 data/ 前缀！
```

#### 2. 技能路径反斜杠问题

**问题：** PDF 技能无法运行，错误 `Skill directory not found: .../skills\pdf`

**原因：** Windows 上注册的技能 `source_path` 使用反斜杠 `\`

**修复：**
```javascript
// skill-loader.js - 读取时规范化
const normalizedPath = skill.source_path.replace(/\\/g, '/');

// skill-manager/index.js - 存储时规范化
const relativePath = path.relative(dataBasePath, fullPath).replace(/\\/g, '/');
```

**数据库修复：**
```sql
UPDATE skills SET source_path = REPLACE(source_path, CHAR(92), '/');
```

#### 3. Python 命令跨平台兼容

**问题：** `spawn python ENOENT` - macOS 没有 `python` 命令

**原因：** macOS 只有 `python3`，Windows 通常用 `python`

**修复：**
```javascript
// skill-runner.js - 添加 Python 命令检测
function detectPythonCommand() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  return 'python3';  // 默认使用 python3
}
```

**Windows 用户配置：** 在 `.env` 中添加 `PYTHON_PATH=python`

---

### 📋 任务文件管理功能

| 功能 | 文件 | 说明 |
|------|------|------|
| 文件删除 | `task.routes.js` | DELETE `/tasks/:id/files` |
| 文件编辑 | `task.routes.js` | PUT `/tasks/:id/files/content` |
| 文件下载 | `TasksTab.vue` | 下载按钮 + 预览功能 |
| 三点菜单 | `TasksTab.vue` | 删除、编辑操作入口 |
| 刷新按钮 | `TasksTab.vue` | 刷新工作空间文件列表 |

---

### ✅ 验收结果

| 项目 | 状态 | 说明 |
|------|------|------|
| 路径正确性 | ✅ 通过 | AI 使用 `work/userId/taskId` 格式 |
| 技能路径 | ✅ 通过 | 数据库已修复，代码已规范化 |
| Python 执行 | ✅ 通过 | 使用 `python3` 命令 |
| 文件管理 | ✅ 通过 | 删除、编辑、下载功能正常 |

---

### 📝 后续建议

1. **共享配置模块** - 抽取 `WORKSPACE_ROOT` 到统一配置
2. **单元测试** - 添加路径拼接测试用例
3. **Docker 部署** - 确保 Docker 环境中 Python 路径正确

---

*修复完成时间：2026-03-03*
*提交：877c1a9 feat(task): 增强任务工作空间路径上下文和跨平台兼容性*

---

### 🔧 2026-03-03 修复记录 (第二轮)

#### 问题描述
AI 创建文件时路径重复：`data/data/work/...` 而非 `data/work/...`

#### 根本原因
- AI 执行文件操作时，基础工作目录已经是 `data/`
- 注入的路径包含 `data/work/` 前缀
- 实际拼接结果：`data/` + `data/work/...` = `data/data/work/...` ❌

#### 修复内容

**文件：** `lib/chat-service.js`
```javascript
// 修复前
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './data/work';
fullWorkspacePath: path.join(WORKSPACE_ROOT, task.workspace_path),  // ❌
systemRoot: WORKSPACE_ROOT,                                          // ❌

// 修复后
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './data/work';  // 后端用
const AI_BASE_PATH = 'work';                                          // AI 用
fullWorkspacePath: path.join(AI_BASE_PATH, task.workspace_path),     // ✅
systemRoot: AI_BASE_PATH,                                             // ✅
```

**文件：** `lib/context-manager.js`
```javascript
// 修复前
const fullPath = taskContext.fullWorkspacePath || `data/work/${relativePath}`;  // ❌
const systemRoot = taskContext.systemRoot || 'data/work';                        // ❌

// 修复后
const fullPath = taskContext.fullWorkspacePath || `work/${relativePath}`;  // ✅
const systemRoot = taskContext.systemRoot || 'work';                        // ✅
```

#### 清理
- 删除错误创建的 `data/data/` 目录

#### 验证
- 重启服务后测试文件创建功能
- 确认文件创建在 `data/work/userId/taskId/output/` 而非 `data/data/work/...`

---

*修复完成时间：2026-03-03*
