# 第四轮审计报告执行单：Contract Mgr v2 独立架构收口

> 审计时间：2026-06-27 22:11
> 执行结论：**补充变更点继续**
> 文档用途：**直接给开发团队执行，不是讨论稿**

---

## 0. 先说结论：本轮审计怎么判断

### 0.1 这轮审计有没有从第一性原理出发

**有，但还需要进一步压缩成更可执行的最小动作。**

本轮审计不是停留在“某个函数写错了”“某个 SQL 漏了”这类表层问题，而是回到了这条产品链路最基本的目标：

> 用户上传一份合同后，系统是否能稳定完成：
> `建档 -> 可查看状态 -> 可提取元数据 -> 可做版本比对`

如果这个目标不成立，那么：

- 加再多字段都不算闭环；
- 写再多兼容逻辑都不是进度；
- 做再多“看起来高级”的抽象也没有价值。

所以本轮审计的第一性原理是：

1. **先保证主链路真的能走通**；
2. **再保证用户能理解和操作**；
3. **最后才是统一抽象、模型整洁、通用化治理**。

### 0.2 这轮审计有没有站在项目全局考虑

**有，而且本轮主要是在防止局部修复继续破坏全局一致性。**

本轮审计不是只盯着 `contract-mgr-v2` 这一个 app，而是把它放回整个项目约束里看：

- 文档能力要不要复用文档平台已有入口；
- `document_collection` 的权限模型能不能被业务方绕开；
- `models/` 作为生成产物能不能继续手改；
- compare 能力到底是“业务版本比对”还是“文档 revision 比对”；
- 前端展示是不是已经开始为了“修一个 bug”而不断堆复杂状态。

也就是说，本轮不是只在查 bug，而是在查：

- 有没有继续制造旁路；
- 有没有让项目整体契约继续分叉；
- 有没有把一个本来简单的问题越修越复杂。

### 0.3 当前修复属于小修小补，还是全局优化

**当前修复本质上属于：主链路收口前的必要修补，不属于全局优化。**

换句话说：

- 已完成的语法修复、ownership 校验、三态收口，属于**必要的小修补**；
- 但 `collection`、`intake`、`compare`、`metadata` 这些点，已经不再是“小修一个 bug”层级，而是**主链路语义收口**；
- 这时如果再继续上升做“大一统架构优化”“抽象出通用框架”“统一测试脚本模式”，就是过度设计。

本阶段的正确策略不是“全局优化”，而是：

> **用最小改动把产品主链路真正走通，并停止继续发散。**

### 0.4 最近几轮有没有在反复打转

**有，且打转点已经比较明确。**

最近几轮反复打转，核心不是开发不努力，而是这几个点一直没有被明确拍板：

1. **版本比对到底比什么**
   - 比两个业务版本？
   - 还是比同一文档下两个 revision？
   - 现在代码一半按前者设计，一半按后者实现，所以一直绕。

2. **collection 到底怎么绑定**
   - 自动创建私有 collection？
   - 还是预先配置？
   - 现在虽然已经倾向“自动创建私有 collection”，但实现没有按现有平台模型落地，导致又绕回权限和字段契约。

3. **元数据回填的验收口径是什么**
   - 是“LLM 返回了 JSON”就算完成？
   - 还是“业务表里真的有数据，用户能改、能存”才算完成？
   - 这点没有钉死，就会出现“代码写了 UPDATE，但其实更新 0 行”的假闭环。

所以本轮开始，审计要求明确切换为：

> **不允许继续在未拍板的语义点上自作主张扩展实现。**

---

## 1. 审计范围

本轮基于开发团队提交的 `changelog_round03.md` 与仓库当前实际变更进行核对，重点审查：

- `apps/contract-mgr-v2/manifest.json`
- `apps/contract-mgr-v2/migrations/install.js`
- `apps/contract-mgr-v2/server/routes.js`
- `apps/contract-mgr-v2/server/controllers/version-from-attachment.js`
- `server/services/contract-v2.service.js`
- `lib/doc-intake-service.js`
- `scripts/upgrade-database.js`
- `frontend/src/api/contract-v2.ts`
- `frontend/src/stores/contract-v2.ts`
- `frontend/src/components/contract-v2/ContractList.vue`
- `frontend/src/components/contract-v2/ContractDetail.vue`
- `frontend/src/components/contract-v2/DashboardPanel.vue`
- `models/contract_v2_version.js`

