/**
 * Package 路由
 * 包管理和白名单配置（仅管理员）
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';
import PackageController from '../controllers/package.controller.js';

export default (db) => {
  const router = new Router({ prefix: '/api/system/packages' });
  const controller = new PackageController(db);

  // 获取已安装的包列表（需要管理员权限）
  router.get('/', authenticate(), (ctx) => controller.getPackages(ctx));

  // 获取包白名单配置（需要管理员权限）
  router.get('/whitelist', authenticate(), (ctx) => controller.getWhitelist(ctx));

  // 更新包白名单配置（需要管理员权限）
  router.patch('/whitelist', authenticate(), (ctx) => controller.updateWhitelist(ctx));

  // 重置白名单为默认值（需要管理员权限）
  router.post('/whitelist/reset', authenticate(), (ctx) => controller.resetWhitelist(ctx));

  // 安装包（需要管理员权限）
  router.post('/install', authenticate(), (ctx) => controller.installPackage(ctx));

  return router;
};