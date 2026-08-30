/**
 * 跨标准 gap 聚合 handler
 *
 * GET /api/apps/standard-mgr/gaps/aggregate
 */

import StandardMgrService from '../service.js';
import logger from '../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || ctx.state.user?.id || null;
}

export const route = {
  path: '/gaps/aggregate',
};

export async function get(ctx, deps) {
  try {
    if (!getUserId(ctx)) {
      ctx.error('Unauthorized', 401);
      return;
    }

    const service = new StandardMgrService(deps.db);
    const gaps = await service.aggregateGaps();
    ctx.success(gaps);
  } catch (err) {
    logger.error(`[standard-mgr] aggregateGaps error: ${err.message}`);
    ctx.error(err.message, err.status || 500);
  }
}
