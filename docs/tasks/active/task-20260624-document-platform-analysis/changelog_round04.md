# Changelog Round 04 - 文档平台审计 Round 04 修复与口径纠偏

## 概述

本轮针对 `audit-round04.md` 中指出的问题进行复核与修复，重点处理 OCR 主链路状态回归，并从系统架构角度重新校准状态边界、阶段判断和任务口径。

## 本轮结论

- `P39` 属于真实且必须立即修复的问题，已完成代码修复。
- `P40`、`P41`、`P42`、`P43` 的核心不是单点 bug，而是阶段判断和状态边界被过度乐观描述；本轮已在文档与共享定义层完成纠偏。
- `P44` 属于真实但低风险的质量问题，已顺手修复。
- `P36` 仍然未完成，但本轮不扩展实现 `metadata extraction` 服务面，因为该项已经被拆分到 `task-20260624-doc-platform-service-contract-design`，继续在当前任务里直接补接口会重新混淆任务边界。
- 当前项目仍不应进入下一功能阶段；只有 OCR 回归清除、服务协议冻结、控制器收口计划明确后，才适合继续推进。

## 已修复问题

### P39: OCR 状态映射回归

- **问题**：`lib/document-ocr-service.js` 将 OCR provider 返回状态直接映射到文档主状态机，导致 `doc_ocr_result.status` 被错误写入 `pending_ocr`、`ocr_processing`、`error` 等文档流程状态。
- **修复**：
  - 将映射重构为 `EXTERNAL_TO_OCR_STATUS_MAP`。
  - `doc_ocr_result.status` 只保留 OCR 子任务语义：`pending`、`processing`、`completed`、`failed`。
  - 文档主状态仍只由 `DocPipelineAdvancer` 推进，不再通过 OCR 结果字段复用。
- **文件**：`lib/document-ocr-service.js`

### P43: 前端终态逻辑仍散落硬编码

- **问题**：`frontend/src/stores/doc.ts` 仍直接用 `ready` / `error` 判断终态，说明状态机治理停留在注释层。
- **修复**：
  - 在 `frontend/src/api/docs.ts` 中增加共享常量 `DOC_PROCESSING_TERMINAL_STATUSES`、`DOC_PROCESSING_NON_TERMINAL_STATUSES` 和 `isTerminalDocProcessingStatus()`。
  - `frontend/src/stores/doc.ts` 改为复用共享终态判断。
  - `frontend/src/views/DocDetailView.vue` 改为复用共享终态/非终态定义，避免页面层再次分叉定义。
- **文件**：`frontend/src/api/docs.ts`、`frontend/src/stores/doc.ts`、`frontend/src/views/DocDetailView.vue`
- **补充说明**：由于 `frontend/src/api/docs.ts` 同文件中还包含上一轮未提交的 `recall contract` 类型对齐（`version -> revision`、补回 `outline_id`），本次提交会一并将该既有修正固化，避免继续悬空在工作树中。

### P44: internal routes 注释乱码

- **问题**：`server/routes/internal.routes.js` 注释出现 `API 设计��` 乱码。
- **修复**：修正文案为正常 UTF-8 文本 `API 设计：`。
- **文件**：`server/routes/internal.routes.js`

## 纠偏但不直接编码实现的事项

### P40: `P34` 不能判定为“已闭环”

- **复核结论**：审计判断成立。
- **本轮处理**：通过修复 `document-ocr-service` 的状态映射回归，将 `P34` 的真实状态回落为“已纠正回归，但状态治理仍未整体闭环”。
- **原因**：当前只修复了最危险的运行时错写；三层状态边界虽已重新拉开，但前后端仍未建立统一导出机制。

### P41: `P36` 不能被主观关闭

- **复核结论**：审计判断成立。
- **本轮处理**：不再沿用“当前阶段不需要”的说法，明确记为“仍未完成，转由服务协议专项任务设计”。
- **未在本轮直接实现的原因**：
  - `metadata extraction` 属于对外能力接口，不应硬塞进平台内部处理状态机。
  - 当前仓库已明确拆出 `task-20260624-doc-platform-service-contract-design` 处理该服务面；若在本轮直接补接口，会重新混淆任务边界与阶段职责。

### P42: `P35` 不能判定为完全闭环

