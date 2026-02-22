/**
 * Model Routes - 模型管理路由
 */

import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';

/**
 * 创建模型路由
 * @param {ModelController} controller - 模型控制器实例
 * @returns {Router} Koa Router 实例
 */
function modelRoutes(controller) {
  const router = new Router({ prefix: '/api/models' });

  // 获取模型列表 - 需要登录
  router.get('/', authenticate(), (ctx) => controller.list(ctx));

  // 获取单个模型详情 - 需要登录
  router.get('/:id', authenticate(), (ctx) => controller.getById(ctx));

  // 创建模型 - 需要管理员权限
  router.post('/', authenticate(), requireAdmin(), (ctx) => controller.create(ctx));

  // 更新模型 - 需要管理员权限
  router.put('/:id', authenticate(), requireAdmin(), (ctx) => controller.update(ctx));

  // 删除模型 - 需要管理员权限
  router.delete('/:id', authenticate(), requireAdmin(), (ctx) => controller.delete(ctx));

  return router;
}

export default modelRoutes;
