/**
 * Chat Routes - 聊天路由
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';
import logger from '../../lib/logger.js';

export default (controller, services = {}) => {
  const router = new Router({ prefix: '/api/chat' });

  // 获取用户可访问的专家列表（用户侧安全接口）
  router.get('/experts', authenticate(), async (ctx) => {
    try {
      const permissionService = services.permissionService;
      const userId = ctx.state.session.id;
      
      const experts = await permissionService.getAccessibleExperts(userId);
      ctx.success(experts);
    } catch (error) {
      logger.error('[ChatRoutes] Get user experts error:', error);
      ctx.error('获取专家列表失败: ' + error.message, 500);
    }
  });

  // 发送消息（需要认证）- content 在 body 中，支持流式响应
  router.post('/', authenticate(), controller.sendMessage.bind(controller));

  // 查询聊天请求状态（需要认证）
  router.get('/requests/:request_id', authenticate(), controller.getRequestStatus.bind(controller));

  // 重试聊天请求（需要认证）
  router.post('/requests/:request_id/retry', authenticate(), controller.retryRequest.bind(controller));

  // SSE 订阅话题流式响应（需要认证）- 只需要 topicId
  router.get('/stream', authenticate(), controller.subscribe.bind(controller));

  // 停止生成（需要认证）
  router.post('/stop', authenticate(), async (ctx) => {
    const { request_id } = ctx.request.body || {};
    const user_id = ctx.state.session.id;

    try {
      if (!request_id) {
        ctx.error('缺少 request_id 参数');
        return;
      }

      const result = await controller.stopRequest(request_id, user_id);

      if (!result.success) {
        ctx.status = 409;
        ctx.body = {
          code: 409,
          message: 'stop failed',
          data: {
            success: false,
            aborted: false,
            request_id,
            expert_id: result.expert_id,
            user_id,
          },
        };
        return;
      }
      
      ctx.body = {
        code: 0,
        message: 'success',
        data: {
          success: result.success,
          aborted: result.aborted,
          request_id,
          expert_id: result.expert_id,
          user_id,
        },
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
