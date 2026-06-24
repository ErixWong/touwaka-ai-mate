import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';
import logger from '../../lib/logger.js';

export default (controller) => {
  const registerRoutes = (routerInstance) => {
    routerInstance.post('/uploads', authenticate(), (ctx) => controller.upload(ctx));
    routerInstance.get('/batches/:batch_id', authenticate(), (ctx) => controller.getBatch(ctx));
    routerInstance.get('/batches/:batch_id/files/:file_id', authenticate(), (ctx) => controller.getFileDetail(ctx));

    routerInstance.post('/analysis/run', authenticate(), (ctx) => controller.runAnalysis(ctx));
    routerInstance.get('/reports/:batch_id', authenticate(), (ctx) => controller.getReport(ctx));
    routerInstance.post('/reports/:batch_id/export', authenticate(), (ctx) => controller.exportReport(ctx));

    routerInstance.get('/rule-sets', authenticate(), (ctx) => controller.listRuleSets(ctx));
    routerInstance.get('/rule-sets/:id', authenticate(), (ctx) => controller.getRuleSet(ctx));
    routerInstance.post('/rule-sets', authenticate(), requireAdmin(), (ctx) => controller.createRuleSet(ctx));
    routerInstance.put('/rule-sets/:id', authenticate(), requireAdmin(), (ctx) => controller.updateRuleSet(ctx));
    routerInstance.delete('/rule-sets/:id', authenticate(), requireAdmin(), (ctx) => controller.deleteRuleSet(ctx));
    routerInstance.post('/rule-sets/:id/copy', authenticate(), requireAdmin(), (ctx) => controller.copyRuleSet(ctx));

    routerInstance.get('/config', authenticate(), (ctx) => controller.getConfig(ctx));
    routerInstance.put('/config', authenticate(), requireAdmin(), (ctx) => controller.saveConfig(ctx));
  };

  const router = new Router({ prefix: '/api/current-feature-analyzer' });
  registerRoutes(router);

  const legacyRouter = new Router({ prefix: '/api/apps/current-feature-analyzer' });

  legacyRouter.use(async (ctx, next) => {
    logger.warn(`[DEPRECATED] Legacy route accessed: ${ctx.path}. Use /api/current-feature-analyzer/* instead.`);
    ctx.set('X-Deprecated', 'true');
    ctx.set('X-Deprecated-Message', 'Use /api/current-feature-analyzer/* instead of /api/apps/current-feature-analyzer/*');
    await next();
  });
  registerRoutes(legacyRouter);

  const combinedRouter = new Router();
  combinedRouter.use(router.routes(), router.allowedMethods());
  combinedRouter.use(legacyRouter.routes(), legacyRouter.allowedMethods());

  return combinedRouter;
};