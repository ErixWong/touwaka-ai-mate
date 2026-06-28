# 第五轮审计报告执行单：Contract Mgr v2 独立架构收口

> 审计时间：2026-06-28 10:18 +08:00
> 审计依据：`changelog_round04.md`、仓库当前代码事实、既有审计单 `audit-round04.md`
> 执行结论：**补充变更点继续**
> 文档用途：**直接给开发团队执行，不是讨论稿**

---

## 0. 先说结论：本轮审计怎么判断

### 0.1 这轮审计有没有从第一性原理出发

**有，而且本轮已经明确回到“用户真正要得到什么”来判断，不再围着局部代码打转。**

本轮不是先看某个函数写得优不优雅，也不是先看某个模块抽象得漂不漂亮，而是先问最基本的问题：

> 用户上传一个合同版本后，系统能不能稳定完成：
> `建版本 -> 进入文档主链路 -> 可见处理状态 -> 可提取元数据 -> 可发起比对 -> 可读取比对结果`

如果这条主线不成立，那么：

- 自动建 collection 修得再完整，也不算闭环；
- compare executor 写得再“高级”，也不算完成；
- 类型定义、抽象层、分页格式再整齐，也不能掩盖产品主链路还没通。

所以本轮审计的第一性原理是：

1. **先确认用户主链路是否真的成立**；
2. **再确认系统是否只有一条主路径，而不是多条旁路并存**；
3. **最后才处理一致性、复用性、整洁性问题**。

### 0.2 这轮审计有没有站在项目全局考虑

**有，而且本轮重点就是防止局部修复再次破坏全局一致性。**

本轮不是只看 `contract-mgr-v2` 自己能不能“单点跑起来”，而是把它放回整个项目约束里审：

- 是否复用了项目统一的 `DocumentIntakeService`；
- 是否复用了现有 `document_collection` 权限模型；
- 是否继续保留能绕过文档平台的旧入口；
- compare 结果结构是否和模型、executor、前端类型一致；
- 是否违反统一分页契约；
- 是否在一个简单问题上继续引入新抽象和新语义分叉。

也就是说，本轮审计查的不是“有没有修 bug”而是：

1. **有没有继续制造平台旁路**；
2. **有没有继续扩大前后端契约分叉**；
3. **有没有把原本简单可修的问题，做成需要多轮返工的大问题**。

### 0.3 当前修复属于小修小补，还是全局优化

**结论：当前修复本质上属于“主链路收口期的定点修补”，不是全局优化，也不允许借题发挥去做大重构。**

具体分层如下：

- `collection` 字段补齐、回到公共 intake、补 `rows` 初始化、停止手改 `models/`，这些都属于**必要且正确的小修补**；
- 清理旧版 `createVersion()` 旁路、修正 compare 结果读取字段、统一 compare DTO，这些属于**主链路收口动作**；
- 若继续上升到“统一 compare 框架”“抽象标准测试脚本模式”“设计复杂兼容层”，则属于**过度设计，当前应禁止**。

本阶段正确策略不是“系统级大优化”，而是：

> **用最小正确修改，把唯一主链路钉死，把明显旁路清掉，把用户真正能看到的能力先做通。**

### 0.4 最近几轮有没有在反复打转

**有，而且打转点已经比较清楚。**

当前至少有 3 个位置在反复打转：

1. **版本 compare 的对象此前反复被实现写偏**
   - 现已拍板：**比对对象是 `revision`，不是 `document` 本身**；
   - 业务上用户选择的是“两个合同版本”，其技术落点应是“同一业务合同下，用户选择某个 `document`，再在该 `document` 上形成多个 `revision` 进行比对”；
   - `document` 是承载容器，`revision` 才是实际比对对象；
   - 最近几轮打转的根因，不是语义本身复杂，而是代码实现没有严格按这个事实落地。

2. **建版本到底保留几条入口**
   - 一边新增了 `from-attachment` 主链路；
   - 一边又保留旧 `createVersion()` 路由；
   - 结果开发和审计都需要反复判断“当前这个版本到底是不是半残版本”。

