# Branch 记录

## 来源

- 从 `task-20260626-app-legacy-mini-app-rows-cleanup` 中拆分出的独立任务
- 目的：为 `contract-mgr-v2` 独立架构相关变更建立专属任务留痕

## 当前分支

`master`

## 建议分支

`fix/20260627-contract-mgr-v2-independence-followup`

## Issue

待创建（如后续需要正式关联）

## PR

待创建

## 当前已识别修改范围

- `apps/contract-mgr-v2/manifest.json`
- `apps/contract-mgr-v2/server/routes.js`
- `apps/contract-mgr-v2/server/controllers/version-from-attachment.js`
- `frontend/src/api/contract-v2.ts`
- `frontend/src/components/contract-v2/ContractDetail.vue`
- `frontend/src/components/contract-v2/ContractList.vue`
- `frontend/src/stores/contract-v2.ts`
- `server/controllers/contract-v2.controller.js`
- `server/services/contract-v2.service.js`

## 任务边界说明

- 本任务负责 `contract-mgr-v2` 独立架构、专属 API、版本建档与前端调用链相关收口
- 不再归属于 `task-20260626-app-legacy-mini-app-rows-cleanup`
- 后者仅保留“已拆分至独立任务”的边界说明

---

*创建时间：2026-06-27*
