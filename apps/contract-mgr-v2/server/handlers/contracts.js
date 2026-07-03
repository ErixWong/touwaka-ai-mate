import ContractV2Service from '../../../../server/services/contract-v2.service.js';
import logger from '../../../../lib/logger.js';

// Handler 元数据：声明具名参数路径
export const route = {
  path: '/contracts/:contractId',
};

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

function isAdmin(ctx) {
  const session = ctx.state.session || {};
  return session.isAdmin || false;
}

export async function get(ctx, deps) {
  try {
    const service = new ContractV2Service(deps.db);
    const userId = getUserId(ctx);
    // 命名参数 contractId 现在会自动注入（来自 route.path 声明）
    // 保留向后兼容：优先使用具名参数
    const contractId = ctx.params.contractId || ctx.params.p0;

    if (contractId) {
      const contract = await service.getContract(contractId, userId);
      return ctx.success(contract);
    }

    const contracts = await service.listContracts(ctx.query, userId);
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
    const userId = getUserId(ctx);
    // 命名参数 contractId 现在会自动注入（来自 route.path 声明）
    const contractId = ctx.params.contractId || ctx.params.p0;
    const contract = await service.updateContract(contractId, ctx.request.body, userId);
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
    const userId = getUserId(ctx);
    // 命名参数 contractId 现在会自动注入（来自 route.path 声明）
    const contractId = ctx.params.contractId || ctx.params.p0;
    await service.deleteContract(contractId, userId);
    ctx.success(null, '删除成功');
  } catch (err) {
    logger.error(`[contract-mgr-v2] deleteContract error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}

export { del as delete };