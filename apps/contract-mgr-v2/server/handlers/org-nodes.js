import ContractV2Service from '../services/contract-v2.service.js';
import logger from '../../../../lib/logger.js';

function isAdmin(ctx) {
  const session = ctx.state.session || {};
  return session.isAdmin || false;
}

export async function get(ctx, deps) {
  try {
    const service = new ContractV2Service(deps.db);
    const tree = await service.getTree();
    ctx.success(tree);
  } catch (err) {
    logger.error(`[contract-mgr-v2] getTree error: ${err.message}`);
    ctx.error(err.message, 500);
  }
}

export async function post(ctx, deps) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.error('Admin required', 403);
    }

    const service = new ContractV2Service(deps.db);
    const data = ctx.request.body;
    if (!data.name || !data.node_type) {
      return ctx.error('name 和 node_type 必填', 400);
    }
    const node = await service.createNode(data);
    ctx.success(node);
  } catch (err) {
    logger.error(`[contract-mgr-v2] createNode error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}