/**
 * Assistant Routes - 助理路由
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

/**
 * 创建路由实例
 * @param {object} controller - AssistantController 实例
 */
export default function createAssistantRoutes(controller) {
  const router = new Router({ prefix: '/api/assistants' });

  // GET /api/assistants - 列出可用助理
  router.get('/', controller.list.bind(controller));

  // POST /api/assistants - 创建助理（管理员）
  router.post('/', authenticate(), controller.create.bind(controller));

  // POST /api/assistants/call - 召唤助理
  router.post('/call', controller.call.bind(controller));

  // GET /api/assistants/requests - 查询委托列表
  router.get('/requests', authenticate(), controller.listRequests.bind(controller));

  // POST /api/assistants/requests/:request_id/archive - 归档委托
  router.post('/requests/:request_id/archive', authenticate(), controller.archive.bind(controller));

  // POST /api/assistants/requests/:request_id/unarchive - 取消归档
  router.post('/requests/:request_id/unarchive', authenticate(), controller.unarchive.bind(controller));

  // DELETE /api/assistants/requests/:request_id - 删除委托
  router.delete('/requests/:request_id', authenticate(), controller.delete.bind(controller));

  // GET /api/assistants/requests/:request_id/messages - 查询委托消息列表
  router.get('/requests/:request_id/messages', authenticate(), controller.getMessages.bind(controller));

  // GET /api/assistants/requests/:request_id - 查询委托状态
  router.get('/requests/:request_id', authenticate(), controller.getRequest.bind(controller));

  // GET /api/assistants/:type - 获取单个助理详情（动态路由放最后）
  router.get('/:type', authenticate(), controller.getDetail.bind(controller));

  // PUT /api/assistants/:type - 更新助理配置（管理员）
  router.put('/:type', authenticate(), controller.update.bind(controller));

  // DELETE /api/assistants/:type - 删除助理（管理员）
  router.delete('/:type', authenticate(), controller.deleteAssistant.bind(controller));

  return router;
}
