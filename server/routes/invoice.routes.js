import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router();

  // List / Detail / Export (已存在)
  router.get('/api/invoice/list', authenticate(), (ctx) => controller.list(ctx));
  router.get('/api/invoice/export', authenticate(), (ctx) => controller.exportExcel(ctx));
  router.get('/api/invoice/:rowId', authenticate(), (ctx) => controller.detail(ctx));

  // Records API (自治 app 专属) - 直接复用 miniAppService 自治能力
  router.post('/api/invoice', authenticate(), (ctx) => controller.create(ctx));
  router.delete('/api/invoice/:rowId', authenticate(), (ctx) => controller.remove(ctx));
  router.post('/api/invoice/:rowId/re-extract', authenticate(), requireAdmin(), (ctx) => controller.reExtract(ctx));

  return router;
};