同时回看上一轮审计结论：

- `docs/tasks/active/task-20260627-contract-mgr-v2-independence-followup/audit-round03.md`

---

## 2. 当前整体项目进度判断

- **整体进度**：约 `70%`
- **阶段判断**：已从“基础阻断修复期”进入“主链路校准期”
- **当前状态**：基础可运行性较第三轮明显改善，但“上传 → intake → 元数据 → 比对”闭环仍未真正成立，尚不具备放行条件

### 判断依据

1. 第三轮 P0 中最明显的语法阻断已经处理：`server/services/contract-v2.service.js` 不再混入 TS 类型标注。
2. 多数合同/版本写接口已开始把 `userId` 传入 service，通过 `ensureContractOwner()` / `ensureVersionOwner()` 做本人数据校验。
3. 但最核心的用户链路仍未闭环：
   - 自动创建私有 collection 的实现与现有 `document_collection` 模型/权限模型不一致；
   - 元数据提取声称“回填业务表”，但当前并没有保证业务表存在对应行；
   - 版本比对仍只支持同 `document_id`，与“每次上传新建一个 document”的实现天然冲突。

---

## 3. 当前修复方向判断

**方向总体正确，但当前修复仍偏“小修补串联”，还没有彻底完成主链路语义收口。**

### 已确认方向正确的部分

1. **运行时基础修复正确**
   - 已去除 JS 中的 TS 语法；
   - manifest handler 已补 `contract_type`；
   - `sales` 已补入安装脚本与升级脚本。

2. **权限口径收缩正确**
   - 合同/版本相关读写已开始统一走 `ctx.state.session.id`；
   - service 内部已加入“仅本人数据”校验。

3. **前端状态收敛方向正确**
   - 页面已向 `处理中 / 完成 / 失败` 三态收敛；
   - 删除自动轮询是正确的简化，避免继续把简单问题复杂化。

### 当前方向上的偏差

1. **把“接入文档平台”做成了“再造一个 intake 旁路”**
   - `lib/doc-intake-service.js` 与现有 `lib/document-intake.service.js` 并存，属于能力分叉，不是收口。

2. **把“字段落库”误认为“业务语义成立”**
   - `revision_id` 虽已落表，但 compare 仍与当前上传模型冲突。

3. **把“SQL 执行了”误认为“数据真的回填了”**
   - 当前没有可靠保证 `app_contract_mgr_v2_rows` 中存在对应行，元数据回填很可能只是空更新。

---

## 4. 对上一轮审计问题的满足情况

### 4.1 已满足

1. **A1 语法阻断修复**
   - `server/services/contract-v2.service.js` 中的 TS 标注已清除。
   - **状态：已满足**

2. **A2 合同类型 `sales` 入库契约补齐**
   - `apps/contract-mgr-v2/migrations/install.js` 与 `scripts/upgrade-database.js` 已补 `sales`。
   - **状态：基本满足**

3. **A3 manifest handler 参数缺失修复**
   - `apps/contract-mgr-v2/server/controllers/version-from-attachment.js` 已要求并传递 `contract_type`。
   - **状态：已满足**

4. **B1 本人数据 ownership 校验**
   - 多数合同/版本相关接口已改为 service 内部基于 `created_by` 做资源归属校验。
   - **状态：基本满足**

5. **B2 intake 失败整体回滚**
   - `createVersionFromAttachment()` 中 `DocIntakeService.createIntake()` 失败会直接抛错，事务回滚，不再继续创建半残版本。
   - **状态：已满足**

6. **B3 三态展示方向收口**
   - 前端多个位置的状态文案已统一为 `处理中 / 已完成 / 处理失败`。
   - **状态：基本满足**

### 4.2 未满足或仅部分满足

1. **C1 停止手改 `models/`**
   - 工作区仍存在 `models/contract_v2_version.js` 修改。
   - **状态：未满足**

