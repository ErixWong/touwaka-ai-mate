import ContractV2Service from '../../../../../server/services/contract-v2.service.js';
import logger from '../../../../../lib/logger.js';

export const route = {
  path: '/contracts/:contractId/versions',
};

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const contractId = ctx.params.contractId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    const versions = await service.listVersions(contractId, userId);
    ctx.success(versions);
  } catch (err) {
    logger.error(`[contract-mgr-v2] listVersions error: ${err.message}`);
    ctx.error(err.message, 500);
  }
}

export async function post(ctx, deps) {
  ctx.error('此建版本入口已废弃，请使用 /from-attachment 入口创建版本', 410);
}
