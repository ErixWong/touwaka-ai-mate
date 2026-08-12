/**
 * 合同管理 - 状态汇总
 * GET /api/apps/contract-mgr/status-summary → 合同状态汇总统计
 *
 * URL 映射：/apps/contract-mgr/status-summary → 本文件
 */
import ContractService from '../services/contract.service.js';
import logger from '../../../../lib/logger.js';

function getSession(ctx) {
  return ctx.state.session || {};
}

function isAdmin(ctx) {
  const session = getSession(ctx);
  return session.isAdmin || false;
}

export async function get(ctx, deps) {
  try {
    const contractService = new ContractService(deps.db);
    const session = getSession(ctx);
    const userId = session.id;
    const admin = isAdmin(ctx);

    const result = await contractService.statusSummary({ userId, isAdmin: admin });
    ctx.success(result);
  } catch (err) {
    logger.error(`[contract-mgr] statusSummary error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}
