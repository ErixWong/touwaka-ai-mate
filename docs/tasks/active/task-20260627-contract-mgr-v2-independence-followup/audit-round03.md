# 第三轮审计报告：Contract Mgr v2 独立架构收口

> 审计时间：2026-06-27
> 结论：**返工重做**

---

## 1. 本轮审计范围

本轮基于开发团队提交的 `changelog_round02.md` 与仓库当前实际改动进行核对，重点审查：

- `apps/contract-mgr-v2/server/routes.js`
- `apps/contract-mgr-v2/server/controllers/version-from-attachment.js`
- `apps/contract-mgr-v2/migrations/install.js`
- `server/services/contract-v2.service.js`
- `frontend/src/api/contract-v2.ts`
- `frontend/src/stores/contract-v2.ts`
- `frontend/src/components/contract-v2/ContractList.vue`
- `frontend/src/components/contract-v2/ContractDetail.vue`
- `models/contract_v2_version.js`
- `scripts/upgrade-database.js`

---

## 2. 当前整体项目进度判断

- **整体进度**：约 `58%`
- **阶段判断**：已从“方案讨论”进入“链路拼装期”，但距离“可放行的闭环实现”仍有明显差距
- **当前状态**：前端局部体验在补齐，但后端主链路存在新的运行阻断，导致整体进度较第二轮并未形成有效收敛

### 判断依据

1. 前端 `npm run type-check` 已通过，说明部分构建问题已被修复。
2. 但后端核心服务 `server/services/contract-v2.service.js` 当前 `node --check` 直接失败，服务代码无法通过基础语法校验。
3. 版本上传、文档 intake、元数据提取、版本比对等关键能力仍处于“局部实现 + 多处契约未收口”的状态。

---

## 3. 当前修复方向是否正确

**方向判断：部分正确，但执行方式明显失控。**

### 正确的方向

1. 已继续沿着“脱离 `mini_app_rows` 主链路依赖、转向 doc platform”的方向推进。
2. 已尝试把 `document_id` 聚合回合同 DTO，方向符合上一轮建议。
3. 已把 collection 收口为合同类型配置驱动，不再按上传用户自动创建，方向正确。
4. 前端已开始补充错误提示、上传校验、状态展示与配置入口，方向正确。

### 方向上的主要偏差

1. **把“方向正确”误当成“实现可放行”**：后端服务文件引入 TypeScript 类型标注到 `.js` 文件，属于基础执行质量失控。
2. **继续旁路实现文档 intake**：`ContractV2Service.createDocIntake()` 仍在 app 业务服务中手工拼装文档、版本、附件绑定事务，没有复用统一入口。
3. **业务类型定义未收口**：新引入的 `sales` / `supply` 路径，与合同主表安装脚本中的枚举并未统一。

---

## 4. 对上一轮审计问题的满足情况

### 4.1 已满足或基本满足

1. **A2 前端构建错误修复**：
   - `frontend/npm run type-check` 通过。
   - 说明导入、类型、若干空值处理问题已部分修复。
   - **状态：已满足**

2. **A4 失败反馈补强**：
   - `ContractList.vue`、`ContractDetail.vue` 已加入 toast / alert 反馈。
   - 不再是完全静默失败。
   - **状态：基本满足**

3. **B2 collection 改为业务配置驱动**：
   - `getOrCreateCollection()` 已不再自动创建 collection。
   - `ContractList.vue` 已增加配置弹窗入口。
   - **状态：基本满足**

4. **B3 合同/版本 document_id 映射补齐**：
   - `listContracts()` / `getContract()` 已尝试聚合 `document_id`。
   - **状态：部分满足**

### 4.2 未满足或被新问题抵消

1. **A1 app 路由运行时可用**：
   - `apps/contract-mgr-v2/server/routes.js` 已引入 `requireAdmin`，但后端核心 service 当前语法错误，整条 app 路由链路仍无法认为可运行。
   - **状态：未满足**

2. **B1 写接口“认证 + 授权”收口**：
   - `POST /contracts/:contractId/versions/from-attachment`
   - `PUT /versions/:versionId/current`
   - `POST /versions/:versionId/extract-metadata`
   - `POST /compare-runs`
   - 以上写接口仍未体现明确的资源级授权校验，仍是“登录即可写/操作”。
   - **状态：未满足**

