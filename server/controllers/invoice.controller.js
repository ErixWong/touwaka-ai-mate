import logger from '../../lib/logger.js';
import InvoiceService from '../services/invoice.service.js';

class InvoiceController {
  constructor(db) {
    this.invoiceService = new InvoiceService(db);
  }

  _getUserContext(ctx) {
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

  async list(ctx) {
    try {
      const query = ctx.query;
      const { userId, isAdmin } = this._getUserContext(ctx);
      if (!userId) return ctx.error('未登录', 401);
      const result = await this.invoiceService.list({
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
      });
      ctx.success(result);
    } catch (error) {
      logger.error('[Invoice] list error:', error.message);
      ctx.error(error.message, 500);
    }
  }

  async detail(ctx) {
    try {
      const { rowId } = ctx.params;
      const { userId, isAdmin } = this._getUserContext(ctx);
      if (!userId) return ctx.error('未登录', 401);
      const data = await this.invoiceService.detail(rowId, userId, isAdmin);
      if (!data.id) {
        return ctx.error('发票记录不存在', 404);
      }
      ctx.success(data);
    } catch (error) {
      logger.error('[Invoice] detail error:', error.message);
      ctx.error(error.message, 500);
    }
  }
}

export default InvoiceController;
