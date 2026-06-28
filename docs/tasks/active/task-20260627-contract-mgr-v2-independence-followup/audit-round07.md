# 第七轮审计报告：Contract Mgr v2 独立架构收口

> 审计时间：2026-06-28 13:45 +08:00
> 审计依据：`changelog_round06.md`、`audit-round06.md`、`SELF-TEST.md`、仓库当前代码事实
> 执行结论：**补充变更点继续**
> 文档用途：**直接给开发团队执行，不是讨论稿**

---

## 1. 当前整体项目进度判断

- **整体进度**：约 `91%`
- **阶段判断**：主链路已经从“能接入”推进到“版本级事实基本收口”，但尚未达到放行标准
- **当前状态**：第六轮对 `extractMetadata()` 的 revision 级修复是有效的，方向正确；但 compare 入口和前端提取入口仍残留 document 维度阻断，说明“版本是 revision 级业务对象”的语义还没有贯穿到最后一跳

### 判断依据

1. `server/services/contract-v2.service.js` 中 `extractMetadata()` 已严格按 `version.revision_id` 读取 chunk，并按 `version.row_id` 回填业务表，已修正上一轮最严重的数据错位风险。
2. `getVersionProcessingStatus()` 已补充 `revision_id`、`document_processing_status`、`status_scope`、`status_scope_note`，接口口径已比上一轮清晰。
3. `frontend/src/components/contract-v2/ContractDetail.vue` 已补上 tooltip 与提取结果落库目标展示，用户可见性明显提升。
4. 但 `createCompareRun()` 仍用 `document.processing_status === 'ready'` 做硬阻断，导致“历史 revision 自己已有 chunk，但 document 当前 revision 正在处理中”时仍无法 compare。
5. 前端“提取元数据”按钮也仍按 `versionProcessingStatus[row.id]?.status === 'ready'` 显示，这与后端已改为 revision 级 chunk 可用性判断产生新的前后端语义分叉。

---

## 2. 当前修复方向是否正确

**结论：方向正确，且 round06 的核心修复成立；但当前还差两处 document 级阻断清理，暂不具备放行条件。**

### 方向正确的部分

1. **metadata 提取主链路已回到 revision 级事实**
   - `server/services/contract-v2.service.js:960` 起的 `extractMetadata()` 已不再通过 `document_id + is_current=1` 取 active revision。

2. **版本状态口径已明确区分 document 与 revision**
   - `server/services/contract-v2.service.js:878` 起已返回 `revision_id`、`document_processing_status`、`status_scope`。

3. **详情页合同类型字典已统一**
   - `frontend/src/components/contract-v2/ContractDetail.vue:86` 的 `contractTypeLabels` 与 `contractTypeOptions` 已收口到单一字典来源。

4. **本轮新增用户可见文案已补齐 i18n**
   - `frontend/src/i18n/locales/zh-CN.ts:2161` 与 `frontend/src/i18n/locales/en-US.ts:2172` 已补入 `statusScopeSharedTooltip`、`extractResultTitle`、`extractTarget`。

### 仍有偏差的部分

1. **compare 创建仍按 document 当前状态阻断，而不是按两个 revision 自身可比性判断**
   - 这与 `extractMetadata()` 已完成的 revision 级修复思路不一致。

2. **前端提取入口仍按 document 共享状态决定是否可点**
   - 后端已经允许“历史版本只要有 chunk 就可提取”，前端却仍把它隐藏掉，造成能力事实与 UI 可用性脱节。

---

## 3. 对上一轮审计问题的满足情况

### 3.1 已满足

| 审计项 | 结论 | 说明 |
|--------|------|------|
| A1 / P0-1 `extractMetadata()` 严格按 `version.revision_id` 取内容 | 已满足 | 已按 `version.revision_id` 查询 revision 与 chunk，见 `server/services/contract-v2.service.js:982`、`server/services/contract-v2.service.js:998` |
| A1 同类隐患：移除 `document.metadata.contract_metadata` 错位写入 | 已满足 | 当前仅回填 `app_contract_mgr_v2_rows`，见 `server/services/contract-v2.service.js:1064` |
| A2 / P1-1 版本级处理状态口径补齐 | 已满足 | 已返回 `revision_id` / `document_processing_status` / `status_scope`，见 `server/services/contract-v2.service.js:915` |
| B1 / P1-2 上传弹窗合同类型字典统一 | 已满足 | 已复用 `contractTypeLabels`，见 `frontend/src/components/contract-v2/ContractDetail.vue:98` |
| B2 / P2-1 `SELF-TEST.md` 补 revision 级验证矩阵 | 已满足 | 已明确 REV-1/2/3 为真实环境待补项，见 `docs/tasks/active/task-20260627-contract-mgr-v2-independence-followup/SELF-TEST.md:133` |
| double-check 新增文案 i18n 化 | 已满足 | 中英文 locale 已同步，见 `frontend/src/i18n/locales/zh-CN.ts:2163`、`frontend/src/i18n/locales/en-US.ts:2174` |