3. **compare 结果到底以谁为契约真相**
   - 模型是 `run_id/risk_level/summary`；
   - service 写成 `compare_run_id/change_severity/index`；
   - 前端类型又写成 `change_severity/description`。
   - 这说明团队最近几轮有“看着像一个功能，但其实三处各写一套”的现象。

本轮审计因此明确要求：

> **只要问题已经从实现 bug 上升到产品语义、验收口径、是否过度设计层级，就必须先停下，列出最小选项，等待拍板，不再自作主张扩大结论。**

> **本轮新增拍板结果**：
> 1. 上传时必须由用户明确选择：`创建新的 document` 或 `沿用已有 document`；
> 2. compare 的实际对象是 `revision`；
> 3. 一个 `document` 下可有多个 `revision`，且仅一个 `revision` 为 active；
> 4. 开发团队不得再把“不同 `document_id` 不能 compare”当作合理产品语义，而应把它认定为当前实现未按已拍板模型落地。

---

## 1. 当前整体项目进度判断

- **整体进度**：约 `78%`
- **阶段判断**：已完成一轮主链路修补，但仍处于“闭环校准期”，尚未达到放行门槛
- **当前状态**：A1/A2/A3/A4/A5/A6 这批明确问题多数已按最小要求修复，但 compare 主链路、分页契约、旧入口旁路、真实验证留痕仍未收口

### 判断依据

1. `server/services/contract-v2.service.js` 已补齐自动建 collection 的关键字段，并改为复用 `DocumentIntakeService` / `CollectionAccessService`，说明方向从“自造旁路”回到了平台主链路。
2. `createVersionFromAttachment()` 已同时初始化 `app_contract_mgr_v2_rows` 与 `app_contract_mgr_v2_content`，并补上 `document_id` / `revision_id` 落库，较上一轮明显前进。
3. 但核心产品能力“真实多版本 compare”仍未成立，且 compare 结果读取本身又引入了新的运行时字段错误，说明代码已接近主链路，但离验收仍差最后几处关键阻断项。

---

## 2. 当前修复方向是否正确

**结论：方向总体正确，但还没有完全收口，且本轮引入了新的实现偏差。**

### 方向正确的部分

1. **collection 自动创建方向正确**
   - 当前实现已按现有 `document_collection` 模型补 `owner_id`、`created_by`、`department_id`、`department_scope`、`embedding_model_id`，并移除了错误的 `source_tag` 依赖。

2. **intake 统一回公共入口方向正确**
   - 当前已删除自造的 `lib/doc-intake-service.js` 分叉，改为复用 `lib/document-intake.service.js`。

3. **元数据回填验收口径更接近事实**
   - 当前已在 `extractMetadata()` 中检查 `UPDATE` 的 `affectedRows`，不再把空更新说成成功。

### 仍有偏差的部分

1. **仍保留旧版 `createVersion()` 旁路入口**
   - `apps/contract-mgr-v2/server/routes.js` 仍保留 `POST /contracts/:contractId/versions`，走的是旧 `createVersion()`，不会创建 `document_id`、`revision_id`，也不会接入文档平台 intake 主链路。
   - 这意味着系统内部仍并存“两套建版本语义”，会继续制造半残版本。

2. **compare 读取实现没有按真实表结构编写**
   - `doc_compare_item` 模型真实字段为 `run_id`、`risk_level`、`summary`；但 `getCompareRunResult()` 却使用 `compare_run_id`、`change_severity`、`index`，与仓库事实不一致。
   - 这不是产品语义未拍板，而是本轮新增的直接运行时错误。

3. **分页契约仍未向项目标准收口**
   - `listContracts()` 仍返回 `{ items, total, page, page_size }`，没有复用 `buildPaginatedResponse()`，与 `AGENTS.md` 和 `docs/development/coding-standards.md` 的统一分页规范不一致。

---

## 3. 对上一轮审计问题的满足情况

### 3.1 已满足

