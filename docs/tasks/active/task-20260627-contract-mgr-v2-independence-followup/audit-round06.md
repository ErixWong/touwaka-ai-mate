# 第六轮审计报告执行单：Contract Mgr v2 独立架构收口

> 审计时间：2026-06-28 11:27 +08:00
> 审计依据：`changelog_round05.md`、`audit-round05.md`、`SELF-TEST.md`、仓库当前代码事实
> 执行结论：**补充变更点继续**
> 文档用途：**直接给开发团队执行，不是讨论稿**

---

## 1. 当前整体项目进度判断

- **整体进度**：约 `86%`
- **阶段判断**：主链路已从“结构接入”推进到“可用闭环”，但还处于**多 revision 语义校准期**，暂未达到放行标准
- **当前状态**：第五轮相较第四/第五轮前半段已经明显收口，compare、metadata、分页契约、旧入口拦截均有实质推进，但出现了**revision 级事实没有彻底贯穿到读取链路**的新缺口

### 判断依据

1. `apps/contract-mgr-v2/server/routes.js` 已把旧 `POST /contracts/:contractId/versions` 改为 `410` 拦截，不再继续生成无 `document_id/revision_id` 的半残版本。
2. `server/services/contract-v2.service.js` 已实现 `createVersionFromAttachment()` 的 `document_mode=new|existing`，并将 compare 主对象切到 `revision_id`。
3. `frontend/src/api/contract-v2.ts`、`frontend/src/stores/contract-v2.ts`、`frontend/src/components/contract-v2/ContractDetail.vue` 已补上 compare 结果展示与 metadata 编辑最小闭环。
4. 但 `extractMetadata()` 仍按 `document_id + is_current=1` 读取当前 revision 内容，而不是按版本自身 `revision_id` 读取；这会在“同 document 多 revision”场景下直接破坏版本级事实。
5. 当前处理状态读取仍主要基于 `document.processing_status`，没有把“版本对应 revision 的状态”与“当前 document 总状态”清晰分离，导致多 revision 场景下用户感知仍可能失真。

---

## 2. 当前修复方向是否正确

**结论：方向正确，且比上一轮明显更接近产品真实语义，但还差最后一层“revision 级读取一致性”收口。**

### 方向正确的部分

1. **旧入口旁路已被封死**
   - `apps/contract-mgr-v2/server/routes.js:124` 已明确返回 `410`，这一步是对的，而且是必须的。

2. **compare 主对象已回到 revision**
   - `server/services/contract-v2.service.js:1178` 的 `createCompareRun()` 已不再要求 `document_id` 相等，而是围绕 `version.revision_id` 创建 compare run。

3. **分页契约已向项目规范收口**
   - `server/services/contract-v2.service.js:275` 已复用 `buildPaginatedResponse()`；前端也已适配 `pagination` 结构。

4. **前后端 compare DTO 已基本一致**
   - `frontend/src/api/contract-v2.ts:237` 已切换为 `run_id/risk_level/summary` 等真实字段。

5. **版本 metadata 查看/编辑/保存最小闭环已建立**
   - 后端 `getVersionMetadata()/updateVersionMetadata()` 与前端编辑弹窗已形成最小可用路径，且其业务归属就是版本本身的 metadata。

### 仍有偏差的部分

1. **revision 语义只在“创建/比对”链路生效，未在“自动提取来源”链路彻底生效**
   - 这意味着系统已经接受“一个 document 下多个 revision”，且版本 metadata 的业务归属已经明确；但部分提取代码仍按“当前 document 当前 revision”思维实现，导致版本 metadata 的自动提取来源还没有彻底统一。

2. **版本级处理状态还没有完全独立表达**
   - 当前前端看到的更多是 document 维度状态，而不是“该版本绑定 revision 的实际可用状态”。

---

## 3. 对上一轮审计问题的满足情况

### 3.1 已满足

