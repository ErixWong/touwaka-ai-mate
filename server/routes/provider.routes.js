/**
 * Provider 路由
 */

import Router from '@koa/router';
import ProviderController from '../controllers/provider.controller.js';

export default (db) => {
  const router = new Router({ prefix: '/api/providers' });
  const controller = new ProviderController(db);

  // 获取所有 Providers
  router.get('/', (ctx) => controller.getAll(ctx));

  // 获取单个 Provider
  router.get('/:id', (ctx) => controller.getOne(ctx));

  // 创建 Provider
  router.post('/', (ctx) => controller.create(ctx));

  // 更新 Provider
  router.put('/:id', (ctx) => controller.update(ctx));

  // 删除 Provider
  router.delete('/:id', (ctx) => controller.delete(ctx));

  return router;
};
