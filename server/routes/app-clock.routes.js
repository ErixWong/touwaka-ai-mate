import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (db) => {
  const router = new Router({ prefix: '/api/app-clock' });

  function checkAdmin(ctx) {
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return false;
    }
    return true;
  }

  function getAppClockOrReject(ctx) {
    const { appClock } = ctx;
    if (!appClock?.running) {
      ctx.error('AppClock not started', 503);
      return null;
    }
    return appClock;
  }

  router.get('/status', authenticate(), async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const appClock = getAppClockOrReject(ctx);
    if (!appClock) return;
    ctx.success(await appClock.getRunStatus());
  });

  router.get('/status/history', authenticate(), async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const appClock = getAppClockOrReject(ctx);
    if (!appClock) return;
    const appId = ctx.query.app_id || null;
    const limit = Math.min(parseInt(ctx.query.limit) || 10, 50);
    ctx.success(await appClock.getRunHistory(appId, limit));
  });

  router.get('/status/:appId', authenticate(), async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const appClock = getAppClockOrReject(ctx);
    if (!appClock) return;
    const status = await appClock.getRunStatusForApp(ctx.params.appId);
    if (!status) {
      ctx.error('App not found in run status', 404);
      return;
    }
    ctx.success(status);
  });

  router.post('/force-tick/:appId', authenticate(), async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const appClock = getAppClockOrReject(ctx);
    if (!appClock) return;
    try {
      await appClock.forceTick(ctx.params.appId);
      ctx.success({ message: 'Tick triggered successfully' });
    } catch (err) {
      ctx.error(err.message, 500);
    }
  });

  return router;
};
