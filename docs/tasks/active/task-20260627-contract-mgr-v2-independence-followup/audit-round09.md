# 第九轮审计报告：Contract Mgr v2 独立架构收尾复核

> 审计时间：2026-06-28 15:23 +08:00
> 审计依据：`changelog_round08.md`、`audit-round08.md`、`SELF-TEST.md`、仓库当前代码事实
> 执行结论：**补充变更点继续**
> 文档用途：**直接给开发团队执行，不是讨论稿**

---

## 1. 当前整体项目进度判断

- **整体进度**：约 `96%`
- **阶段判断**：revision 级主链路已经基本成立，当前阻塞项已从“主链路语义错位”收敛为“显示层一致性 + 验证留痕一致性”
- **当前状态**：round08 已把上一轮要求的 i18n 收尾和 `triggerMetadataExtract` 歧义清理大体完成，但还未达到“符合项目标准直接放行”的程度

### 判断依据

1. `frontend/src/api/contract-v2.ts:229` 当前只保留 `extractMetadata()`，前端 API 层的双命名歧义已消失。
2. `server/services/contract-v2.service.js:942` 当前只保留 `extractMetadata()`，service 层未再保留未使用的 `triggerMetadataExtract()`。
3. `frontend/src/components/contract-v2/ContractDetail.vue:206`、`frontend/src/components/contract-v2/ContractDetail.vue:242`、`frontend/src/components/contract-v2/ContractDetail.vue:684`、`frontend/src/components/contract-v2/ContractDetail.vue:788` 等位置，本轮新增弹窗标题、按钮文本、表头文本已基本切到 i18n。
4. `frontend/src/i18n/locales/zh-CN.ts:2257` 与 `frontend/src/i18n/locales/en-US.ts:2268` 中，`contractV2.content` 当前只保留一处定义，上一轮指出的 locale 覆盖问题已被修掉。
5. 但 `frontend/src/components/contract-v2/ContractDetail.vue:497`、`frontend/src/components/contract-v2/ContractDetail.vue:734`、`frontend/src/components/contract-v2/ContractDetail.vue:740`、`frontend/src/components/contract-v2/ContractDetail.vue:741` 仍直接展示后端原始枚举值，说明“文本接入 i18n”已做，而“用户看到的实际显示语义”还没有完全收口。
6. `docs/tasks/active/task-20260627-contract-mgr-v2-independence-followup/SELF-TEST.md:1` 仍停留在 round07，验证矩阵与 round08 代码状态没有同步更新，留痕完整性仍落后于代码事实。

---

## 2. 当前修复方向是否正确

**结论：方向正确，且 round08 没有跑偏；但当前仍属于“尾项未彻底收口”，不能直接按已完成放行。**

### 方向正确的部分

1. **上一轮要求的两项动作都已真正落地**
   - i18n 文案补齐已覆盖主要模板区、确认弹窗、上传失败提示、内容弹窗标题；
   - metadata API 歧义已按最小删除方案完成，没有被扩成新一轮接口设计。

2. **locale 结构问题已不是阻断项**
   - round08 double-check 提到的 `contractV2.content` 重复定义覆盖问题，当前代码中已消失。

3. **修复方式保持了最小改动原则**
   - 没有为 i18n 收尾和命名清理额外引入状态层、抽象层或新接口，符合前一轮“只做最小清理”的拍板要求。

### 仍有偏差的部分

1. **显示层仍残留“用户可见但未本地化”的原始枚举值**
   - 这次不再是硬编码中文问题，而是直接把内部状态值暴露给用户。

2. **验证留痕没有同步升级**
   - 代码已进入 round08，但 `SELF-TEST.md` 仍按 round07 记录，导致“变更完成度”和“验收矩阵”之间存在文档断层。

---

## 3. 对上一轮审计问题的满足情况

### 3.1 已满足

| 审计项 | 结论 | 说明 |
|--------|------|------|
| A1 / P2 `ContractDetail.vue` 用户可见文本 i18n 收口 | 已基本满足 | 见 `frontend/src/components/contract-v2/ContractDetail.vue:206`、`frontend/src/components/contract-v2/ContractDetail.vue:242`、`frontend/src/components/contract-v2/ContractDetail.vue:684`、`frontend/src/components/contract-v2/ContractDetail.vue:788` |
| A1 补齐 locale key | 已满足 | 见 `frontend/src/i18n/locales/zh-CN.ts:2163`、`frontend/src/i18n/locales/en-US.ts:2174` |
| A1 修复 `contractV2.content` 重复定义覆盖 | 已满足 | 见 `frontend/src/i18n/locales/zh-CN.ts:2257`、`frontend/src/i18n/locales/en-US.ts:2268` |
| A2 / P2 `triggerMetadataExtract` 语义歧义最小清理 | 已满足 | 见 `frontend/src/api/contract-v2.ts:229`、`server/services/contract-v2.service.js:942` |

### 3.2 部分满足

