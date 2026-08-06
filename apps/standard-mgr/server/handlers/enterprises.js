/**
 * enterprises handler
 *
 * GET  /api/apps/standard-mgr/enterprises — 企业花名册列表（含各企业标准计数）
 * POST /api/apps/standard-mgr/enterprises — 新建企业（admin，name 唯一）
 *
 * 路由扁平化：按 ctx.params.enterpriseId 有无分流 GET 详情 / PUT 更新 / GET 列表
 */

import StandardMgrService from '../service.js';
import logger from '../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export const route = {
  path: '/enterprises/:enterpriseId',
};

/** GET /enterprises — 列表（含各企业标准计数） */
export async function get(ctx, deps) {
  try {
    const service = new StandardMgrService(deps.db);

    if (ctx.params.enterpriseId) {
      // 获取单个企业
      const enterprise = await service.getEnterprise(ctx.params.enterpriseId);
      if (!enterprise) {
        ctx.throw(404, 'Enterprise not found');
      }
      ctx.success(enterprise);
      return;
    }

    const enterprises = await service.listEnterprises({ include_counts: true });
    ctx.success(enterprises);
  } catch (err) {
    logger.error(`[standard-mgr] enterprises error: ${err.message}`);
    ctx.error(err.message, err.status || 500);
  }
}

/** POST /enterprises — 新建企业 */
export async function post(ctx, deps) {
  try {
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return;
    }

    const userId = getUserId(ctx);
    const service = new StandardMgrService(deps.db);
    const body = ctx.request.body;

    const { name, name_en, description } = body || {};

    if (!name || !name.trim()) {
      ctx.error('name is required', 400);
      return;
    }

    const result = await service.createEnterprise({
      name: name.trim(),
      name_en: name_en || null,
      description: description || null,
      user_id: userId,
    });

    ctx.success(result);
  } catch (err) {
    logger.error(`[standard-mgr] createEnterprise error: ${err.message}`);
    const status = err.status || (err.message?.includes('already exists') ? 409 : 500);
    ctx.error(err.message, status);
  }
}

/** PUT /enterprises/:enterpriseId — 更新企业（改名/停用） */
export async function put(ctx, deps) {
  try {
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return;
    }

    const service = new StandardMgrService(deps.db);
    const { enterpriseId } = ctx.params;
    const body = ctx.request.body;

    if (!enterpriseId) {
      ctx.error('enterpriseId is required', 400);
      return;
    }

    const result = await service.updateEnterprise(enterpriseId, body);
    if (!result) {
      ctx.error('Enterprise not found', 404);
      return;
    }

    ctx.success(result);
  } catch (err) {
    logger.error(`[standard-mgr] updateEnterprise error: ${err.message}`);
    const status = err.status || (err.message?.includes('already exists') ? 409 : 500);
    ctx.error(err.message, status);
  }
}
