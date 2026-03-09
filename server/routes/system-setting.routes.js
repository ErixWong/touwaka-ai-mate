/**
 * SystemSetting 路由
 * 系统配置管理（仅管理员）
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';
import SystemSettingController from '../controllers/system-setting.controller.js';

export default (db) => {
  const router = new Router({ prefix: '/api/system-settings' });
  const controller = new SystemSettingController(db);

  // 获取所有系统配置（需要认证）
  router.get('/', authenticate(), (ctx) => controller.getAll(ctx));

  // 更新系统配置（需要认证）
  router.put('/', authenticate(), (ctx) => controller.update(ctx));

  // 重置配置为默认值（需要认证）
  router.post('/reset', authenticate(), (ctx) => controller.reset(ctx));

  return router;
};
