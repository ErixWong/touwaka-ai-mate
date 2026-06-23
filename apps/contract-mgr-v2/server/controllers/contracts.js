import ContractV2Service from '../../../../server/services/contract-v2.service.js';
import logger from '../../../../lib/logger.js';

function isAdmin(ctx) {
  const session = ctx.state.session || {};
  return session.isAdmin || false;
}

export async function get(ctx, deps) {
  try {
    const service = new ContractV2Service(deps.db);
    const { contractId } = ctx.params;

    if (contractId) {
      const contract = await service.getContract(contractId);
      return ctx.success(contract);
    }

    const contracts = await service.listContracts(ctx.query);
    ctx.success(contracts);
  } catch (err) {
    logger.error(`[contract-mgr-v2] contracts GET error: ${err.message}`);
    ctx.error(err.message, err.message.includes('not found') ? 404 : 500);
  }
}

export async function post(ctx, deps) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.error('Admin required', 403);
    }

    const service = new ContractV2Service(deps.db);
    const contract = await service.createContract(ctx.request.body);
    ctx.success(contract);
  } catch (err) {
    logger.error(`[contract-mgr-v2] createContract error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

export async function put(ctx, deps) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.error('Admin required', 403);
    }

    const service = new ContractV2Service(deps.db);
    const { contractId } = ctx.params;
    const contract = await service.updateContract(contractId, ctx.request.body);
    ctx.success(contract);
  } catch (err) {
    logger.error(`[contract-mgr-v2] updateContract error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

async function del(ctx, deps) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.error('Admin required', 403);
    }

    const service = new ContractV2Service(deps.db);
    const { contractId } = ctx.params;
    await service.deleteContract(contractId);
    ctx.success(null, '删除成功');
  } catch (err) {
    logger.error(`[contract-mgr-v2] deleteContract error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

export { del as delete };