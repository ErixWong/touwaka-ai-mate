# SELF-TEST - 第九轮验证矩阵

> 更新时间：2026-06-28 15:30 +08:00
> 验证轮次：round09（对应 audit-round09.md）

---

## 目标

记录 `contract-mgr-v2` 独立任务当前阶段的最小验证矩阵，确保后续开发和审计都有统一检查口径。
本轮重点是把"详情页原始枚举值直出"和"验证文档与代码同步"问题收口。

---

## 本轮新增修复验证

### ✅ A1 / P1-1 (round09): ContractDetail.vue 原始枚举值收口到 i18n 显示语义

- [x] `revision_status` 不再直接输出原值，改为通过 `revisionStatusLabels` 映射后显示本地化文案 + el-tag
- [x] `compareResult.status` 不再直接输出原值，改为通过 `compareStatusLabels` 映射后显示
- [x] `change_type` 不再通过 `prop` 直出，改为 slot + `compareChangeTypeLabels` 映射 + el-tag
- [x] `risk_level` 不再通过 `prop` 直出，改为 slot + `compareRiskLevelLabels` 映射 + el-tag（null 时显示 `-`）
- [x] 新增 locale 域：`contractV2.revisionStatuses.*`（6 项）、`contractV2.compareStatuses.*`（4 项）、`contractV2.compareChangeTypes.*`（5 项）、`contractV2.compareRiskLevels.*`（4 项）
- [x] zh-CN / en-US 均已补齐
- [x] 映射模式与已有 `versionStatusLabels` / `processingStatusLabels` 一致（computed + fallback 原值）

### ✅ A2 / P2-1 (round09): SELF-TEST.md 同步到 round08 事实口径

- [x] 标题、轮次、更新时间已同步到 round09
- [x] round08 已完成项（i18n 收口、metadata API 歧义清理、locale 重复定义覆盖修复）已补入验证矩阵
- [x] 未做真实环境验证的项目仍保留"静态验证通过、实测未完成"口径

### ✅ A1 / P2 (round08): ContractDetail.vue 用户可见文本 i18n 收口

- [x] 弹窗标题、按钮文本、表头文本已切换到 i18n（见 line 206/242/684/788）
- [x] locale key 已补齐（zh-CN / en-US）
- [x] `contractV2.content` 重复定义覆盖问题已修复

### ✅ A2 / P2 (round08): triggerMetadataExtract 语义歧义最小清理

- [x] `frontend/src/api/contract-v2.ts:229` 只保留 `extractMetadata()`
- [x] `server/services/contract-v2.service.js:942` 只保留 `extractMetadata()`
- [x] 前后端双命名歧义已消失

### ✅ A1 / P0-1 (round07): compare 创建前置校验从 document 状态切到 revision 级 chunk 可用性

- [x] `createCompareRun()` 已移除对 `document.processing_status` 的硬依赖
- [x] 改为检查 `versionA.revision_id` / `versionB.revision_id` 对应 revision 是否存在 chunk
- [x] 若 chunk 不存在，按 `revision.is_current` 区分错误语义（"处理中" vs "历史内容缺失"）
- [x] 对确实无 chunk 的 revision，错误文案可区分"当前 revision 处理中"与"历史 revision 无内容"
- [x] **(double-check 第二轮)** A/B 双侧同时无 chunk 时，错误消息会合并返回两侧原因，不再只保留首个原因
- [x] **(double-check 第二轮)** 当前 revision 无 chunk 时，compare 错误文案会带出 `document.processing_status`，与 `extractMetadata()` 保持一致口径

### ✅ A2 / P1-1 (round07): 前端“提取元数据”按钮去除 document 共享状态误隐藏

- [x] `ContractDetail.vue` 已移除 `status === 'ready'` 控制按钮显示的逻辑
- [x] 改为只要有 `document_id` 就显示按钮，实际可用性由后端错误语义兜底
- [x] 成功提取时仍展示 `revision_id / row_id`
- [x] 不可提取时，用户能看到明确错误原因（后端返回语义化错误）

### ✅ B1 / P2-1 (round07): SELF-TEST.md 补 compare revision 级验证项

- [x] 新增"REV-4：历史 revision 在 document 当前 revision 非 ready 时是否仍可 compare"验证项
- [x] 新增 compare 无 chunk 时的错误语义验证项
- [x] 历史记录中明确标注真实环境待补项

---

## 本轮已验证事实（静态）

### ✅ A1: collection 自动创建字段契约

- [x] 自动创建的 collection 包含 `owner_id`、`created_by`、`department_id`、`department_scope`、`embedding_model_id`
- [x] 使用用户私有 collection 策略：`contract_${userId}_${contractType}`
- [x] `owner_id = 当前用户`

### ✅ A2: 自动建 collection 写权限闭环

- [x] 自动创建的 collection 以当前用户为 owner
- [x] 复用 `CollectionAccessService.canWrite()` 现有逻辑

