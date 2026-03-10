/**
 * Chat Routes - 聊天路由
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/chat' });

  // 发送消息（需要认证）- content 在 body 中，支持流式响应
  router.post('/', authenticate(), controller.sendMessage.bind(controller));

  // SSE 订阅话题流式响应（需要认证）- 只需要 topicId
  router.get('/stream', authenticate(), controller.subscribe.bind(controller));

  // 停止生成（需要认证）
  router.post('/stop', authenticate(), async (ctx) => {
    const { expert_id } = ctx.request.body || {};
    const user_id = ctx.state.session.id;

    // 简化实现：返回成功，前端会标记消息为已停止
    ctx.body = {
      code: 0,
      message: 'success',
      data: { success: true, expert_id, user_id },
    };
  });

  return router;
};