### 3.2 部分满足

| 审计项 | 结论 | 说明 |
|--------|------|------|
| revision 级语义贯穿主链路 | 部分满足 | metadata 已收口，但 compare 创建与前端提取入口仍残留 document 级阻断 |
| 真实环境闭环验证记录 | 部分满足 | 文档口径已诚实，但依然缺少真实多 revision 数据验证 |

### 3.3 仍未满足

| 审计项 | 结论 | 说明 |
|--------|------|------|
| C1 compare 算法升级到段级语义 | 未满足 | `lib/doc-compare-executor.js` 仍是按 `seq` 顺序位比对 |
| revision 级 compare 可用性收口 | 未满足 | 本轮新发现，compare 入口仍被 document 当前状态误阻断 |
| revision 级提取入口前后端一致性 | 未满足 | 后端允许历史版本提取，前端按钮仍可能隐藏 |

---

## 4. 本轮新发现的问题和缺口

### P0

#### P0-1 compare 创建仍按 `document.processing_status === 'ready'` 硬阻断，历史 revision 可能被误拦

- **证据**：`server/services/contract-v2.service.js:1242` 仍要求 `docA?.processing_status === 'ready' && docB?.processing_status === 'ready'`。
- **对照事实**：`lib/doc-compare-executor.js:43` 实际 compare 读取的是 `run.base_version_id` 和 `run.target_version_id` 对应 revision 的 chunk，不依赖 document 当前 revision。
- **问题场景**：
  1. 同一 document 下旧版本 A 的 revision 已完成且 chunk 完整；
  2. 新上传版本 B 后，document 当前 revision 进入 `pending_ocr`；
  3. 此时拿版本 A 去和其他版本 compare，会被 `document.processing_status !== 'ready'` 拦截；
  4. 但 executor 其实完全可以基于版本 A 自己的 revision chunk 执行 compare。
- **影响**：这会把 round06 已经修好的“历史 revision 仍可独立取数”语义再次在 compare 链路上打断，属于主功能误阻断。
- **优先级理由**：直接影响“多版本 compare 可用性”，且与当前架构事实相违背，属于放行阻断项。

### P1

#### P1-1 前端“提取元数据”按钮仍按 document 共享状态显示，导致历史版本可提取但 UI 不可达

- **证据**：`frontend/src/components/contract-v2/ContractDetail.vue:637` 仅在 `versionProcessingStatus[row.id]?.status === 'ready'` 时显示“提取元数据”按钮。
- **对照事实**：后端 `extractMetadata()` 已改为以该版本 revision 是否存在 chunk 为准，而不是看 `document.processing_status`，见 `server/services/contract-v2.service.js:1005`。
- **问题场景**：
  1. 历史版本 revision 已有 chunk，可被后端正常提取；
  2. 但只要 document 当前 revision 正在处理中，前端拿到的共享 `processing_status` 就不是 `ready`；
  3. 按钮因此被隐藏，用户根本无法触发这条本已修好的后端能力。
- **影响**：造成“代码已修、用户不可用”的假闭环，且会误导团队以为后端修复未生效。
- **优先级理由**：不写错数据，但直接阻断用户操作，属于主链路可用性问题。

#### P1-2 compare 可用性判断与 metadata 提取可用性判断仍未统一到 revision 级 chunk 事实

- **证据**：
  - metadata 提取：`server/services/contract-v2.service.js:1005` 已按 revision chunk 可用性判断；
  - compare 创建：`server/services/contract-v2.service.js:1242` 仍按 document 状态判断。
- **影响**：同一系统内“历史版本还能不能继续工作”的规则不一致，后续会持续制造难解释问题。
- **优先级理由**：属于架构一致性缺口，若不统一，后面每加一个动作都容易再踩一遍 round06 的坑。

### P2

