import ContractService from '../../../../server/services/contract.service.js';
import logger from '../../../../lib/logger.js';

function getSession(ctx) {
  return ctx.state.session || {};
}

function isAdmin(ctx) {
  const session = getSession(ctx);
  return session.isAdmin || false;
}

function requireAdmin(ctx) {
  if (!isAdmin(ctx)) {
    ctx.error('Admin required', 403);
    return false;
  }
  return true;
}

export async function get(ctx, deps) {
  try {
    const contractService = new ContractService(deps.db);
    const { recordId } = ctx.params;
    const session = getSession(ctx);
    const userId = session.id;
    const admin = isAdmin(ctx);

    if (recordId) {
      const record = await contractService.detail(recordId, { userId, isAdmin: admin });
      if (!record) return ctx.error('Record not found', 404);
      return ctx.success(record);
    }

    if (ctx.path.includes('/status-summary')) {
      const result = await contractService.statusSummary({ userId, isAdmin: admin });
      return ctx.success(result);
    }

    const { page, size, status, search, sort, order } = ctx.query;
    const result = await contractService.list({
      page: parseInt(page) || 1,
      size: parseInt(size) || 20,
      status, search, sort, order,
      userId, isAdmin: admin,
    });
    ctx.success(result);
  } catch (err) {
    logger.error(`[contract-mgr] GET error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

export async function post(ctx, deps) {
  try {
    const contractService = new ContractService(deps.db);
    const { recordId } = ctx.params;

    if (!recordId) {
      return ctx.error('recordId is required', 400);
    }

    if (ctx.path.endsWith('/confirm')) {
      if (!requireAdmin(ctx)) return;
      await contractService.confirm(recordId);
      return ctx.success(null, 'Confirmed');
    }

    if (ctx.path.endsWith('/retry')) {
      if (!requireAdmin(ctx)) return;
      const result = await contractService.retry(recordId);
      return ctx.success(result);
    }

    ctx.error('Not implemented', 501);
  } catch (err) {
    logger.error(`[contract-mgr] POST error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}