/**
 * standard-mgr 配置 handler
 *
 * GET /api/apps/standard-mgr/config — 读取应用配置（登录即可）
 * PUT /api/apps/standard-mgr/config — 保存应用配置（需管理员）
 *
 * 遵循平台统一响应契约 ctx.success() / ctx.error()。
 */

import StandardMgrConfigService from '../services/config.service.js';

export const route = {
  path: '/config',
  methods: ['GET', 'PUT'],
};

function getUserId(ctx) {
  return ctx.state.session?.id || ctx.state.user?.id || null;
}

function isAdmin(ctx) {
  return Boolean(ctx.state.session?.isAdmin);
}

function requireAdmin(ctx) {
  if (!isAdmin(ctx)) {
    ctx.error('需要管理员权限', 403);
    return false;
  }
  return true;
}

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    if (!userId) {
      ctx.error('Unauthorized', 401);
      return;
    }

    const configService = new StandardMgrConfigService(deps.db);
    const config = await configService.getConfig();
    ctx.success(config);
  } catch (err) {
    ctx.error(err.message, 500);
  }
}

export async function put(ctx, deps) {
  if (!requireAdmin(ctx)) return;
  try {
    const configService = new StandardMgrConfigService(deps.db);
    const config = await configService.saveConfig(ctx.request.body || {});
    ctx.success(config);
  } catch (err) {
    ctx.error(err.message, 400);
  }
}