#### P2-1 审计与自测文档尚未把“compare 仍可能误阻断历史 revision”纳入未完成项

- **证据**：`docs/tasks/active/task-20260627-contract-mgr-v2-independence-followup/SELF-TEST.md:137` 仅覆盖提取与状态返回，尚未增加“历史 revision compare 是否仍可执行”的验证项。
- **影响**：会让下一轮误以为 revision 级闭环已经全面完成，实际 compare 主链路仍有缺口。
- **优先级理由**：留痕问题，不阻断代码运行，但会影响协作判断和验收口径。

---

## 5. 结论

**结论：补充变更点继续**

### 放行判断

- **当前不符合标准放行**
- **当前不需要返工重做**
- **建议状态：补充变更点继续**

### 结论理由

1. 第六轮对 metadata 提取来源的修复是真修，不是表面补丁。
2. 当前剩余问题集中在“document 级旧判断还残留在个别入口”，不是架构方向错误。
3. 其中 compare 创建误阻断已影响主功能闭环，前端提取入口隐藏则影响用户真实可达性。
4. 因此此轮不应放行，但也不需要推翻重做；应继续做**小范围、定点、以 revision 级事实为准**的补充收口。

---

## 5.5 对本轮审计方法的复盘（给开发团队与负责人看）

### 5.5.1 这轮审计有没有从第一性原理出发

**结论：有，且本轮判断依据基本回到了产品最小业务事实。**

本轮审计不是沿着“哪里报错修哪里”的表面路径走，而是回到以下两个基础事实：

1. **业务版本的事实主键是什么**
   - 当前项目里，业务版本已经明确绑定 `revision_id` 与 `row_id`；
   - 因此凡是“读取内容 / 提取 metadata / 发起 compare”的地方，都应优先围绕 `revision_id` 判断，而不是围绕 `document.current_revision` 判断。

2. **用户真正要完成的动作是什么**
   - 用户不是要看“document 当前状态漂不漂亮”；
   - 用户是要对“某个业务版本”做提取、比对、核对落库结果。

所以本轮审计抓住的不是代码风格问题，而是：**当前实现是否仍在拿 document 维度规则，误伤 revision 维度业务动作。**

### 5.5.2 这轮审计有没有站在项目全局考虑

**结论：有，但控制在必要范围，没有无谓扩散。**

全局视角体现在：

1. 不是只看 `extractMetadata()` 单点，而是联动核对了：
   - `createCompareRun()`
   - `lib/doc-compare-executor.js`
   - `getVersionProcessingStatus()`
   - `ContractDetail.vue` 的按钮展示逻辑
2. 不是只看“代码是否能跑”，而是同时看：
   - 产品语义是否一致
   - 前后端口径是否一致
   - 用户是否真的能操作到这条能力
3. 不是继续泛化到“compare 算法优化 / 状态机重构 / 新抽象层设计”，而是把范围压回到当前放行阻断项。

### 5.5.3 当前修复属于小修小补，还是全局优化

**结论：本轮建议属于“围绕全局语义做最后一跳收口”，不是零散小补，也不是新一轮大重构。**

更准确地说，这是：

- **不是小修小补**：因为修的是主业务语义的一致性，影响 metadata / compare / 前端入口三个层面；
- **也不是全局重构**：因为不需要推翻当前 architecture，不需要改数据库，不需要重写状态机；
- **本质上是全局语义下的定点收口**：把已经拍板的“版本=revision级对象”贯彻到最后几个遗漏入口。

这类工作应按“**小范围、强约束、快收口**”执行，禁止借题发挥搞新抽象。

### 5.5.4 最近几轮有没有在反复打转

**结论：前几轮存在局部打转，本轮开始已经明显收敛，但还有“最后一跳漏层”的重复模式。**

#### 已经摆脱的打转

1. 不再停留在“旧入口旁路 / DTO 字段错误 / 文档写乐观结论”这种浅层补洞。
2. round06 已经把最危险的“metadata 读错 revision、写错版本”问题真正修掉。

#### 仍然存在的轻度重复模式

1. **后端主逻辑修到了 revision 级，但其他入口还残留 document 级旧判断**；
2. **单点修复已完成，但前端可达性 / compare 前置校验没有同步跟进**。

这不是“大方向反复打转”，而是**同一产品语义没有一次性贯穿到底**。

#### 给开发团队的执行提醒

