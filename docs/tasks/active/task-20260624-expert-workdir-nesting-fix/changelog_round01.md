# Changelog - Round 01

## 变更概述

本轮修复了专家对话中任务工作目录被重复拼接为 `/work/:userId/:taskId/work/:userId/:taskId` 的问题。

**根本原因**：系统把展示路径（逻辑路径）和执行路径（绝对路径）混在一起，导致：
1. `fullWorkspacePath` 实际存储的是逻辑路径（如 `work/userId/taskId`），不是绝对路径
2. 下游模块（如 skill-loader）又把逻辑路径按 `DATA_BASE_PATH + 逻辑路径` 解析
3. 这导致路径被重复拼接

## 修复方案

采用全局最优解策略：**执行层统一只接受绝对路径，展示层使用逻辑路径**

### 变更文件清单

| 文件 | 变更内容 |
|------|----------|
| `lib/paths.js` | 新增统一路径 API：`getUserWorkspaceRoot`, `getTaskWorkspaceAbsolutePath`, `getDefaultWorkspaceAbsolutePath`, `resolveWorkspaceAbsolutePath`, `toLogicalWorkspacePath` |
| `lib/chat-service.js` | 新增 `absolute_workspace_path`（绝对路径）和 `logical_workspace_path`（逻辑路径）字段，保留 `fullWorkspacePath` 兼容 |
| `lib/tool-manager.js` | 优先使用 `absolute_workspace_path`，拒绝非绝对路径 |
| `lib/skill-loader.js` | 删除绝对路径转相��路径的逻辑，强制要求绝对路径 |
| `lib/skill-runner.js` | 删除相对路径兼容逻辑，`WORKING_DIRECTORY` 必须是绝对路径 |
| `lib/context-manager.js` | 更新模型提示，删除 "相对于 data/ 目录" 旧语义 |
| `lib/context-organizer/base-organizer.js` | 更新路径权限提示文案 |
| `lib/context-organizer/minimal-organizer.js` | 更新路径权限提示文案 |
| `server/services/assistant/vision-processor.js` | 删除多候选路径猜测，只接受绝对路径 |

### 架构变更

#### 新增 API（lib/paths.js）

```js
// 获取用户工作根目录
export function getUserWorkspaceRoot(userId)

// 获取任务工作目录绝对路径
export function getTaskWorkspaceAbsolutePath(userId, taskId)

// 获取默认临时工作目录
export function getDefaultWorkspaceAbsolutePath(userId)

// 统一解析运行时工作目录（只接受绝对路径）
export function resolveWorkspaceAbsolutePath(input, userId)

// 绝对路径转逻辑路径（展示用）
export function toLogicalWorkspacePath(absolutePath)
```

#### 任务上下文新字段

```js
taskContext = {
  // 兼容旧字段
  fullWorkspacePath: 'work/userId/taskId',  // 逻辑路径
  
  // 新字段
  absolute_workspace_path: '/absolute/path/to/work/userId/taskId',  // 绝对路径
  logical_workspace_path: 'work/userId/taskId',  // 逻辑路径（与 fullWorkspacePath 相同）
  
  // ...其他字段
}
```

### 模型提示更新

旧版提示（会导致模型重复拼接路径）：
```
路径是相对于系统 data/ 目录的，不需要再加 data/ 前缀
```

新版提示：
```
使用相对当前工作目录的路径，例如 `input/file.xlsx` 或 `output/result.txt`
```

## 测试验证

- Lint 检查通过
- 代码逻辑符合新协议

## 风险与注意事项

1. **向后兼容性**：旧代码如果传递逻辑路径给 `WORKING_DIRECTORY` 环境变量，会抛出明确错误
2. **调用链检查**：确保所有调用 chat-service 的地方都传递了正确格式的路径
3. **前端影响**：如果前端直接读取 `fullWorkspacePath`，逻辑路径仍然可用

## 后续建议

1. 逐步迁移使用新字段 `absolute_workspace_path`
2. 清理旧代码中对 `fullWorkspacePath` 的消费
3. 添加端到端测试验证路径行为

---

## 自审结果

### 对照审计报告检查清单

| 审计报告要求 | 完成状态 | 备注 |
|-------------|---------|------|
| Phase 0: 定义新契约 | ✅ 完成 | taskContext 新增 absolute_workspace_path 和 logical_workspace_path |
| Phase 1: 重构 paths.js | ✅ 完成 | 新增 5 个统一路径 API |
| Phase 2: 重构 chat-service | ✅ 完成 | 新增字段，保留 fullWorkspacePath 兼容 |
| Phase 3: 重构 tool-manager | ✅ 完成 | 优先使用 absolute_workspace_path |
| Phase 3: 重构 skill-loader | ✅ 完成 | 删除绝对路径转相对路径逻辑 |
| Phase 4: 重构 skill-runner | ✅ 完成 | 删除相对路径兼容，只接受绝对路径 |
| Phase 5: OS 沙箱执行器 | ⚠️ 本轮未涉及 | 当前系统未使用 firejail/sandboxie |
| Phase 6: 视觉处理 | ✅ 完成 | vision-processor.js 修复并清理重复代码 |
| Phase 7: 模型提示 | ✅ 完成 | 删除 "相对于 data/ 目录" 旧语义 |

### 自审发现并修复的问题

| 问题 | 文件 | 修复内容 |
|------|------|----------|
| manager.js 未使用新字段 | `server/services/assistant/manager.js` | 使用 absolute_workspace_path 优先 |
| vision-processor.js 有重复代码 | `server/services/assistant/vision-processor.js` | 删除重复的死代码 |

### ES 模块导入校验

- `lib/paths.js`: ✅ 通过，所有导出函数可正常导入
- `lib/tool-manager.js`: ✅ 通过（运行时校验）
- `lib/chat-service.js`: ✅ 通过（运行时校验）
- 其他修改文件: ✅ 通过静态检查

### Lint 检查

- ✅ `npm run lint` 通过

### 返回结构和字段类型一致性

- taskContext 新字段均为字符串类型，与原字段类型一致
- absolute_workspace_path: 字符串（绝对路径）
- logical_workspace_path: 字符串（逻辑路径）
- fullWorkspacePath: 保留，字符串（逻辑路径，兼容）

### 数据库/后端/前端变量命名一致性

- 统一使用 snake_case 命名
- 新字段遵循 `absolute_workspace_path` 和 `logical_workspace_path` 命名规范
- 与现有代码风格一致

### 提交记录

```
commit 1: fix: 统一工作目录为绝对路径，修复路径重复拼接问题
commit 2: fix: 补充修复 manager.js 和清理 vision-processor.js 重复代码
```

### 变更报告路径

```
D:\projects\node\touwaka-mate-v2-p0\docs\tasks\active\task-20260624-expert-workdir-nesting-fix\changelog_round01.md
```