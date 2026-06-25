/**
 * Internal Routes - 内部 API 路由
 *
 * 用于驻留式技能调用，需要用户 JWT 认证
 *
 * API 设计：
 * - POST /internal/messages/insert - 插入消息并触发专家响应
 * - GET /internal/models/:model_id - 获取模型配置（含 Provider 信息）
 * - GET /internal/models/resolve?name=xxx - 通过名称解析模型 ID
 * - POST /internal/resident/invoke - 调用驻留式技能工具
 * - POST /internal/docs/intakes - 文档接入
 * - GET /internal/docs/:document_id/processing - 查询处理状态
 * - POST /internal/docs/recall - 文档召回
 * - GET /internal/docs/:document_id/revisions - 版本列表
 *
 * 安全策略：
 * - 必须提供有效的用户 JWT Token
 * - 注：当前实现为"JWT 认证即可"，未强制本地 IP 访问
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
    prefix: '/internal'
  });

  // 所有 internal API 都需要用户认证
  const requireAuth = authMiddleware.authenticate();

  // 消息插入 API
  router.post('/messages/insert', requireAuth, controller.insertMessage.bind(controller));

  // 通过名称解析模型 ID（必须在 /:model_id 之前注册）
  router.get('/models/resolve', requireAuth, controller.resolveModelName.bind(controller));

  // 获取模型配置 API
  router.get('/models/:model_id', requireAuth, controller.getModelConfig.bind(controller));

  // 调用驻留式技能工具 API
  router.post('/resident/invoke', requireAuth, controller.invokeResidentTool.bind(controller));

  // 获取 MCP 配置 API（供驻留进程调用）
  router.post('/mcp/config', requireAuth, controller.getMcpConfig.bind(controller));

  // ==================== 文档内部 API (P27) ====================

  // 文档接入
  router.post('/docs/intakes', requireAuth, docsController.createIntake.bind(docsController));

  // 查询处理状态
  router.get('/docs/:document_id/processing', requireAuth, docsController.getProcessingStatus.bind(docsController));

  // 文档召回
  router.post('/docs/recall', requireAuth, docsController.recall.bind(docsController));

  // 版本列表
  router.get('/docs/:document_id/revisions', requireAuth, docsController.listRevisions.bind(docsController));

  return router;
}
