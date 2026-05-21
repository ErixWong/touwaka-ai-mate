import logger from '../../lib/logger.js';
import InvoiceService from '../services/invoice.service.js';

class InvoiceController {
  constructor(db) {
    this.invoiceService = new InvoiceService(db);
  }

  async list(ctx) {
    try {
      const query = ctx.query;
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
      const data = await this.invoiceService.detail(rowId);
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
