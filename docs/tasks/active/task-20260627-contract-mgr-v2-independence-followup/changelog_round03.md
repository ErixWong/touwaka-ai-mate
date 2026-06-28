# 变更报告 - Contract Mgr v2 独立架构收口 (Round 03)

> 生成时间：2026-06-27
> 任务目录：`docs/tasks/active/task-20260627-contract-mgr-v2-independence-followup`

---

## 0. 方向澄清（2026-06-27 讨论纪要）

本轮与 Eric 讨论后，确认了以下设计原则：

### 核心原则
1. **文档平台能力保留在文档平台** - 提取、比對等能力通过 API 调用共享，不在 app 内重复实现
2. **MVP 简化** - 首版只做核心功能，删除过度设计
3. **用户视角** - 不过度设计，让用户自己决策

### 决策共识

| 分歧点 | 最终决策 | 理由 |
|--------|----------|------|
| Collection 配置 | **B. 自动创建私有 collection** | 用户上传时自动创建，无需预配置；设为私有，不在文档平台展示 |
| 元数据提取 | **A. 保持现状** | 自动提取 + 人工修正，简化用户工作量 |
| 版本比对 | **首版实现** | 用户自己选择版本比对，系统不做自动比对 |
| 架构方向 | **C. 重新定义 MVP** | 只保留核心功能（上传/列表/状态），文档处理能力调用平台 API |
| 状态轮询 | **删除** | 移除自动轮询，改用手动刷新（进入详情页时获取状态，失败时可重试） |
| 当前权限口径 | **仅本人数据** | 暂不设计复杂 app 授权模型；当前用户只能看到并操作自己创建/上传的数据 |

---

## 1. 变更概述

本轮针对审计报告第三轮 (`audit-round03.md`) 中指出的问题进行修复，同时应用上述设计原则简化实现。

### M0 基础可运行性修复

1. **移除后端 JS 文件中的 TS 类型标注**
2. **统一合同类型字典** - 数据库枚举增加 `sales`
3. **修复 manifest handler 参数签名**

### M1 写接口权限与失败语义

4. **intake 失败必须整体回滚**

### M2 文档主链路模型

5. **版本表增加 revision_id 字段**
6. **Collection 自动创建私有 collection**（新决策）

### M3 业务闭环

7. **前端状态展示收敛为三态**
8. **元数据提取后写入业务表**
9. **删除自动轮询，改用手动刷新**（新决策）

---

## 2. 具体变更

### 2.1 后端变更

| 文件 | 变更内容 |
|------|----------|
| `server/services/contract-v2.service.js` | 1. 移除 TS 类型标注<br>2. intake 失败时抛出异常<br>3. 创建版本时记录 revision_id<br>4. Collection 改为自动创建私有 collection<br>5. 元数据同步写入业务表 |
| `lib/doc-intake-service.js` | 新增公共 doc intake service，将文档 intake 事务从 app 业务 service 抽到文档平台公共层 |
| `apps/contract-mgr-v2/migrations/install.js` | 枚举增加 `sales`，增加 `revision_id` 列 |
| `apps/contract-mgr-v2/server/controllers/version-from-attachment.js` | 添加 contract_type 必填校验 |
| `apps/contract-mgr-v2/server/routes.js` | 按“仅本人数据”口径，将合同/版本读写统一传入 `userId` 做业务级 ownership 校验 |
| `scripts/upgrade-database.js` | 补齐 `sales` 枚举、`document_id` / `revision_id` 字段、contract-mgr-v2 rows 表历史兼容修补 |

### 2.2 前端变更

| 文件 | 变更内容 |
|------|----------|
| `frontend/src/api/contract-v2.ts` | `ContractVersion` 接口增加 `revision_id` |
| `frontend/src/stores/contract-v2.ts` | 1. 补回 `addVersionFromAttachment` / `fetchVersionProcessingStatus` / `doExtractMetadata` / `doCreateCompareRun` 等缺失方法<br>2. 删除自动轮询导出与依赖，状态批量刷新改为简单串行 |
| `frontend/src/components/contract-v2/ContractList.vue` | 1. processingStatusLabels 收敛为三态<br>2. 新建合同首版上传改用 `addVersionFromAttachment`，不再走旧 `mini_app_rows` 链路<br>3. 删除自动轮询依赖，改为手动刷新思路 |
| `frontend/src/components/contract-v2/ContractDetail.vue` | processingStatusLabels 收敛为三态 |
| `frontend/src/components/contract-v2/DashboardPanel.vue` | 删除刷新时重新开启自动轮询的调用 |

