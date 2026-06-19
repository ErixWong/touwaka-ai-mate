import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router();

  router.get('/api/app-backup', authenticate(), requireAdmin(), (ctx) =>
    controller.listBackupApps(ctx)
  );

  router.get('/api/app-backup/:appId', authenticate(), requireAdmin(), (ctx) =>
    controller.getBackupInfo(ctx)
  );

  router.post('/api/app-backup/:appId/export', authenticate(), requireAdmin(), (ctx) =>
    controller.exportBackup(ctx)
  );

  router.post('/api/app-backup/:appId/import', authenticate(), requireAdmin(), (ctx) =>
    controller.importBackup(ctx)
  );

  return router;
};