3. **B4 停止手改 `models/`**：
   - `models/contract_v2_version.js` 继续被直接修改。
   - 虽然 `install.js` 也补了字段，但仓库事实依旧是“models 仍然手改”。
   - **状态：未满足**

4. **C1 统一 doc intake 入口**：
   - `createDocIntake()` 仍为旁路实现。
   - **状态：未满足**

5. **C2 收敛版本比对数据模型**：
   - 业务版本表仍无 `revision_id`；
   - compare 逻辑仍靠“同 document 下抓最新两个 revision”推断；
   - 与“用户选中的两个业务版本”并未形成可验证映射。
   - **状态：未满足**

6. **C3 元数据抽取回到业务表并允许人工修正**：
   - 当前仍写入文档元数据 `document.metadata`；
   - 没有形成业务表字段回填和人工修正保存闭环。
   - **状态：未满足**

7. **C4 状态展示收口为三态**：
   - 前端与 store 仍保留大量底层处理状态标签，不是明确三态收口。
   - **状态：未满足**

---

## 5. 本轮新发现的问题与缺口

### P0

#### P0-1 后端核心服务文件语法错误，服务不可启动

- **证据**：`node --check server/services/contract-v2.service.js` 失败
- **问题点**：`server/services/contract-v2.service.js` 中混入 `const versionMap: Record<string, { document_id: string | null }> = {};`
- **影响**：整个服务模块无法被 Node.js 解析，app 路由链路和主服务启动均存在直接阻断风险
- **优先级理由**：基础运行阻断，属于立即返工项

#### P0-2 合同类型契约已分叉，首版上传链路可能直接写入非法值

- **证据**：
  - `frontend/src/components/contract-v2/ContractList.vue`、`frontend/src/components/contract-v2/ContractDetail.vue` 新增 `sales`
  - `apps/contract-mgr-v2/migrations/install.js` 的 `contract_v2_main_records.contract_type` 枚举不包含 `sales`
- **影响**：创建合同时若写入 `sales`，数据库层可能报错或落库失败
- **优先级理由**：首版核心业务链路可能直接失败

#### P0-3 manifest handler 与 service 新签名不一致

- **证据**：`apps/contract-mgr-v2/server/controllers/version-from-attachment.js` 调用 `createVersionFromAttachment()` 时未传 `contract_type`
- **影响**：通过 manifest `apis` 路径触发该 handler 时会直接报 `contract_type 必填`
- **优先级理由**：同一能力存在两套入口，其中一套已经失效，属于接口断裂

### P1

#### P1-1 写接口授权模型仍未闭环

- **问题点**：多个写接口没有资源级授权，只依赖登录态或部分 admin 校验
- **影响**：与项目“认证 ≠ 授权”的红线冲突，存在越权风险
- **优先级理由**：安全与合规问题，必须在放行前关闭

#### P1-2 仍在业务服务中旁路造文档 intake

- **证据**：`server/services/contract-v2.service.js:718` 起的 `createDocIntake()`
- **影响**：重复维护文档平台事务模型，后续 revision、compare、状态同步都会继续漂移
- **优先级理由**：继续放大会形成长期架构债务

#### P1-3 compare 模型仍不成立

- **问题点**：
  - 业务版本没有 `revision_id`
  - compare 只支持“同 document 的最新两个 revision”
  - 不同 `document_id` 的版本直接不支持比对
- **影响**：前端“选择两个版本进行比对”与后端真实执行语义不一致
- **优先级理由**：核心业务能力不可验收

#### P1-4 intake 失败被吞并后仍继续创建版本

- **证据**：`createVersionFromAttachment()` 中 `createDocIntake()` 失败只记录 warn，随后继续创建 version
- **影响**：会制造“业务版本已创建但没有 document_id”的半残数据
- **优先级理由**：造成后续状态轮询、提取、比对都无法闭环

#### P1-5 文档元数据写回方向仍偏离任务目标

