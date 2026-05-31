/**
 * Doc Routes - 统一文档平台路由
 *
 * API 规范见 docs/tasks/active/task-20260531-kb-contract-unification-analysis/UNIFIED_DOCUMENT_PLATFORM_PLAN.md §20
 *
 * 路径前缀：/api/docs
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/docs' });

  // ==================== 文档路由 ====================

  // 获取文档列表
  router.get('/', authenticate(), controller.listDocuments.bind(controller));

  // 创建文档
  router.post('/', authenticate(), controller.createDocument.bind(controller));

  // 获取文档详情
  router.get('/:documentId', authenticate(), controller.getDocument.bind(controller));

  // 更新文档
  router.patch('/:documentId', authenticate(), controller.updateDocument.bind(controller));

  // ==================== 版本路由 ====================

  // 获取版本列表
  router.get('/:documentId/versions', authenticate(), controller.listVersions.bind(controller));

  // 创建新版本
  router.post('/:documentId/versions', authenticate(), controller.createVersion.bind(controller));

  // 设为当前版本
  router.post('/:documentId/versions/:versionId/set-current', authenticate(), controller.setCurrentVersion.bind(controller));

  // 版本状态流转
  router.post('/:documentId/versions/:versionId/transition', authenticate(), controller.transitionVersionStatus.bind(controller));

  // 获取内容树
  router.get('/:documentId/versions/:versionId/content-tree', authenticate(), controller.getContentTree.bind(controller));

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