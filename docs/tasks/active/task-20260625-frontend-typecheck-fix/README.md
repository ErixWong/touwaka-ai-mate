# task-20260625-frontend-typecheck-fix

## 目标

- 修复当前前端 `vue-tsc --build` 阻塞的 TypeScript 类型错误。
- 保持改动最小，仅处理明确的类型定义、空值保护与模板推断问题。

## 范围

- `frontend/src/components/current-feature-analyzer/CompressedCurrentChart.vue`
- `frontend/src/components/current-feature-analyzer/FileListPanel.vue`
- `frontend/src/components/current-feature-analyzer/RuleSetEditorModal.vue`
- `frontend/src/stores/currentFeatureAnalyzer.ts`
- `frontend/src/views/contract-mgr/ContractMgrView.vue`
- `docs/tasks/active/task-20260625-frontend-typecheck-fix/`

## 结果

- 为图表分段映射补全显式类型，消除隐式 `any`。
- 为文件列表面板补上完成数与总数的计算来源。
- 修正阶段删除按钮索引类型与 store 首项访问的空值保护。
- 修正合同详情请求的泛型参数，匹配实际详情类型。

## 验证

- 已通过：`frontend` 目录下 `npx vue-tsc --build`
