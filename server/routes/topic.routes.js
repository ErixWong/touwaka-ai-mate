/**
 * Topic Routes - 话题路由
 */

import Router from '@koa/router';
import { authenticate, optionalAuth } from '../middlewares/auth.js';

export default (controller, messageController) => {
  const router = new Router({ prefix: '/api/topics' });

  // 复杂查询话题列表（需要认证）
  router.post('/query', authenticate(), controller.query.bind(controller));

  // 获取话题列表（需要认证）- 简单 GET 查询，保持向后兼容
  router.get('/', authenticate(), controller.list.bind(controller));

  // 创建话题（需要认证）
  router.post('/', authenticate(), controller.create.bind(controller));

  // 获取话题详情（公开访问）
  router.get('/:id', optionalAuth(), controller.get.bind(controller));

  // 更新话题（需要认证）
  router.put('/:id', authenticate(), controller.update.bind(controller));

  // 删除话题（需要认证）
  router.delete('/:id', authenticate(), controller.delete.bind(controller));

  // 获取话题下的消息列表（需要认证）
  if (messageController) {
    router.get('/:topicId/messages', authenticate(), messageController.listByTopic.bind(messageController));
  }

  return router;
};
