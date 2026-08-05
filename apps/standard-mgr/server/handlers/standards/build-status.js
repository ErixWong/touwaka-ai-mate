/**
 * build-status handler
 *
 * POST /api/apps/standard-mgr/standards/:standardId/build-status
 *
 * 更新标准的锚点构建状态。
 * 当 status='done' 时自动触发 rebuildAnchoredSections 生成带锚点副本。
 *
 * 需要管理员权限（R2-4）。
 */

import StandardMgrService from '../../service.js';
import logger from '../../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export const route = {
  path: '/standards/:standardId/build-status',
};

export async function post(ctx, deps) {
  try {
    // R2-4：管理员权限校验
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return;
    }

    const userId = getUserId(ctx);
    const service = new StandardMgrService(deps.db);
    const { standardId } = ctx.params;
    const { status, error_message } = ctx.request.body || {};

    if (!standardId) {
      ctx.error('standardId is required', 400);
      return;
    }
    if (!status) {
      ctx.error('status is required', 400);
      return;
    }

    const result = await service.updateAnchorBuildStatus(standardId, status, error_message || null);

    // P1-3 触发②：清洗完成后异步执行 gap 回填（不阻塞主请求）
    if (status === 'done') {
      service.runGapBackfill({
        trigger: 'clean_done',
        standard_id: standardId,
      }).catch(err => {
        logger.error(`[standard-mgr] backfill-clean-done failed: ${err.message}`);
      });
    }

    ctx.success(result);
  } catch (err) {
    logger.error(`[standard-mgr] build-status error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}
