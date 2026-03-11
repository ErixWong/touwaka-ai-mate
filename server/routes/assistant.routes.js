/**
 * Assistant Routes - 助理路由
 */

import Router from '@koa/router';

/**
 * 创建路由实例
 * @param {object} controller - AssistantController 实例
 */
export default function createAssistantRoutes(controller) {
  const router = new Router({ prefix: '/api/assistants' });

  // GET /api/assistants - 列出可用助理
  router.get('/', controller.list.bind(controller));

  // POST /api/assistants/call - 召唤助理
  router.post('/call', controller.call.bind(controller));

  // GET /api/assistants/requests - 查询委托列表
  router.get('/requests', controller.listRequests.bind(controller));

  // GET /api/assistants/requests/:request_id/messages - 查询委托消息列表
  router.get('/requests/:request_id/messages', controller.getMessages.bind(controller));

  // GET /api/assistants/requests/:request_id - 查询委托状态
  router.get('/requests/:request_id', controller.getRequest.bind(controller));

  return router;
}