| 审计项 | 结论 | 说明 |
|--------|------|------|
| A1 自动建 collection 字段契约 | 已满足 | 已补齐 `owner_id`、`created_by`、`department_id`、`department_scope`、`embedding_model_id` |
| A2 自动建 collection 写权限闭环 | 已满足 | 自动创建 collection 时 `owner_id = 当前用户`，后续复用 `CollectionAccessService.canWrite()` |
| A3 补齐业务表建行逻辑 | 已满足 | `createVersionFromAttachment()` 已初始化 `app_contract_mgr_v2_rows` |
| A4 compare 结果读取授权 | 已满足 | 已按 `doc_compare_run.created_by` 做最小授权闭环 |
| A5 `contract_type` 最小口径统一 | 已基本满足 | `manifest.json` 已补 `sales`，最小口径与 `config.contract_types` 对齐 |
| A6 停止手改 `models/` | 已满足 | 当前工作区无 `models/` 手改痕迹 |
| C2 / P1-3 intake 公共入口分叉 | 已满足 | 已回到 `DocumentIntakeService` |

### 3.2 部分满足

| 审计项 | 结论 | 说明 |
|--------|------|------|
| P0-3 版本 compare 主能力可用 | 部分满足 | 已有 `revision_id` 落库和授权修复，但跨版本 compare 仍被 `document_id` 相等条件阻断 |
| A7 真实验证留痕 | 部分满足 | changelog 已诚实区分静态验证与未完成项，但仍无真实上传/提取/比对成功记录 |

### 3.3 仍未满足

| 审计项 | 结论 | 说明 |
|--------|------|------|
| B1 版本 compare 最终语义闭环 | 未满足 | 当前仍只支持同 `document_id` compare，无法覆盖真实多版本场景 |
| B2 元数据“人工修正保存”闭环 | 未满足 | 当前只有提取与落库，没有查看/编辑/保存入口 |
| P2-2 统一分页契约 | 未满足 | `listContracts()` 仍未复用 `buildPaginatedResponse()` |
| C5 真实业务验证留痕 | 未满足 | 缺真实环境事实记录 |

---

## 4. 本轮新发现的问题和缺口

### P0

#### P0-1 compare 结果读取代码与真实表结构不一致，运行时大概率直接失败

- **证据**：`server/services/contract-v2.service.js` 中 `getCompareRunResult()` 使用：
  - `where: { compare_run_id: runId }`
  - `order: [['change_severity', 'DESC'], ['index', 'ASC']]`
  - 后续按 `change_severity` 分组
- **对照事实**：
  - `models/doc_compare_item.js` 真实字段为 `run_id`
  - 风险字段为 `risk_level`
  - 文本字段为 `summary`
  - 模型中没有 `compare_run_id`、`change_severity`、`index`
- **影响**：即便 compare executor 成功写入明细，结果查询接口仍可能报错或查不出结果。
- **优先级理由**：这是本轮新增的真实运行时阻断项，直接影响“已创建任务但无法读结果”。

#### P0-2 旧版 `createVersion()` 入口仍在，继续绕过文档平台主链路

- **证据**：`apps/contract-mgr-v2/server/routes.js` 仍保留 `POST /contracts/:contractId/versions`，调用 `contractV2Service.createVersion()`。
- **对照事实**：`createVersion()` 只建业务版本与 `app_contract_mgr_v2_content`，不会创建 `document_id`、`revision_id`，也不会走 `DocumentIntakeService`。
- **影响**：同一产品同时存在“接入文档平台的版本”和“未接入文档平台的版本”，会制造半残数据和后续异常分支。
- **优先级理由**：这是主链路旁路，不清掉就无法把验收口径钉死。

#### P0-3 真实多版本 compare 仍未打通

- **证据**：`server/services/contract-v2.service.js` 中 `createCompareRun()` 仍要求 `versionA.document_id === versionB.document_id`。
- **对照已拍板语义**：
  - 上传时应允许用户选择“创建新的 `document`”或“沿用已有 `document`”
  - compare 对象是 `revision`
  - 同一 `document` 下允许存在多个 `revision`，且仅一个 active
- **当前实现偏差**：当前后端没有把“上传时的 document 选择”做成正式输入模型，也没有围绕 `revision` 建立稳定 compare 主路径。
- **影响**：真实多版本 compare 仍然失败，不满足当前任务 README 中的产品目标。
- **优先级理由**：这是本任务当前最大的剩余产品阻断项。

