/**
 * Internal Routes - 内部 API 路由
 * 
 * 用于服务间通信，不走用户认证
 * 
 * API 设计：
 * - POST /internal/messages/insert - 插入消息并触发专家响应
 */

import Router from '@koa/router';

/**
 * 创建内部路由
 * @param {Object} controller - InternalController 实例
 * @returns {Router}
 */
export default function createInternalRoutes(controller) {
  const router = new Router({
    prefix: '/internal'
  });

  // 消息插入 API
  router.post('/messages/insert', controller.insertMessage.bind(controller));

  return router;
}