/**
 * Role Routes - 角色管理路由
 */

import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/roles' });

  // 所有角色路由需要认证和管理员权限
  router.use(authenticate());

  // 获取角色列表
  router.get('/', requireAdmin(), controller.list.bind(controller));

  // 获取所有权限列表（用于角色管理界面）
  router.get('/permissions/all', requireAdmin(), controller.listAllPermissions.bind(controller));

  // 获取所有专家列表（用于角色管理界面）
  router.get('/experts/all', requireAdmin(), controller.listAllExperts.bind(controller));

  // 获取角色详情
  router.get('/:id', requireAdmin(), controller.get.bind(controller));

  // 更新角色
  router.put('/:id', requireAdmin(), controller.update.bind(controller));

  // 角色权限
  router.get('/:id/permissions', requireAdmin(), controller.getPermissions.bind(controller));
  router.put('/:id/permissions', requireAdmin(), controller.updatePermissions.bind(controller));

  // 角色专家访问权限
  router.get('/:id/experts', requireAdmin(), controller.getExperts.bind(controller));
  router.put('/:id/experts', requireAdmin(), controller.updateExperts.bind(controller));

  return router;
};