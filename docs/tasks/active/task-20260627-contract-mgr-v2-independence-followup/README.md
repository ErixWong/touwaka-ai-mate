# Contract Mgr v2 独立架构收口

## 目标

为 `contract-mgr-v2` 建立独立任务留痕，并推动其从“脱离 `mini_app_rows` 的过渡态代码”收口为“基于文档平台运行的合同管理产品闭环”。

本任务的产品目标不是单纯完成技术去耦，而是让 `contract-mgr-v2` 成为一个：

1. 可绑定具体 `collection`
2. 上传合同后自动进入 doc pipeline
3. 能查看解析 / 向量化状态与进度
4. 能抽取合同业务元数据
5. 能发起版本比对并消费比对结果

的业务 app。

## 范围

当前已识别的相关代码范围包括：

- `apps/contract-mgr-v2/manifest.json`
- `apps/contract-mgr-v2/server/routes.js`
- `apps/contract-mgr-v2/server/controllers/version-from-attachment.js`
- `frontend/src/api/contract-v2.ts`
- `frontend/src/components/contract-v2/ContractDetail.vue`
- `frontend/src/components/contract-v2/ContractList.vue`
- `frontend/src/stores/contract-v2.ts`
- `server/controllers/contract-v2.controller.js`
- `server/services/contract-v2.service.js`

## 当前背景

1. `contract-mgr-v2` 当前已具备 `/api/apps/contract-mgr-v2/*` 的 app 内独立路由主路径尝试。
2. 版本建档已新增 `createVersionFromAttachment`，目标是不再依赖 legacy `mini_app_rows` 主链路。
3. 文档平台当前已具备 `collection`、`documents`、`revisions`、OCR、outline、chunk、embedding、compare-runs 等基础能力。
4. 当前 `contract-mgr-v2` 还没有真正把版本上传接入到 `collection -> documents -> revisions -> processing -> compare` 这条文档平台主链路。
5. 这批改动此前仅在 `task-20260626-app-legacy-mini-app-rows-cleanup` 中被“引用”，但不应继续归属在该任务下。

## 预期产物

1. `contract-mgr-v2` 相关代码变更的独立 changelog / audit / self-test 留痕
2. 与 `legacy-mini-app-rows-cleanup` 的任务边界彻底切分
3. 对当前专属路由、前端调用路径、权限语义和架构过渡状态的统一说明
4. `contract-mgr-v2` 与文档平台的集成方案落文档
5. 面向开发团队可执行的产品闭环推进计划

## 产品闭环定义

### 1. 产品定位

`contract-mgr-v2` 应被视为：

- **业务壳**：组织树、合同主记录、版本管理、业务字段、权限与运营动作
- **文档能力编排层**：绑定 doc platform 的 `collection`、`document`、`revision`、processing、recall、compare 能力

### 2. 业务主线

一个合同版本的标准主链路应为：

1. 先确定该合同记录关联的 `collection`
2. 上传附件后创建 doc intake，生成 `document_id`
3. 通过 doc pipeline 完成 OCR → outline → chunk → embedding
4. 在合同管理页查看 processing 状态、错误码、重试入口
5. 使用合同管理 app 自己定义的 schema 抽取元数据
6. 将抽取结果回填到 `contract_v2` 业务表
7. 使用文档平台 compare-run 发起版本比对，并在合同管理页查看结果

### 3. 合同元数据 schema 分层

#### 3.1 通用合同字段

- 合同编号
- 合同名称
- 合同类型
- 甲方
- 乙方
- 合同金额
- 币种
- 签订日期
- 生效日期
- 失效日期

#### 3.2 销售合同专属字段

- 客户所属集团（如吉利、东风等）
- 客户主体
- 业务项目
- 零件号 / 物料号
- 零件名称
- 项目代号
- 交付区域 / 工厂

#### 3.3 设计原则

- 抽取字段由 `contract-mgr-v2` 自己定义
- 文档平台负责提供 OCR / 内容树 / chunk / 向量 / compare 等底层能力
- AI 抽取结果必须允许人工确认和修改，不能直接视为最终业务事实

## 里程碑计划

### M1：可用接入

- 合同记录可绑定或继承 `collection_id`
- 上传合同后能生成 `document_id`
- 合同详情页能查看 doc pipeline 状态与错误信息

### M2：可用抽取

- 合同通用字段抽取落库
- 销售合同专属字段抽取落库
- 支持人工确认/修正抽取结果

### M3：可用比对

- 基于 doc platform `compare-runs` 发起合同版本比对
- 比对结果持久化并可从合同详情页查看
- 能按新增 / 删除 / 修改 / 风险等级消费结果

### M4：可运营

- 权限模型明确
- 失败重试与错误恢复闭环
- 审计留痕、验证矩阵、关键指标齐备

## 当前优先级重排

### P0

1. 明确 `collection` 绑定模型（合同级 / 组织级 / 类型级）
2. 把版本上传切到 doc intake 主链路
3. 稳定保存 `document_id` 与 processing 状态映射

### P1

1. 定义合同元数据抽取 schema
2. 建立人工确认 / 修正闭环
3. 打通版本比对任务与结果展示
4. 明确 `/contract-v2/*` 与 `/apps/contract-mgr-v2/*` 的迁移主次关系

### P2

1. 指标体系（抽取准确率、重试成功率、平均处理时长等）
2. 运营工具（批量重试、失败筛选、审计导出）

## 当前状态

**当前已进入放行前收尾阶段：主链路实现、revision 级语义收口、详情页 i18n/显示层收口和任务级验证矩阵已基本完成；当前主要剩余真实环境多 revision 验证补录，以及放行前文档口径持续同步。**

## 结果要求

- 后续 `contract-mgr-v2` 的变更记录、审计结论和 PR 范围应优先落在本任务目录
- `task-20260626-app-legacy-mini-app-rows-cleanup` 仅保留边界说明，不再承担本任务主留痕职责
- 开发团队后续不得再以“只脱离 `mini_app_rows`”作为完成标准，必须以“接入文档平台主链路 + 可见状态 + 可用抽取 + 可用比对”为阶段验收口径

## 当前文档清单

- `README.md`：目标、范围、里程碑、优先级
- `BRANCH.md`：分支与范围映射
- `audit-round01.md` ~ `audit-round10.md`：历轮审计结论、风险判断与执行计划
- `changelog_round01.md` ~ `changelog_round09.md`：历轮开发变更与自审补充记录
- `SELF-TEST.md`：当前验证矩阵与真实环境待补项口径

## 当前收尾判断

1. **代码层**：当前未发现新的主链路实现缺口；compare / metadata / processing / 前端显示层的已知阻断项已完成收口。
2. **文档层**：任务留痕已形成 `audit + changelog + self-test` 闭环，但仍需保持与最新进度同步，避免 README/总览说明再次过期。
3. **放行前仍待补**：`SELF-TEST.md` 中 REV-1 ~ REV-5 的真实环境多 revision 验证记录尚未补齐，因此当前仍不应宣称“符合标准放行”。

---

*创建时间：2026-06-27*
