/**
 * Expert Routes - 专家路由
 */

import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/experts' });

  // 获取专家列表（需要管理员权限）
  router.get('/', authenticate(), requireAdmin(), controller.list.bind(controller));

  // 获取专家详情（需要管理员权限）
  router.get('/:id', authenticate(), requireAdmin(), controller.get.bind(controller));

  // 创建专家（需要管理员权限）
  router.post('/', authenticate(), requireAdmin(), controller.create.bind(controller));

  // 更新专家（需要管理员权限）
  router.put('/:id', authenticate(), requireAdmin(), controller.update.bind(controller));

  // 删除专家（需要管理员权限）
  router.delete('/:id', authenticate(), requireAdmin(), controller.delete.bind(controller));

  // 获取专家技能列表（需要管理员权限）
  router.get('/:id/skills', authenticate(), requireAdmin(), controller.getSkills.bind(controller));

  // 更新专家技能（需要管理员权限）
  router.post('/:id/skills', authenticate(), requireAdmin(), controller.updateSkills.bind(controller));

  // 刷新专家缓存（需要管理员权限）
  router.post('/:id/refresh', authenticate(), requireAdmin(), controller.refresh.bind(controller));

  return router;
};
