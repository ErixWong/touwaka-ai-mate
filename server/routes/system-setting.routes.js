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

  router.get('/', authenticate(), (ctx) => controller.getAll(ctx));
  router.put('/', authenticate(), (ctx) => controller.update(ctx));
  router.post('/reset', authenticate(), (ctx) => controller.reset(ctx));

  return router;
};

export function createBrandingRoutes(db) {
  const router = new Router({ prefix: '/api/branding' });
  const controller = new SystemSettingController(db);

  router.get('/', async (ctx) => {
    try {
      const records = await controller.SystemSetting.findAll({ raw: true });
      const result = controller._parseSettings(records);
      ctx.success({
        app_name: result.branding?.app_name || 'Touwaka Mate',
        logo_icon: result.branding?.logo_icon || '🤖',
      });
    } catch (error) {
      ctx.success({
        app_name: 'Touwaka Mate',
        logo_icon: '🤖',
      });
    }
  });

  return router;
}