### P1

#### P1-1 compare 结果 DTO 与 executor/模型字段口径不一致

- **证据**：
  - `lib/doc-compare-executor.js` 产出的字段是 `change_type`、`summary`、`risk_level`
  - `frontend/src/api/contract-v2.ts` 却把结果定义成 `change_severity`、`description`
- **影响**：即使服务层改对查询字段，前端类型和消费口径仍然错位，后续 UI 展示会继续出错。
- **优先级理由**：属于契约层事实分叉，修复成本不大，但不修会持续制造假问题。

#### P1-2 compare 执行算法仍停留在顺序位比较，不符合已拍板语义

- **证据**：`lib/doc-compare-executor.js` 当前按 `document_chunk.seq` 一一对位比较，只能识别 identical/modified/added/removed。
- **对照业务拍板**：上一轮变更报告已明确“先比较分段找出差异 -> 制定比较计划 -> 执行比较”，还要求识别“表面删除、实际合并到其他段”的情况。
- **影响**：即使接口跑通，也仍不能满足已拍板的 compare 语义。
- **优先级理由**：这是主能力正确性的核心缺口，但它属于拍板后的正式实现项，可排在运行时阻断修复之后。

#### P1-2a compare 主对象分歧已拍板，现转为直接执行项

- **已拍板事实**：
  1. compare 对象是 `revision`
  2. 上传时由用户选择“新建 `document`”还是“沿用已有 `document`”
  3. 若选择沿用已有 `document`，则新上传内容应形成该 `document` 的新 `revision`
  4. active 仅表示当前生效 revision，不改变 compare 的对象定义
- **现在开发可直接执行**：
  1. 为上传/建版本接口补充 `document` 选择输入
  2. 选择“沿用已有 `document`”时，落到“同 document 新 revision”链路
  3. `createCompareRun()` 改为围绕两个 `revision_id` 工作，而不是把 `document_id` 相等当成 compare 语义本身
  4. 前端明确展示当前版本挂在哪个 `document`、对应哪个 `revision`
- **禁止继续做的事**：
  - 禁止再把这个问题描述成“产品语义不清”
  - 禁止再扩展成跨文档 compare 大方案讨论
  - 禁止新增临时兼容逻辑掩盖主链路缺失

#### P1-3 前端上传/建版本口径仍与完整合同类型字典分叉

- **证据**：`frontend/src/components/contract-v2/ContractDetail.vue` 的上传弹窗 `contractTypeOptions` 仅有 `sales` / `supply`；而列表字典和 manifest 仍包含更多合同类型。
- **影响**：用户在详情页新增版本时的选择口径与创建合同时的类型字典不完全一致。
- **优先级理由**：不是主阻断，但会继续制造产品理解偏差。

#### P1-4 元数据人工修正口径已拍板，现转为直接执行项

- **已拍板事实**：
  1. 元数据提取后先保存到业务表
  2. 用户可以修改，也可以不修改
  3. 若用户修改，本质上就是一个 `key/value` 编辑器
  4. 这就是完整首版闭环，不需要额外上复杂抽象
- **当前实现缺口**：
  - 当前已接近“提取后落表”，但还缺“查看已提取字段 + key/value 修改 + 保存回表”这条用户可见闭环
- **现在开发可直接执行**：
  1. 在详情页或版本页展示当前已落表的元数据字段
  2. 提供最小 `key/value` 编辑器，先覆盖当前已落库的固定字段
  3. 保存时直接更新 `app_contract_mgr_v2_rows`
  4. 显示保存成功/失败，不做额外复杂流程
- **禁止继续做的事**：
  - 禁止扩展成动态表单引擎
  - 禁止讨论通用 schema 平台
  - 禁止为了“以后支持更多合同类型”先做过度抽象

### P2

#### P2-1 `listContracts()` 仍未复用统一分页响应构造

