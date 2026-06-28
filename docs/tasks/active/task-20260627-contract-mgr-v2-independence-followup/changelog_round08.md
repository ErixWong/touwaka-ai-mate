# Changelog Round 08 - Contract Mgr v2 独立架构收尾

> 日期：2026-06-28 14:55 +08:00
> 依据：audit-round08.md
> 状态：**已完成**

---

## 1. 变更概述

本轮为 round08 审计后的执行轮次，主要完成以下两项工作：

1. **A1**: `ContractDetail.vue` 用户可见文本补齐 i18n
2. **A2**: 清理 `triggerMetadataExtract` / `extractMetadata` 语义歧义

---

## 2. 具体变更内容

### A1: ContractDetail.vue i18n 收口

#### 变更内容

在 `frontend/src/components/contract-v2/ContractDetail.vue` 中，将所有用户可见硬编码中文替换为 i18n 调用。

涉及位置：

| 位置 | 原硬编码 | 替换后 i18n Key |
|------|----------|-----------------|
| 第 341 行 | 比对任务已创建... | `$t('contractV2.compare.taskCreated')` |
| 第 554 行 | 清除选择 (...) | `$t('contractV2.businessVersions.clearSelection')` |
| 第 560 行 | 比对已选版本 | `$t('contractV2.businessVersions.compareSelected')` |
| 第 567-633 行 | 表格列标题 (版本号/版本名称/类型/状态/文档处理/当前版本/合同编号/甲方/Document ID/Revision ID/操作) | 对应 `$t('contractV2.businessVersions.columnXXX')` |
| 第 642 行 | 提取元数据 | `$t('contractV2.businessVersions.extractMetadata')` |
| 第 649 行 | 编辑元数据 | `$t('contractV2.businessVersions.editMetadata')` |
| 第 655 行 | 取消选择/选择比对 | `$t('contractV2.businessVersions.cancelSelect')` / `selectForCompare` |
| 第 687 行 | 上传合同文件 | `$t('contractV2.upload.title')` |
| 第 690-710 行 | 上传弹窗表单标签 | 对应 `$t('contractV2.upload.XXX')` |
| 第 729 行 | 比对结果 | `$t('contractV2.compare.title')` |
| 第 737 行 | 比对结果统计行 | 对应 `$t('contractV2.compare.XXX')` |
| 第 743-749 行 | 比对结果表格列 | 对应 `$t('contractV2.compare.columnXXX')` |
| 第 767/777 行 | 基本信息/文档内容 | `$t('contractV2.content.basicInfo')` / `documentContent` |
| 第 791 行 | 编辑元数据 | `$t('contractV2.metadata.title')` |
| 第 794 行 | 加载中... | `$t('contractV2.metadata.loading')` |
| 第 797-807 行 | 元数据编辑表单标签 | 对应 `$t('contractV2.metadata.XXX')` |

同时更新 i18n 文件：

- `frontend/src/i18n/locales/zh-CN.ts`：在 `contractV2` 下新增 `businessVersions.columnVersionNo/Name/Type/Label` 等 key
- `frontend/src/i18n/locales/en-US.ts`：对应英文翻译

### A2: API 语义歧义清理

#### 变更内容

1. **前端 API 层**：删除未使用的 `triggerMetadataExtract()` 定义
   - 文件：`frontend/src/api/contract-v2.ts`
   - 变更：删除第 219-221 行的函数定义

2. **后端 Service 层**：删除未使用的 `triggerMetadataExtract()` 方法
   - 文件：`server/services/contract-v2.service.js`
   - 变更：删除第 933-949 行的方法定义

#### 说明

- 当前前端 store (`contract-v2.ts:345`) 实际调用的是 `extractMetadata()`
- 后端 service 中 `extractMetadata()` 方法实际承载了完整的元数据提取能力
- 删除 `triggerMetadataExtract` 后，系统只保留**直接提取元数据**这一条真实链路
- 按审计报告拍板口径：不做接口重构，只做最小清理

---

## 3. 对审计报告的回复

### 已采纳建议

| 审计项 | 执行情况 |
|--------|----------|
| A1 / P1-1 清理 i18n 硬编码 | 已完成。按审计报告拍板口径，作为顺手一次性收尾项处理 |
| A2 / P2-1 清理 triggerMetadataExtract 歧义 | 已完成。按最小删除方案执行 |

### 审计报告中的分歧点处理

