# 第二轮审计报告：Contract Mgr v2 独立架构收口

> 审计时间：2026-06-27
> 结论：**补充变更点继续**

---

## 1. 变更背景

本轮变更目标不是单点修 bug，而是把 `contract-mgr-v2` 从“独立化尝试”收口到“可接文档平台、可上传、可看状态、可继续补业务闭环”的稳定主链路。

当前仓库已推进：

- `manifest.runtime.server.routes` 已补齐；
- 前端主路径基本迁移到 `/api/apps/contract-mgr-v2/*`；
- 服务层已引入 `document_id`、状态查询、元数据提取、比对等能力；
- 但仍存在运行时阻断、前端构建失败、权限未收口、文档链路未完全对齐等问题。

---

## 2. 范围

本轮审计关注以下范围：

- `apps/contract-mgr-v2/manifest.json`
- `apps/contract-mgr-v2/server/routes.js`
- `apps/contract-mgr-v2/migrations/install.js`
- `server/services/contract-v2.service.js`
- `frontend/src/api/contract-v2.ts`
- `frontend/src/stores/contract-v2.ts`
- `frontend/src/components/contract-v2/ContractList.vue`
- `frontend/src/components/contract-v2/ContractDetail.vue`
- `models/contract_v2_version.js`
- 文档平台相关模型 / controller / API

---

## 3. 当前判断

- **整体进度**：约 `68%`
- **修复方向**：方向正确，但实现收口不足
- **修复性质**：属于“局部链路收口中的中等规模修补”，不是小修小补，也不是全局优化完成态
- **放行判断**：不能放行
- **主要原因**：存在新的 P0/P1 阻断项，且上一轮权限问题未按标准闭环

---

## 4. 关键问题

### P0

1. **前端构建失败**
   - `frontend/npm run build` 失败
   - 主要问题：错误 import、类型缺失、store 缺少 docs API import、上传参数不完整

2. **app 路由存在运行时风险**
   - `apps/contract-mgr-v2/server/routes.js` 中使用 `requireAdmin()`，但未见显式引入/定义
   - 即使 manifest 已挂载，也可能在模块加载时报错

### P1

3. **写接口仍是“认证即可写”**
   - 不符合“认证 ≠ 授权，写操作必须校验权限”的项目规则

4. **文档平台接入走了旁路实现**
   - `ContractV2Service.createDocIntake()` 直接操作文档表，没有复用统一 intake 能力入口

5. **版本比对模型未对齐**
   - 当前版本记录只有 `document_id`，没有 `revision_id`
   - 现有 compare 实现却按“同一 document 的不同 revision”设计，逻辑不成立

6. **合同级与版本级 document 状态映射未打通**
   - 前端大量依赖 `contract.document_id`
   - 但真实 `document_id` 当前在 `contract_v2_version` 侧

7. **手改 `models/` 生成产物**
   - `models/contract_v2_version.js` 被直接修改
   - 违反项目“models 禁止手改”的规则

---

## 5. 已确认的执行前提

以下事项已明确，不再继续讨论设计：

1. **上传前必须先分流**
   - 新建合同并上传首个版本
   - 或为已有合同补充版本

2. **collection 是业务级绑定，不绑定个人**
   - 由管理员提前创建并配置关联
   - 普通用户上传时不自动建 collection

3. **允许人工编辑业务字段**
   - 元数据提取不到部分字段是正常情况，不算失败

4. **用户侧状态展示首版只保留三态**
   - `处理中 / 失败 / 完成 + 重试`
   - 底层详细状态、错误码、OCR 结果系统已经保存，可供排障使用

---

## 6. 执行事项

### A. 必须立即修复（P0）

#### A1. 修复 app 路由运行时错误

- **要求**：确保 `apps/contract-mgr-v2/server/routes.js` 可正常加载
- **完成标准**：
  - app 路由能被 `AppRouterLoader` 正常挂载
  - 至少验证一个普通路由和一个 admin 路由可访问
- **技术指导**：
  - 直接复用现有 `auth.js` 中间件
  - 不新增 app 内权限封装层

#### A2. 修复前端构建错误

- **要求**：修正类型、导入、可空值和接口参数问题
- **完成标准**：
  - `frontend/npm run build` 通过
- **技术指导**：
  - 先做最小收口，不做额外重构