- **证据**：`server/services/contract-v2.service.js` 仍返回 `{ items, total, page, page_size }`。
- **对照规则**：项目明确要求分页接口复用 `buildPaginatedResponse()`。
- **影响**：当前前端可跑，但与全项目统一契约不一致，后续维护成本增加。
- **优先级理由**：一致性问题，可后置，但不应再长期搁置。

#### P2-2 真实验证矩阵文档仍未按事实更新

- **证据**：`SELF-TEST.md` 仍主要停留在第一轮模板，没有把“本轮哪些已验证、哪些未验证”按事实落文档。
- **影响**：开发与审计之间仍需要反复从 changelog 里人工拼装验证状态。
- **优先级理由**：留痕问题，不阻断代码运行，但影响后续协作效率。

---

## 5. 结论

**结论：补充变更点继续**

### 放行判断

- **当前不符合标准放行**
- **当前不需要返工重做**
- **建议状态：补充变更点继续**

### 结论理由

1. 本轮针对 collection/intake/rows/model 生成产物的修复是有效的，说明开发团队方向明显更稳。
2. 但 compare 相关仍同时存在：
   - 主语义未闭环；
   - 结果读取字段写错；
   - 前后端结果 DTO 分叉。
3. 再加上旧版 `createVersion()` 旁路仍保留，所以现在还不能说“产品主链路已唯一化”。
4. 最近几轮已出现“主链路未钉死、局部字段修一轮又冒出下一轮”的打转迹象，因此本轮执行单必须强制转为最小动作、最小决策、最小扩张。

---

## 6. 新一轮明确、可衡量的变更计划（含技术指导）

### A. 立即执行项

#### A1. 修复 compare 结果读取字段错误

- **优先级**：P0
- **为什么现在做**：当前接口极可能直接运行失败，必须先恢复可读性。
- **要做什么**：
  1. 把 `getCompareRunResult()` 的条件从 `compare_run_id` 改为真实字段 `run_id`
  2. 把排序/分组口径从 `change_severity` 改为真实字段 `risk_level`
  3. 返回 DTO 时使用真实字段 `summary`，不要凭空映射 `description`
- **验收标准**：
  - 能通过一个已有 `run_id` 读出 `doc_compare_items`
  - 不再访问不存在字段
- **技术指导**：
  - 以 `models/doc_compare_item.js` 为唯一事实来源
  - 先修正确性，不要顺手扩展 compare UI

#### A2. 清理旧版 `createVersion()` 旁路入口

- **优先级**：P0
- **为什么现在做**：继续保留就会持续产生不带 `document_id/revision_id` 的半残版本。
- **要做什么**：
  1. 明确 `POST /contracts/:contractId/versions` 是下线、转调、还是硬拦截
  2. 前端与路由只保留唯一的“from attachment + intake”建版本主路径
  3. 若暂不能删除，至少在旧入口明确返回阻断错误，不允许再写新数据
- **验收标准**：
  - 新创建的版本全部具备 `document_id` 和 `revision_id`
  - 仓库内不存在可继续生成“无 intake 版本”的有效入口
- **技术指导**：
  - 优先做“禁用旧入口”而不是兼容两套链路
  - 这是典型“简单问题不要复杂化”的场景：不需要为旧入口设计迁移框架、兼容状态机、双写策略；首选就是下线、阻断或单点转调

#### A3. 修复 compare 前后端契约分叉

- **优先级**：P1
- **为什么现在做**：服务层修好后，前端类型不修仍会继续误用字段。
- **要做什么**：
  1. `frontend/src/api/contract-v2.ts` 的 `CompareRunResult` 改成与后端真实字段一致
  2. 若需要“高/中/低风险分组”，按 `risk_level` 显式映射
  3. 检查详情页未来展示 compare 结果时是否直接依赖了错误字段名
- **验收标准**：
  - 前后端对 compare item 的字段名完全一致
  - TypeScript 类型与 Sequelize 模型不再冲突
- **技术指导**：
  - 不要发明 `change_severity` 这类第二套命名

#### A4. 按已拍板语义实现 compare 主链路最小闭环

