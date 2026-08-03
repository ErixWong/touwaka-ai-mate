# changelog_round04：文档平台版本管理四轮收口修复

> 基于 audit-round04.md 的变更计划执行记录
> 分支：feature/20260727-doc-platform-version-alignment
> 基准：1ecd797 (round03)

---

## 变更摘要

本轮聚焦三个方向：**制度收口**（模型同步 + API 契约）、**工程化细节**（前端组件健壮性）、**验证兜底**（迁移验证脚本 + 旧兜底白名单）。

---

## 已修复项

### P0-7.1：数据库变更后的模型同步/重生成说明

**文件**：`scripts/upgrade-database.js`

在 `revision_label` 迁移步骤末尾追加模型重生成提醒：
```
⚠ IMPORTANT: After this migration, run "node scripts/generate-models.js" to regenerate models/
  This will update models/document_revision.js with allowNull:false and the unique index.
```

**说明**：`models/document_revision.js` 由 `sequelize-auto` 从数据库反向生成。当前模型 `revision_label: allowNull: true` 对应迁移前状态。迁移执行后必须运行 `node scripts/generate-models.js` 重新生成，生成的模型将自动带上 `allowNull: false` 和唯一索引元数据。此步骤满足 `AGENTS.md` §2.1 对模型同步的规则要求。

---

### P0-7.2：迁移验证脚本

**新增文件**：`scripts/verify-revision-label-migration.js`

提供独立于 `upgrade-database.js` 的迁移前/后验证能力：
- `--dry-run`（默认）：检查 NULL 值、重复 label、唯一索引、NOT NULL 状态
- `--fix`：按与 `upgrade-database.js` 一致的逻辑执行修复
- 输出包含待修复项的采样详情（前 5 条 NULL、每条重复组的完整版号列表）

**运行方式**：
```bash
# 迁移前检查
node scripts/verify-revision-label-migration.js

# 迁移前修复 + 检查
node scripts/verify-revision-label-migration.js --fix
```

---

### P1-5.1 / 7.3：`getDocumentResult` 补齐 `resolved_current_revision`

**文件**：`server/controllers/doc.controller.js`、`frontend/src/api/docs.ts`

`getDocumentResult` 响应的 `document` 对象现在同时返回：
- `resolved_current_revision_id`（已有）
- `resolved_current_revision`（**新增**）：完整的当前版本对象

前端 `DocResultDetail.document` 类型同步更新，新增 `resolved_current_revision: DocRevision | null`。

这与 `getDocument` / `listVersions` 的语义完全对齐：调用方始终通过 `resolved_current_revision` 判断当前版本，不需自行推断。

---

### P1-7.4：API 契约与消费约定 JSDoc 同步

**文件**：`server/controllers/doc.controller.js`

为以下方法补全 JSDoc，明确 `current_revision_id` vs `resolved_*` 的语义分工：
- `getDocument` — 标注 `resolved_current_revision` 为平台解析后的权威当前版本
- `getDocumentResult` — 同上，并追加调用方消费规则
- `listVersions` — 同上

消费规则统一表述为：
> 调用方应始终使用 resolved_* 字段判断当前版本，禁止自行遍历列表推断。

---

### P1-7.5：旧兜底逻辑白名单

**新增文件**：`docs/tasks/active/.../legacy-fallback-whitelist.md`

盘点当前仍保留 `revision_no DESC` 等历史兜底的模块：
| 模块 | 兜底模式 | 保留理由 |
|------|----------|----------|
| `document-clean-service.js` | `current_revision_id` → `revision_no DESC` fallback | 主路径优先，兜底仅防 current_revision_id 缺失 |
| `document-ocr-service.js` | 同上 | 同上 |
| `doc-recall-service.js` | `is_current = 1` 读路径 | 纯读取，不写入 |

每项有明确的保留理由、未来迁移计划和新增代码约束。

---

### P2-7.6：前端工程化细节优化

**文件**：`frontend/src/components/docs/DocVersionPanel.vue`、`zh-CN.ts`、`en-US.ts`

| 审计项 | 修复 |
|--------|------|
| 5.2 `sortedVersions` 未排序 | 实现客户端排序：年份 → revision_no DESC → created_at DESC，与后端 `sortRevisionList()` 对齐 |
| 5.3 `empty-text` 硬编码 | 改为 `:empty-text="$t(...)"`，中英文 i18n 补齐 |
| 5.4 label 编辑 blur 双触发 | 增加 `savingLabelFlag` 防重入守卫；`saveLabel()` 入口检查 `editingLabelId` 是否匹配，防止 blur 在 Enter 后重复触发 |

---

## 开发者反思

### 审计报告中存疑的地方

**5.5 `_dup_` 修复策略**：审计认为这"带业务语义损耗"。我的判断是：当前策略在工程上是最佳实践。

- `_dup_{revision_no}` 是去重后缀，保留了原始 label 的语义线索
- 比简单地覆盖或删除更可逆
- 重复数据本身已是业务异常（同一文档下不应有两个相同 label），修复只是使约束得以建立
- 已在迁移脚本中保留第一版的原值不变（`ORDER BY revision_no ASC`）

**5.6 "未看到 models/ 同步证据"**：这个观察是正确的。`generate-models.js` 是 sequelize-auto 生成器，模型必须从**已迁移的数据库**生成。在迁移尚未执行时，模型文件描述的是当前数据库状态（`allowNull: true`），这是正确的。本轮已通过迁移脚本末尾的提示和 changelog 说明补齐了这一流程。

### 系统性反思

本轮 audit-round04 的 6 个新问题全部属于**工程化收口**性质（文档、验证、防御性代码），而非方向性问题。这验证了前 3 轮的核心架构决策是正确的。

类似模式排查：
- 已确认 `is_current` 写入完全通过 `_syncIsCurrentFlags()` 统一入口
- 已确认旧兜底仅存在于 OCR/Clean 两条服务链，且均为读取兜底
- 前端组件防御性排序已与后端 `sortRevisionList()` 保持一致

---

## 未完成项（延后）

| 审计引用 | 内容 | 原因 |
|----------|------|------|
| P2-7.5 | 年份体系阈值精细化 | 当前 50% 规则可用，真实数据驱动后再调优 |
| — | 迁移真实执行 + 回归测试 | 需在目标环境执行，非代码层面问题；迁移验证脚本已就位 |

---

## 修改文件清单

| 文件 | 操作 |
|------|------|
| `scripts/upgrade-database.js` | 修改：追加模型重生成提醒 |
| `scripts/verify-revision-label-migration.js` | **新增**：迁移验证脚本 |
| `server/controllers/doc.controller.js` | 修改：`getDocumentResult` 返回 `resolved_current_revision`；JSDoc 补齐 |
| `frontend/src/api/docs.ts` | 修改：`DocResultDetail.document` 类型新增 |
| `frontend/src/components/docs/DocVersionPanel.vue` | 修改：客户端排序、i18n empty-text、防重入守卫 |
| `frontend/src/i18n/locales/zh-CN.ts` | 修改：新增 `emptyText` |
| `frontend/src/i18n/locales/en-US.ts` | 修改：新增 `emptyText` |
| `docs/tasks/.../legacy-fallback-whitelist.md` | **新增**：旧兜底白名单 |
