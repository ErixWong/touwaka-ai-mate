/**
 * Message Routes - 消息路由
 *
 * 核心设计：
 * - 消息按 expert + user 组织，不是按 topic 组织
 * - topic 只是对话历史的阶段性总结
 */

import Router from '@koa/router';
import { authenticate, optionalAuth } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/messages' });

  // 按 expert + user 获取消息列表（主要入口，需要认证）
  router.get('/expert/:expertId', authenticate(), controller.listByExpert.bind(controller));

  // 获取消息列表（旧 API，按 topic，保留兼容）
  router.get('/', optionalAuth(), controller.list.bind(controller));

  // 获取单条消息详情（需要认证）
  router.get('/:id', authenticate(), controller.get.bind(controller));

  return router;
};
