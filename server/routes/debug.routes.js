/**
 * Debug Routes - 调试路由
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/debug' });

  // 获取最近一次 LLM Payload（需要认证）
  router.get('/llm-payload', authenticate(), controller.getLLMPayload.bind(controller));

  return router;
};
