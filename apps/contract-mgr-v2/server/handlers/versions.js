import ContractV2Service from '../services/contract-v2.service.js';
import logger from '../../../../lib/logger.js';

export const route = {
  path: '/versions/:versionId',
};

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

function isAdmin(ctx) {
  const session = ctx.state.session || {};
  return session.isAdmin || false;
}

export async function put(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const admin = isAdmin(ctx);
    const versionId = ctx.params.versionId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    const version = await service.updateVersion(versionId, ctx.request.body, userId, admin);
    ctx.success(version);
  } catch (err) {
    logger.error(`[contract-mgr-v2] updateVersion error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

async function del(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const admin = isAdmin(ctx);
    const versionId = ctx.params.versionId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    await service.deleteVersion(versionId, userId, admin);
    ctx.success(null, '删除成功');
  } catch (err) {
    logger.error(`[contract-mgr-v2] deleteVersion error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

export { del as delete };