- 下一轮不要再围着“compare 算法要不要顺便升级”“要不要抽复杂状态机”“要不要增加更多前端提示”继续扩写；
- 当前任务只需要把**revision 级可用性判断**在 compare 和前端入口再收一遍即可。

---

## 5.6 当前看到的分歧点（需暂停定口径）

> 下面这些点已经从实现 bug 上升到“产品语义 / 验收口径 / 是否过度设计”的层级。
> 在你拍板前，不应继续自作主张扩大结论。

### 分歧点 1：前端“提取元数据”按钮是否要做强前置判断

- **现状**：后端已经能根据 revision chunk 可用性给出明确错误，但前端还在用 document 共享状态提前隐藏按钮。
- **负责人已拍板**：**按钮应明确挂在 revision 上**。打开一个 document 后，下面有多个 revision，每个 revision 都应允许独立触发“提取元数据”。
- **最小选项**：
  1. **选项 A（最小可执行）**：只要有 `document_id` 就显示按钮，能不能提取交给后端判断；
  2. **选项 B（轻增强）**：接口新增 revision 级 `extractable` 标识，前端按该标识展示按钮；
  3. **选项 C（不建议当前轮次）**：前端自己推导复杂状态，区分历史 revision / 当前 revision / chunk 状态后再决定按钮显示。
- **开发可直接执行**：
  - 选项 A 可以直接执行；
  - 选项 B 在你同意后可执行。
- **必须你拍板**：
  - 是否值得为这个按钮新增专门的 `extractable` 字段；
  - 当前轮次是否允许增加一个新接口口径。
- **已定执行口径**：按 **A** 执行。前端不要新增复杂推导，也不要为此扩大接口设计；每个 revision 直接展示提取入口，实际可提取性由后端按 revision 事实判断。

### 分歧点 2：compare 前置校验要不要抽公共 helper

- **现状**：`extractMetadata()` 和 `createCompareRun()` 都要判断 revision chunk 是否可用，但 compare 本质上是调用文档平台能力，不应在本任务里额外做平台外扩设计。
- **负责人已拍板**：先确认这部分是否就是**文档平台内现有能力**；本任务以“直接调用文档平台、去掉错误阻断”为优先，不为此额外设计新公共层。
- **最小选项**：
  1. **选项 A（最小可执行）**：先在 `createCompareRun()` 内按与 `extractMetadata()` 同样的逻辑修正，不抽 helper；
  2. **选项 B（轻收口）**：抽一个很小的 helper，只负责“检查 revision chunk 是否可用并返回语义化结果”；
  3. **选项 C（不建议当前轮次）**：抽成通用状态服务/状态机层，统一所有 revision 动作。
- **开发可直接执行**：
  - 选项 A 可以直接执行；
  - 选项 B 在开发自控范围内也可执行，但要确保 helper 足够小。
- **必须你拍板**：
  - 若团队想从 helper 扩大到“统一 revision 状态服务”，必须先拍板。
- **已定执行口径**：按 **A** 执行。本任务不新增公共抽象层，不做“文档平台外再包一层状态能力”的设计；如果文档平台已有现成 compare 能力，直接正确调用即可。

### 分歧点 3：当前轮次是否要把 compare 算法一起升级

- **现状**：当前发现的是 compare “进不去”的问题，不是 compare “算得不够智能”的问题。
- **负责人已拍板**：**不在本次任务中体现 compare 算法升级**。如果文档平台 compare 能力不够强，另开任务处理。
- **最小选项**：
  1. **选项 A（建议）**：本轮只修 compare 可进入性，不动算法；
  2. **选项 B**：在修进入性后，顺手做极小的结果可读性增强；
  3. **选项 C（当前禁止）**：直接把 compare 从顺序位比对升级到段级/语义级。
- **开发可直接执行**：
  - 选项 A 可直接执行；
  - 选项 B 仅限极小 UI 可读性增强。
- **必须你拍板**：
  - 是否进入算法升级阶段。
- **已定执行口径**：按 **A** 执行。当前任务只修“compare 入口阻断/调用口径错误”，不讨论算法强弱，不在本任务中顺带重做文档平台 compare。

### 分歧点 4：真实环境验证要做到什么程度才算本轮收口

- **现状**：当前静态验证充分，但真实环境多 revision 验证仍缺。
- **负责人已拍板**：本轮按**静态验证**作为收口标准，不要求补真实环境验证再进入下一轮判断。
- **最小选项**：
  1. **选项 A（建议）**：至少补 1 组“旧 revision 可提取 + 可 compare”的真实验证记录；
  2. **选项 B**：补完整矩阵，再决定放行；
  3. **选项 C**：继续只靠静态验证推进下一轮。
