# Audit Round 29 - 文档预览语义去兼容化重构

## 审计范围

- 任务文档：`docs/tasks/active/task-20260624-doc-preview-semantic-unification/README.md`
- 分支记录：`docs/tasks/active/task-20260624-doc-preview-semantic-unification/BRANCH.md`
- 上轮审计：`docs/tasks/active/task-20260624-doc-preview-semantic-unification/audit-round28.md`
- 本轮变更说明：`docs/tasks/active/task-20260624-doc-preview-semantic-unification/changelog_round28.md`
- 本轮代码抽查：
  - `frontend/src/api/docs.ts`
  - `frontend/src/views/DocDetailView.vue`
  - `server/controllers/doc.controller.js`
  - `lib/doc-ocr-utils.js`
- 工作树与验证事实：`git status --short`、`git branch --show-current`、`npm run type-check`、`npx eslint src/api/docs.ts`
- 模式排查：`main_markdown_attachment_id`、`preview_markdown_attachment`、`raw_markdown_attachment`、`raw_result_attachment_id|deliverables_manifest_attachment_id|image_manifest_attachment_id`

---

## 1. 一句话结论

**round28 已完成上一轮唯一阻塞项：`main_markdown_attachment_id` 已从前端正式类型 `DocProcessingStatus` 中移除，前端主消费链路继续只使用 `preview_markdown_attachment` / `raw_markdown_attachment`，且类型校验与 lint 校验通过。按本任务既定边界，本轮结论调整为：符合标准放行。**

---

## 2. 当前整体项目进度判断

### 结论

项目处于**本任务主目标已完成、仅剩非阻塞过程边界项**的阶段，可按当前任务范围进入放行态。

### 进度估算

- 预览语义统一：**100%**
- 前后端主消费链路迁移：**100%**
- 详情接口去兼容化：**100%**
- 前端正式契约收口：**100%（按本轮要求）**
- 任务边界控制：**96%**
- 文档与代码口径一致性：**98%**
- 综合进度：**约 98%**

### 判断依据

1. `frontend/src/api/docs.ts:124`-`frontend/src/api/docs.ts:132` 中，`DocProcessingStatus.ocr_result` 已只保留新语义 attachment 字段，不再暴露 legacy attachment ID 字段；
2. `frontend/src/views/DocDetailView.vue:219`、`frontend/src/views/DocDetailView.vue:224` 继续只消费 `preview_markdown_attachment` / `raw_markdown_attachment`；
3. `server/controllers/doc.controller.js:1142`-`server/controllers/doc.controller.js:1146` 已形成“前端正式类型收口、后端原始响应保留技术字段”的受控不对称；
4. `npm run type-check` 与 `npx eslint src/api/docs.ts` 已通过，说明本轮类型收口没有引入前端静态校验回归；
5. `git status --short` 显示仍有其他未提交改动，但当前 round28 对应的收口项已具备独立审计闭环。

---

## 3. 当前修复方向是否正确

### 结论

**方向正确，且当前实现已经达到本任务定义下的验收终点。**

### 具体判断

1. **方向持续正确**
   - 仍然坚持“前端业务只认新语义、后端技术字段暂作兼容保留”的最小正确策略；
   - 没有把问题扩大为数据库字段统一、外部系统迁移工程或新的接口治理工程；
   - 没有为了一处类型收尾去引入新的抽象层或验证框架。

2. **执行已从‘接近完成’进入‘完成态’**
   - round28 前阻塞放行的唯一问题是 `main_markdown_attachment_id` 仍留在前端正式类型；
   - 当前该字段已从 `frontend/src/api/docs.ts` 的状态接口类型中移除；
   - 前端 grep 未发现 `main_markdown_attachment_id` / `main_markdown_attachment` / `cleaned_markdown_attachment` 业务残留，说明契约信号与真实消费面已对齐。

3. **第一性原理判断成立**
   - 用户实际需要的是“唯一有效预览稿”与“原始稿”；
   - 当前前端正式模型已只鼓励这两种语义；
   - legacy ID 字段已全部退出前端正式状态类型，因此不再构成当前任务的阻塞项。

---

## 4. 能否满足之前审计报告提出来的问题

### 结论

**可以，round28 已满足 round28 审计报告中的全部阻塞性要求。**

### 逐项判断

1. **变更项 A：将 `main_markdown_attachment_id` 从前端正式类型中降级移除**
   - 判断：**已满足**
   - 依据：`frontend/src/api/docs.ts:124`-`frontend/src/api/docs.ts:130` 不再声明该字段。

2. **变更项 A：保留 `preview_markdown_attachment` / `raw_markdown_attachment` 作为前端唯一 attachment 语义**
   - 判断：**已满足**
   - 依据：`frontend/src/api/docs.ts:125`-`frontend/src/api/docs.ts:126` 与 `frontend/src/views/DocDetailView.vue:219`、`frontend/src/views/DocDetailView.vue:224` 一致。

3. **变更项 A：grep 核实前端零残留业务使用**
   - 判断：**已满足**
   - 依据：对 `frontend/src` 搜索 `main_markdown_attachment_id|main_markdown_attachment|cleaned_markdown_attachment` 结果为零。

4. **变更项 B：同步修正文档口径**
   - 判断：**已满足**
   - 依据：`changelog_round28.md` 已明确区分“后端响应仍保留技术字段”与“前端正式类型已移除该字段”。

5. **过程约束：禁止扩大范围**
   - 判断：**已满足**
   - 依据：本轮未改数据库、未扩成后端响应下线工程、未把其他未跟踪残留并入本任务整改项。

---

## 5. 有没有引入新的问题和缺口

### 结论

**未发现新的阻塞性问题；当前仅剩 1 个非阻塞的过程边界项。**