- **问题点**：提取结果写入 `doc_document.metadata`，没有回填合同业务表
- **影响**：人工修正、业务查询、统计与运营链路均无法基于业务表落地
- **优先级理由**：与 README 中“回填到业务表”的闭环目标不一致

#### P1-6 前端状态展示未按三态收口

- **问题点**：仍保留 `pending_ocr / pending_clean / pending_outline / pending_chunk / pending_embedding / ready / error` 等底层状态直出
- **影响**：与上一轮已经明确的产品约束不一致
- **优先级理由**：不是阻断，但会继续造成认知复杂度上升

### P2

#### P2-1 任务文档与实际改动存在偏差

- **问题点**：`changelog_round02.md` 未完整覆盖工作区真实变更，如删除 `server/controllers/contract-v2.controller.js`、`server/routes/contract-v2.routes.js`、引入 manifest handler 等
- **影响**：审计与交付留痕可信度下降
- **优先级理由**：不阻断运行，但影响后续评审效率

#### P2-2 无效或未使用状态变量残留

- **问题点**：如 `ContractDetail.vue` 中 `showCompareDialog`、`APP_ID`、`onMounted` 等存在未形成闭环使用痕迹
- **影响**：代码噪音增加，说明实现边界尚未收拢
- **优先级理由**：可在主链路修复后一起清理

---

## 6. 是否引入新的问题和缺口

**是，且已经引入新的阻断项。**

本轮不是单纯“遗留旧问题未解”，而是出现了以下新增缺口：

1. 把 TypeScript 类型写进 `.js` 服务文件，直接造成后端语法错误；
2. `sales` 新合同类型与数据库枚举未同步；
3. manifest handler 未跟随 service 新参数要求同步更新；
4. intake 失败后继续建版本，扩大半残数据风险。

这意味着当前代码质量相较第二轮并未稳定提升，而是出现“修一处、断一处”的失控信号。

---

## 7. 结论

**结论：返工重做**

### 放行判断

- **不符合标准放行**
- **不属于仅补少量变更点即可上线的状态**
- 当前更接近“方向正确但实现质量失控，需要回到主链路重新收口”的返工态

### 结论理由

1. 后端基础语法不通过，已构成 P0 运行阻断；
2. 合同类型契约不一致，首版上传链路存在真实落库失败风险；
3. 核心写接口授权未达标；
4. compare / metadata / intake 三条关键能力仍未达到 README 定义的产品闭环标准。

---

## 8. 新一轮明确、可衡量的变更计划

### M0：先恢复基础可运行性（P0）

1. **移除后端 `.js` 文件中的 TS 类型标注**
   - 验收标准：
     - `node --check server/services/contract-v2.service.js` 通过
     - `node --check apps/contract-mgr-v2/server/routes.js` 通过
   - 技术指导：
     - JS 文件只保留 JSDoc，不允许 TS 语法混入

2. **统一合同类型字典**
   - 验收标准：
     - `contract_type` 的前端选项、manifest 配置、安装脚本、升级脚本、业务校验全部一致
     - 至少明确 `sales` 是否为正式合法类型；若是，数据库枚举必须同步覆盖
   - 技术指导：
     - 优先抽单一常量源，避免前后端各写一套

3. **修复 manifest handler 与 service 参数签名**
   - 验收标准：
     - `/api/apps/contract-mgr-v2/contracts/:contractId/versions/from-attachment` 的所有入口都要求并传递 `contract_type`
   - 技术指导：
     - 不允许只修 routes.js，不修 manifest handler

### M1：收口写接口权限与失败语义（P1）

4. **为所有写接口补齐资源级授权**
   - 验收标准：
     - 创建合同、补充版本、设当前版本、触发提取、发起比对、删除版本等接口，未授权稳定返回 403
   - 技术指导：
     - 先复用现有 admin / 可编辑能力，不做 RBAC 重构

5. **禁止 intake 失败后继续创建业务版本**
   - 验收标准：
     - 上传链路要么整体成功并产出 `document_id`，要么整体失败并回滚
   - 技术指导：
     - 不接受“warn 一下继续写版本”的半成功模式

### M2：收口文档主链路模型（P1）

