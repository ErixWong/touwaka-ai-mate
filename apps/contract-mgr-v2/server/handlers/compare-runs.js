import ContractV2Service from '../../../../server/services/contract-v2.service.js';
import logger from '../../../../lib/logger.js';

export const route = {
  path: '/compare-runs',
};

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export async function post(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const { version_id_a, version_id_b } = ctx.request.body || {};
    const service = new ContractV2Service(deps.db);
    const result = await service.createCompareRun(version_id_a, version_id_b, userId);
    ctx.success(result);
  } catch (err) {
    logger.error(`[contract-mgr-v2] createCompareRun error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}
