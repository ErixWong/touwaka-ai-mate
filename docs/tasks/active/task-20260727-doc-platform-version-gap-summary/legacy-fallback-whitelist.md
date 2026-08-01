# 旧版本兜底逻辑白名单

> 基于 audit-round04 §7.5 要求，整理当前仍保留 `revision_no DESC` 等历史兜底逻辑的模块清单。
> 最后更新：2026-07-27

---

## 原则

以下兜底逻辑允许保留的前提：
1. **仅用于读取路径**（选择最新版本），不写入 `is_current`；
2. 主路径已优先使用 `current_revision_id` 作为主源；
3. 兜底仅在 `current_revision_id IS NULL` 时生效；
4. 未来应逐步迁移到 `resolveCurrentRevision()` 统一工具函数。

---

## 白名单清单

### 1. `lib/document-clean-service.js` — `_loadDocumentAndRevision()`

**位置**：行 1015-1026

**兜底模式**：
```js
if (document.current_revision_id) {
  revision = await DocumentRevision.findByPk(document.current_revision_id);
}
if (!revision) {
  revision = await DocumentRevision.findOne({
    where: { document_id: documentId },
    order: [['revision_no', 'DESC']],
  });
}
```

**保留理由**：
- 主路径优先使用 `current_revision_id`
- 兜底仅在 `current_revision_id` 为 NULL 或无效时生效
- Clean 服务需要最新版本进行清洗，此兜底可避免因 `current_revision_id` 缺失导致流程中断

**未来计划**：迁移到 `resolveCurrentRevisionId()`

---

### 2. `lib/document-ocr-service.js` — `_loadDocumentAndRevision()`

**位置**：行 1168-1178

**兜底模式**：同上（结构完全一致）

**保留理由**：
- 同上，OCR 服务与 Clean 服务共享相同模式
- OCR 处理链需要确定目标 revision，兜底保证不中断

**未来计划**：与 Clean 服务同步迁移到 `resolveCurrentRevisionId()`

---

### 3. `lib/doc-recall-service.js` — `is_current` 读路径

**位置**：行 525

**模式**：
```js
revisionFilter = 'AND v.is_current = 1';
```

**保留理由**：
- 纯读取路径，不写入 `is_current`
- `is_current` 由 `_syncIsCurrentFlags()` 统一维护，读取侧使用派生字段是预期行为
- 转为 `resolved_current_revision_id` 需要改写召回逻辑的 JOIN 条件，收益有限

**未来计划**：评估后决定是否迁移，当前不阻塞

---

## 不在白名单的已收敛模块

以下模块已完全迁移到统一工具：

| 模块 | 迁移方式 |
|------|----------|
| `lib/document-intake.service.js` | 通过 `revisionService._syncIsCurrentFlags()` |
| `lib/document-revision.service.js` | `_syncIsCurrentFlags()` 统一写入口 |
| `server/controllers/doc.controller.js` | `sortRevisionList()` / `resolveCurrentRevision()` |
| `frontend/src/components/docs/DocVersionPanel.vue` | 客户端排序与后端一致 |

---

## 新增代码约束

所有**新代码**如需要"获取最新/当前版本"，必须使用以下统一工具：

- `resolveCurrentRevisionId(doc, revisions)` → 获取当前版本 ID
- `resolveCurrentRevision(doc, revisions)` → 获取当前版本完整对象
- `sortRevisionList(revisions)` → 统一排序

禁止在新代码中使用 `revision_no DESC` 作为"获取当前版本"的方式。