### ✅ A3: 业务表建行逻辑

- [x] `createVersionFromAttachment()` 同时初始化 `app_contract_mgr_v2_rows` 与 `app_contract_mgr_v2_content`
- [x] `extractMetadata()` 检查 `affectedRows`，不再把空更新说成成功

### ✅ A4: compare 结果读取授权

- [x] `getCompareRunResult()` 已增加 `doc_compare_run.created_by` 校验

### ✅ A5: contract_type 最小口径统一

- [x] `manifest.json` 已补 `sales` 字段
- [x] 与 `config.contract_types` 对齐

### ✅ A6: 停止手改 models/

- [x] 当前工作区无 `models/` 手改痕迹

### ✅ P1-3: intake 公共入口

- [x] 已删除 `lib/doc-intake-service.js` 分叉
- [x] 复用 `DocumentIntakeService`

---

## round06 历史修复验证（仍有效）

### ✅ P0-1 (round06): 元数据提取严格按 version.revision_id 取内容

- [x] `extractMetadata()` 已改为使用 `version.revision_id` 直接 `findByPk` 取该版本自己的 revision
- [x] 不再通过 `document_id + is_current=1` 反查当前 active revision
- [x] chunk 查询严格使用 `version.revision_id`
- [x] 若 `version.revision_id` 为空，明确报错，不回退到模糊逻辑
- [x] 已清理向 `document.metadata` 写入 `contract_metadata` 的错位逻辑（该字段无读取方，属于半残写入）
- [x] 返回值新增 `revision_id` / `row_id`，便于核对落库目标
- [x] **(double-check)** 前置校验已从 `document.processing_status !== 'ready'` 改为以"该版本 revision 自己是否有 chunk"为准，避免旧版本因 document 维度状态被误阻断
- [x] **(double-check)** 历史版本 revision 无 chunk 时给出明确语义化错误（区分"正在处理"与"历史版本无内容"）

### ✅ P1-1 (round06): 版本级处理状态口径补齐

- [x] `getVersionProcessingStatus()` 返回结构已区分 `document_processing_status` 与 `revision_id`
- [x] 新增 `status_scope` 字段：`none` / `document_current_revision` / `document_shared`
- [x] 新增 `status_scope_note` 口径说明文本
- [x] 前端 `ProcessingStatus` 类型已同步更新
- [x] 前端版本列表对"非当前 revision"版本加 tooltip 提示，避免把 document 状态误表述为该版本状态

### ✅ P1-2 (round06): 上传弹窗合同类型字典统一

- [x] `ContractDetail.vue` 已删除硬编码 `sales/supply` 的 `contractTypeOptions`
- [x] 改为复用 `contractTypeLabels`（10 项），与 `ContractList.vue` / `manifest.json` 一致

### ✅ I18N (round06 double-check): 本轮新增用户可见文本已同步 i18n

- [x] 版本状态口径 tooltip 文案已提取为 `contractV2.businessVersions.statusScopeSharedTooltip`（中/英）
- [x] 提取结果弹窗标题已提取为 `contractV2.businessVersions.extractResultTitle`（中/英）
- [x] 提取结果落库目标行已提取为 `contractV2.businessVersions.extractTarget`（中/英，带参数）
- [x] `ContractDetail.vue` 已引入 `useI18n`，script 内硬编码中文已替换为 `t()` 调用

---

## round05 历史修复验证（仍有效）

### ✅ P0-1 (round05): compare 结果读取字段错误修复

- [x] `getCompareRunResult()` 已修改为使用真实字段 `run_id`、`risk_level`
- [x] 不再访问不存在字段 `compare_run_id`、`change_severity`、`index`

### ✅ P0-2 (round05): 旧版 createVersion() 旁路入口清理

- [x] `POST /contracts/:contractId/versions` 已硬拦截，返回 410 错误
- [x] 提示使用 `/from-attachment` 入口

### ✅ P1-1 (round05): compare 前后端契约分叉修复

- [x] 前端 `CompareRunResult` 类型已修正为与后端真实字段一致
- [x] 使用 `risk_level` 和 `summary` 替代 `change_severity` 和 `description`

### ✅ P0-3 (round05): compare 主链路最小闭环

- [x] `createCompareRun()` 已修改为围绕两个 `revision_id` 工作
- [x] 不再要求 `document_id` 必须相等
- [x] 支持同一合同下的不同 document 的 revision 进行比对
- [x] 上传时已支持 `document_mode = new|existing` 与 `existing_document_id`
- [x] 沿用已有 `document` 时会创建新的 `revision`

### ✅ P1-4 (round05): 元数据查看/编辑/保存闭环

- [x] 后端已添加 `getVersionMetadata()` 接口
- [x] 后端已添加 `updateVersionMetadata()` 接口
- [x] 前端已添加元数据编辑对话框
- [x] 已实现 key/value 方式的最小编辑功能
- [x] 已修复 `getVersionMetadata()` 查询结果读取 bug

