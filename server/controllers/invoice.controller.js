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

  async exportExcel(ctx) {
    try {
      const query = ctx.query;
      const { userId, isAdmin } = this._getUserContext(ctx);
      if (!userId) return ctx.error('未登录', 401);

      const type = query.type || 'full';
      logger.info(`[Invoice] export type=${type}, query=${JSON.stringify(query)}`);
      const params = {
        startDate: query.start_date,
        endDate: query.end_date,
        sort: query.sort || 'invoice_date',
        order: query.order || 'desc',
        userId,
        isAdmin,
      };

      let buffer;
      let filename;

      const now = new Date();
      const ts = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

      if (type === 'full') {
        buffer = await this.invoiceService.exportFull(params);
        filename = `发票信息全部导出-${ts}.xlsx`;
      } else if (type === 'custom') {
        const fields = query.fields ? query.fields.split(',') : [];
        const includeItems = query.include_items === 'true' || query.include_items === '1';
        buffer = await this.invoiceService.exportCustom({ ...params, fields, includeItems });
        filename = `发票信息个性化导出-${ts}.xlsx`;
      } else if (type === 'negative') {
        buffer = await this.invoiceService.exportNegative({
          ...params,
          invoiceNumber: query.invoice_number,
          sellerName: query.seller_name,
          buyerName: query.buyer_name,
          status: query.status,
        });
        filename = `负值明细导出-${ts}.xlsx`;
      } else {
        return ctx.error('不支持的导出类型', 400);
      }

      if (!buffer) {
        return ctx.error('没有符合条件的数据', 404);
      }

      ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      ctx.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      ctx.body = Buffer.from(buffer);
    } catch (error) {
      logger.error('[Invoice] export error:', error.message);
      ctx.error(error.message, 500);
    }
  }
}

export default InvoiceController;
