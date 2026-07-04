import ContractV2Service from '../../../../server/services/contract-v2.service.js';
import logger from '../../../../lib/logger.js';

export const route = {
  path: '/versions/:versionId',
};

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export async function put(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const versionId = ctx.params.versionId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    const version = await service.updateVersion(versionId, ctx.request.body, userId);
    ctx.success(version);
  } catch (err) {
    logger.error(`[contract-mgr-v2] updateVersion error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

async function del(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const versionId = ctx.params.versionId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    await service.deleteVersion(versionId, userId);
    ctx.success(null, '删除成功');
  } catch (err) {
    logger.error(`[contract-mgr-v2] deleteVersion error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

export { del as delete };
