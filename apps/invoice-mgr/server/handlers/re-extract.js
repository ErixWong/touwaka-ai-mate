/**
 * 发票管理 - 重新提取
 * POST /api/apps/invoice-mgr/re-extract/:rowId → 重置记录为 pending_process（管理员）
 *
 * URL 映射：/apps/invoice-mgr/re-extract/:rowId → 本文件，params.p0 = rowId
 */
import logger from '../../../../lib/logger.js';
import MiniAppService from '../../../../server/services/mini-app.service.js';

let miniAppService;

function _getUserContext(ctx) {
  const session = ctx.state?.session || {};
  const user = ctx.state?.user || {};
  const userId = session.id || user.id;
  const isAdmin = Boolean(
    session.isAdmin
    || user.isAdmin
    || user.role === 'admin'
    || (Array.isArray(session.roles) && session.roles.includes('admin'))
  );
  return { userId, isAdmin };
}

export async function post(ctx, deps) {
  if (!miniAppService) miniAppService = new MiniAppService(deps.db);

  try {
    const { userId, isAdmin } = _getUserContext(ctx);
    if (!userId) return ctx.error('未登录', 401);
    if (!isAdmin) return ctx.error('仅管理员可执行重新分析', 403);

    const rowId = ctx.params.p0;

    const record = await miniAppService.updateAutonomousRecord(
      'invoice-mgr',
      rowId,
      userId,
      {},
      { status: 'pending_process' }
    );

    ctx.success(record, 'Re-extract triggered');
  } catch (error) {
    logger.error('[Invoice] reExtract error:', error.message);
    ctx.error(error.message, 400);
  }
}
