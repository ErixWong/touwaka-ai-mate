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
    if (!userId) {
      ctx.error('Unauthorized', 401);
      return;
    }

    const body = ctx.request.body || {};

    // 人工修正/确认入口必须管理员权限
    // auto / auto_backfill 来源由清洗 agent / 回填流程内部调用，仍需登录用户身份，
    // 后续可进一步通过任务 token 或 standard/document 权限做细粒度控制
    if (body.source === 'manual' || body.source === 'user_confirmed') {
      if (!ctx.state.session?.isAdmin) {
        ctx.error('需要管理员权限', 403);
        return;
      }
    }

    const service = new StandardMgrService(deps.db);

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
