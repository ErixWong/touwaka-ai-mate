/**
 * standards/sections handler
 *
 * GET /api/apps/standard-mgr/standards/:standardId/sections
 *
 * P0-2: 返回指定标准的全部带锚点副本（anchored_section）。
 * 只读端点，无需 admin 权限。
 */

import StandardMgrService from '../../service.js';
import logger from '../../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export const route = {
  path: '/standards/:standardId/sections',
};

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const service = new StandardMgrService(deps.db);
    const { standardId } = ctx.params;

    if (!standardId) {
      ctx.error('standardId is required', 400);
      return;
    }

    // 校验标准存在
    const standard = await service.getStandard(standardId);
    if (!standard) {
      ctx.error('Standard not found', 404);
      return;
    }

    const sections = await service.listAnchoredSections(standardId);
    ctx.success(sections);
  } catch (err) {
    logger.error(`[standard-mgr] sections error: ${err.message}`);
    ctx.error(err.message, 500);
  }
}
