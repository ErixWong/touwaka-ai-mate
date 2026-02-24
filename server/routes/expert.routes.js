/**
 * Expert Routes - 专家路由
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/experts' });

  // 获取专家列表（需要认证）
  router.get('/', authenticate(), controller.list.bind(controller));

  // 获取专家详情（需要认证）
  router.get('/:id', authenticate(), controller.get.bind(controller));

  // 创建专家（需要认证）
  router.post('/', authenticate(), controller.create.bind(controller));

  // 更新专家（需要认证）
  router.put('/:id', authenticate(), controller.update.bind(controller));

  // 删除专家（需要认证）
  router.delete('/:id', authenticate(), controller.delete.bind(controller));

  // 获取专家技能列表（需要认证）
  router.get('/:id/skills', authenticate(), controller.getSkills.bind(controller));

  // 更新专家技能（需要认证）
  router.post('/:id/skills', authenticate(), controller.updateSkills.bind(controller));

  return router;
};