- **开发可直接执行**：
  - 选项 A、B 都可执行。
- **必须你拍板**：
  - 放行门槛到底按 A 还是 B。
- **已定执行口径**：按 **C** 执行。文档中继续如实标注“当前为静态验证口径”，但开发团队本轮不应再为了补真实环境验证而扩工作范围。

### 5.6.1 分歧点拍板后的直接执行要求

1. **前端提取按钮**：直接按 revision 展示，不再由 document 共享状态隐藏。
2. **compare 前置校验**：只修当前错误阻断，不新增公共抽象层，不额外包装文档平台能力。
3. **compare 算法**：不纳入本任务，不允许顺手扩写。
4. **验证口径**：本轮以静态验证为准，文档按事实标注即可。

---

## 6. 新一轮明确、可衡量的变更计划（含技术指导）

### A. 立即执行项

#### A1. 把 compare 创建前置校验从 document 状态切到 revision 级可比性

- **优先级**：P0
- **目标**：只要两个版本各自绑定的 revision 都有可用 chunk，就允许创建 compare run；不再被 document 当前 revision 状态误阻断。
- **要做什么**：
  1. 移除 `createCompareRun()` 中对 `docA.processing_status/docB.processing_status` 的硬依赖；
  2. 改为检查 `versionA.revision_id` / `versionB.revision_id` 对应 revision 是否存在 chunk；
  3. 若 chunk 不存在，返回明确错误，区分“当前 revision 处理中”和“历史 revision 无内容”。
- **验收标准**：
  1. 同一 document 下旧 revision 已完成、新 revision 正在 `pending_ocr` 时，旧版本仍可参与 compare；
  2. compare run 创建成功后，`lib/doc-compare-executor.js` 能正常消费两个 revision 的 chunk；
  3. 对确实无 chunk 的 revision，错误文案可区分“处理中”与“历史内容缺失”。
- **技术指导**：
  - 直接复用 round06 在 `extractMetadata()` 中已经收口好的 revision chunk 可用性判断思路；
  - compare 的事实主键是 `revision_id`，不是 `document.processing_status`。

#### A2. 收口前端“提取元数据”入口可见性，避免 document 共享状态误隐藏历史版本能力

- **优先级**：P1
- **目标**：让 UI 与后端能力一致；历史版本只要具备 revision 内容，就应该允许用户触发提取。
- **要做什么**：
  1. 移除 `ContractDetail.vue` 中仅用 `status === 'ready'` 控制“提取元数据”按钮显示的逻辑；
  2. 改为基于更合理的最小条件展示，例如“有 `document_id` 即可展示，实际可用性交给后端错误语义兜底”，或新增 revision 级可提取标识后再判断；
  3. 若按钮继续可点但后端返回“处理中/无内容”，前端直接展示后端错误，不做静默处理。
- **验收标准**：
  1. 历史 revision 在 document 当前状态非 `ready` 时，按钮仍可触达；
  2. 成功提取时仍展示 `revision_id / row_id`；
  3. 不可提取时，用户能看到明确错误原因。
- **技术指导**：
  - 当前后端已经具备足够的错误语义，前端不应再用 document 级共享状态提前替用户做错误判断；
  - 若后续要增强体验，应新增 revision 级 `extractable` 标识，而不是继续滥用 `processing_status`。

### B. 次级执行项

#### B1. 统一 compare / metadata 两条链路的“revision 可用性判断”封装

- **优先级**：P1
- **目标**：避免同类判断在多个方法里再次漂移。
- **要做什么**：
  1. 抽出一个最小公共判断函数，例如“根据 `revision_id` 检查 chunk 可用性并返回语义化状态”；
  2. `extractMetadata()` 与 `createCompareRun()` 复用同一判断口径；
  3. 错误消息模板保持一致。
- **验收标准**：
  1. compare 与 metadata 的可用性判断口径一致；
  2. 后续再加 revision 相关动作时可直接复用。
- **技术指导**：
  - 不要抽成复杂状态机，先做小而准的 helper；
  - 目标是“统一事实口径”，不是“为了复用而复用”。

#### B2. 更新 `SELF-TEST.md`，补 compare 的 revision 级验证项

