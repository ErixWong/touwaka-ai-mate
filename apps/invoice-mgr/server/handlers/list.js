/**
 * 发票管理 - 列表
 * GET /api/apps/invoice-mgr/list → 发票列表（分页 + 筛选）
 *
 * URL 映射：/apps/invoice-mgr/list → 本文件
 */
import logger from '../../../../lib/logger.js';
import InvoiceService from '../services/invoice.service.js';

let invoiceService;

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

export async function get(ctx, deps) {
  if (!invoiceService) invoiceService = new InvoiceService(deps.db);

  try {
    const query = ctx.query;
    const { userId, isAdmin } = _getUserContext(ctx);
    if (!userId) return ctx.error('未登录', 401);

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
  } catch (error) {
    logger.error('[Invoice] list error:', error.message);
    ctx.error(error.message, 500);
  }
}
