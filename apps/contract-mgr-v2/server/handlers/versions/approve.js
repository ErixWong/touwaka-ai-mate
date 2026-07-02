import ContractV2Service from '../../../../../server/services/contract-v2.service.js';
import logger from '../../../../../lib/logger.js';

export const route = {
  path: '/versions/:versionId/approve',
};

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export async function put(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const versionId = ctx.params.versionId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    const version = await service.approveVersion(versionId, userId);
    ctx.success(version);
  } catch (err) {
    logger.error(`[contract-mgr-v2] approveVersion error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}