| 审计项 | 结论 | 说明 |
|--------|------|------|
| P0-1 compare 结果读取字段错误 | 已满足 | `getCompareRunResult()` 已按 `run_id/risk_level/summary` 实现，见 `server/services/contract-v2.service.js:1248` |
| P0-2 旧版 `createVersion()` 旁路入口 | 已满足 | 已返回 `410`，见 `apps/contract-mgr-v2/server/routes.js:124` |
| P0-3 compare 主链路最小闭环 | 已基本满足 | 已切到 `revision_id` compare，支持不同 document 的 revision 比对 |
| P1-1 compare 前后端契约分叉 | 已满足 | 前端类型已改为真实字段，见 `frontend/src/api/contract-v2.ts:237` |
| P1-4 版本 metadata 查看/编辑/保存闭环 | 已满足 | 后端接口与前端弹窗均已补齐，且编辑对象就是版本对应 metadata |
| P2-2 统一分页契约 | 已满足 | `listContracts()` 已复用 `buildPaginatedResponse()`，见 `server/services/contract-v2.service.js:275` |
| C5 最小 compare 结果可读性 | 已满足 | 详情页已可查看和刷新 compare 结果 |
| doc.controller 同类字段隐患 | 已满足 | `compare_run_id` 已修成 `run_id`，见 `server/controllers/doc.controller.js:781` |

### 3.2 部分满足

| 审计项 | 结论 | 说明 |
|--------|------|------|
| C5 真实业务验证留痕 | 部分满足 | `SELF-TEST.md` 已更新为事实矩阵，但仍缺真实环境“成功上传/成功 compare/成功提取”的证据 |
| P0-3 compare 主能力可用 | 部分满足 | 任务创建与结果读取路径已通，但尚未完成一轮真实 revision 级业务验证 |

### 3.3 仍未满足

| 审计项 | 结论 | 说明 |
|--------|------|------|
| P1-2 compare 算法升级到段级语义 | 未满足 | `lib/doc-compare-executor.js` 仍是按顺序位比较 |
| 多 revision 下版本级事实一致性 | 未满足 | 新增问题，本轮正式转为执行项 |
| 真实环境闭环验证记录 | 未满足 | 仍停留在静态验证和代码自查 |

---

## 4. 本轮新发现的问题和缺口

### P0

#### P0-1 版本 metadata 的自动提取仍按当前 active revision 取内容，会把版本 A 的提取结果写成版本 B

- **证据**：`server/services/contract-v2.service.js:949` 在 `extractMetadata()` 中通过 `document_id + is_current = 1` 查找 revision，而不是直接使用该版本已落库的 `version.revision_id`。
- **对照事实**：
  - `createVersionFromAttachment()` 已将每个业务版本绑定到独立 `revision_id`，见 `server/services/contract-v2.service.js:638`
  - compare 也已围绕 `revision_id` 工作，见 `server/services/contract-v2.service.js:1226`
- **影响**：
  - 当同一 `document` 下已有多个 revision 时，旧版本触发“提取元数据”会读取当前 active revision 的内容；
  - 最终可能把“新版本内容”回填到“旧版本 row_id”，形成**版本 metadata 业务事实错位落库**。
- **优先级理由**：这是比“UI 展示不准”更严重的问题，属于**数据写错目标版本**，必须优先修复。

### P1

#### P1-1 版本级处理状态仍未与 revision 绑定，用户看到的是 document 状态，不一定是该版本状态

- **证据**：`server/services/contract-v2.service.js:872` 的 `getVersionProcessingStatus()` 读取的是 `document.processing_status`；`getContract()` 也聚合的是当前版本 document 状态，见 `server/services/contract-v2.service.js:308`。
- **对照事实**：系统现在允许“同一 document 多 revision”；此时“document 当前状态”不等于“某一历史版本对应 revision 的处理事实”。
- **影响**：
  - 用户在版本列表里查看处理状态时，可能得到的是共享 document 的当前状态，而不是该版本自己的状态语义；
  - 会削弱“版本是独立业务对象”的可解释性。
- **优先级理由**：不会立刻写错数据，但会直接影响用户理解和后续问题排查，属于主链路一致性缺口。

#### P1-2 上传弹窗合同类型选项仍是局部口径，未完全复用完整字典

