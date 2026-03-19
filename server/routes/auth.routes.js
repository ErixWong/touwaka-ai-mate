/**
 * Auth Routes - 认证路由
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/auth' });

  // 登录
  router.post('/login', (ctx) => controller.login(ctx));

  // 注册
  router.post('/register', (ctx) => controller.register(ctx));

  // 获取注册配置（公开接口）
  router.get('/registration-config', (ctx) => controller.getRegistrationConfig(ctx));

  // 刷新 Token
  router.post('/refresh', (ctx) => controller.refresh(ctx));

  // 获取当前用户信息（需要认证）
  router.get('/me', authenticate(), (ctx) => controller.me(ctx));

  // 登出（需要认证）
  router.post('/logout', authenticate(), (ctx) => controller.logout(ctx));

  return router;
};
