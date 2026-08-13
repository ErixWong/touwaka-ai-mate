import ContractV2Service from '../services/contract-v2.service.js';
import logger from '../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const service = new ContractV2Service(deps.db);
    const dashboard = await service.getDashboard(userId);
    ctx.success(dashboard);
  } catch (err) {
    logger.error(`[contract-mgr-v2] getDashboard error: ${err.message}`);
    ctx.error(err.message, 500);
  }
}