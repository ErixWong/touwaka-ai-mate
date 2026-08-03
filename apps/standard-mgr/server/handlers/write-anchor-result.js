/**
 * write_anchor_result handler
 *
 * POST /api/apps/standard-mgr/write-anchor-result
 *
 * 三个调用方共享此端点：
 * 1. 清洗 agent 工具（来源=auto）
 * 2. 回填流程（来源=auto_backfill）
 * 3. 人工修正（来源=manual / user_confirmed）
 */

import StandardMgrService from '../service.js';
import logger from '../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export const route = {
  path: '/write-anchor-result',
};

export async function post(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const service = new StandardMgrService(deps.db);

    const body = ctx.request.body;

    // R2-4 过渡策略：忽略客户端传入的 enterprise_id
    const result = await service.writeAnchorResult({
      ...body,
      user_id: userId,
    });

    ctx.success(result);
  } catch (err) {
    logger.error(`[standard-mgr] writeAnchorResult error: ${err.message}`);
    ctx.error(err.message, 400);
  }
}