- **优先级**：P0
- **为什么现在做**：这是当前产品闭环最后一个核心阻断项。
- **要做什么**：
  1. 上传版本时补充 `document` 选择：`new` 或 `existing_document_id`
  2. 选择新建时，创建新的 `document`
  3. 选择沿用时，在目标 `document` 上创建新的 `revision`
  4. `createCompareRun()` 改为直接围绕两个 `revision_id` 建任务
  5. 明确 active revision 的切换和 compare 是两件事，不要混在一起实现
- **验收标准**：
  - 真实两份版本可成功发起 compare
  - 同一 `document` 下可看到多个 `revision`
  - 真实一条 compare 结果可被读取
- **技术指导**：
  - 这个问题已经拍板，不再允许继续讨论 compare 主对象
  - 先把“上传如何形成 revision”做通，再升级 compare 算法
  - 不需要设计复杂文档合并策略；用户上传时自己选择“新 document”还是“沿用 document”即可

#### A5. 补齐元数据“查看 / 编辑 / 保存”最小闭环

- **优先级**：P1
- **为什么现在做**：这个口径已经拍板，不再需要讨论验收语义，直接做最小用户闭环即可。
- **要做什么**：
  1. 元数据提取后，继续保存到 `app_contract_mgr_v2_rows`
  2. 在合同详情或版本详情中展示当前元数据字段
  3. 提供普通 `key/value` 编辑器，允许用户修改固定字段后保存
  4. 保存时直接更新业务表，不新增复杂状态流
- **验收标准**：
  - 提取后用户能看到当前落表值
  - 用户修改后能保存成功
  - 刷新页面后仍能读到更新后的值
- **技术指导**：
  - 首版只覆盖当前已有固定字段，如 `contract_number`、`party_a`、`party_b`、`contract_amount`
  - 使用现有表单组件直接实现，不做动态表单引擎
  - 本质就是 `key/value` 编辑器，不要把简单编辑需求上升成 schema 设计问题

### B. 紧随其后的补充项

#### B1. 将 compare 算法升级到已拍板的段级语义

- **优先级**：P1
- **为什么做**：当前 `seq` 对位比较无法满足“段落合并/迁移识别”的已拍板要求。
- **要做什么**：
  1. 先读取分段/章节结果，构建标准化段对象
  2. 实现段级匹配与差异分类
  3. 产出比较计划，再执行逐段 compare
- **验收标准**：
  - 能区分新增、删除、修改
  - 能识别至少一类“合并迁移”场景
- **技术指导**：
  - 先做段级 MVP，不要一上来做复杂规则引擎
  - 禁止为了“标准化”再抽一层 compare framework

#### B2. 统一列表分页契约

- **优先级**：P2
- **为什么做**：这是项目级规范要求，且后续会影响前端复用。
- **要做什么**：
  1. `listContracts()` 改为复用 `buildPaginatedResponse()`
  2. 同步前端 store/API 类型到统一 `pagination` 结构
- **验收标准**：
  - `/contracts` 返回结构与项目其他分页接口一致
- **技术指导**：
  - 参考 `server/controllers/doc-collection.controller.js` 等现有实现
  - 这是规则收口，不是重新设计分页系统；禁止借此扩展全局分页抽象

#### B3. 更新 `SELF-TEST.md` 为事实型验证矩阵

- **优先级**：P2
- **为什么做**：下一轮必须减少“changelog 说了、但审计还得重新拼事实”的沟通损耗。
- **要做什么**：
  1. 把已完成验证、未完成验证、阻断原因按事实写清
  2. 明确真实上传/提取/比对各一条记录
- **验收标准**：
  - `SELF-TEST.md` 能直接回答“当前哪些链路真的跑通过”

#### B4. 所有修补点必须遵守“用户角度优先，禁止过度设计”

- **优先级**：P1
- **为什么做**：最近几轮已经出现“一个简单问题拆很多轮、小问题越修越复杂”的风险。
- **要做什么**：
  1. 每个修补点先判断：用户真正需要的最小结果是什么
  2. 若一个问题可以通过明确提示、直接阻断、单点修补解决，就不要扩展成复杂后台流程
  3. 测试、脚本、适配层只做当前任务最小必需，不做提前抽象