2. **C2 统一 doc intake 公共入口**
   - 虽然新增了 `lib/doc-intake-service.js`，但没有复用现有 `lib/document-intake.service.js`，而是又新造了一套 intake 事务入口。
   - **状态：部分满足，但实现方式不达标**

3. **C3 版本与 revision 稳定映射以支撑 compare**
   - `revision_id` 已落表，这是进步；
   - 但 compare 仍要求同一 `document_id`，与当前每次上传新建 document 的实现不兼容。
   - **状态：部分满足，业务语义仍未成立**

4. **C4 元数据回填业务表并可人工修正**
   - 当前只有 UPDATE SQL，没有看到对应业务行的可靠创建逻辑，也没有人工修正保存闭环。
   - **状态：未满足**

5. **C5 真实验证留痕**
   - `changelog_round03.md` 仍以静态检查为主，没有真实上传 / 提取 / 比对成功记录。
   - **状态：未满足**

---

## 5. 当前已上升到“产品语义 / 验收口径”的分歧点

> **重要要求**：以下分歧点在拍板前，开发团队不得继续自作主张扩大结论、扩展实现或做架构发散。

### 分歧点 1：版本比对到底比什么

#### 当前看到的分歧

当前实现里同时存在两套互相冲突的语义：

- 前端和业务表述：**用户选择两个业务版本进行比对**；
- 后端实现：**只有两个版本属于同一个 `document_id` 时才允许比对**。

而当前上传实现又是：

- 每次上传都新建一个 `document_id`。

这三者不能同时成立，所以这是当前最核心的打转点。

#### 最小选项

- **选项 A：一个合同只用一个 `document_id`，多个版本映射到多个 `revision_id`**
  - 用户上传新版本时，不新建 document，只新增 revision；
  - compare 直接基于两个 `revision_id` 做比对。

- **选项 B：每个业务版本独立一个 `document_id`，平台支持跨 document compare**
  - 用户上传新版本时继续新建 document；
  - compare 需要明确支持 document A 与 document B 的比对。

#### 哪些可以由开发直接执行

- 在拍板前，开发可以先：
  1. 停止继续扩展 compare UI/交互；
  2. 把当前 compare 路由的错误提示改得更明确；
  3. 补齐比对结果读取的 ownership 校验；
  4. 真实记录“当前为什么比不通”的验证结果。

#### 哪些必须由你拍板

- **必须拍板**：最终采用选项 A 还是选项 B。
- 拍板前，开发不得继续自作主张重构 compare 模型。

---

### 分歧点 2：collection 绑定策略要不要继续设计复杂化

#### 当前看到的分歧

当前方向已倾向：

- **自动创建私有 collection**，用户无感知。

这个方向本身没问题，但开发实现又开始发散到：

- 自己定义 `source_tag`；
- 绕开现有 `document_collection` 必填字段；
- 再额外适配权限模型。

这就把本来可以很简单的方案搞复杂了。

#### 最小选项

- **选项 A：继续自动创建私有 collection，但严格复用现有平台模型**
  - 本质就是“后台帮用户点一次创建集合”；
  - 不发明新字段，不发明新权限规则。

- **选项 B：取消自动创建，改为必须预配置 collection**
  - 这会增加用户理解和配置成本。

#### 哪些可以由开发直接执行

- 在拍板前，开发可以直接执行：
  1. 按现有 `document_collection` 模型补齐 `owner_id`、`created_by`、`department_id`、`embedding_model_id`；
  2. 去掉模型中不存在的字段写入；
  3. 让自动创建后的 collection 能通过现有 `CollectionAccessService.canWrite()`。

#### 哪些必须由你拍板

- 若要从“自动创建私有 collection”改回“要求用户预配置 collection”，**必须拍板**。
- 当前从用户体验和“不要简单问题复杂化”原则出发，**默认不建议回退到预配置方案**。

---

### 分歧点 3：元数据提取的验收口径是什么

#### 当前看到的分歧

当前存在两种不同理解：

- 理解 1：LLM 成功返回了 JSON，就算元数据提取完成；
- 理解 2：业务表真实更新成功，用户能看到、能修改、能保存，才算完成。

这两者不是一个验收口径。

#### 最小选项

