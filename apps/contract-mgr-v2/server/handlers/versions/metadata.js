import ContractV2Service from '../../../../../server/services/contract-v2.service.js';
import logger from '../../../../../lib/logger.js';

export const route = {
  path: '/versions/:versionId/metadata',
};

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const versionId = ctx.params.versionId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    const result = await service.getVersionMetadata(versionId, userId);
    ctx.success(result);
  } catch (err) {
    logger.error(`[contract-mgr-v2] getVersionMetadata error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

export async function put(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const versionId = ctx.params.versionId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    const result = await service.updateVersionMetadata(versionId, ctx.request.body, userId);
    ctx.success(result);
  } catch (err) {
    logger.error(`[contract-mgr-v2] updateVersionMetadata error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}