#### A3. 收敛上传入口与参数

- **要求**：上传前先选“新建合同”或“补充版本”
- **完成标准**：
  - 两条链路都可独立走通
  - 创建首版版本时必传 `contract_type`
  - 未选必要项时前端直接阻止提交并提示
- **技术指导**：
  - 先做最小双入口/双分支
  - 不做复杂 wizard

#### A4. 修补失败反馈

- **要求**：上传/创建失败时必须给用户明确提示
- **完成标准**：
  - 400/403/500 都能显示清晰错误
  - 不允许静默失败
- **技术指导**：
  - 直接复用 toast / 表单校验
  - 不新增复杂 modal 流程

### B. 必须补齐的合规和链路项（P1）

#### B1. 把“认证即可写”收敛为“认证 + 授权”

- **要求**：所有写接口补齐权限校验
- **完成标准**：
  - 无权限稳定返回 403
  - 至少区分 admin / 可编辑 / 只读
- **技术指导**：
  - 优先复用现有权限能力
  - 不做 RBAC 大重构

#### B2. 把 collection 改成业务配置驱动

- **要求**：删除按上传用户自动创建 collection 的逻辑
- **完成标准**：
  - collection 从配置读取
  - 未配置时禁止上传并提示联系管理员
  - 配置界面能看到“合同类型 -> collection”映射
- **技术指导**：
  - 本轮不引入“组”概念
  - 合同业务主 collection 先按 `department + self_and_descendants` 收口

#### B3. 收敛合同/版本 `document_id` 映射

- **要求**：合同列表和详情展示要命中真实 document
- **完成标准**：
  - `getContract()` / `listContracts()` 返回结构与前端展示字段一致
  - 状态轮询和重试入口可用
- **技术指导**：
  - 建议直接聚合“当前版本 document_id / processing_status”到合同 DTO

#### B4. 停止手改 `models/`，改为重新生成

- **要求**：纠正生成产物管理方式
- **完成标准**：
  - `models/contract_v2_version.js` 不再靠手改维护
  - 模型与数据库事实一致
- **技术指导**：
  - 通过迁移 + 生成流程修复
  - 不继续扩大手工修补范围

### C. 继续推进的业务闭环项（P1/P2）

#### C1. 统一 doc intake 入口

- **要求**：不要继续在 `contract-v2.service` 手工造文档 intake 事务
- **完成标准**：
  - 统一复用文档平台 intake 能力入口
- **技术指导**：
  - 抽公共 service，避免 app 侧旁路实现

#### C2. 收敛版本比对数据模型

- **要求**：把业务版本和文档 revision 的关系定义清楚并落实到代码
- **完成标准**：
  - compare 入参能稳定映射到真实 revision
  - 至少完成一条真实比对成功验证
- **技术指导**：
  - 先保证“可比”，不要扩复杂 diff 工作台

#### C3. 元数据抽取回到业务表并允许人工修正

- **要求**：抽取结果可编辑、可保存
- **完成标准**：
  - 缺字段不算失败
  - 用户可补录并保存最小业务字段集
- **技术指导**：
  - 首版固定字段表单
  - 不做动态 schema 引擎

#### C4. 状态展示收口为三态

- **要求**：合同页面只显示 `处理中 / 失败 / 完成 + 重试`
- **完成标准**：
  - 多阶段底层状态统一映射为三态
  - 失败时可重试
- **技术指导**：
  - 复用现有 `/api/docs/documents/:documentId/retry`
  - 详细状态和 OCR 结果保留给文档平台详情页/排障使用

---

## 7. 简短评分

- **方向判断**：8.9
- **执行收口**：6.0
- **风险控制**：5.6
- **验证意识**：5.9
- **综合**：6.7 / 10

评价：方向正确，但推进快于验证，导致运行时、构建、权限和链路一致性同时暴露问题。

---

## 8. 结论

本轮**不放行**，继续补充变更点。

下一轮最小验收门槛：

1. app 路由可正常挂载并运行；
2. 前端 `npm run build` 通过；
3. 写接口具备明确授权控制；
4. 上传、状态、重试、最小元数据编辑链路可真实走通；
5. 版本比对与文档 revision 关系被收口并完成一条验证记录。

---

*生成时间：2026-06-27*