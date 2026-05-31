# ADR: Mini-app 架构处置计划

## 状态

已批准 (2026-05-31)

## 背景

当前系统中 Mini-app 作为轻量应用框架承载了多个业务模块，包括：
- 合同管理 (contract-mgr, contract-mgr-v2)
- 发票管理 (invoice-mgr)
- OCR 工具
- 知识库早期版本

随着平台战略收敛为两大业务线（文档域、数据库域），Mini-app 框架的定位需要重新评估：

1. **文档域统一**：知识库与合同比对统一到 `/api/docs/*`，不再需要 Mini-app 的文档能力
2. **数据库域独立**：发票等结构化数据业务将按数据库产品线独立建设
3. **维护成本**：Mini-app 框架的通用能力（行管理、附件、状态机、角色权限）在新架构中已被更专业的模块替代

## 决策

采用**"先保留、先冻结、暂不改造"**策略，逐步退役 Mini-app 架构。

### 当前策略（立即生效）

1. **冻结增量**：停止新增任何"文档型" Mini-app 需求
2. **路由统一**：文档域统一到 `/api/docs/*`
3. **保留存量**：现有 Mini-app 保持可用，仅做稳定性维护

### 删除前置条件

满足以下全部条件后方可启动退役：

| 条件 | 验证方式 | 当前状态 |
|------|----------|----------|
| 文档域 100% 迁移 | `/api/docs/*` 覆盖所有文档能力 | 进行中 |
| 数据库域 100% 脱离 | 发票业务不再依赖 Mini-app 路径 | 未开始 |
| API 30 天无流量 | `/api/mini-apps/*` 调用量为 0 | 待观测 |
| 表 30 天无写入 | mini_apps 相关表无新增记录 | 待观测 |
| 替代模块完成回归 | OCR/流程编排等有替代方案 | 未评估 |

## 影响范围

### 表级影响

| 表 | 数据量 | 处置建议 |
|---|--------|----------|
| mini_apps | 5 | 退役后删除 |
| mini_app_rows | 8 | 迁移到 doc_documents |
| mini_app_files | 8 | 迁移到 attachments |
| app_row_handlers | 12 | 迁移后删除 |
| app_state | 29 | 迁移后删除 |
| app_action_logs | 159 | 归档后删除 |
| app_clock_registry | 4 | 迁移后删除 |
| app_tick_log | 16447 | 归档后删除 |
| app_contract_mgr_* | 多表 | 迁移到 doc_* 表 |
| contract_v2_* | 多表 | 迁移到 doc_* 表 |

### 路由级影响

- `/api/mini-apps/*` → 迁移后退役
- `/api/kb/*` → 迁移到 `/api/docs/*`

### 自定义 Handler 影响

| App | Handler | 处置方案 |
|-----|---------|----------|
| contract-mgr-v2 | batch_upload | 迁移到文档平台上传服务 |

## 观测机制

每周输出《Mini-app 退役观测报告》，包含：
- API 调用量统计
- 数据写入量统计
- 任务执行量统计
- 替代覆盖率评估

审计脚本：`tests/mini-app-dependency-audit.js`

## 风险与应对

| 风险 | 应对 |
|------|------|
| 业务中断 | 保持存量运行，新功能走新路径 |
| 数据丢失 | 迁移前完整备份，迁移后双写验证 |
| 依赖遗漏 | 审计脚本全覆盖检查 |

## 相关文档

- 统一文档平台方案：`docs/tasks/active/task-20260531-kb-contract-unification-analysis/UNIFIED_DOCUMENT_PLATFORM_PLAN.md`
- Mini-app 依赖审计报告：`temp/mini-app-audit-report.json`

## 决策者

- Eric（产品负责人）
- Maria（架构师）