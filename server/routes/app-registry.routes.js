import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';
import logger from '../../lib/logger.js';

export default (controller) => {
  const router = new Router();

  router.get('/api/app-registry', authenticate(), (ctx) => controller.listApps(ctx));
  
  router.get('/api/app-registry/installed', authenticate(), requireAdmin(), (ctx) => 
    controller.listInstalledApps(ctx)
  );

  router.get('/api/app-registry/clock-registry', authenticate(), requireAdmin(), (ctx) => 
    controller.listClockRegistry(ctx)
  );

  router.post('/api/app-registry', authenticate(), requireAdmin(), (ctx) => controller.createApp(ctx));

  router.get('/api/app-registry/:appId', authenticate(), (ctx) => controller.getApp(ctx));
  
  router.get('/api/app-registry/:appId/runtime', authenticate(), requireAdmin(), (ctx) => 
    controller.getAppWithRuntime(ctx)
  );
  
  router.put('/api/app-registry/:appId', authenticate(), requireAdmin(), (ctx) => 
    controller.updateApp(ctx)
  );
  
  router.delete('/api/app-registry/:appId', authenticate(), requireAdmin(), (ctx) => 
    controller.deleteApp(ctx)
  );

  router.get('/api/app-registry/:appId/config', authenticate(), requireAdmin(), (ctx) => 
    controller.getAppConfig(ctx)
  );
  
  router.put('/api/app-registry/:appId/config', authenticate(), requireAdmin(), (ctx) => 
    controller.updateAppConfig(ctx)
  );

  router.get('/api/app-registry/:appId/manifest', authenticate(), requireAdmin(), (ctx) => 
    controller.getAppManifest(ctx)
  );
  
  router.get('/api/app-registry/:appId/validate-runtime', authenticate(), requireAdmin(), (ctx) => 
    controller.validateAppRuntime(ctx)
  );
  
  router.get('/api/app-registry/:appId/clock-registry', authenticate(), requireAdmin(), (ctx) => 
    controller.getClockRegistry(ctx)
  );
  
  router.put('/api/app-registry/:appId/clock-registry', authenticate(), requireAdmin(), (ctx) => 
    controller.updateClockRegistry(ctx)
  );

  const legacyRouter = new Router();

  legacyRouter.use(async (ctx, next) => {
    if (ctx.path === '/api/apps' || ctx.path.startsWith('/api/apps/')) {
      logger.warn(`[DEPRECATED] Legacy route accessed: ${ctx.path}. Use /api/app-registry/* instead.`);
      ctx.set('X-Deprecated', 'true');
      ctx.set('X-Deprecated-Message', 'Use /api/app-registry/* instead of /api/apps/* for registry APIs');
    }
    await next();
  });

  legacyRouter.get('/api/apps', authenticate(), (ctx) => controller.listApps(ctx));
  
  legacyRouter.get('/api/apps/installed', authenticate(), requireAdmin(), (ctx) => 
    controller.listInstalledApps(ctx)
  );

  legacyRouter.get('/api/apps/clock-registry', authenticate(), requireAdmin(), (ctx) => 
    controller.listClockRegistry(ctx)
  );

  legacyRouter.post('/api/apps', authenticate(), requireAdmin(), (ctx) => controller.createApp(ctx));

  legacyRouter.get('/api/apps/:appId', authenticate(), (ctx) => controller.getApp(ctx));
  
  legacyRouter.get('/api/apps/:appId/runtime', authenticate(), requireAdmin(), (ctx) => 
    controller.getAppWithRuntime(ctx)
  );
  
  legacyRouter.put('/api/apps/:appId', authenticate(), requireAdmin(), (ctx) => 
    controller.updateApp(ctx)
  );
  
  legacyRouter.delete('/api/apps/:appId', authenticate(), requireAdmin(), (ctx) => 
    controller.deleteApp(ctx)
  );

  legacyRouter.get('/api/apps/:appId/config', authenticate(), requireAdmin(), (ctx) => 
    controller.getAppConfig(ctx)
  );
  
  legacyRouter.put('/api/apps/:appId/config', authenticate(), requireAdmin(), (ctx) => 
    controller.updateAppConfig(ctx)
  );

  legacyRouter.get('/api/apps/:appId/manifest', authenticate(), requireAdmin(), (ctx) => 
    controller.getAppManifest(ctx)
  );
  
  legacyRouter.get('/api/apps/:appId/validate-runtime', authenticate(), requireAdmin(), (ctx) => 
    controller.validateAppRuntime(ctx)
  );
  
  legacyRouter.get('/api/apps/:appId/clock-registry', authenticate(), requireAdmin(), (ctx) => 
    controller.getClockRegistry(ctx)
  );
  
  legacyRouter.put('/api/apps/:appId/clock-registry', authenticate(), requireAdmin(), (ctx) => 
    controller.updateClockRegistry(ctx)
  );

  const combinedRouter = new Router();
  combinedRouter.use(router.routes(), router.allowedMethods());
  combinedRouter.use(legacyRouter.routes(), legacyRouter.allowedMethods());

  return combinedRouter;
};