- **选项 A：首版验收以“业务表真实落库 + 用户可手改保存”作为完成标准**
- **选项 B：首版只要求“提取结果展示”，人工修正后移**

#### 哪些可以由开发直接执行

- 在拍板前，开发可以直接做：
  1. 创建版本时可靠初始化 `app_contract_mgr_v2_rows`；
  2. 提取后校验 UPDATE 实际影响行数；
  3. 如果 0 行，直接报错并记录，不再把“执行了 SQL”写成“已回填业务表”。

#### 哪些必须由你拍板

- **必须拍板**：首版是否要求“人工修正并保存”进入放行门槛。
- 在没有拍板前，开发不要扩展到动态 schema、复杂表单引擎、通用规则系统。

---

## 6. 本轮新发现的问题与缺口

### P0

#### P0-1 自动创建私有 collection 与现有模型契约冲突，上传主链路大概率运行失败

- **证据**：`server/services/contract-v2.service.js` 中 `getOrCreateCollection()` 创建集合时只写了 `id/name/description/visibility/source_tag/embedding_model_id/metadata`
- **对照事实**：`models/document_collection.js` 中 `owner_id`、`created_by`、`department_id`、`embedding_model_id` 均为必填，且模型中没有 `source_tag` 字段
- **影响**：自动建 collection 很可能直接失败，导致首版上传主链路不可用
- **优先级理由**：直接阻断主链路

#### P0-2 新建私有 collection 后仍无法通过 intake 写权限校验

- **证据**：`lib/doc-intake-service.js` 在创建 intake 前强制调用 `CollectionAccessService.canWrite()`；`CollectionAccessService.canWrite()` 只认 `owner_id === userId`
- **问题点**：当前自动创建 collection 时未设置 `owner_id`
- **影响**：即便 collection 创建成功，后续 intake 也会失败
- **优先级理由**：自动创建与后续写入逻辑自相矛盾

#### P0-3 版本比对主能力仍然不可用

- **证据**：`server/services/contract-v2.service.js` 中 `createCompareRun()` 明确要求 `versionA.document_id === versionB.document_id`
- **对照事实**：`createVersionFromAttachment()` 每次都会新建新的 `document_id`
- **影响**：真实多版本场景下几乎必失败
- **优先级理由**：核心能力不可验收

### P1

#### P1-1 元数据“回填业务表”实际上没有落库前提

- **证据**：`extractMetadata()` 只对 `app_contract_mgr_v2_rows` 执行 `UPDATE ... WHERE row_id = ?`
- **对照事实**：`createVersionFromAttachment()` 只插入了 `app_contract_mgr_v2_content`，没有看到向 `app_contract_mgr_v2_rows` 插入对应 `row_id` 的逻辑
- **影响**：提取成功后很可能只是更新 0 行
- **优先级理由**：业务闭环关键缺口

#### P1-2 获取比对结果接口缺少资源级授权校验

- **证据**：`GET /compare-runs/:runId` 直接调用 `getCompareRunResult()`；该方法仅按 `runId` 查询，没有校验 `created_by` 或所属合同归属
- **影响**：已登录用户若知道 `run_id`，可能读取他人的比对结果
- **优先级理由**：安全红线问题

#### P1-3 新增 `lib/doc-intake-service.js` 与现有公共 intake service 重复，且能力更弱

- **证据**：仓库已有 `lib/document-intake.service.js`
- **差异点**：现有新文件没有复用附件归属校验逻辑，也没有与既有 intake 入口保持统一契约
- **影响**：文档平台入口再次分叉
- **优先级理由**：架构债务继续扩散

#### P1-4 `manifest.json` 的字段选项仍未与当前业务字典完全统一

- **证据**：`apps/contract-mgr-v2/manifest.json` 中 `fields[].options` 仍不包含 `sales`，但 `config.contract_types` 已包含 `sales`
- **影响**：manifest 驱动入口与定制前端入口口径不一致
- **优先级理由**：事实分叉，后续还会再绕回来

### P2

#### P2-1 工作区仍手改生成产物，违反项目红线

- **证据**：`git status --short` 仍显示 `models/contract_v2_version.js` 已修改
- **影响**：后续重新生成 models 会覆盖该改动
- **优先级理由**：违反明确规则

