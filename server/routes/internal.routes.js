/**
 * Internal Routes
 *
 * 用于驻留式技能和内部后台执行链路。所有路由都经过用户 JWT 认证。
 */

import Router from '@koa/router';

/**
 * 创建内部路由
 * @param {Object} controller - InternalController 实例
 * @param {Object} docsController - InternalDocsController 实例
 * @param {Object} authMiddleware - 认证中间件
 * @returns {Router}
 */
export default function createInternalRoutes(controller, docsController, authMiddleware) {
  const router = new Router({
    prefix: '/internal',
  });

  const requireAuth = authMiddleware.authenticate();

  router.post('/messages/insert', requireAuth, controller.insertMessage.bind(controller));

  router.get('/models/resolve', requireAuth, controller.resolveModelName.bind(controller));
  router.get('/models/:model_id', requireAuth, controller.getModelConfig.bind(controller));

  router.post('/resident/invoke', requireAuth, controller.invokeResidentTool.bind(controller));
  router.post('/agent/child-run/execute', requireAuth, controller.executeChildAgentRun.bind(controller));

  router.post('/mcp/config', requireAuth, controller.getMcpConfig.bind(controller));

  router.post('/docs/intakes', requireAuth, docsController.createIntake.bind(docsController));
  router.get('/docs/:document_id/processing', requireAuth, docsController.getProcessingStatus.bind(docsController));
  router.post('/docs/recall', requireAuth, docsController.recall.bind(docsController));
  router.get('/docs/:document_id/revisions', requireAuth, docsController.listRevisions.bind(docsController));

  return router;
}
