/**
 * anchors/gaps handler
 *
 * GET /api/apps/standard-mgr/anchors/gaps?standard_id=xxx
 */

import StandardMgrService from '../../service.js';
import logger from '../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export const route = {
  path: '/anchors/gaps',
};

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const service = new StandardMgrService(deps.db);

    const { standard_id, limit, offset } = ctx.query;

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

    const gaps = await service.listGaps(standard_id, {
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    ctx.success(gaps);
  } catch (err) {
    logger.error(`[standard-mgr] listGaps error: ${err.message}`);
    ctx.error(err.message, 500);
  }
}
