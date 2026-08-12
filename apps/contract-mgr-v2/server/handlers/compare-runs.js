import ContractV2Service from '../services/contract-v2.service.js';
import logger from '../../../../lib/logger.js';

export const route = {
  path: '/compare-runs/:runId',
};

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const runId = ctx.params.runId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    const result = await service.getCompareRunResult(runId, userId);
    ctx.success(result);
  } catch (err) {
    logger.error(`[contract-mgr-v2] getCompareRunResult error: ${err.message}`);
    ctx.error(err.message, 403);
  }
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
