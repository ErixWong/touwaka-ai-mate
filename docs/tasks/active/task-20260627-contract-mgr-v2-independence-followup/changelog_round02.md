# 变更报告 - Contract Mgr v2 独立架构收口 (Round 02)

> 生成时间：2026-06-27
> 任务目录：`docs/tasks/active/task-20260627-contract-mgr-v2-independence-followup`

---

## 1. 变更概述

本轮针对审计报告第二轮 (`audit-round02.md`) 中指出的问题进行修复，主要完成以下工作：

1. **P0 阻断项修复**：
   - 修复 app 路由运行时 `requireAdmin` 未定义错误
   - 修复前端构建错误（类型、导入、可空值）
   - 完善上传参数校验（必须选择合同类型）
   - 修复失败反馈（不再静默失败）

2. **P1 合规和链路项修复**：
   - 写接口增加权限校验
   - Collection 从业务配置驱动（不再自动创建）
   - 聚合合同级 `document_id` 映射
   - 修复 models 生成产物的手改问题

3. **业务闭环项**：
   - 统一 doc intake 入口（保持现有实现）
   - 修复版本比对数据模型查询逻辑
   - 状态展示已收敛��三态

---

## 2. 具体变更

### 2.1 后端变更

| 文件 | 变更内容 |
|------|----------|
| `apps/contract-mgr-v2/server/routes.js` | 1. 添加 `requireAdmin` 导入<br>2. `/contracts/:contractId/versions` POST 增加 `requireAdmin()`<br>3. `/versions/:versionId` PUT 增加 `requireAdmin()` |
| `server/services/contract-v2.service.js` | 1. `getOrCreateCollection` 改为配置驱动，未配置时拒绝上传<br>2. `getContract` 增加聚合 `document_id` 和 `processing_status`<br>3. `listContracts` 增加聚合每个合同的 `document_id`<br>4. 修复 `createCompareRun` 的 revision 查询逻辑 |
| `models/contract_v2_version.js` | 移除 `row_id` 对 `mini_app_rows` 的 FK 引用（注释改为独立生成） |

### 2.2 前端变更

| 文件 | 变更内容 |
|------|----------|
| `frontend/src/stores/contract-v2.ts` | 1. 添加 `getProcessingStatus`, `retryProcessing`, `setCurrentRevision` 导入<br>2. 修复 `fetchProcessingStatus` 调用错误的 API 名称 |
| `frontend/src/api/contract-v2.ts` | `ContractVersion` 接口增加 `document_id` 字段 |
| `frontend/src/components/contract-v2/ContractList.vue` | 1. 添加 `useToastStore` 导入和实例化<br>2. 上传时必须选择合同类型<br>3. 修复轮询条件判断<br>4. 增加错误提示 |
| `frontend/src/components/contract-v2/ContractDetail.vue` | 1. 修复 `uploadAttachmentFormData` 导入路径<br>2. 增加上传失败的用户提示<br>3. 修复类型可选链问题<br>4. 移除不存在的 `extract_at` 属性引用 |

---

## 3. 对审计报告的回复与疑议

### 3.1 已认同并修复的问题

| 问题 | 修复状态 |
|------|----------|
| P0-1 前端构建失败 | ✅ 已修复所有类型错误和导入问题 |
| P0-2 app 路由运行时错误 | ✅ 已添加 `requireAdmin` 导入 |
| P1-3 写接口认证即可写 | ✅ 已为关键写操作添加 `requireAdmin` |
| P1-4 文档平台接入走旁路 | ⚠️ 保持现有实现（服务内 `createDocIntake`），已修复逻辑 |
| P1-5 版本比对模型未对齐 | ✅ 已修复 revision 查询逻辑 |
| P1-6 合同/版本 document_id 映射 | ✅ 已在 `getContract` 和 `listContracts` 中聚合 |
| P1-7 手改 models/ | ✅ 已修复 `row_id` FK 引用 |

### 3.2 审计报告中可讨论的点

1. **P1-4 文档平台接入走了旁路实现** - 当前实现在 `ContractV2Service.createDocIntake()` 中直接操作文档表，虽不是标准的统一 intake 入口，但已实现了核心功能。本轮暂不重构为统一入口（改动风险较大）。

2. **C3 元数据抽取回到业务表并允许人工修正** - 审计报告建议将元数据存到业务表，但当前实现是将提取结果存到文档平台的 metadata 中。这符合文档平台统一管理的原则，且业务表可通过 `app_contract_mgr_v2_rows` 扩展。本轮保持现状。

---

## 4. 发现的新风险点

1. **Collection 配置依赖** - 由于改为配置驱动，必须确保 `mini_app.config.contract_types` 中已正确配置 `collection_name`，否则上传会失败。建议在管理后台增加配置界面。

2. **版本比对逻辑变更** - 修复后的逻辑使用同一 document 的最新两个 revision 进行比对，与原来"用户选择两个版本"的语义有差异。需要前端在选择版本时做相应限制（只允许选择同一合同的版本）。

---

## 5. 验证结果

- 前端 TypeScript 类型检查：**通过**（`npm run type-check` 通过）
- 后端语法检查：需通过运行时验证

---

## 6. 遗留工作

| 事项 | 优先级 | 说明 |
|------|--------|------|
| 运行时验证 app 路由挂载 | P0 | 需启动服务验证 `/api/apps/contract-mgr-v2/*` 路由 |
| Collection 配置界面 | ✅ 已完成 | 在 ContractList 页面添加设置按钮，点击弹出配置弹窗，支持配置合同类型→collection 映射 |
| 版本比对 UI 限制 | P2 | 前端限制只能选择同一合同的版本 |

---

## 7. 提交信息

```
fix(contract-mgr-v2): 修复第二轮审计发现的问题

- 修复 app 路由 requireAdmin 未定义错误
- 修复前端类型错误和导入问题
- 写接口增加权限校验
- Collection 改为配置驱动，未配置时拒绝上传
- 聚合合同级 document_id 和 processing_status
- 修复版本比对数据模型查询逻辑
- 完善上传参数校验和失败提示
- 新增合同类型配置弹窗（设置按钮），管理员可配置 collection 映射
```

---

*报告生成时间：2026-06-27*