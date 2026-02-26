/**
 * User Routes - 用户路由
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/users' });

  // ========== 管理员专用路由 ==========
  
  // 获取用户列表（需要管理员权限）
  router.get('/', authenticate(), controller.getUsers.bind(controller));

  // 创建新用户（需要管理员权限）
  router.post('/', authenticate(), controller.createUser.bind(controller));

  // 删除用户（需要管理员权限）
  router.delete('/:id', authenticate(), controller.deleteUser.bind(controller));

  // 重置用户密码（需要管理员权限）
  router.post('/:id/reset-password', authenticate(), controller.resetPassword.bind(controller));

  // 更新用户角色（需要管理员权限）
  router.put('/:id/roles', authenticate(), controller.updateUserRoles.bind(controller));

  // ========== 角色管理路由 ==========
  
  // 获取所有角色列表（需要管理员权限）
  router.get('/roles', authenticate(), controller.getRoles.bind(controller));

  // ========== 当前用户路由 ==========
  
  // 获取当前用户偏好设置（需要认证）- 必须在 /:id 路由之前
  router.get('/me/preferences', authenticate(), controller.getMyPreferences.bind(controller));

  // 更新当前用户偏好设置（需要认证）- 必须在 /:id 路由之前
  router.put('/me/preferences', authenticate(), controller.updateMyPreferences.bind(controller));

  // ========== 用户 CRUD 路由 ==========
  
  // 获取用户信息（需要认证）
  router.get('/:id', authenticate(), controller.getUser.bind(controller));

  // 更新用户信息（需要认证）
  router.put('/:id', authenticate(), controller.updateUser.bind(controller));

  // 更新用户偏好设置（需要认证）- 保留兼容
  router.put('/:id/preferences', authenticate(), controller.updatePreferences.bind(controller));

  return router;
};
