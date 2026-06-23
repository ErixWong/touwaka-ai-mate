import ContractV2Service from '../../../../server/services/contract-v2.service.js';
import logger from '../../../../lib/logger.js';

export async function get(ctx, deps) {
  try {
    const service = new ContractV2Service(deps.db);
    const dashboard = await service.getDashboard();
    ctx.success(dashboard);
  } catch (err) {
    logger.error(`[contract-mgr-v2] getDashboard error: ${err.message}`);
    ctx.error(err.message, 500);
  }
}