- **优先级**：P2
- **目标**：把“历史 revision compare 是否仍可执行”明确写进验证矩阵。
- **要做什么**：
  1. 新增“REV-4：历史 revision 在 document 当前 revision 非 ready 时是否仍可 compare”验证项；
  2. 新增 compare 无 chunk 时的错误语义验证项；
  3. 历史记录中明确标注真实环境待补项。
- **验收标准**：
  1. 文档明确列出已验证/未验证；
  2. 不再把 compare 的 revision 级可用性缺口遗漏掉。
- **技术指导**：
  - 按事实写，不要写成“预期已通”；
  - 文档要能直接服务下一轮审计，而不是只记录开发意图。

### C. 后续正式能力项

#### C1. compare 算法从顺序位比较升级为更接近段级语义的比对

- **优先级**：P1（后续迭代）
- **为什么后置**：当前主阻断仍是“历史 revision 能否稳定进入 compare”；在可用性还未完全收口前，不应扩大算法范围。
- **技术指导**：
  - 先确保 revision 级取数和执行条件完全一致；
  - 后续再围绕段落重排、相似段匹配、语义摘要做增量升级。

---

## 7. 所有变更项优先级与理由汇总

| 变更项 | 优先级 | 理由 |
|--------|--------|------|
| `createCompareRun()` 改为按 revision chunk 可用性判断 | P0 | 当前会误阻断历史 revision compare，影响主功能闭环 |
| 前端“提取元数据”按钮去除 document 共享状态误隐藏 | P1 | 后端已可用但 UI 不可达，直接影响用户操作 |
| 统一 compare / metadata 的 revision 可用性判断封装 | P1 | 防止同类 document/revision 口径再次漂移 |
| `SELF-TEST.md` 补 compare revision 级验证项 | P2 | 提升留痕准确性，避免验收误判 |
| compare 算法升级 | P1（后续） | 重要但非当前阻断，应在可用性稳定后推进 |

---

## 8. 本轮开发团队表现评分

> 评分标准：`10` 为表现优秀且可直接复用；`7-8` 为整体可靠但仍有明显缺口；`6` 以下表示需要加强基本能力。

| 能力维度 | 评分 | 评价 |
|----------|------|------|
| 问题收敛能力 | 8.5/10 | round06 对上一轮 P0 核心问题修复到位，且主动清理了 `document.metadata` 同类隐患 |
| 架构方向判断 | 8.5/10 | 团队已经接受并落实“版本事实主键是 revision_id / row_id”这一核心方向 |
| 全局一致性意识 | 7/10 | metadata 链路已收口，但 compare 与前端入口仍残留 document 级旧判断 |
| 代码实现准确性 | 7.5/10 | 后端主修复质量较高，但最后一跳 UI/compare 条件没有完全同步 |
| 风险识别能力 | 7/10 | 能响应已指出问题，也有一定主动补漏，但对跨链路一致性仍需加强 |
| 文档留痕质量 | 8/10 | `changelog_round06.md` 与 `SELF-TEST.md` 比前几轮更诚实、可审计 |
| 验证意识 | 6.5/10 | 静态验证充足，但真实多 revision 环境验证仍明显不足 |
| 响应速度与执行力 | 8.5/10 | 修复节奏快，且能在同轮内完成 double-check 和 i18n 补洞 |

### 综合评分

- **综合得分**：`7.7/10`
- **综合评价**：
  - 团队已经明显走到收口阶段，主方向没有跑偏；
  - 当前短板主要不是不会修，而是**同一事实口径在不同入口上的同步还不够彻底**；
  - 若下一轮把 compare 与前端提取入口也统一到 revision 级判断，并补上真实环境验证，本任务将接近放行门槛。

---

## 9. 审计结论摘要（给团队直接执行）

1. round06 的 metadata 修复是有效的，版本级事实错位问题已基本解决。
2. 当前最大剩余阻断变成两处旧判断残留：
   - `createCompareRun()` 仍按 `document.processing_status` 阻断；
   - 前端“提取元数据”按钮仍按 document 共享状态隐藏。
3. 下一轮不要扩范围，先做两件事：
   - 把 compare 创建前置校验切到 revision chunk 可用性；
   - 把前端提取入口与后端能力口径对齐。
4. 完成后补 `SELF-TEST.md` 的 compare revision 级验证项，再进入下一轮放行判断。

---

*生成时间：2026-06-28 13:45 +08:00*

✌Bazinga！
