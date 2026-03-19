/**
 * Debug Routes - 调试路由
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/debug' });

  // 获取最近一次 LLM Payload（需要认证）
  router.get('/llm-payload', authenticate(), controller.getLLMPayload.bind(controller));

  // 获取驻留进程状态（需要认证）
  router.get('/resident-status', authenticate(), controller.getResidentStatus.bind(controller));

  // 获取调度器状态（需要认证）
  router.get('/scheduler-status', authenticate(), controller.getSchedulerStatus.bind(controller));

  // 强制重置调度器任务（需要认证）
  router.post('/scheduler-reset/:name', authenticate(), controller.resetSchedulerTask.bind(controller));

  return router;
};