### ✅ C5 补充 (round05): 用户可读取 compare 结果

- [x] 详情页已添加最小 compare 结果查看弹窗
- [x] 可按 `run_id` 刷新并读取当前结果

### ✅ P2-2 (round05): 统一分页契约

- [x] `listContracts()` 已复用 `buildPaginatedResponse()`
- [x] 前端已适配新的 `pagination` 结构

---

## 本轮仍未完成验证（revision 级真实业务验证）

以下验证项需要真实环境多 revision 数据执行，当前仅完成静态/代码自查：

### ❌ REV-1: 旧版本提取 metadata 是否读取旧 revision 内容

- 目标：同一 document 下创建两个 revision 对应两个业务版本，对旧版本执行 metadata extract，确认读取内容来自旧 revision 而非当前 active revision
- 状态：代码已改为按 `version.revision_id` 取数（静态验证通过），真实环境验证未完成

### ❌ REV-2: 版本状态返回是否含 revision_id / 口径说明

- 目标：调用 `getVersionProcessingStatus()` 确认返回结构含 `revision_id`、`status_scope`、`status_scope_note`
- 状态：代码已实现（静态验证通过），真实环境验证未完成

### ❌ REV-3: 多 revision 下 row_id 落库目标正确性

- 目标：对旧版本执行 metadata extract 后，`app_contract_mgr_v2_rows` 对应 `row_id` 落到旧版本事实，而非新版本
- 状态：代码已按 `version.row_id` 隔离（静态验证通过），真实环境验证未完成

### ❌ REV-4: 历史 revision 在 document 当前 revision 非 ready 时是否仍可 compare

- 目标：同一 document 下旧版本 A 已完成且 chunk 完整，新版本 B 上传后 document 当前 revision 进入 `pending_ocr`，此时拿版本 A 去和版本 C（另一个旧版本）compare，应能正常创建 compare run
- 状态：代码已改为按 `revision_id` 对应 chunk 可用性判断（静态验证通过），真实环境验证未完成

### ❌ REV-5: compare 无 chunk 时的错误语义验证

- 目标：对一个 revision 有 chunk 但另一个 revision 无 chunk 的情况创建 compare run，确认错误文案区分"处理中"与"历史内容缺失"
- 状态：代码已实现语义化错误（静态验证通过），真实环境验证未完成

---

## 本轮仍未完成验证（其他）

### ❌ P1-2: compare 算法升级到段级语义

- 原因：这是正式实现项，需要先完成主链路闭环后再逐步升级
- 状态：待后续迭代

### ❌ B3: 真实业务验证记录

- 仍需要真实环境测试数据来验证完整链路
- 当前仅完成静态验证

---

## 验收通过条件（待真实环境验证后判断）

1. compare 结果读取接口按真实字段工作，不再访问不存在字段
2. 旧版 `createVersion()` 入口被禁用，返回 410 错误
3. 至少完成一条按 `revision` 模型运行的真实多版本 compare 成功闭环
4. compare 前后端 DTO 字段完全一致
5. 元数据提取后可查看、可按 key/value 方式修改、可保存
6. 分页接口使用统一 `buildPaginatedResponse()` 结构
7. 详情页可查看当前 compare 结果
8. 元数据提取严格按 `version.revision_id` 取内容，旧版本提取不会读到当前 active revision
9. 版本处理状态返回含 `revision_id` 与口径说明，前端不再把 document 状态误表述为该版本状态
10. **(本轮新增)** compare 创建不再被 document.processing_status 误阻断，历史 revision 只要有自己的 chunk 就能参与 compare
11. **(本轮新增)** 前端“提取元数据”按钮不再被 document 共享状态隐藏，每个有 document_id 的版本都能触发提取

---

## 历史验证记录

| 轮次 | 时间 | 验证项数 | 通过项数 | 备注 |
|------|------|----------|----------|------|
| round01 | 2026-06-27 | 9 | 1 | 初始模板 |
| round02 | - | - | - | 无记录 |
| round03 | - | - | - | 无记录 |
| round04 | 2026-06-28 | 6 | 6 | 静态验证 |
| round05 | 2026-06-28 | 16 | 16 | 含自审补漏 |
| round06 | 2026-06-28 | 19 | 16 | revision 级读取一致性收口；3 项真实环境验证待补 |
| round07 | 2026-06-28 | 21 | 18 | compare 创建前置校验 + 前端提取入口可见性收口；5 项真实环境验证待补 |
| round08 | 2026-06-28 | 23 | 20 | i18n 收口 + metadata API 歧义清理 + locale 重复定义覆盖修复；5 项真实环境验证待补 |
| round09 | 2026-06-28 | 27 | 24 | 原始枚举显示收口 + SELF-TEST 同步；5 项真实环境验证待补 |

---

*更新时间：2026-06-28 15:30 +08:00*
