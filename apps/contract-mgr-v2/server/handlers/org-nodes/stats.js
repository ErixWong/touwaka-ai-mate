import ContractV2Service from '../../../../../server/services/contract-v2.service.js';
import logger from '../../../../../lib/logger.js';

export const route = {
  path: '/org-nodes/:nodeId/stats',
};

export async function get(ctx, deps) {
  try {
    const nodeId = ctx.params.nodeId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    const stats = await service.getNodeStats(nodeId);
    ctx.success(stats);
  } catch (err) {
    logger.error(`[contract-mgr-v2] getNodeStats error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}