#### P2-2 分页返回格式仍未完全对齐项目统一分页规范

- **证据**：`listContracts()` 返回 `{ items, total, page, page_size }`，未复用 `buildPaginatedResponse()`
- **影响**：当前能跑，但与项目统一分页契约不一致
- **优先级理由**：一致性问题，可后置

---

## 7. 结论

**结论：补充变更点继续**

### 放行判断

- **当前不符合标准放行**
- **但不再属于“整体返工重做”**
- 当前问题集中在少数关键闭环点，适合按执行单定点修补，不要再扩大设计范围

### 结论理由

1. 语法、参数签名、基础 ownership 校验等第三轮 P0/P1 问题已有明显修复；
2. 当前真正阻断放行的，不是“代码到处都烂”，而是少数产品语义点没有拍板、少数主链路点没有闭环；
3. 继续发散做“全局优化”“复杂抽象”“统一框架”只会让团队继续打转。

---

## 8. 给开发团队的执行单

> 规则：**先做可直接执行项，拍板项暂停，不要自作主张扩展。**

### A. 立即执行项（无需拍板）

#### A1. 修复自动建 collection 的字段契约

- **优先级**：P0
- **要做什么**：
  1. 自动建 collection 时补齐 `owner_id`、`created_by`、`department_id`、`embedding_model_id`
  2. 去掉模型中不存在的字段写入，如 `source_tag`
  3. 复用现有集合创建口径，不再自己定义第二套最小模型
- **验收标准**：
  - 真实上传一份合同时，collection 创建成功
  - 数据库中 collection 记录字段完整
- **技术指导**：
  - 参考 `DocCollectionController.createCollection()` 的字段组织方式
  - 不要在业务服务里继续“半猜测式”写集合字段

#### A2. 修复自动建 collection 后的写权限闭环

- **优先级**：P0
- **要做什么**：
  1. 确保自动创建后的 collection，当前用户就是 owner
  2. 确保后续 intake 能通过 `CollectionAccessService.canWrite()`
- **验收标准**：
  - 同一用户上传时不再报“没有 collection 写权限”
- **技术指导**：
  - 不新增权限旁路
  - 不重写 `CollectionAccessService`
  - 让数据满足现有权限模型即可

#### A3. 补齐业务表建行逻辑，停止空 UPDATE

- **优先级**：P1
- **要做什么**：
  1. 在创建版本事务内，同时初始化 `app_contract_mgr_v2_rows`
  2. 元数据提取时检查 UPDATE 影响行数
  3. 若影响行数为 0，则返回失败，不得继续写“回填成功”
- **验收标准**：
  - 版本创建后，`app_contract_mgr_v2_rows` 和 `app_contract_mgr_v2_content` 都有对应 `row_id`
  - 提取后业务表字段实际变化可查
- **技术指导**：
  - 首版只保证固定字段：`contract_number`、`party_a`、`party_b`、`contract_amount`
  - 不要上升到动态 schema

#### A4. 补齐 compare 结果读取授权

- **优先级**：P1
- **要做什么**：
  1. `GET /compare-runs/:runId` 返回前校验 `created_by`
  2. 非本人访问返回 403
- **验收标准**：
  - 他人 `run_id` 不可读
- **技术指导**：
  - 优先按 `doc_compare_run.created_by` 做最小闭环
  - 不引入新的复杂授权模型

#### A5. 统一 `contract_type` 最小口径

- **优先级**：P1
- **要做什么**：
  1. 把 `manifest.json` 中缺失的 `sales` 补齐
  2. 核对前端字典、app config、安装脚本、升级脚本是否一致
- **验收标准**：
  - 至少 `sales` / `supply` 在各入口口径一致
- **技术指导**：
  - 先做最小统一，不急着抽全局共享包

#### A6. 停止手改 `models/`

- **优先级**：P2
- **要做什么**：
  1. 撤出手工修改路径
  2. 结构变更只进入迁移脚本
  3. 后续通过生成流程刷新 model
- **验收标准**：
  - 工作区不再保留手改 `models/contract_v2_version.js`
- **技术指导**：
  - 不要为了“快修一个字段”继续碰生成产物

#### A7. 补真实验证留痕

