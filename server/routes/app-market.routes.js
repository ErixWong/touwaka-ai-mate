import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';

/**
 * App Market 路由
 * 管理员接口：浏览、安装、卸载 App
 */
export default (controller) => {
  const router = new Router();

  // ==================== Registry 接口 ====================

  // 获取 Registry 配置
  router.get('/api/app-market/settings', authenticate(), requireAdmin(), (ctx) => 
    controller.getSettings(ctx)
  );

  // 更新 Registry 配置
  router.put('/api/app-market/settings', authenticate(), requireAdmin(), (ctx) => 
    controller.updateSettings(ctx)
  );

  // 获取 Registry 索引（可用 App 列表）
  router.get('/api/app-market/index', authenticate(), requireAdmin(), (ctx) => 
    controller.getIndex(ctx)
  );

  // 获取 App manifest（从 Registry 拉取）
  router.get('/api/app-market/apps/:appId', authenticate(), requireAdmin(), (ctx) => 
    controller.getManifest(ctx)
  );

  // ==================== App 安装/卸载 ====================

  // 检查依赖
  router.post('/api/app-market/check-dependencies', authenticate(), requireAdmin(), (ctx) => 
    controller.checkDependencies(ctx)
  );

  // 安装 App
  router.post('/api/app-market/install', authenticate(), requireAdmin(), (ctx) => 
    controller.installApp(ctx)
  );

  // 卸载 App
  router.delete('/api/app-market/apps/:appId', authenticate(), requireAdmin(), (ctx) => 
    controller.uninstallApp(ctx)
  );

  // 检查更新
  router.get('/api/app-market/apps/:appId/check-update', authenticate(), requireAdmin(), (ctx) => 
    controller.checkUpdate(ctx)
  );

  // 更新 App
  router.put('/api/app-market/apps/:appId/update', authenticate(), requireAdmin(), (ctx) => 
    controller.updateApp(ctx)
  );

  // ==================== 自定义组件 ====================

  // 获取 App 自定义组件代码
  router.get('/api/app-market/component/:appId', authenticate(), (ctx) => 
    controller.getComponent(ctx)
  );

  return router;
};
