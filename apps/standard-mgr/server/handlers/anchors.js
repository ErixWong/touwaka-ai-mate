/**
 * anchors handler
 *
 * GET /api/apps/standard-mgr/anchors?standard_id=xxx&status=gap
 *
 * 路由扁平化（R2-3）：原 anchors/list.js 重命名为 anchors.js。
 */

import StandardMgrService from '../../service.js';
import logger from '../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export const route = {
  path: '/anchors',
};

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const service = new StandardMgrService(deps.db);

    const { standard_id, status, ref_type, limit, offset } = ctx.query;

    if (!standard_id) {
      ctx.error('standard_id is required', 400);
      return;
    }

    // R2-4 过渡策略：不过滤 enterprise_id
    const standard = await service.getStandard(standard_id);
    if (!standard) {
      ctx.error('Standard not found', 404);
      return;
    }

    const anchors = await service.listRefAnchors(standard_id, {
      status: status || null,
      ref_type: ref_type || null,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    ctx.success(anchors);
  } catch (err) {
    logger.error(`[standard-mgr] anchors error: ${err.message}`);
    ctx.error(err.message, 500);
  }
}
