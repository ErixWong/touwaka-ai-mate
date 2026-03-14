## 问题背景

当前项目存在多个独立的数据库迁移脚本（`scripts/migrate-*.js`）和一个升级脚本（`scripts/upgrade-database.js`），导致以下问题：

1. **迁移分散**：新旧迁移脚本并存，不便于维护
2. **外键缺失**：部分表（如 `knowledge_bases`）缺少必要的外键约束
3. **幂等性问题**：部分迁移脚本可能无法安全重复执行
4. **文档过时**：`SOUL.md` 中仍引用旧的 `migrate-xxx.js` 流程

## 解决方案

### 1. 统一迁移脚本

将所有独立的迁移脚本整合到 `scripts/upgrade-database.js` 中，删除所有 `migrate-*.js` 文件和 `migrations/` 目录。

### 2. 确保幂等性

- 每个迁移项有 `check` 函数检查是否已应用
- 使用 `safeExecute()` 捕获"已存在"类错误
- 表创建使用 `CREATE TABLE IF NOT EXISTS`
- 字段/外键添加前检查是否存在

### 3. 补充外键约束

为 `knowledge_bases` 表添加缺失的外键：
- `owner_id` → `users(id)`
- `embedding_model_id` → `ai_models(id)`

### 4. 更新文档

- 更新 `docs/core/SOUL.md` 中的迁移流程说明
- 更新 `docs/guides/development/code-review-checklist.md` 添加迁移检查项

## 预期结果

- 统一的数据库升级入口：`node scripts/upgrade-database.js`
- 所有迁移幂等，可安全重复执行
- 完整的外键约束
- 更新的开发文档

## 相关文件

- `scripts/upgrade-database.js`
- `docs/core/SOUL.md`
- `docs/guides/development/code-review-checklist.md`