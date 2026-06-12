/**
 * Doc Routes - 统一文档平台路由
 *
 * API 契约: docs/tasks/active/task-20260605-document-platform-refactor/API-CONTRACTS.md
 * 前缀: /api/docs
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/docs' });

  // ==================== 文档路由 ====================

  // 文档接入（启动固定流水线）— 2.1
  router.post('/intakes', authenticate(), controller.createIntake.bind(controller));

  // 获取文档列表 — 2.2
  router.get('/documents', authenticate(), controller.listDocuments.bind(controller));

  // 创建文档
  router.post('/documents', authenticate(), controller.createDocument.bind(controller));

  // 获取文档详情
  router.get('/documents/:documentId', authenticate(), controller.getDocument.bind(controller));

  // 获取文档结果详情（阶段一：上传->OCR->预览）
  router.get('/documents/:documentId/result', authenticate(), controller.getDocumentResult.bind(controller));

  // 更新文档
  router.patch('/documents/:documentId', authenticate(), controller.updateDocument.bind(controller));

  // 删除文档
  router.delete('/documents/:documentId', authenticate(), controller.deleteDocument.bind(controller));

  // 查询处理状态 — 2.3
  router.get('/documents/:documentId/processing', authenticate(), controller.getProcessingStatus.bind(controller));

  // 提交 OCR 任务
  router.post('/documents/:documentId/ocr/submit', authenticate(), controller.submitOcr.bind(controller));

  // 同步 OCR 任务状态
  router.post('/documents/:documentId/ocr/sync', authenticate(), controller.syncOcr.bind(controller));

  // 重试失败处理 — 2.4
  router.post('/documents/:documentId/retry', authenticate(), controller.retryProcessing.bind(controller));

  // 查询文档权限 — 2.8
  router.get('/documents/:documentId/permissions', authenticate(), controller.getDocumentPermissions.bind(controller));

  // 迁移文档集合 — 2.9
  router.post('/documents/:documentId/relocate', authenticate(), controller.relocateDocument.bind(controller));

  // ==================== 版本(revision)路由 ====================

  // 获取版本列表 — 2.5
  router.get('/documents/:documentId/revisions', authenticate(), controller.listVersions.bind(controller));

  // 创建新版本
  router.post('/documents/:documentId/revisions', authenticate(), controller.createVersion.bind(controller));

  // 获取内容树
  router.get('/documents/:documentId/revisions/:revisionId/content-tree', authenticate(), controller.getContentTree.bind(controller));

  // 设为当前版本 — 2.6
  router.post('/revisions/:revisionId/set-current', authenticate(), controller.setCurrentVersion.bind(controller));

  // 版本状态流转
  router.post('/revisions/:revisionId/transition', authenticate(), controller.transitionVersionStatus.bind(controller));

  // 查询版本差异状态 — 2.7
  router.get('/revisions/:revisionId/diff-status', authenticate(), controller.getDiffStatus.bind(controller));

  // ==================== 检索路由 ====================

  // 统一召回入口
  router.post('/recall', authenticate(), controller.recall.bind(controller));

  // ==================== 比对路由 ====================

  // 创建比对任务
  router.post('/compare-runs', authenticate(), controller.createCompareRun.bind(controller));

  // 获取比对结果
  router.get('/compare-runs/:runId', authenticate(), controller.getCompareRun.bind(controller));

  return router;
};