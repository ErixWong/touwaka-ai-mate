# 第四轮变更报告（changelog_round04）

> 任务目录：`docs/tasks/active/task-20260627-contract-mgr-v2-independence-followup`
> 生成时间：2026-06-28 10:00 +08:00
> 结论口径：仅记录本次已完成事实，不把待拍板项写成已闭环

---

## 1. 本轮实际完成的代码修复

### 1.1 A1 / A2：自动建 collection 字段契约与写权限闭环

**已完成：**

1. `server/services/contract-v2.service.js`
   - 自动建 collection 时补齐：`owner_id`、`created_by`、`department_id`、`department_scope`、`embedding_model_id`
   - 删除错误思路中的 `source_tag` 依赖
   - collection 名称改为 `contract_${userId}_${contractType}`，避免跨用户串用同名私有集合
   - 若用户缺少 `department_id`，直接报错，不再写伪默认值

2. 权限闭环
   - 自动创建的 collection 直接以当前用户作为 `owner_id`
   - 后续 intake 写入复用 `CollectionAccessService.canWrite()` 现有逻辑，无新增权限旁路

**结果：**
- 代码层已满足审计单 A1、A2 的最小技术要求

---

### 1.2 A3：补齐业务表建行逻辑，停止空 UPDATE

**已完成：**

1. `createVersionFromAttachment()` 事务内新增：
   - 初始化 `app_contract_mgr_v2_rows`
   - 初始化 `app_contract_mgr_v2_content`

2. `extractMetadata()` 中新增：
   - 校验 `UPDATE app_contract_mgr_v2_rows` 的 `affectedRows`
   - 当影响行数为 `0` 时，直接抛错：`业务表不存在对应 row_id=...，元数据回填失败`
   - 不再把“执行了 SQL”误记为“业务表已成功回填”

**结果：**
- 已满足审计单 A3 的关键要求

---

### 1.3 A4：补齐 compare 结果读取授权

**已完成：**

1. `server/services/contract-v2.service.js`
   - `getCompareRunResult(runId, userId)` 增加 `doc_compare_run.created_by` 校验
   - 非创建人访问时返回“无权限查看该比对任务”

2. `apps/contract-mgr-v2/server/routes.js`
   - `GET /compare-runs/:runId` 传入 `ctx.state.session.id`

**结果：**
- 已满足审计单 A4 的最小授权闭环要求

---

### 1.4 A5：统一 `contract_type` 最小口径

**已完成：**

1. `apps/contract-mgr-v2/manifest.json`
   - `fields[].options` 补齐 `sales`
   - 与当前 `config.contract_types` 的最小口径对齐到 `sales` / `supply`

**结果：**
- 已完成审计单 A5 中 manifest 侧缺口修复

---

### 1.5 C2 / P1-3：统一复用公共 intake 入口

**已完成：**

1. 删除重复实现文件：`lib/doc-intake-service.js`
2. `server/services/contract-v2.service.js` 改为直接复用：
   - `DocumentIntakeService.validateIntakeRequest()`
   - `DocumentIntakeService.createIntakeDocument()`
   - `CollectionAccessService`

**结果：**
- 已消除本轮代码中新引入的 intake 分叉
- 这部分属于对审计单 `C2 / P1-3` 的补强修复

---

### 1.6 A6：停止手改 `models/`

**已完成：**

1. 执行：`node scripts/generate-models.js`
2. 将生成带出的无关 `models/` 噪音变更全部回滚
3. 同时把 `contract-v2.service.js` 改成：
   - 对 `contract_v2_versions` 的 `document_id` / `revision_id` 读取改走原始 SQL
   - 不再依赖手改 `models/contract_v2_version.js` 才能工作

**结果：**
- 当前工作区已不再保留 `models/contract_v2_version.js` 手工修改
- 满足审计单 A6 的要求

---

## 2. 本轮附带修正的质量问题

### 2.1 修正了错误 model 名称使用

`server/services/contract-v2.service.js` 原先混用了：

- `doc_document`
- `doc_version`
- `doc_chunk`

已统一修正为仓库现有公共文档平台使用的 model 名称：

- `document`
- `document_revision`
- `document_chunk`

这属于自审过程发现的真实运行时风险修复。

### 2.2 修正了新控制器导入路径错误

`apps/contract-mgr-v2/server/controllers/version-from-attachment.js` 初始相对路径错误，导致 ESM 导入失败。

已修正为：

```js
import ContractV2Service from '../../../../server/services/contract-v2.service.js';
```

---

## 3. 对审计报告的回复 / 疑议

### 3.1 已认同并完成修复的项

