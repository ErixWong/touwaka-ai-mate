/**
 * User Routes - 用户路由
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/users' });

  // 获取当前用户偏好设置（需要认证）- 必须在 /:id 路由之前
  router.get('/me/preferences', authenticate(), controller.getMyPreferences.bind(controller));

  // 更新当前用户偏好设置（需要认证）- 必须在 /:id 路由之前
  router.put('/me/preferences', authenticate(), controller.updateMyPreferences.bind(controller));

  // 获取用户信息（需要认证）
  router.get('/:id', authenticate(), controller.getUser.bind(controller));

  // 更新用户信息（需要认证）
  router.put('/:id', authenticate(), controller.updateUser.bind(controller));

  // 更新用户偏好设置（需要认证）- 保留兼容
  router.put('/:id/preferences', authenticate(), controller.updatePreferences.bind(controller));

  return router;
};
