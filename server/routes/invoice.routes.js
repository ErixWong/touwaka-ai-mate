import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router();

  router.get('/api/invoice/list', authenticate(), (ctx) => controller.list(ctx));
  router.get('/api/invoice/:rowId', authenticate(), (ctx) => controller.detail(ctx));

  return router;
};
