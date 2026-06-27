# Branch 记录

## 来源

- 拆自 `task-20260619-app-generation-guide`（已归档）
- 源分支: `feat/20260619-phase4-app-migration`（PR #891 已合并 master）

## 当前分支

`docs/20260627-legacy-mini-app-rows-audit-round12`

## Issue

待创建（如需要正式 Issue 关联）

## PR

待创建（Round 12 文档收口 PR）

## 修改范围

- `apps/doc-ocr-pipeline/tick/index.js`
- `server/services/mini-app.service.js`
- `server/services/extension-table.service.js`
- `server/routes/mini-app.routes.js`
- `docs/tasks/active/task-20260626-app-legacy-mini-app-rows-cleanup/README.md`
- `docs/tasks/active/task-20260626-app-legacy-mini-app-rows-cleanup/SELF-TEST.md`
- `docs/tasks/active/task-20260626-app-legacy-mini-app-rows-cleanup/BRANCH.md`
- `docs/tasks/active/task-20260626-app-legacy-mini-app-rows-cleanup/changelog_round11.md`
- `docs/tasks/active/task-20260626-app-legacy-mini-app-rows-cleanup/changelog_round12.md`
- `docs/tasks/active/task-20260626-app-legacy-mini-app-rows-cleanup/audit-round12.md`

## Round 12 文档收口记录

| 变更 | 文件 | 描述 |
|------|------|------|
| 修正任务阶段状态 | `README.md` | 明确“已完成，待复审归档”，并解释暂留 active 的原因 |
| 修正工作树数量对账 | `README.md`, `changelog_round11.md` | 将统计修正为本任务 11 + 其他任务 9 = 总数 20 |
| 补充勘误规则 | `SELF-TEST.md` | 明确历史审计文档优先勘误说明，避免直接重写旧正文 |
| 补充新一轮审计 | `audit-round12.md` | 记录 Round 12 审计结论与整改计划 |
| 记录文档收口动作 | `changelog_round12.md` | 留痕本轮纯文档修复 |

## Round 1 变更记录

| 变更 | 文件 | 描述 |
|------|------|------|
| 修复 `isFullyAutonomousApp()` | `mini-app.service.js` | 添加 `contract-mgr-v2` 到自治 app 列表 |
| 新增自治查询路径 | `extension-table.service.js` | 新增 `getRecordsWithExtensionAutonomous()` 和 `getRecordWithExtensionAutonomous()` |
| 移除 legacy 回写 | `doc-ocr-pipeline/tick/index.js` | 移除 `contract-mgr` 对 `mini_app_rows` 的回写，仅保留自治表写入 |
| 补齐资产盘点 | `asset-inventory.md` | 新增文档记录迁移分层与清理前置条件 |
| P1-5 旧路由盘点 | `asset-inventory.md` | 经盘点决定保留旧兼容路由，架构已正确分流 |
