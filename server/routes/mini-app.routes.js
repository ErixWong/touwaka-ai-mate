import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router();

  // ==================== App CRUD ====================

  router.get('/api/mini-apps', authenticate(), (ctx) => controller.listApps(ctx));
  router.get('/api/mini-apps/:appId', authenticate(), (ctx) => controller.getApp(ctx));
  router.post('/api/mini-apps', authenticate(), requireAdmin(), (ctx) => controller.createApp(ctx));
  router.put('/api/mini-apps/:appId', authenticate(), requireAdmin(), (ctx) => controller.updateApp(ctx));
  router.delete('/api/mini-apps/:appId', authenticate(), requireAdmin(), (ctx) => controller.deleteApp(ctx));

  // ==================== App Config ====================

  router.get('/api/mini-apps/:appId/config', authenticate(), requireAdmin(), (ctx) => controller.getAppConfig(ctx));
  router.put('/api/mini-apps/:appId/config', authenticate(), requireAdmin(), (ctx) => controller.updateAppConfig(ctx));
  router.get('/api/mini-apps/:appId/available-resources', authenticate(), requireAdmin(), (ctx) => controller.getAvailableResources(ctx));

  // ==================== Record CRUD (COMPATIBILITY - 旧 app 过渡兼容，新 app 使用自己的 API) ====================

  router.get('/api/mini-apps/:appId/data', authenticate(), (ctx) => {
    ctx.set('X-Compatibility', 'legacy mini_app_rows model, new apps should use own API via /api/apps/:appId/*');
    return controller.listRecords(ctx);
  });
  router.get('/api/mini-apps/:appId/data/:recordId', authenticate(), (ctx) => {
    ctx.set('X-Compatibility', 'legacy mini_app_rows model');
    return controller.getRecord(ctx);
  });
  router.post('/api/mini-apps/:appId/data', authenticate(), (ctx) => {
    ctx.set('X-Compatibility', 'legacy mini_app_rows model');
    return controller.createRecord(ctx);
  });
  router.put('/api/mini-apps/:appId/data/:recordId', authenticate(), (ctx) => {
    ctx.set('X-Compatibility', 'legacy mini_app_rows model');
    return controller.updateRecord(ctx);
  });
  router.delete('/api/mini-apps/:appId/data/:recordId', authenticate(), (ctx) => {
    ctx.set('X-Compatibility', 'legacy mini_app_rows model');
    return controller.deleteRecord(ctx);
  });

  // ==================== Batch & Status (COMPATIBILITY - 旧 app 过渡兼容) ====================

  router.post('/api/mini-apps/:appId/data/batch', authenticate(), (ctx) => {
    ctx.set('X-Compatibility', 'legacy batch upload, new apps should use own API');
    return controller.batchUpload(ctx);
  });
  router.put('/api/mini-apps/:appId/data/:recordId/confirm', authenticate(), (ctx) => {
    ctx.set('X-Compatibility', 'legacy confirm record, state managed by app tick');
    return controller.confirmRecord(ctx);
  });
  router.post('/api/mini-apps/:appId/data/:recordId/re-extract', authenticate(), requireAdmin(), (ctx) => {
    ctx.set('X-Compatibility', 'legacy re-extract, state managed by app tick');
    return controller.reExtractRecord(ctx);
  });
  router.get('/api/mini-apps/:appId/status-summary', authenticate(), (ctx) => {
    ctx.set('X-Compatibility', 'legacy status summary, apps manage their own status');
    return controller.getStatusSummary(ctx);
  });

// ==================== Extension Tables ====================

  router.get('/api/mini-apps/:appId/extension/distinct', authenticate(), (ctx) => controller.getDistinctValues(ctx));
  router.get('/api/mini-apps/:appId/extension/distinct/:field', authenticate(), (ctx) => controller.getDistinctField(ctx));

  // ==================== Content (OCR) ====================

  router.get('/api/mini-apps/:appId/content/:rowId', authenticate(), (ctx) => controller.getDocumentContent(ctx));

  // ==================== Compare ====================

  router.post('/api/mini-apps/:appId/compare', authenticate(), requireAdmin(), (ctx) => controller.compareRecords(ctx));
  router.get('/api/mini-apps/:appId/data/:rowId/compare', authenticate(), requireAdmin(), (ctx) => controller.getCompareResult(ctx));

  return router;
};
