import ContractV2Service from '../../../../../server/services/contract-v2.service.js';
import logger from '../../../../../lib/logger.js';

export const route = {
  path: '/org-nodes/:nodeId',
};

function isAdmin(ctx) {
  const session = ctx.state.session || {};
  return session.isAdmin || false;
}

export async function put(ctx, deps) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.error('Admin required', 403);
    }
    const nodeId = ctx.params.nodeId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    const node = await service.updateNode(nodeId, ctx.request.body);
    ctx.success(node);
  } catch (err) {
    logger.error(`[contract-mgr-v2] updateNode error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

async function del(ctx, deps) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.error('Admin required', 403);
    }
    const nodeId = ctx.params.nodeId || ctx.params.p0;
    const service = new ContractV2Service(deps.db);
    await service.deleteNode(nodeId);
    ctx.success(null, '删除成功');
  } catch (err) {
    logger.error(`[contract-mgr-v2] deleteNode error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

export { del as delete };
