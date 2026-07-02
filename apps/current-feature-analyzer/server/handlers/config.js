import { ConfigService } from '../services/index.js';

function getUserId(ctx) {
  return ctx.state.session?.id || ctx.state.user?.id || null;
}

function isAdmin(ctx) {
  return (ctx.state.session?.isAdmin || false);
}

function requireAdmin(ctx) {
  if (!isAdmin(ctx)) {
    ctx.error('Admin required', 403);
    return false;
  }
  return true;
}

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    if (!userId) { ctx.error('Unauthorized', 401); return; }

    const configService = new ConfigService(deps.db);
    const config = await configService.getConfig();
    ctx.success(config);
  } catch (err) {
    ctx.error(err.message, 500);
  }
}

export async function put(ctx, deps) {
  if (!requireAdmin(ctx)) return;
  try {
    const configService = new ConfigService(deps.db);
    const config = await configService.saveConfig(ctx.request.body);
    ctx.success(config);
  } catch (err) {
    ctx.error(err.message, 400);
  }
}