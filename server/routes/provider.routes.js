/**
 * Provider 路由
 */

import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';
import ProviderController from '../controllers/provider.controller.js';

export default (db) => {
  const router = new Router({ prefix: '/api/providers' });
  const controller = new ProviderController(db);

  // 获取所有 Providers（需管理员）
  router.get('/', authenticate(), requireAdmin(), (ctx) => controller.getAll(ctx));

  // 获取单个 Provider（需管理员）
  router.get('/:id', authenticate(), requireAdmin(), (ctx) => controller.getOne(ctx));

  // 创建 Provider（需管理员）
  router.post('/', authenticate(), requireAdmin(), (ctx) => controller.create(ctx));

  // 更新 Provider（需管理员）
  router.put('/:id', authenticate(), requireAdmin(), (ctx) => controller.update(ctx));

  // 删除 Provider（需管理员）
  router.delete('/:id', authenticate(), requireAdmin(), (ctx) => controller.delete(ctx));

  return router;
};
