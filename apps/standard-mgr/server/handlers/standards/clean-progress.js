/**
 * standards/clean-progress handler
 *
 * GET /api/apps/standard-mgr/standards/:standardId/clean-progress
 *
 * 登录用户可查询当前版本的锚点清洗进度，无需管理员权限。
 */

import StandardMgrService from '../../service.js';
import logger from '../../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || ctx.state.user?.id || null;
}

export const route = {
  path: '/standards/:standardId/clean-progress',
};

export async function get(ctx, deps) {
  try {
    if (!getUserId(ctx)) {
      ctx.error('未登录', 401);
      return;
    }

    const { standardId } = ctx.params;
    if (!standardId) {
      ctx.error('standardId is required', 400);
      return;
    }

    const service = new StandardMgrService(deps.db);
    const progress = await service.getCleanProgress(standardId);
    if (!progress) {
      ctx.error('Standard not found', 404);
      return;
    }

    ctx.success(progress);
  } catch (err) {
    logger.error(`[standard-mgr] clean-progress error: ${err.message}`);
    ctx.error(err.message, err.status || 500);
  }
}
