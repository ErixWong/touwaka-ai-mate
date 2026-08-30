/**
 * standards/find handler
 *
 * GET /api/apps/standard-mgr/standards/find?standard_code=xxx&standard_name=xxx
 */

import StandardMgrService from '../../service.js';
import logger from '../../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export const route = {
  path: '/standards/find',
};

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const service = new StandardMgrService(deps.db);

    // enterprise_id 仅作为标准归属的分类标签，不参与访问控制或查询过滤。
    const standard_code = ctx.query.standard_code || null;
    const standard_name = ctx.query.standard_name || null;

    if (!standard_code && !standard_name) {
      ctx.error('At least one of standard_code or standard_name is required', 400);
      return;
    }

    const standards = await service.findStandards({ standard_code, standard_name });

    ctx.success(standards);
  } catch (err) {
    logger.error(`[standard-mgr] findStandards error: ${err.message}`);
    ctx.error(err.message, 500);
  }
}
