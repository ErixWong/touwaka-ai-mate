import Router from '@koa/router';
import multer from '@koa/multer';
import CurrentFeatureAnalyzerController from './controller.js';
import { authenticate, requireAdmin } from '../../../server/middlewares/auth.js';
import logger from '../../../lib/logger.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

/**
 * 注册单套路由到指定 router
 * 新旧前缀共享同一套 handler，不复制 controller 逻辑
 */
function registerRoutes(router, controller) {
  router.post('/uploads', authenticate(), upload.fields([{ name: 'files', maxCount: 50 }]), (ctx) => controller.upload(ctx));
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
}

export default function createRoutes(context) {
  const db = context.db;
  const controller = new CurrentFeatureAnalyzerController(db);

  // 主入口：新前缀 /api/current-feature-analyzer/*
  const router = new Router({ prefix: '/api/current-feature-analyzer' });
  registerRoutes(router, controller);

  // Legacy 兼容层：/api/apps/current-feature-analyzer/*
  // 保留一轮兼容，带 deprecated header
  const legacyRouter = new Router({ prefix: '/api/apps/current-feature-analyzer' });
  legacyRouter.use(async (ctx, next) => {
    logger.warn(`[DEPRECATED] Legacy route accessed: ${ctx.path}. Use /api/current-feature-analyzer/* instead.`);
    ctx.set('X-Deprecated', 'true');
    ctx.set('X-Deprecated-Message', 'Use /api/current-feature-analyzer/* instead of /api/apps/current-feature-analyzer/*');
    await next();
  });
  registerRoutes(legacyRouter, controller);

  // 合并两套路由
  const combinedRouter = new Router();
  combinedRouter.use(router.routes(), router.allowedMethods());
  combinedRouter.use(legacyRouter.routes(), legacyRouter.allowedMethods());

  return combinedRouter;
}