- **优先级**：P2
- **要做什么**：
  1. 记录一条真实上传结果
  2. 记录一条真实提取结果
  3. 记录一条真实比对结果或明确失败阻断点
- **验收标准**：
  - 文档中写事实，不写意图
- **技术指导**：
  - 不接受只有 `node --check`、`type-check` 的静态留痕

---

### B. 暂停项（等待拍板）

#### B1. 比对模型最终采用哪条语义

- **优先级**：P0
- **为什么暂停**：这是产品语义分歧，不是开发自己能补逻辑解决的
- **拍板前禁止做的事**：
  - 禁止重构 compare 数据模型
  - 禁止继续扩展 compare UI
  - 禁止新增一层“临时兼容 compare 逻辑”

#### B2. 元数据验收是否必须包含“人工修正保存”

- **优先级**：P1
- **为什么暂停**：这决定首版放行门槛，不是简单实现 bug
- **拍板前禁止做的事**：
  - 禁止上动态表单引擎
  - 禁止上复杂抽象
  - 禁止为了“以后通用”扩张需求

---

## 9. 本轮变更项优先级与理由汇总

| 编号 | 变更项 | 优先级 | 理由 |
|------|--------|--------|------|
| 1 | 补齐自动建 collection 必填字段与模型契约 | P0 | 当前上传主链路可能直接失败 |
| 2 | 修复自动建 collection 后 intake 写权限 | P0 | 否则自动创建与后续写入逻辑自相矛盾 |
| 3 | 明确 compare 最终语义并完成真实比对 | P0 | 核心能力当前不可用，且最近几轮一直在这里打转 |
| 4 | 为 compare 结果读取补齐归属校验 | P1 | 防止已登录用户读取他人结果 |
| 5 | 补齐 `app_contract_mgr_v2_rows` 建行逻辑 | P1 | 否则“回填业务表”只是空更新 |
| 6 | 明确元数据首版验收口径 | P1 | 防止继续把简单问题做成复杂设计 |
| 7 | 统一 `contract_type` 单一来源 | P1 | manifest/app config/前端字典仍有分叉 |
| 8 | 停止手改 `models/` 并恢复生成流程 | P2 | 违反项目红线，但可在主链路稳定后收口 |
| 9 | 统一分页契约到项目标准 | P2 | 一致性问题，不是当前主阻断 |
| 10 | 补齐真实验证与事实型留痕 | P2 | 避免“看起来修完了，实际仍不可用” |

---

## 10. 本轮开发团队表现评分

满分 10 分。

| 维度 | 分数 | 评价 |
|------|------|------|
| 需求理解 | 8.4 | 已能围绕“独立化 + 文档平台接入 + 本人数据口径”推进 |
| 架构判断 | 6.8 | 开始向主链路收口，但在 intake / compare 上仍有语义摇摆 |
| 执行质量 | 7.0 | 语法类错误明显改善，但运行时契约问题仍较多 |
| 风险控制 | 6.2 | 对 collection 模型/权限联动、业务表建行前提预判不足 |
| 合规意识 | 6.0 | ownership 校验有所提升，但 `models/` 手改和授权遗漏仍在 |
| 验证意识 | 6.1 | 静态检查在做，但真实链路验证仍不足 |
| 留痕质量 | 6.5 | changelog 更完整，但仍有“表述已完成、事实未闭环”的问题 |
| 综合评分 | 6.7 | 已脱离返工失控态，但离可放行仍有关键闭环未完成 |

---

## 11. 最终结论

本轮结论为：**补充变更点继续**。

下一轮最小放行门槛必须同时满足：

1. 自动建 collection 与现有 `document_collection` 模型、权限模型完全一致；
2. 真实上传链路可成功落下 `document_id` 与 `revision_id`；
3. 元数据提取后业务表有真实更新，不是空 UPDATE；
4. 版本比对语义已拍板，且至少完成一次真实成功比对；
5. 比对结果读取补齐资源级授权；
6. `manifest.json`、前端字典、安装/升级脚本的 `contract_type` 保持单一口径；
7. `models/` 不再手改，相关结构通过迁移与生成流程收口。

---

*生成时间：2026-06-27 22:11*

✌Bazinga！