| 审计项 | 结论 | 说明 |
|--------|------|------|
| 前端显示层规范完全收口 | 部分满足 | 硬编码文案已大幅收口，但 revision / compare 状态枚举仍直接展示原始值 |
| 文档留痕完整性 | 部分满足 | `changelog_round08.md` 已补充 double-check，自述更完整；但 `SELF-TEST.md` 未同步到 round08 |

### 3.3 仍未满足

| 审计项 | 结论 | 说明 |
|--------|------|------|
| compare 算法升级到段级语义 | 未满足 | `lib/doc-compare-executor.js` 仍非本轮收口内容，继续后置 |
| 真实环境多 revision 闭环验证 | 未满足 | `docs/tasks/active/task-20260627-contract-mgr-v2-independence-followup/SELF-TEST.md:163` 起仍明确为待补 |

---

## 4. 本轮新发现的问题和缺口

### P1

#### P1-1 `ContractDetail.vue` 仍把原始状态枚举直接暴露给用户

- **证据**：
  - `frontend/src/components/contract-v2/ContractDetail.vue:497` 直接展示 `row.revision_status`
  - `frontend/src/components/contract-v2/ContractDetail.vue:734` 直接展示 `compareResult.status`
  - `frontend/src/components/contract-v2/ContractDetail.vue:740` 直接展示 `change_type`
  - `frontend/src/components/contract-v2/ContractDetail.vue:741` 直接展示 `risk_level`
- **问题性质**：显示层语义未完全收口。不是主链路 bug，但属于用户可见层面的标准缺口。
- **影响**：
  1. 中英文界面下都会看到 `pending` / `modified` / `high` / `approved` 这类内部值；
  2. 页面局部已经 i18n 化，但结果区/状态区仍像调试界面，体验不一致；
  3. 这会削弱 round08 “详情页 i18n 收口已完成”的结论可信度。
- **优先级理由**：修复范围小、收益直接、不会触碰主链路，是当前最适合的一次性放行前补项。

### P2

#### P2-1 `SELF-TEST.md` 仍停留在 round07，代码与验收矩阵脱节

- **证据**：`docs/tasks/active/task-20260627-contract-mgr-v2-independence-followup/SELF-TEST.md:1` 标题仍为“第七轮验证矩阵”，`docs/tasks/active/task-20260627-contract-mgr-v2-independence-followup/SELF-TEST.md:4` 仍写 round07。
- **问题性质**：文档留痕缺口，不是运行时 bug。
- **影响**：
  1. 当前无法从验证矩阵快速确认 round08 的 i18n/接口清理是否已纳入验收；
  2. 后续再审计时容易误判“代码已改但未声明验证范围”；
  3. 团队自测边界继续停留在上一轮，影响交付透明度。
- **优先级理由**：不阻断功能，但阻断按项目流程完成交付闭环。

---

## 5. 有没有引入新的问题和缺口

**结论：有，但没有引入新的主链路阻断；新增/残留问题主要集中在显示层完成度和验证文档同步。**

### 判断

1. **没有引入新的 revision/document 事实错位**
   - metadata 提取与 compare 仍保持 revision 级事实口径。

2. **没有引入新的 API 语义分叉**
   - `triggerMetadataExtract` 已被清掉，当前不存在“同一路径两套命名”的状态。

3. **仍暴露出一层新的“显示层尾项”**
   - 这层问题与 round08 之前的硬编码中文不同，属于“值已正确、展示仍粗糙”。

4. **文档同步不足继续存在**
   - `SELF-TEST.md` 未跟进，说明团队在“完成代码后同步验收边界”的纪律上还有短板。

---

## 6. 结论

**结论：补充变更点继续**

### 放行判断

- **当前不符合标准放行**
- **当前不需要返工重做**
- **建议状态：补充变更点继续**

### 结论理由

1. round08 要求的两项立即执行项已基本完成，方向正确，不需要返工。
2. 当前剩余问题不在主架构，也不在 revision 语义，而是放行前的显示层和文档层收口。
3. 这些问题边界小、可衡量、无需扩大设计范围，应一次性并掉后再进入放行判断。

---

## 7. 新一轮明确、可衡量的变更计划（含技术指导）

### A. 立即执行项

#### A1. 把 `ContractDetail.vue` 中仍直接显示的状态/枚举值收口到 i18n 显示语义

- **优先级**：P1
- **目标**：让详情页所有用户可见状态文本都走统一显示字典，不再直接暴露内部枚举。
- **要做什么**：
  1. 为 `revision_status` 建立显示映射；
  2. 为 compare 的 `status`、`change_type`、`risk_level` 建立显示映射；
  3. 模板中统一通过映射后的 label 展示，而不是直接输出原值。
- **验收标准**：
  1. `ContractDetail.vue` 中不再直接输出 `row.revision_status`、`compareResult.status`、`change_type`、`risk_level` 原始值；
  2. 中英文 locale 都存在对应 key；
  3. 缺省值有合理兜底（未知枚举可回退原值，但正常路径必须显示本地化文案）。
