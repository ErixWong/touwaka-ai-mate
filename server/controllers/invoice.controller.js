import logger from '../../lib/logger.js';
import InvoiceService from '../services/invoice.service.js';
import MiniAppService from '../services/mini-app.service.js';

class InvoiceController {
  constructor(db) {
    this.db = db;
    this.invoiceService = new InvoiceService(db);
    this.miniAppService = new MiniAppService(db);
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
        includeAll: query.include_all === 'true' || query.include_all === '1',
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
      const fieldCount = query.fields ? query.fields.split(',').length : 0;
      logger.info(`[Invoice] export type=${type}, fields=${fieldCount}, include_items=${query.include_items || '0'}`);
      const params = {
        startDate: query.start_date,
        endDate: query.end_date,
        sort: query.sort || 'created_at',
        order: query.order || 'desc',
        invoiceNumber: query.invoice_number,
        sellerName: query.seller_name,
        buyerName: query.buyer_name,
        status: query.status,
        userId,
        isAdmin,
        includeAll: query.include_all === 'true' || query.include_all === '1',
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
        buffer = await this.invoiceService.exportNegative(params);
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

  // ==================== Records API (自治 app 专属) ====================

  async create(ctx) {
    try {
      const { userId } = this._getUserContext(ctx);
      if (!userId) return ctx.error('未登录', 401);

      const { data, attachments, clientRecordId } = ctx.request.body;
      if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
        return ctx.error('附件必填', 400);
      }

      // 复用 miniAppService 自治能力创建记录
      const record = await this.miniAppService.createAutonomousRecord(
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

  async remove(ctx) {
    try {
      const { userId } = this._getUserContext(ctx);
      if (!userId) return ctx.error('未登录', 401);

      const { rowId } = ctx.params;

      // 复用 miniAppService 自治能力删除记录
      await this.miniAppService.deleteAutonomousRecord('invoice-mgr', rowId, userId);

      ctx.success(null, 'Deleted');
    } catch (error) {
      logger.error('[Invoice] remove error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async reExtract(ctx) {
    try {
      const { userId, isAdmin } = this._getUserContext(ctx);
      if (!userId) return ctx.error('未登录', 401);
      if (!isAdmin) return ctx.error('仅管理员可执行重新分析', 403);

      const { rowId } = ctx.params;

      // 复用 miniAppService 自治能力更新记录状态为 pending_process
      const record = await this.miniAppService.updateAutonomousRecord(
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
}

export default InvoiceController;
