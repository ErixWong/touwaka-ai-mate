import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';

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

  return router;
};