### 已关闭项：`DocProcessingStatus.ocr_result` 剩余 3 个 deprecated 技术 ID 字段

- 状态：**本轮已修复**
- 位置：`frontend/src/api/docs.ts:124`
- 处理结果：
  1. 已从 `DocProcessingStatus.ocr_result` 中移除 `raw_result_attachment_id`、`deliverables_manifest_attachment_id`、`image_manifest_attachment_id`；
  2. grep `frontend/src` 已确认这 3 个字段无业务消费残留；
  3. 前端状态正式类型现已只保留 `preview_markdown_attachment` / `raw_markdown_attachment` 两个 attachment 语义字段。
- 判断：
  - 该项已从“非阻塞候选”转为“已完成收口事实”，不再作为后续待办保留。

### 问题 1：任务工作树仍混有非本任务改动

- 优先级：**P2**
- 位置：`git status --short`
- 现象：当前工作树仍包含 `frontend/src/components/panel/SkillsDirectoryTab.vue`、`frontend/src/components/panel/TasksTab.vue`、i18n 文件及若干脚本等多处未提交修改，以及未跟踪文件 `page-snapshot.yml`、`scripts/request-utils.js`、`scripts/verify-round10-fix.js`、`scripts/verify-round10-simple.mjs`。
- 影响：
  1. 不影响本轮对 doc preview semantic unification 收口项的事实判断；
  2. 但会持续增加后续提交/PR 归属不清的风险。
- 理由：
  - 属于任务边界治理问题，不是当前修复方向错误，因此定为 **P2**。

### 非问题说明

1. `server/controllers/doc.controller.js:1145` 仍返回 `main_markdown_attachment_id`，这是当前任务明示允许的后端兼容保留，不构成本轮问题；
2. `lib/doc-ocr-utils.js` 内部继续读取 `main_markdown_attachment_id` 作为 `raw_markdown_attachment` 的事实源，符合“默认不改数据库字段”的设计约束，不构成回归；
3. `npm run type-check` 与 `npx eslint src/api/docs.ts` 通过，未发现静态校验层新增缺口。

---

## 6. 当前结论

### 结论

**符合标准放行**

### 为什么可以放行

1. 上轮阻塞放行的唯一必修项已经完成；
2. 前端正式契约与实际消费面已经一致地收敛到 `preview_markdown_attachment` / `raw_markdown_attachment`；
3. 本轮未引入新的运行时问题、契约倒退或边界失控。

### 为什么不是“补充变更点继续”

1. 当前剩余问题不再卡住本任务定义下的验收门槛；
2. 当前剩余事项只涉及工作树归属治理，不再是 doc preview 语义或前端正式契约问题。

### 为什么不是“返工重做”

1. 主方向始终正确；
2. 主链路收口事实已经稳定；
3. 当前只有可延后处理的低优先级尾项，没有方案性失败迹象。

---

## 7. 新一轮明确可衡量变更计划（含技术指导）

> 说明：以下仅保留**本轮修复后仍未完成**的后续优化计划；已执行项不再重复挂为待办。

### 变更项 A：清理任务工作树归属，减少混改风险

- 优先级：**P2**
- 理由：当前工作树中仍混有多项非本任务改动，长期会影响提交边界与复盘精度。
- 可衡量交付：
  1. 对 `git status --short` 中全部修改文件进行“本任务 / 非本任务”二次归属；
  2. 将非本任务文件迁回对应任务目录留痕，或在独立分支/独立任务中处理；
  3. 提交前确保 PR 只包含本任务直接相关文件。
- 技术指导：
  1. 不在当前已放行审计中继续追打这些文件内容；
  2. 后续动作以 Git 边界治理为主，不与 doc preview semantic 语义治理混做一轮。

### 过程约束

- 优先级：**P0**
- 理由：防止放行后又把低优先级尾项滚成新的大任务。
- 明确要求：
  1. 不改数据库字段，除非单独获得明确授权；
  2. 不把 legacy 技术字段治理升级为“全系统统一字段输出规范”工程；
  3. 不把验证脚本标准化、未跟踪残留清理、i18n 改动并入当前任务放行范围；
  4. 后续每个尾项都必须有独立可衡量交付，避免再次多议题混行。

---

## 8. 本轮开发团队表现评分

- **需求理解：9.5/10**
  已准确抓住“唯一阻塞项是前端正式类型中的 legacy 信号”这一点。

- **第一性原理意识：9.6/10**
  本轮没有把收尾问题升级成数据库或接口治理工程。

- **全局收敛能力：9.6/10**
  前端主视图、后端响应语义和类型层口径已完成闭环，非阻塞尾项也已继续收口。

- **执行落地能力：9.7/10**
  阻塞项与非阻塞项均按最小路径落地，且静态校验通过。

- **边界控制能力：9.4/10**
  本轮未在修复 `docs.ts` 时顺手扩散到其他字段和其他系统层级。

- **避免过度设计能力：9.7/10**
  采用最小正确修改完成放行，不引入新抽象。

- **验证闭环能力：9.4/10**
  已用 grep、type-check、eslint 和代码事实形成闭环证据。

- **规范性把控：9.2/10**
  当前仍有少量非本任务工作树改动混入，但不影响本轮放行判断。

- **综合得分：9.6/10**

### 综合评价

本轮团队表现达到**可放行且已顺手完成非阻塞收口**的水平。关键点不在于“改了多少代码”，而在于是否把上一轮唯一阻塞项，以及用户已拍板继续处理的低风险尾项，都用最小代价、正确边界和可验证事实收掉。当前结果表明，团队已经把 doc preview semantic unification 从“按任务定义完成”进一步推进到“前端正式契约层面完全收口”。

---

✌Bazinga！
