import ContractV2Service from '../../../../../server/services/contract-v2.service.js';
import logger from '../../../../../lib/logger.js';

export const route = {
  path: '/versions/:versionId/extract-metadata',
};

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export async function post(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const versionId = ctx.params.versionId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    const result = await service.extractMetadata(versionId, userId);
    ctx.success(result);
  } catch (err) {
    logger.error(`[contract-mgr-v2] extractMetadata error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}
