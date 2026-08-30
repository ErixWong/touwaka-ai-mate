/**
 * standards/referenced-by handler
 *
 * GET /api/apps/standard-mgr/standards/:standardId/referenced-by
 *
 * 返回引用指定标准的来源标准及章节，登录用户可读。
 */

import StandardMgrService from '../../service.js';
import logger from '../../../../../lib/logger.js';

export const route = {
  path: '/standards/:standardId/referenced-by',
};

export async function get(ctx, deps) {
  try {
    const service = new StandardMgrService(deps.db);
    const { standardId } = ctx.params;

    if (!standardId) {
      ctx.error('standardId is required', 400);
      return;
    }

    const standard = await service.getStandard(standardId);
    if (!standard) {
      ctx.error('Standard not found', 404);
      return;
    }

    const result = await service.listReferencedBy(standardId);
    if (!result) {
      ctx.error('Standard not found', 404);
      return;
    }
    ctx.success(result);
  } catch (err) {
    logger.error(`[standard-mgr] referenced-by error: ${err.message}`);
    ctx.error(err.message, err.status || 500);
  }
}
