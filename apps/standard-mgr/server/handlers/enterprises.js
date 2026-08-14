/**
 * enterprises handler
 *
 * GET  /api/apps/standard-mgr/enterprises — 企业花名册列表（含各企业标准计数）
 * POST /api/apps/standard-mgr/enterprises — 新建企业（admin，name 唯一）
 *
 * 路由扁平化：按 ctx.params.enterpriseId 有无分流 GET 详情 / PUT 更新 / DELETE 停用 / GET 列表
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
        ctx.error('Enterprise not found', 404);
        return;
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

    const { name, name_en, description, code_prefixes } = body || {};

    if (!name || !name.trim()) {
      ctx.error('name is required', 400);
      return;
    }

    const result = await service.createEnterprise({
      name: name.trim(),
      name_en: name_en || null,
      description: description || null,
      code_prefixes: code_prefixes || null,
      user_id: userId,
    });

    ctx.success(result);
  } catch (err) {
    logger.error(`[standard-mgr] createEnterprise error: ${err.message}`);
    const status = err.status || (err.message?.includes('already exists') ? 409 : 500);
    ctx.error(err.message, status);
  }
}

/** PUT /enterprises/:enterpriseId — 更新企业（改名/前缀/停用） */
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

/** DELETE /enterprises/:enterpriseId — 停用企业（软删除，is_active=0） */
export async function del(ctx, deps) {
  try {
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return;
    }

    const service = new StandardMgrService(deps.db);
    const { enterpriseId } = ctx.params;

    if (!enterpriseId) {
      ctx.error('enterpriseId is required', 400);
      return;
    }

    const result = await service.updateEnterprise(enterpriseId, { is_active: false });
    if (!result) {
      ctx.error('Enterprise not found', 404);
      return;
    }

    ctx.success({ id: result.id, name: result.name, is_active: result.is_active });
  } catch (err) {
    logger.error(`[standard-mgr] deleteEnterprise error: ${err.message}`);
    ctx.error(err.message, err.status || 500);
  }
}

// delete 是 JS 保留字，路由装载器按 method.toLowerCase() 查找导出
export { del as delete };
