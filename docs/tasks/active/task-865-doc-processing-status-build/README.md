# task-865-doc-processing-status-build

## 目标

- 修复 `frontend` 构建时 `src/stores/doc.ts` 对不存在处理状态字段的访问导致的 TypeScript 编译失败。

## 范围

- `frontend/src/stores/doc.ts`
- `docs/tasks/active/task-865-doc-processing-status-build/`

## 结果

- 删除 `doc` store 轮询逻辑中对 `outline_run_id` 和 `outline_run_status` 的依赖。
- 保持前端轮询逻辑仅依赖当前后端真实返回的 `processing_status` 契约。

## 验证

- `frontend` 下执行 `npm run build`。
- 仓库根目录执行 `npm run lint`。

## 验证结论

- `frontend` 下 `npm run build` 已通过。
- 仓库根目录 `npm run lint` 已通过。
