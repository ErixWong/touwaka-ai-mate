/**
 * Role Routes - 角色管理路由
 */

import Router from '@koa/router';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const requireRoleManagement = requirePermission('menu:admin:roles');

export default (controller) => {
  const router = new Router({ prefix: '/api/roles' });

  // 所有角色路由需要认证和角色管理权限
  router.use(authenticate());

  // 获取角色列表
  router.get('/', requireRoleManagement, controller.list.bind(controller));

  // 获取所有权限列表（用于角色管理界面）
  router.get('/permissions/all', requireRoleManagement, controller.listAllPermissions.bind(controller));

  // 获取所有专家列表（用于角色管理界面）
  router.get('/experts/all', requireRoleManagement, controller.listAllExperts.bind(controller));

  // 获取角色详情
  router.get('/:id', requireRoleManagement, controller.get.bind(controller));

  // 更新角色
  router.put('/:id', requireRoleManagement, controller.update.bind(controller));

  // 角色权限
  router.get('/:id/permissions', requireRoleManagement, controller.getPermissions.bind(controller));
  router.put('/:id/permissions', requireRoleManagement, controller.updatePermissions.bind(controller));

  // 角色专家访问权限
  router.get('/:id/experts', requireRoleManagement, controller.getExperts.bind(controller));
  router.put('/:id/experts', requireRoleManagement, controller.updateExperts.bind(controller));

  return router;
};