- **证据**：`frontend/src/components/contract-v2/ContractDetail.vue:75` 的 `contractTypeOptions` 仍仅包含 `sales/supply`；而同文件 `contractTypeLabels` 已包含更多合同类型，且后端配置来源允许更完整字典。
- **影响**：详情页“新增版本”时的合同类型选项仍与系统整体字典不完全一致。
- **优先级理由**：不是阻断，但会持续制造前后体验分叉。

### P2

#### P2-1 `SELF-TEST.md` 结论偏乐观，尚未把“revision 级读取风险”纳入未验证项

- **证据**：`SELF-TEST.md` 现声明 round05 多项已完成，但未覆盖“metadata 是否严格按 version.revision_id 取数”的关键校验点。
- **影响**：文档会让下一轮开发误以为“多 revision 闭环已全通”，实际没有。
- **优先级理由**：留痕问题，不阻断代码运行，但会误导协作判断。

---

## 5. 结论

**结论：补充变更点继续**

### 放行判断

- **当前不符合标准放行**
- **当前不需要返工重做**
- **建议状态：补充变更点继续**

### 结论理由

1. 第五轮针对旧入口、compare 字段、分页契约、版本 metadata 编辑闭环的修复是**真实有效**的，不再是表面打补丁。
2. 当前最大剩余问题已经不是“建不起来”或“读不到结果”，而是**版本 metadata 的自动提取来源还没有彻底绑定到该版本 revision**。
3. 这类问题如果现在不收口，后续会出现最难查的一类 bug：**版本 metadata 看似保存成功，实则提取自错误版本内容**。
4. 因此本轮不建议放行，但也不应返工重做；正确动作是继续做**小范围、定点、可验证**的补充修复。

---

## 6. 新一轮明确、可衡量的变更计划（含技术指导）

### A. 立即执行项

#### A1. 把元数据提取严格绑定到 `version.revision_id`

- **优先级**：P0
- **目标**：保证任意版本触发提取时，读取的是该版本自己的 revision 内容，而不是 document 当前 active revision。
- **要做什么**：
  1. 将 `extractMetadata()` 中 revision 查询从 `document_id + is_current=1` 改为优先使用 `version.revision_id`
  2. chunk 查询严格使用该 `revision_id`
  3. 若 `version.revision_id` 为空，明确报错，不允许回退到模糊逻辑
- **验收标准**：
  1. 同一 document 下创建两个 revision 对应两个业务版本
  2. 对旧版本执行 metadata extract，读取内容仍来自旧 revision
  3. `app_contract_mgr_v2_rows` 中对应 `row_id` 落到正确版本事实
- **技术指导**：
  - 不要再通过 `document_id` 反查 current revision；
  - 把 `version.revision_id` 当作版本事实主键，而不是辅助字段。

#### A2. 补齐“版本级处理状态”最小口径

- **优先级**：P1
- **目标**：让前端能表达“这个业务版本对应 revision 的状态”，而不是共享 document 的模糊状态。
- **要做什么**：
  1. 先明确一个最小状态源：若底层暂无 revision 级 processing 字段，则在接口层至少返回 `revision_id`、`document_id` 和当前口径说明
  2. 在 `getVersionProcessingStatus()` 返回结构里明确区分 `document_processing_status` 与 `version_revision_id`
  3. 前端展示文案要避免把 document 状态误表述成“该版本已完成”
- **验收标准**：
  1. 接口返回中能明确看到该版本绑定的 `revision_id`
  2. UI 文案不再制造“版本状态 = document 状态”的误读
- **技术指导**：
  - 现阶段不必大改平台状态机；
  - 先把数据口径讲清楚，再决定是否需要更细 revision 状态建模。

### B. 次级执行项

#### B1. 统一上传弹窗合同类型字典来源

- **优先级**：P1
- **目标**：详情页新增版本时的合同类型选项与系统字典一致。
- **要做什么**：
  1. 不再在 `ContractDetail.vue` 内硬编码 `sales/supply`
  2. 复用合同类型配置来源，至少与创建合同页/manifest 配置保持一致
- **验收标准**：
  1. 详情页合同类型选项与系统当前配置一致
  2. 不再出现“展示字典一套、上传弹窗一套”
- **技术指导**：
  - 优先复用已有配置接口/常量，不要再新增一份局部字典。

