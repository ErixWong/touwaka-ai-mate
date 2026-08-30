/**
 * standards/upgrade-revision handler
 *
 * POST /api/apps/standard-mgr/standards/:standardId/upgrade-revision
 *
 * 将标准重指到文档平台最新版本，并触发新版本锚点清洗。
 * 需要管理员权限。
 */

import StandardMgrService from '../../service.js';
import logger from '../../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export const route = {
  path: '/standards/:standardId/upgrade-revision',
};

export async function post(ctx, deps) {
  try {
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return;
    }

    const userId = getUserId(ctx);
    if (!userId) {
      ctx.error('未登录', 401);
      return;
    }

    const { standardId } = ctx.params;
    if (!standardId) {
      ctx.error('standardId is required', 400);
      return;
    }

    const service = new StandardMgrService(deps.db);
    const result = await service.upgradeToLatestRevision(standardId, {
      session: ctx.state.session,
      chatService: deps.request?.chatService,
    });

    ctx.success(result);
  } catch (err) {
    logger.error(`[standard-mgr] upgrade-revision error: ${err.message}`);
    ctx.error(err.message, err.status || 500);
  }
}
