import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';
import logger from '../../lib/logger.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/current-feature-analyzer' });

  router.post('/uploads', authenticate(), (ctx) => controller.upload(ctx));
  router.get('/batches/:batch_id', authenticate(), (ctx) => controller.getBatch(ctx));
  router.get('/batches/:batch_id/files/:file_id', authenticate(), (ctx) => controller.getFileDetail(ctx));

  router.post('/analysis/run', authenticate(), (ctx) => controller.runAnalysis(ctx));
  router.get('/reports/:batch_id', authenticate(), (ctx) => controller.getReport(ctx));
  router.post('/reports/:batch_id/export', authenticate(), (ctx) => controller.exportReport(ctx));

  router.get('/rule-sets', authenticate(), (ctx) => controller.listRuleSets(ctx));
  router.get('/rule-sets/:id', authenticate(), (ctx) => controller.getRuleSet(ctx));
  router.post('/rule-sets', authenticate(), requireAdmin(), (ctx) => controller.createRuleSet(ctx));
  router.put('/rule-sets/:id', authenticate(), requireAdmin(), (ctx) => controller.updateRuleSet(ctx));
  router.delete('/rule-sets/:id', authenticate(), requireAdmin(), (ctx) => controller.deleteRuleSet(ctx));
  router.post('/rule-sets/:id/copy', authenticate(), requireAdmin(), (ctx) => controller.copyRuleSet(ctx));

  router.get('/config', authenticate(), (ctx) => controller.getConfig(ctx));
  router.put('/config', authenticate(), requireAdmin(), (ctx) => controller.saveConfig(ctx));

  const legacyRouter = new Router({ prefix: '/api/apps/current-feature-analyzer' });

  legacyRouter.use(async (ctx, next) => {
    logger.warn(`[DEPRECATED] Legacy route accessed: ${ctx.path}. Use /api/current-feature-analyzer/* instead.`);
    ctx.set('X-Deprecated', 'true');
    ctx.set('X-Deprecated-Message', 'Use /api/current-feature-analyzer/* instead of /api/apps/current-feature-analyzer/*');
    await next();
  });

  legacyRouter.post('/uploads', authenticate(), (ctx) => controller.upload(ctx));
  legacyRouter.get('/batches/:batch_id', authenticate(), (ctx) => controller.getBatch(ctx));
  legacyRouter.get('/batches/:batch_id/files/:file_id', authenticate(), (ctx) => controller.getFileDetail(ctx));

  legacyRouter.post('/analysis/run', authenticate(), (ctx) => controller.runAnalysis(ctx));
  legacyRouter.get('/reports/:batch_id', authenticate(), (ctx) => controller.getReport(ctx));
  legacyRouter.post('/reports/:batch_id/export', authenticate(), (ctx) => controller.exportReport(ctx));

  legacyRouter.get('/rule-sets', authenticate(), (ctx) => controller.listRuleSets(ctx));
  legacyRouter.get('/rule-sets/:id', authenticate(), (ctx) => controller.getRuleSet(ctx));
  legacyRouter.post('/rule-sets', authenticate(), requireAdmin(), (ctx) => controller.createRuleSet(ctx));
  legacyRouter.put('/rule-sets/:id', authenticate(), requireAdmin(), (ctx) => controller.updateRuleSet(ctx));
  legacyRouter.delete('/rule-sets/:id', authenticate(), requireAdmin(), (ctx) => controller.deleteRuleSet(ctx));
  legacyRouter.post('/rule-sets/:id/copy', authenticate(), requireAdmin(), (ctx) => controller.copyRuleSet(ctx));

  legacyRouter.get('/config', authenticate(), (ctx) => controller.getConfig(ctx));
  legacyRouter.put('/config', authenticate(), requireAdmin(), (ctx) => controller.saveConfig(ctx));

  const combinedRouter = new Router();
  combinedRouter.use(router.routes(), router.allowedMethods());
  combinedRouter.use(legacyRouter.routes(), legacyRouter.allowedMethods());

  return combinedRouter;
};