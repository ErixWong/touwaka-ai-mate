/**
 * Auth Routes - 认证路由
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/auth' });

  // 登录
  router.post('/login', (ctx) => controller.login(ctx));

  // 刷新 Token
  router.post('/refresh', (ctx) => controller.refresh(ctx));

  // 获取当前用户信息（需要认证）
  router.get('/me', authenticate(), (ctx) => controller.me(ctx));

  // 登出（需要认证）
  router.post('/logout', authenticate(), (ctx) => controller.logout(ctx));

  return router;
};
