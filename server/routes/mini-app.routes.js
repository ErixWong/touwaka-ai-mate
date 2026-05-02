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

  // ==================== Record CRUD ====================

  router.get('/api/mini-apps/:appId/data', authenticate(), (ctx) => controller.listRecords(ctx));
  router.get('/api/mini-apps/:appId/data/:recordId', authenticate(), (ctx) => controller.getRecord(ctx));
  router.post('/api/mini-apps/:appId/data', authenticate(), (ctx) => controller.createRecord(ctx));
  router.put('/api/mini-apps/:appId/data/:recordId', authenticate(), (ctx) => controller.updateRecord(ctx));
  router.delete('/api/mini-apps/:appId/data/:recordId', authenticate(), (ctx) => controller.deleteRecord(ctx));

  // ==================== Batch & Status ====================

  router.post('/api/mini-apps/:appId/data/batch', authenticate(), (ctx) => controller.batchUpload(ctx));
  router.put('/api/mini-apps/:appId/data/:recordId/confirm', authenticate(), (ctx) => controller.confirmRecord(ctx));
  router.post('/api/mini-apps/:appId/data/:recordId/re-extract', authenticate(), requireAdmin(), (ctx) => controller.reExtractRecord(ctx));
  router.get('/api/mini-apps/:appId/status-summary', authenticate(), (ctx) => controller.getStatusSummary(ctx));

  // ==================== State CRUD ====================

  router.get('/api/mini-apps/:appId/states', authenticate(), (ctx) => controller.listStates(ctx));
  router.post('/api/mini-apps/:appId/states', authenticate(), requireAdmin(), (ctx) => controller.createState(ctx));
  router.put('/api/mini-apps/:appId/states/:stateId', authenticate(), requireAdmin(), (ctx) => controller.updateState(ctx));
  router.delete('/api/mini-apps/:appId/states/:stateId', authenticate(), requireAdmin(), (ctx) => controller.deleteState(ctx));

  // ==================== Handler CRUD ====================

  router.get('/api/handlers', authenticate(), requireAdmin(), (ctx) => controller.listHandlers(ctx));
  router.get('/api/handlers/:handlerId', authenticate(), requireAdmin(), (ctx) => controller.getHandler(ctx));
  router.post('/api/handlers', authenticate(), requireAdmin(), (ctx) => controller.createHandler(ctx));
  router.put('/api/handlers/:handlerId', authenticate(), requireAdmin(), (ctx) => controller.updateHandler(ctx));
  router.delete('/api/handlers/:handlerId', authenticate(), requireAdmin(), (ctx) => controller.deleteHandler(ctx));
  router.get('/api/handlers/:handlerId/logs', authenticate(), requireAdmin(), (ctx) => controller.getHandlerLogs(ctx));
  router.post('/api/handlers/:handlerId/test', authenticate(), requireAdmin(), (ctx) => controller.testHandler(ctx));

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
