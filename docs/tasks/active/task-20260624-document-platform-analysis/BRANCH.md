# Branch 记录

## 当前分支

- `fix/document-platform-audit-issues`

## Issue / PR

- Issue：无
- PR：无

## 修改范围

- 新增 `docs/tasks/active/task-20260624-document-platform-analysis/README.md`，记录本轮需求分析目标、范围与交付物。
- 新增 `docs/tasks/active/task-20260624-document-platform-analysis/BRANCH.md`，记录当前分支与本轮文档改动范围。
- 新增并收敛 `docs/tasks/active/task-20260624-document-platform-analysis/audit-round01.md`，沉淀本轮完整文档平台需求审计结果。
- 删除 `audit-round02.md`、`audit-round03.md`，将 metadata 边界修正与第一性原理重构分析并回 `audit-round01.md`。
- 新增 3 个后续子任务目录，用于承接回归修复、服务协议设计和文档域统一重构，不再把执行细节继续堆叠在主审计目录中。
- 新增 `audit-round04.md` 对 Round 03 修复结果执行复审，并新增 `changelog_round04.md` 记录本轮纠偏修复、验证结果与提交信息。
- 修复 `lib/document-ocr-service.js` 中 OCR 子状态机与文档主状态机混写问题，恢复 `doc_ocr_result.status` 的独立语义。
- 修复 `frontend/src/api/docs.ts`、`frontend/src/stores/doc.ts`、`frontend/src/views/DocDetailView.vue` 中文档处理终态的分散硬编码，收敛到共享定义。
- 修复 `server/routes/internal.routes.js` 注释乱码，并在任务文档中纠正 `P34/P35/P36` 的完成度口径。

## 审计范围

- `server/routes/doc.routes.js`
- `server/routes/doc-collection.routes.js`
- `server/routes/internal.routes.js`
- `server/controllers/doc.controller.js`
- `server/controllers/doc-collection.controller.js`
- `server/controllers/internal.controller.js`
- `lib/doc-recall-service.js`
- `lib/document-embedding-service.js`
- `lib/document-embedding-worker.js`
- `lib/document-ocr-service.js`
- `lib/document-outline-service.js`
- `lib/document-clean-service.js`
- `lib/document-chunk-service.js`
- `lib/doc-pipeline-defaults.js`
- `lib/rag-service.js`
- `frontend/src/api/docs.ts`
- `frontend/src/api/doc-pipeline.ts`
- `frontend/src/stores/doc.ts`
- `docs/design/drafts/document-intelligence-scenarios.md`

## 状态

- 首轮能力盘点与差距审计已完成，后续按多轮对话继续补充边界、优先级和实施建议。
- 主审计任务当前作为总控与分发入口，具体修复/设计工作已开始拆分到独立任务目录。
- `audit-round04` 对应修复已完成，当前状态为“消除 OCR 回归并纠正阶段判断”；`metadata extraction` 服务面仍保持未完成并转交专项任务处理。

✌Bazinga！