- **技术指导**：
  - 建议新增命名域：`contractV2.revisionStatuses.*`、`contractV2.compareStatuses.*`、`contractV2.compareChangeTypes.*`、`contractV2.compareRiskLevels.*`；
  - 组件内使用 `computed<Record<string, string>>` 做单一映射源，保持与本轮 `versionTypes` / `versionStatuses` 方案一致；
  - 不要把这些映射散落在模板里逐项 `if/else` 判断。

#### A2. 更新 `SELF-TEST.md` 到 round08 事实口径

- **优先级**：P2
- **目标**：让验证矩阵与当前代码状态一致，避免“代码已完成、验收文档仍停留上一轮”。
- **要做什么**：
  1. 把标题、更新时间、对应轮次改到 round08；
  2. 补入 round08 已完成项：i18n 收口、metadata API 歧义清理、locale 重复定义覆盖修复；
  3. 明确保留真实环境验证待补项，不得虚报完成。
- **验收标准**：
  1. `SELF-TEST.md` 标题、轮次、更新时间与当前代码一致；
  2. round08 新增项在验证矩阵中可逐条追溯；
  3. 未做真实环境验证的项目仍保留“静态验证通过、实测未完成”口径。
- **技术指导**：
  - 继续沿用当前文档结构，不要重写模板；
  - 强调“静态已验证 / 真实环境待补”的边界，避免把代码检查写成真实验证通过。

### B. 继续后置事项

#### B1. compare 算法升级继续后置

- **优先级**：P1（后续迭代）
- **原因**：本轮问题已不在 compare 主链路可用性，而在显示/留痕尾项。
- **技术指导**：
  - 不要在本轮顺手改 `lib/doc-compare-executor.js`；
  - 后续另行围绕段级匹配和语义摘要立项。

#### B2. 真实环境多 revision 验证继续保留待补

- **优先级**：P2（记录项）
- **原因**：当前代码事实可以静态确认，但真实环境闭环尚未在本轮补齐。
- **技术指导**：
  - 在 `SELF-TEST.md` 中继续保留 REV-1~REV-5 待补状态；
  - 不要因为本轮补了文案和映射，就把真实链路验证误写成完成。

---

## 8. 所有变更项优先级与理由汇总

| 变更项 | 优先级 | 理由 |
|--------|--------|------|
| 收口 `ContractDetail.vue` 中 revision / compare 原始枚举显示 | P1 | 用户直接可见，且是当前最主要的标准缺口 |
| 更新 `SELF-TEST.md` 到 round08 事实口径 | P2 | 不影响运行，但影响交付闭环和后续审计准确性 |
| compare 算法升级 | P1（后续） | 重要但非本轮阻断，继续后置 |
| 真实环境多 revision 验证补录 | P2（后续） | 当前仍按静态验证口径推进 |

---

## 9. 本轮开发团队表现评分

> 评分标准：`10` 为表现优秀且可直接复用；`7-8` 为整体可靠但仍有明显缺口；`6` 以下表示需要加强基本能力。

| 能力维度 | 评分 | 评价 |
|----------|------|------|
| 问题收敛能力 | 9/10 | 能按上一轮要求快速完成 i18n 收尾和 API 歧义删除，没有再次扩散范围 |
| 架构方向判断 | 9/10 | 继续守住 revision 级事实口径，没有回退到 document 级旧逻辑 |
| 全局一致性意识 | 8/10 | locale 覆盖问题也顺手修掉了，但显示层仍遗漏原始枚举直出 |
| 代码实现准确性 | 8.5/10 | round08 的两项直接改动准确，且清理方式克制 |
| 风险识别能力 | 8/10 | 能发现 locale 重复定义问题并补修，但对“原始枚举仍直出”没有提前拦住 |
| 文档留痕质量 | 7.5/10 | `changelog_round08.md` 写得更完整，但 `SELF-TEST.md` 没有同步升级，扣分明显 |
| 验证意识 | 7/10 | 静态自查还在，但验证矩阵未跟代码一起更新，说明验收同步动作不稳定 |
| 响应速度与执行力 | 9/10 | 响应快、修复集中、double-check 意识比前几轮更成熟 |

### 综合评分

- **综合得分**：`8.3/10`
- **综合评价**：
  - 团队已经进入真正意义上的收尾阶段；
  - 当前短板不再是主链路，而是**显示层细节和文档验收同步纪律**；
  - 再补完本轮 P1/P2 两项后，才更接近“符合标准放行”的状态。

---

## 10. 审计结论摘要（给团队直接执行）

1. round08 对上一轮要求的 i18n 收尾和 metadata API 歧义清理已基本完成，方向正确。
2. 当前不需要返工，但也还不能直接放行；主要剩余缺口是 `ContractDetail.vue` 仍直出原始状态枚举，以及 `SELF-TEST.md` 未同步到 round08。
3. 下一轮只做两件事：
   - 收口 revision / compare 的原始枚举显示；
   - 更新 `SELF-TEST.md` 到 round08 事实口径。
4. compare 算法升级与真实环境多 revision 验证继续后置，文档必须按事实保留待补状态。

---

*生成时间：2026-06-28 15:23 +08:00*

✌Bazinga！