- **验收标准**：
  - 本轮新增实现中，不出现为了解一个局部问题而新增一套通用框架
  - 审计执行单中的每个动作都能对应到一个直接用户价值或直接验收价值
- **技术指导**：
  - 类似“有关联数据就禁止删除”的场景，优先提示+阻断，不设计复杂补偿程序
  - 类似“补一条验证脚本”的场景，优先写最小可用脚本，不讨论统一模式、环境变量框架、设计模式抽象

---

## 7. 所有变更项优先级与理由汇总

| 编号 | 变更项 | 优先级 | 理由 |
|------|--------|--------|------|
| 1 | 修复 compare 结果读取字段错误 | P0 | 当前接口本身大概率运行失败 |
| 2 | 清理旧版 `createVersion()` 旁路 | P0 | 否则系统继续生成未接入文档平台的半残版本 |
| 3 | 按已拍板 revision 模型打通真实多版本 compare | P0 | 当前核心产品能力仍不可用，且主对象已明确不能再继续打转 |
| 4 | 修复 compare 前后端契约分叉 | P1 | 避免服务层修好后前端继续按错误字段消费 |
| 5 | compare 算法升级到段级语义 | P1 | 当前实现不满足已拍板业务要求 |
| 6 | 统一详情页上传口径与合同类型字典 | P1 | 避免入口口径继续分叉 |
| 7 | 补齐元数据 `key/value` 编辑最小闭环 | P1 | 口径已明确，本质就是简单编辑器，不应过度设计 |
| 8 | 统一分页契约 | P2 | 项目规范要求，一致性治理项 |
| 9 | 更新事实型验证矩阵 | P2 | 提升后续审计和交付效率 |
| 10 | 禁止过度设计，所有修补点按最小用户价值执行 | P1 | 防止简单问题继续修很多轮 |

---

## 8. 本轮开发团队表现评分

满分 10 分。

| 维度 | 分数 | 评价 |
|------|------|------|
| 需求理解 | 8.8 | 已能聚焦主链路，不再大幅发散 |
| 架构判断 | 7.6 | intake 分叉已收口，但旧版本入口仍未完全清掉 |
| 执行质量 | 7.4 | 多数上一轮问题已真修，但 compare 结果读取新增字段级错误 |
| 风险控制 | 7.1 | collection/rows/model 风险控制明显提升，compare 运行时风险预判仍不足 |
| 合规意识 | 8.2 | 已停止手改 `models/`，也回到了公共 service |
| 验证意识 | 6.8 | 静态验证诚实，真实链路验证仍不足 |
| 留痕质量 | 7.9 | `changelog_round04.md` 事实口径比之前清晰，但 `SELF-TEST.md` 仍未同步演进 |
| 综合评分 | 7.7 | 已进入可收口状态，但距离放行仍差 compare 主闭环和旁路清理 |

---

## 9. 最终结论

本轮结论为：**补充变更点继续**。

下一轮最小放行门槛必须同时满足：

1. compare 结果读取接口按真实字段工作，不再访问不存在字段；
2. 旧版 `createVersion()` 旁路被禁用、删除或统一转入 intake 主链路；
3. 至少完成一条按 `revision` 模型运行的真实多版本 compare 成功闭环；
4. compare 前后端 DTO 字段完全一致；
5. 元数据提取后可查看、可按 `key/value` 方式修改、可保存；
6. `SELF-TEST.md` 更新为事实型验证记录；
7. 分页契约是否本轮处理可协商，但不得再否认其为待收口项。

### 本轮执行纪律

1. 能直接修实现 bug 的，直接修，不要扩展成架构设计讨论。
2. 能通过“禁止旧入口 / 明确报错 / 页面提示”解决的问题，不要发明复杂后台流程。
3. 一旦问题上升到“产品语义、验收口径、是否过度设计”，必须按本单列出分歧点后暂停，等待拍板。
4. 拍板前，开发团队不得继续自作主张扩大结论、扩大范围、扩大抽象层。

---

*生成时间：2026-06-28 10:18 +08:00*

✌Bazinga！
