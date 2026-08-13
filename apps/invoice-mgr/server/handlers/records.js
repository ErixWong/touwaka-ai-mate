/**
 * 发票管理 - 记录 CRUD
 * POST   /api/apps/invoice-mgr/records       → 创建发票记录
 * GET    /api/apps/invoice-mgr/records/:rowId → 发票详情
 * DELETE /api/apps/invoice-mgr/records/:rowId → 删除发票记录
 * 
 *
 * URL 映射：/apps/invoice-mgr/records/:rowId → 本文件，params.p0 = rowId
 */
import logger from '../../../../lib/logger.js';
import InvoiceService from '../services/invoice.service.js';
import MiniAppService from '../../../../server/services/mini-app.service.js';

let invoiceService;
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

async function get(ctx, deps) {
  if (!invoiceService) invoiceService = new InvoiceService(deps.db);
  if (!miniAppService) miniAppService = new MiniAppService(deps.db);

  const { userId, isAdmin } = _getUserContext(ctx);
  if (!userId) return ctx.error('未登录', 401);

  const rowId = ctx.params.p0;

  try {
    if (!rowId) {
      // 列表（兼容 GET /apps/invoice-mgr/）
      const query = ctx.query;
      const result = await invoiceService.list({
        page: parseInt(query.page) || 1,
        size: parseInt(query.size) || 20,
        invoiceNumber: query.invoice_number,
        sellerName: query.seller_name,
        buyerName: query.buyer_name,
        status: query.status,
        startDate: query.start_date,
        endDate: query.end_date,
        sort: query.sort,
        order: query.order,
        userId,
        isAdmin,
        includeAll: query.include_all === 'true' || query.include_all === '1',
      });
      ctx.success(result);
      return;
    }

    const data = await invoiceService.detail(rowId, userId, isAdmin);
    if (!data.id) {
      return ctx.error('发票记录不存在', 404);
    }
    ctx.success(data);
  } catch (error) {
    logger.error('[Invoice] detail error:', error.message);
    ctx.error(error.message, 500);
  }
}

async function post(ctx, deps) {
  if (!miniAppService) miniAppService = new MiniAppService(deps.db);

  const { userId } = _getUserContext(ctx);
  if (!userId) return ctx.error('未登录', 401);

  try {
    const { data, attachments, clientRecordId } = ctx.request.body;
    if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
      return ctx.error('附件必填', 400);
    }

    const record = await miniAppService.createAutonomousRecord(
      'invoice-mgr',
      userId,
      data || {},
      attachments,
      clientRecordId
    );

    ctx.success(record, 'Created');
  } catch (error) {
    logger.error('[Invoice] create error:', error.message);
    ctx.error(error.message, 400);
  }
}

async function del(ctx, deps) {
  if (!miniAppService) miniAppService = new MiniAppService(deps.db);

  const { userId } = _getUserContext(ctx);
  if (!userId) return ctx.error('未登录', 401);

  const rowId = ctx.params.p0;

  try {
    await miniAppService.deleteAutonomousRecord('invoice-mgr', rowId, userId);
    ctx.success(null, 'Deleted');
  } catch (error) {
    logger.error('[Invoice] remove error:', error.message);
    ctx.error(error.message, 400);
  }
}

export default {
  get,
  post,
  delete: del,
};