| 审计项 | 处理结果 |
|--------|----------|
| A1 自动建 collection 字段契约 | 已完成 |
| A2 自动建 collection 写权限闭环 | 已完成 |
| A3 补齐业务表建行逻辑，停止空 UPDATE | 已完成 |
| A4 compare 结果读取授权 | 已完成 |
| A5 `contract_type` 最小口径统一 | 已完成 |
| C2 / P1-3 intake 公共入口分叉 | 已完成补强修复 |
| A6 停止手改 `models/` | 已完成 |

### 3.2 已完成拍板，但尚未完成代码闭环的项

以下项的**业务语义已经明确**，但当前代码实现仍未完全对齐，因此仍不能写成“已闭环”：

| 项目 | 当前结论 |
|------|----------|
| B1 版本比对语义 | **已拍板**：先比较分段（相当于目录）找出差异，再制定比较计划并执行；需要识别同段语义变化、新增段、删除段、以及“表面删除、实际合并到其他段”的情况 |
| B2 元数据验收口径 | **已拍板**：提取结果直接保存；用户后续可随时修改，这就算“人工修正并保存” |
| P0-3 真实多版本 compare 成功闭环 | 仍未完成；当前代码尚未实现“分段差异发现 → 比较计划 → 执行”的正式链路 |
| A7 真实上传 / 提取 / 比对事实留痕 | 目前仅完成静态校验和导入校验，尚无真实业务操作记录 |

### 3.3 对审计报告的保留意见

#### 关于分页契约（P2-2）

审计报告指出 `listContracts()` 未复用 `buildPaginatedResponse()`。

本轮未处理该项，原因：

1. 审计单本轮“立即执行项”中未要求处理该问题
2. 当前前端已按 `{ items, total, page, page_size }` 消费
3. 这属于一致性治理问题，不应在本轮主链路收口里继续扩散范围

因此本轮将其保留为**未处理的一致性问题**，而不是写成“问题不存在”。

---

## 4. 本轮验证记录（事实型）

### 4.1 已完成验证

1. `npm run lint`
   - 结果：通过

2. 关键文件语法检查
   - `node --check server/services/contract-v2.service.js`：通过
   - `node --check apps/contract-mgr-v2/server/routes.js`：通过
   - `node --check apps/contract-mgr-v2/server/controllers/version-from-attachment.js`：通过

3. ESM 导入校验
   - `import('./server/services/contract-v2.service.js')`：通过
   - `import('./apps/contract-mgr-v2/server/controllers/version-from-attachment.js')`：初次失败，暴露导入路径错误；修复后复查通过

4. models 再生流程验证
   - `node scripts/generate-models.js`：执行成功
   - 无关生成噪音已回滚

### 4.2 尚未完成的真实业务验证

以下内容**本轮没有伪造为已完成**：

1. 真实上传一份合同并确认 collection 成功创建
2. 真实触发 intake 并确认通过 `CollectionAccessService.canWrite()`
3. 真实执行元数据提取并确认 `app_contract_mgr_v2_rows` 字段变更
4. 真实完成一次成功 compare

这些仍需要后续用真实环境数据执行验证，才能满足审计单对 `A7 / C5` 的高标准要求。

---

## 5. 当前剩余风险与建议

### 5.1 剩余风险

1. **版本比对主语义仍未拍板**
   - 当前代码仍保持“同合同 + 同 document 才可比对”的边界
   - 若继续采用“每次上传新建一个 document”的模型，则真实多版本 compare 仍会失败

2. **compare 已拍板，但当前实现仍明显不足**
   - 已明确：版本比对基于“完成分段后的段级比较”
   - 当前代码仍停留在 `document_id` / `revision_id` 级别的基础校验，尚未实现段匹配、差异计划、段落合并识别

3. **真实链路验收记录不足**
   - 当前有静态验证，但没有上传 / 提取 / 比对的真实操作留痕

### 5.2 建议

1. 下一轮 compare 实现应直接围绕已拍板语义展开：
   - 先做分段结果读取与标准化
   - 再做段级匹配与差异分类
   - 最后生成比较计划并执行
2. 元数据链路后续优先补“查看/编辑/保存”入口，而不是再扩展抽象层
3. 下一轮优先补真实环境验证记录，而不是继续抽象重构

---

## 7. 已拍板业务语义（2026-06-28）

### 7.1 版本比对语义

在完成分段后，版本比对按以下原则执行：

1. 对应的相同段落（如免责条款、保密条款）需要按段比对语义变化
2. 需要识别并列出新增段、删除段
3. 需要识别“看起来被删除，实际是合并到其他段”的情况

因此正式链路为：

`先比较分段（相当于目录）找出差异 -> 制定比较计划 -> 执行比较`

### 7.2 元数据验收口径

元数据首版验收口径明确为：

1. 提取结果直接保存
2. 用户后续可随时修改
3. 这就视为“人工修正并保存”已满足

---

## 6. 建议提交信息

```text
fix: 收口 contract-mgr-v2 第四轮审计问题
```

---

✌Bazinga！
