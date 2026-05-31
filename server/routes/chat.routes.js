/**
 * Chat Routes - 聊天路由
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';
import logger from '../../lib/logger.js';

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

    try {
      // 真正中止 LLM 请求
      const aborted = await controller.chatService.abortUserRequest(user_id, expert_id);
      
      ctx.body = {
        code: 0,
        message: 'success',
        data: { success: true, aborted, expert_id, user_id },
      };
    } catch (error) {
      logger.error('[ChatRoutes] Stop generation error:', error);
      ctx.body = {
        code: 500,
        message: error.message,
        data: { success: false },
      };
    }
  });

  return router;
};
