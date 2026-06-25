import Router from '@koa/router';
import multer from '@koa/multer';
import CurrentFeatureAnalyzerController from './controller.js';
import { authenticate, requireAdmin } from '../../../server/middlewares/auth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

export default function createRoutes(context) {
  const db = context.db;
  const controller = new CurrentFeatureAnalyzerController(db);
  const router = new Router({ prefix: '/api/apps/current-feature-analyzer' });

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

  return router;
}
