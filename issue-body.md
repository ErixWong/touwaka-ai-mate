## 背景

助理（Assistant）系统的 `assistant_type` 字段命名混乱，实际起到 ID 的作用但名称像是一个类型字段。需要重构以提高代码可读性和用户体验。

## 已完成变更

### 1. 助理召唤工具参数优化
- **文件**: `server/services/assistant-manager.js`
- 将 `assistant_summon` 工具的参数从 `type` 改为 `assistant_id`
- 工具描述中显示助理列表格式改为 `assistant_id（name）`

### 2. 方法重命名
- **文件**: `server/services/assistant-manager.js`, `lib/tool-manager.js`
- 将 `getToolDefinitions()` 重命名为 `getAssistantTools()`
- 更清晰地表达方法用途

### 3. 助理 ID 自动生成
- **文件**: `server/services/assistant-manager.js`
- `createAssistant()` 方法自动生成 `assistant_type`（格式：`asst_xxxxxxxx`）
- 使用 `Utils.newID(8)` 生成随机 ID

### 4. 前端创建表单优化
- **文件**: `frontend/src/components/settings/AssistantEditDialog.vue`
- 移除 `assistant_type` 输入字段
- 用户只需填写名称，ID 由系统自动生成

### 5. 后端校验调整
- **文件**: `server/controllers/assistant.controller.js`
- 移除创建助理时对 `assistant_type` 的必填检查

### 6. 调试日志增强
- **文件**: `server/services/assistant-manager.js`
- 在 `notifyExpertResult()` 中添加 console 日志输出助理返回结果

## 待完成变更

### 数据库字段重命名
- 将 `assistants` 表的 `assistant_type` 字段重命名为 `id`
- 需要修改：
  - 数据库迁移脚本
  - Sequelize 模型定义
  - 所有引用 `assistant_type` 的代码

## 影响范围

- 前端：助理管理界面
- 后端：助理管理服务、控制器
- 数据库：assistants 表

## 测试要点

- [ ] 创建助理时自动生成 ID
- [ ] 召唤助理时使用 `assistant_id` 参数
- [ ] 助理列表正确显示
- [ ] 助理返回结果在 console 中显示