- **复核结论**：审计判断成立。
- **本轮处理**：在任务文档中将控制器收口状态明确记录为“部分迁移完成，未形成唯一业务入口”。
- **原因**：`createVersion()` / `setCurrentVersion()` 已迁移，但 `doc.controller.js` 仍承载较多版本、召回、流水线编排职责。

## 为什么这些问题会出现

1. **状态概念边界不清**
- 本轮最核心的问题不是“少了一个 if”，而是把三层状态混成了一层：provider 状态、OCR 结果状态、文档处理状态没有明确所有权。
- 这类问题一旦发生，表面上看只是命名调整，实际上会让轮询、取消、重试、复用逻辑同时失真。

2. **阶段判断依赖 changelog 主观表述而非仓库事实**
- `P34`、`P35`、`P36` 在上一轮被写得过于乐观，说明“文档已写完”被误当成“问题已闭环”。
- 这会直接误导是否切阶段，是项目管理层面的风险。

3. **前端消费层没有复用后端状态定义**
- 页面层和 store 层各自写一份终态逻辑，短期可用，长期会继续分裂。
- 本轮虽然只做了最小共享化，但已经证明同类问题确实存在。

## 同类风险复盘

- `DocDetailView.vue` 与 `doc store` 的状态判断曾分别维护，属于同源分叉风险；本轮已最小收敛。
- `metadata extraction` 如果后续被误接入 `documents.processing_status`，会再次制造“平台状态机膨胀”问题；因此本轮明确禁止沿该路径继续实现。
- 控制器与服务层双编排仍是潜在同类风险，后续若继续迁移 `revision status transition`、`recall` 等逻辑，必须坚持“服务层唯一业务入口”。

## 本轮未修复项与理由

### 1. `metadata extraction` 服务面

- **状态**：未实现，保持待办。
- **理由**：需要单独定义请求体、权限边界、同步/异步返回策略与结果归属；这是接口设计任务，不适合在本轮回归修复中直接拍脑袋补路由。

### 2. 控制器剩余职责迁移

- **状态**：未继续迁移。
- **理由**：当前优先级低于 OCR 主链路回归止损，且需要单独梳理服务边界。

### 3. 更广泛的前端状态统一

- **状态**：只做最小共享化，未继续拆 store。
- **理由**：`frontend/src/stores/doc.ts` 与页面层职责分离属于下阶段重构题，不应在本轮扩散范围。

## 自审结果

### 对照审计项

- `P39`：已闭环，OCR 子状态机与文档主状态机已重新拆开。
- `P40`：已纠偏，撤销“P34 已闭环”的错误口径。
- `P41`：已纠偏，撤销“P36 当前不需要”的错误口径，改为“未完成，交由专项任务设计”。
- `P42`：已纠偏，任务文档已明确控制器拆分仅为部分完成。
- `P43`：已部分收敛，至少 store 与关键页面不再各自手写终态定义。
- `P44`：已闭环，乱码注释已修复。

### 架构约束复核

- 未修改数据库结构。
- 未引入新的第三方依赖。
- 未改变现有 API 契约。
- 未将 `metadata extraction` 硬塞进平台内部状态机。

## 验证结果

- [x] `node --check lib/document-ocr-service.js`
- [x] `npm run lint`
- [x] `node -e "import('./lib/document-ocr-service.js').then(() => console.log('OK'))"`
- [x] `npx vue-tsc --project "tsconfig.audit-doc-status-round04.json" --noEmit`

## 变更文件清单

1. `lib/document-ocr-service.js` - 修复 OCR 状态映射回归
2. `frontend/src/api/docs.ts` - 增加共享处理状态定义
3. `frontend/src/stores/doc.ts` - 复用共享终态判断
4. `frontend/src/views/DocDetailView.vue` - 复用共享状态定义
5. `server/routes/internal.routes.js` - 修复乱码注释
6. `frontend/tsconfig.audit-doc-status-round04.json` - 本轮前端局部类型校验工程
7. `docs/tasks/active/task-20260624-document-platform-analysis/README.md` - 更新 Round 04 结论与产出物
8. `docs/tasks/active/task-20260624-document-platform-analysis/BRANCH.md` - 更新当前分支与本轮修改范围
9. `docs/tasks/active/task-20260624-document-platform-analysis/changelog_round04.md` - 本文件

## 提交信息

- 待提交

## 变更报告路径

`D:\projects\node\touwaka-mate-v2-p1\docs\tasks\active\task-20260624-document-platform-analysis\changelog_round04.md`

✌Bazinga！
