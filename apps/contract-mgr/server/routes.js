import Router from '@koa/router';
import ContractService from '../../../server/services/contract.service.js';
import { authenticate, requireAdmin } from '../../../server/middlewares/auth.js';

export default function createRoutes(context) {
  const router = new Router();
  const contractService = new ContractService(context.db);

  router.get('/records', authenticate(), async (ctx) => {
    try {
      const session = ctx.state.session;
      const userId = session?.id;
      const isAdmin = session?.isAdmin || false;
      const { page, size, status, search, sort, order } = ctx.query;
      const result = await contractService.list({
        page: parseInt(page) || 1,
        size: parseInt(size) || 20,
        status, search, sort, order,
        userId, isAdmin,
      });
      ctx.success(result);
    } catch (err) {
      ctx.error(err.message, 400);
    }
  });

  router.get('/status-summary', authenticate(), async (ctx) => {
    try {
      const session = ctx.state.session;
      const userId = session?.id;
      const isAdmin = session?.isAdmin || false;
      const result = await contractService.statusSummary({ userId, isAdmin });
      ctx.success(result);
    } catch (err) {
      ctx.error(err.message, 400);
    }
  });

  router.get('/records/:recordId', authenticate(), async (ctx) => {
    try {
      const session = ctx.state.session;
      const userId = session?.id;
      const isAdmin = session?.isAdmin || false;
      const record = await contractService.detail(ctx.params.recordId, { userId, isAdmin });
      if (!record) return ctx.error('Record not found', 404);
      ctx.success(record);
    } catch (err) {
      ctx.error(err.message, 400);
    }
  });

  router.post('/records/:recordId/confirm', requireAdmin(), async (ctx) => {
    try {
      await contractService.confirm(ctx.params.recordId);
      ctx.success(null, 'Confirmed');
    } catch (err) {
      ctx.error(err.message, 400);
    }
  });

  router.post('/records/:recordId/retry', requireAdmin(), async (ctx) => {
    try {
      const result = await contractService.retry(ctx.params.recordId);
      ctx.success(result);
    } catch (err) {
      ctx.error(err.message, 400);
    }
  });

  return router;
}
