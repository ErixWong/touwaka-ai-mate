# Changelog Round 09 - Contract Mgr v2 独立架构收尾

> 日期：2026-06-28 15:30 +08:00
> 依据：audit-round09.md
> 状态：**已完成**

---

## 1. 变更概述

本轮为 round09 审计后的执行轮次，主要完成以下两项工作：

1. **A1**: `ContractDetail.vue` 中原始枚举值收口到 i18n 显示语义
2. **A2**: 更新 `SELF-TEST.md` 到 round09 事实口径

---

## 2. 具体变更内容

### A1: ContractDetail.vue 原始枚举值收口

#### 变更内容

在 `frontend/src/components/contract-v2/ContractDetail.vue` 中，将所有用户可见的原始枚举值替换为 i18n 映射后显示。

涉及位置（共 4 处）：

| 位置 | 原直出枚举 | 替换后映射 | 说明 |
|------|-----------|-----------|------|
| Line 497 | `{{ row.revision_status }}` | `{{ revisionStatusLabels[row.revision_status]?.label \|\| row.revision_status }}` + el-tag | revision 状态 |
| Line 734 | `{{ compareResult.status }}` | `{{ compareStatusLabels[compareResult.status] \|\| compareResult.status }}` | compare 运行状态 |
| Line 740 | `<el-table-column prop="change_type" />` | slot + `compareChangeTypeLabels` 映射 + el-tag | compare 变更类型 |
| Line 741 | `<el-table-column prop="risk_level" />` | slot + `compareRiskLevelLabels` 映射 + el-tag | compare 风险等级 |

#### 新增 i18n 映射

在 `frontend/src/i18n/locales/zh-CN.ts` 和 `en-US.ts` 中新增以下 locale 域：

```
contractV2.revisionStatuses.*   (6 项: draft, review, approved, effective, expired, archived)
contractV2.compareStatuses.*    (4 项: pending, processing, completed, failed)
contractV2.compareChangeTypes.* (5 项: identical, modified, semantic_change, added, removed)
contractV2.compareRiskLevels.*  (4 项: none, low, medium, high)
```

#### 实现模式

采用与已有 `versionStatusLabels` / `processingStatusLabels` 一致的 computed 模式：

```typescript
const revisionStatusLabels = computed<Record<string, { label: string; type: string }>>(() => ({
  draft: { label: t('contractV2.revisionStatuses.draft'), type: 'info' },
  review: { label: t('contractV2.revisionStatuses.review'), type: 'warning' },
  // ...
}))
```

#### 额外修复

- **compare summary 行 raw text warning**：将 compare summary 统计行改为使用 `$t('contractV2.compare.summaryLine', {...})` i18n 模板，消除 `@intlify/vue-i18n/no-raw-text` 警告
- **清理未使用 import**：移除 ContractDetail.vue 中未使用的 `onMounted` 导入

### A2: SELF-TEST.md 同步

#### 变更内容

更新 `docs/tasks/active/task-20260627-contract-mgr-v2-independence-followup/SELF-TEST.md`：

1. 标题从"第七轮验证矩阵"更新为"第九轮验证矩阵"
2. 更新时间从 `2026-06-28 13:55` 更新为 `2026-06-28 15:30`
3. 新增本轮 (round09) 修复验证项：
   - A1: ContractDetail.vue 原始枚举值收口到 i18n 显示语义
   - A2: SELF-TEST.md 同步到 round09 事实口径
4. 新增 round08 修复验证项：
   - A1: ContractDetail.vue 用户可见文本 i18n 收口
   - A2: triggerMetadataExtract 语义歧义最小清理
5. 历史验证记录表追加 round08 / round09 条目

---

## 3. 对审计报告的回复

### 已采纳建议

| 审计项 | 执行情况 |
|--------|----------|
| A1 / P1-1 原始枚举值收口 | 已完成。按审计报告拍板口径，显示层最小清理一次性完成 |
| A2 / P2-1 SELF-TEST 同步 | 已完成。文档与代码同步更新到 round09 |

### 无异议项

审计报告指出的所有问题均被采纳并已修复，无提出异议。

---

## 4. 发现的同类隐患

### 已排查

| 模块 | 状态 | 说明 |
|------|------|------|
| ContractList.vue | ✅ 无问题 | 已正确使用 `contractTypeLabels` 映射 |
| DashboardPanel.vue | ✅ 无问题 | 只显示统计数字，无枚举直出 |
| 其他 contract-v2 组件 | ✅ 无问题 | 状态枚举已使用 store 提供的映射 |

---

## 5. 验证状态

### ✅ 本轮已完成（静态验证）

| 验证项 | 状态 | 说明 |
|--------|------|------|
| ContractDetail.vue lint | 通过 | 无 error，无 warning |
| i18n locale keys | 完整 | zh-CN / en-US 均已补齐 |
| 映射 fallback | 正确 | 未匹配枚举仍回退显示原值 |
| 同类隐患排查 | 清理完成 | 其他组件无同类问题 |
| TypeScript 检查 | 通过 | --skipLibCheck 下无错误 |
| ES 模块导入校验 | 通过 | import 语句正确，onMounted 清理完成 |
| 返回结构字段一致性 | 通过 | 前端类型与后端 API 字段一致 |
| 数据库/后端/前端命名一致性 | 通过 | revision_status / change_type / risk_level 等字段全链路一致 |

### ⏳ 待后续验证

| 验证项 | 状态 | 说明 |
|--------|------|------|
| REV-1~REV-5 真实环境多 revision 验证 | 待补 | 仍保留在 SELF-TEST.md 待补区 |
| compare 算法升级 | 待后置 | 按审计报告要求继续后置 |

---

## 6. 自审补充

### 6.1 对照审计报告验收标准

| 审计报告验收项 | 执行结果 |
|---------------|----------|
| A1: `ContractDetail.vue` 中不再直接输出原始枚举值 | ✅ 已完成 4 处修改 |
| A1: 中英文 locale 都存在对应 key | ✅ 已补齐 4 组 locale 域 |
| A1: 缺省值有合理兜底 | ✅ 已实现 `\|\| row.xxx` fallback |
| A1: 使用 computed 模式 | ✅ 与 versionStatusLabels 模式一致 |
| A2: SELF-TEST.md 标题/轮次/更新时间同步 | ✅ 已更新到 round09 |
| A2: round08 新增项可追溯 | ✅ 已补入验证矩阵 |
| A2: 保留真实环境待补口径 | ✅ REV-1~REV-5 仍标记待补 |

### 6.2 代码质量检查

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 是否引入新阻塞 | ✅ 无阻塞 | 仅修改显示层映射 |
| 代码能否运行 | ✅ 可运行 | lint/typescript 均通过 |
| 类型是否闭环 | ✅ 闭环 | 前端类型与后端返回一致 |
| 返回结构一致性 | ✅ 一致 | CompareRunResult / DocRevisionStatus 等 |
| 数据库/后端/前端命名 | ✅ 一致 | 全链路 snake_case |
| ES 模块导入校验 | ✅ 通过 | 清理了未使用 import |

### 6.3 发现的同类隐患

| 模块 | 状态 | 说明 |
|------|------|------|
| ContractList.vue | ✅ 无问题 | 已正确使用 `contractTypeLabels` 映射 |
| DashboardPanel.vue | ✅ 无问题 | 只显示统计数字，无枚举直出 |
| 其他 contract-v2 组件 | ✅ 无问题 | 状态枚举已使用 store 提供的映射 |

---

## 7. 提交信息

本轮无独立提交，变更直接更新到工作分支。

---

*生成时间：2026-06-28 15:51 +08:00*

✌Bazinga！