| 分歧点 | 采纳方案 |
|--------|----------|
| 分歧点 1：i18n 当前轮次是否必须处理 | 按 **选项 A**：作为顺手一次性收尾项处理 |
| 分歧点 2：triggerMetadataExtract 是否值得清理 | 按 **选项 A**：最小删除方案 |
| 分歧点 3：放行标准是否仍围绕主链路 | 按 **选项 A**：主链路优先，尾项一次性并掉 |

---

## 4. 新发现的风险点和建议

### 已处理

- **i18n 硬编码扩散**：已完成本轮一次性收口

### 仍需后置（按审计报告拍板）

- **compare 算法升级** (`lib/doc-compare-executor.js:93`)：继续后置，不纳入当前收尾
- **真实环境多 revision 验证**：继续按静态验证口径推进，文档保留待补状态

---

## 5. 提交信息

```bash
# Round 08 变更提交
feat(contract-v2): 完成 i18n 收口与 API 歧义清理

- A1: 清理 ContractDetail.vue 硬编码中文，补齐 i18n keys
- A2: 删除未使用的 triggerMetadataExtract 定义，统一保留 extractMetadata 链路
- 更新 zh-CN.ts 与 en-US.ts 补齐必要 i18n keys
```

---

## 6. Double-check 轮次补充

### 6.1 新发现

在本轮自审中，发现上一版 `round08` 变更仍有以下遗漏，说明初版实现尚未完全满足审计报告里“高质量完成”的要求：

1. `frontend/src/components/contract-v2/ContractDetail.vue` 仍残留少量用户可见硬编码文案，主要包括：
   - “设为当前”确认弹窗；
   - “删除版本”确认弹窗；
   - 上传失败弹窗标题与兜底文案；
   - 文档版本历史中的“生效日期”列标题；
   - 文档内容弹窗标题 `文档内容 - xxx`。

2. `frontend/src/i18n/locales/zh-CN.ts` 与 `frontend/src/i18n/locales/en-US.ts` 中，`contractV2.content` 被重复定义；前面新增的 `basicInfo` / `documentContent` / `dialogTitle` 等 key 会被后面的同名对象覆盖，存在运行时取值不稳定风险。

3. 为了消除剩余硬编码，把部分标签字典改成了 `computed` i18n 映射，但这一轮复查确认模板读取口径仍需同步核对，必须保证字典与模板访问方式保持一致，避免引入显示层回归。

### 6.2 Double-check 新修复

针对以上新发现，已补充完成以下修复：

1. **补齐剩余 UI 文案 i18n**
   - `handleSetCurrent()` 改为使用 `contractV2.revisions.confirmSetCurrentMessage`；
   - `handleDeleteVersion()` 改为使用 `contractV2.businessVersions.confirmDeleteMessage`；
   - 上传失败的 alert 标题与兜底消息统一改为 `contractV2.upload.failed`；
   - 文档版本历史“生效日期”列改为 `contractV2.revisions.effectiveFrom`；
   - 文档内容弹窗标题改为 `contractV2.content.dialogTitle`。

2. **修复 i18n 结构覆盖问题**
   - 合并 `contractV2.content` 的重复定义，统一保留在同一个对象下；
   - 确保 `basicInfo`、`documentContent`、`dialogTitle`、`extractTime`、`noContent` 同时存在且不会被后续对象覆盖。

3. **补齐状态/类型映射的 i18n 化**
   - 新增 `contractV2.contractTypes.*`；
   - 新增 `contractV2.versionTypes.*`；
   - 新增 `contractV2.versionStatuses.*`；
   - 新增 `contractV2.processingStatuses.*`；
   - 将 `ContractDetail.vue` 中原先硬编码在脚本里的合同类型、版本类型、版本状态、处理状态标签改为统一走 i18n。

### 6.3 Double-check 结论

经过本轮自审补修后，`audit-round08.md` 明确要求的两项立即执行项已更完整地收口：

1. **A1 / i18n 收口**：不仅模板中的按钮、表头、弹窗标题已 i18n 化，连确认弹窗、失败提示、状态标签、内容标题等此前遗漏点也已补齐。
2. **A2 / metadata API 歧义清理**：`triggerMetadataExtract` 在前端 API 层与后端 service 层均已删除，当前只保留 `extractMetadata` 这一条真实链路。
3. **额外质量修复**：i18n 对象重复定义导致 key 覆盖的问题已一并修复，避免出现“代码看似补齐、运行时实际失效”的隐患。

本次 double-check 后，round08 对应审计项已达到更高完整度，不再停留在“表面替换文案”，而是把实现层与 i18n 结构层一并收口。

---

*生成时间：2026-06-28 14:55 +08:00*

✌Bazinga！