6. **统一 doc intake 入口**
   - 验收标准：
     - `contract-v2` 不再自己手工创建 `doc_document` / `doc_version` / attachment 绑定事务
     - 改为复用统一 intake service 或公共入口
   - 技术指导：
     - 公共 service 放到文档平台层，不放 app 业务层

7. **补齐业务版本与文档 revision 的持久化映射**
   - 验收标准：
     - 版本表或关联表中能稳定定位实际 `revision_id`
     - compare 入参使用“用户选择的两个业务版本”即可唯一映射真实 revision
   - 技术指导：
     - 先做最小映射字段，不做复杂 compare 工作台

### M3：完成最小业务闭环（P1/P2）

8. **元数据提取回填业务表并支持人工修正**
   - 验收标准：
     - 至少一组固定字段（如 `contract_number`、`party_a`、`party_b`、`effective_date`）可提取、可编辑、可保存
   - 技术指导：
     - 首版固定字段表单，不做动态 schema 引擎

9. **前端状态展示收敛为三态**
   - 验收标准：
     - 页面只显示 `处理中 / 失败 / 完成`
     - 失败时提供重试入口
   - 技术指导：
     - 底层状态仅用于内部映射，不直接暴露给用户

10. **补齐验证与留痕**
   - 验收标准：
     - `npm run type-check`
     - 至少相关后端模块语法校验通过
     - 记录一条真实上传、一条真实提取、一条真实比对验证结果
   - 技术指导：
     - changelog 必须与实际改动一一对应，不漏写新增/删除文件

---

## 9. 本轮变更项优先级与理由汇总

| 编号 | 变更项 | 优先级 | 理由 |
|------|--------|--------|------|
| 1 | 修复 `contract-v2.service.js` 语法错误 | P0 | 当前直接阻断后端运行 |
| 2 | 统一 `contract_type` 字典与数据库枚举 | P0 | 首版创建链路可能落库失败 |
| 3 | 修复 manifest handler 参数缺失 | P0 | 同能力双入口之一已失效 |
| 4 | 写接口补齐授权 | P1 | 安全与项目规则红线 |
| 5 | intake 失败必须整体回滚 | P1 | 避免制造半残业务版本 |
| 6 | 统一 doc intake 公共入口 | P1 | 防止架构旁路继续扩散 |
| 7 | 持久化版本与 revision 映射 | P1 | compare 语义当前不成立 |
| 8 | 元数据回填业务表并可人工修正 | P1 | 未达到产品闭环目标 |
| 9 | 前端状态收口为三态 | P2 | 降低复杂度，贴合产品约束 |
| 10 | 完善 changelog / self-test 留痕 | P2 | 提升交付可信度与审计效率 |

---

## 10. 本轮开发团队表现评分

满分 10 分。

| 维度 | 分数 | 评价 |
|------|------|------|
| 需求理解 | 7.8 | 能抓住独立化、collection 配置化、前端补反馈等主方向 |
| 架构判断 | 6.2 | 知道往文档平台收口，但仍继续旁路实现关键事务 |
| 执行质量 | 4.3 | 把 TS 语法写进 JS 文件，属于基础质量失守 |
| 风险控制 | 4.8 | 新增 `sales` 类型却未同步数据库与 handler，变更影响面未收口 |
| 合规意识 | 5.1 | 权限、models 生成物规则仍未真正遵守 |
| 验证意识 | 5.4 | 前端 type-check 有做，但后端最基础语法检查未覆盖 |
| 留痕质量 | 6.0 | 有 changelog，但与实际改动不完全一致 |
| 综合评分 | 5.7 | 方向对，执行失稳，当前不具备放行条件 |

---

## 11. 最终结论

本轮结论为：**返工重做**。

下一轮最小放行门槛必须同时满足：

1. 后端相关文件语法检查全部通过；
2. 合同类型字典、DB 枚举、前端选项、上传入口完全一致；
3. 写接口授权闭环完成；
4. 上传失败不落半残版本；
5. 版本与 revision 映射明确并完成一条真实比对验证；
6. 元数据可回填业务表并人工修正；
7. 三态状态展示与重试链路真实可用。

---

*生成时间：2026-06-27*