#### B2. 更新 `SELF-TEST.md`，补入 revision 级验证矩阵

- **优先级**：P2
- **目标**：让后续审计能直接看到“多 revision 取数是否正确”的事实记录。
- **要做什么**：
  1. 新增“旧版本提取 metadata 是否读取旧 revision”验证项
  2. 新增“版本状态返回是否含 revision_id/口径说明”验证项
- **验收标准**：
  1. `SELF-TEST.md` 中明确列出已验证/未验证项
  2. 不再把未验证风险写成已闭环事实
- **技术指导**：
  - 文档按事实写，不要写预期完成态。

### C. 后续正式能力项

#### C1. compare 算法从顺序位比较升级为更接近段级语义的比对

- **优先级**：P1（后续迭代）
- **为什么后置**：当前主阻断已从“能不能跑”转向“结果够不够好”；在 revision 级事实未完全收口前，不应扩大 compare 算法范围。
- **技术指导**：
  - 先保留现有 executor；
  - 后续围绕“段落重排/合并/语义近似”设计增量升级，不要在当前轮次并行大改。

---

## 7. 所有变更项优先级与理由汇总

| 变更项 | 优先级 | 理由 |
|--------|--------|------|
| `extractMetadata()` 改为严格按 `version.revision_id` 取内容 | P0 | 当前存在写错版本业务数据的风险，影响最大 |
| 版本级处理状态口径补齐 | P1 | 避免多 revision 场景下状态误读，保障主链路可解释性 |
| 上传弹窗合同类型字典统一 | P1 | 消除前端局部口径分叉，降低用户误解 |
| `SELF-TEST.md` 补 revision 级验证项 | P2 | 提升留痕准确性，避免后续协作判断失真 |
| compare 算法升级 | P1（后续） | 重要但非当前阻断，应在主链路事实稳定后推进 |

---

## 8. 本轮开发团队表现评分

> 评分标准：`10` 为表现优秀且可直接复用；`7-8` 为整体可靠但仍有明显缺口；`6` 以下表示需要加强基本能力。

| 能力维度 | 评分 | 评价 |
|----------|------|------|
| 问题收敛能力 | 8/10 | 已能把上一轮 P0/P1 关键项快速收口，旁路清理动作到位 |
| 架构方向判断 | 8/10 | 已接受并落地“compare 对象是 revision”这一核心语义，方向明显更稳 |
| 全局一致性意识 | 7/10 | 分页、DTO、旧入口处理都有改进，但 revision 级读取一致性仍漏了一层 |
| 代码实现准确性 | 6.5/10 | 主体修复有效，但 `extractMetadata()` 仍保留旧思维，说明关键事实没有贯彻到底 |
| 风险识别能力 | 6.5/10 | 能修已指出问题，但对“多 revision 下读取错位”的自发现能力还不够 |
| 文档留痕质量 | 7/10 | `changelog_round05.md` 和 `SELF-TEST.md` 比之前更诚实，但结论仍稍偏乐观 |
| 验证意识 | 6/10 | 静态验证完成度尚可，真实业务验证仍明显不足 |
| 响应速度与执行力 | 8.5/10 | 本轮修复覆盖面大、动作集中，执行效率值得肯定 |

### 综合评分

- **综合得分**：`7.2/10`
- **综合评价**：
  - 团队已经走出前几轮“边修边漂移”的状态；
  - 当前短板不再是大方向，而是**关键语义落地到最后一跳时仍会漏层**；
  - 若下一轮把 `revision_id` 贯穿到 metadata/状态读取，并补一轮真实验证，本任务就会接近放行门槛。

---

## 9. 审计结论摘要（给团队直接执行）

1. 第五轮修复**不是无效劳动**，旧入口、compare 字段、分页契约、元数据编辑闭环都已到位。
2. 当前**最大新增阻断**是：`extractMetadata()` 还没严格绑定 `version.revision_id`，这会在多 revision 场景下把数据写错版本。
3. 下一轮不要再扩范围，先做两件事：
   - 修正 metadata 读取源；
   - 把版本级状态口径讲清楚并返回给前端。
4. 完成后补真实验证记录，再进入下一轮放行判断。