---

## 3. 验证结果

| 验证项 | 结果 |
|--------|------|
| `node --check server/services/contract-v2.service.js` | ✅ |
| `node --check apps/contract-mgr-v2/server/routes.js` | ✅ |
| `npm run type-check` | ✅ |

---

## 4. 遗留工作

| 事项 | 优先级 | 说明 |
|------|--------|------|
| 运行时验证 app 路由挂载 | P0 | 需启动服务验证 |
| 真实上传验证 | P1 | 需确认自动创建私有 collection、创建合同、首版上传整链路成功 |
| 真实提取验证 | P1 | 需确认元数据同时写入 `doc_document.metadata` 和 `app_contract_mgr_v2_rows` |
| 真实比对验证 | P1 | 需确认使用版本表持久化的 `revision_id` 可以稳定命中用户选择的两个业务版本 |
| models 生成闭环 | P2 | 本轮按您的决策保持“停止继续扩散手改、以迁移事实运行”，后续单独补生成流程 |

---

## 6. 本轮简化决策（与 Eric 讨论后）

| 简化项 | 决策 | 理由 |
|--------|------|------|
| Collection 配置 | **自动创建私有 collection** | 用户上传时自动创建，无需预配置；设为私有（visibility=private） |
| 状态轮询 | **删除** | 用户不需要实时知道处理进度，改用手动刷新 |
| 元数据提取 | **保持** | 自动提取 + 人工修正，简化用户工作量 |
| 版本比对 | **首版实现** | 用户自己选择版本进行比对 |

### 技术实现

1. **Collection 自动创建**
   - 命名规则：`contract_{contract_type}`（如 `contract_sales`）
   - 标记 `source_tag: 'contract-mgr-v2'`
   - visibility 设为 `private`，不在文档平台列表展示

2. **删除自动轮询**
   - 移除 `startPolling()` / `stopPolling()` 的页面依赖与 store 导出
   - 用户进入详情页时获取一次状态
   - 失败时显示重试按钮，用户可手动触发

3. **仅本人数据访问控制**
   - 合同列表、合同详情、版本列表、状态查询、提取、比对、设当前版本、删除版本均按 `created_by` / 业务归属做 ownership 校验
   - 当前不引入复杂 app 授权模型，避免继续过度设计和多轮打转

## 7. 自审结论

### 7.1 已完成并通过静态验证
- `M0-1` 移除 JS 文件中的 TS 语法，相关 `node --check` 已通过
- `M0-2` 统一 `contract_type`：前端字典、安装脚本、升级脚本已覆盖 `sales`
- `M0-3` manifest handler 与 service 参数签名已对齐，所有 from-attachment 入口都要求 `contract_type`
- `M1-5` intake 失败已整体回滚，不再创建半残版本
- `M2-6` 统一 intake 入口已按拍板方案 B 收口到 `lib/doc-intake-service.js`
- `M2-7` 业务版本与 `revision_id` 映射已持久化，并在 compare 中改为直接使用两个业务版本自身的 `revision_id`
- `M3-8` 元数据提取已同步回填业务表
- `M3-9` 前端状态展示已收口为三态，自动轮询已删除

### 7.2 尚未完成的放行项
- 审计要求的“真实上传 / 真实提取 / 真实比对验证记录”还未补齐，这部分需要运行时实测后留痕
- `models/` 生成流程本轮未重建，按当前决策保留为后续专项收口项，不继续扩大改动面

---

## 7. 提交信息

```
fix(contract-mgr-v2): 第三轮审计修复 + 设计简化

- 修复 JS 文件中的 TS 类型标注语法错误
- 数据库枚举增加 sales 类型
- manifest handler 添加 contract_type 必填校验
- intake 失败时整体回滚，不再创建半残版本
- 版本表增加 revision_id 字段用于版本比对映射
- 前端状态展示收敛为三态（处理中/完成/失败）
- 元数据提取后同步写入业务表
- Collection 改为自动创建私有 collection（用户无感知）
- 删除自动轮询，改用手动刷新
- 修复前端 store 缺失方法，首版上传切换到独立附件建版本链路
```

---

*报告生成时间：2026-06-27*
