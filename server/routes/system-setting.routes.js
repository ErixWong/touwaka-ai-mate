/**
 * SystemSetting 路由
 * 系统配置管理（仅管理员）
 */

import Router from '@koa/router';
import SystemSettingController from '../controllers/system-setting.controller.js';

export default (db) => {
  const router = new Router({ prefix: '/api/system-settings' });
  const controller = new SystemSettingController(db);

  // 获取所有系统配置
  router.get('/', (ctx) => controller.getAll(ctx));

  // 更新系统配置
  router.put('/', (ctx) => controller.update(ctx));

  // 重置配置为默认值
  router.post('/reset', (ctx) => controller.reset(ctx));

  return router;
};
