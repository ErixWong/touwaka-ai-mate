import logger from '../../lib/logger.js';
import { Sequelize } from 'sequelize';

class InvoiceService {
  constructor(db) {
    this.db = db;
    this.sequelize = db.sequelize;
  }

  async list({ page = 1, size = 20, invoiceNumber, sellerName, buyerName, status, startDate, endDate, sort = 'invoice_date', order = 'desc' }) {
    const conditions = [];
    const replacements = [];

    if (invoiceNumber) {
      conditions.push('r.invoice_number LIKE ?');
      replacements.push(`%${invoiceNumber}%`);
    }
    if (sellerName) {
      conditions.push('r.seller_name LIKE ?');
      replacements.push(`%${sellerName}%`);
    }
    if (buyerName) {
      conditions.push('r.buyer_name LIKE ?');
      replacements.push(`%${buyerName}%`);
    }
    if (status) {
      conditions.push('m.status = ?');
      replacements.push(status);
    }
    if (startDate) {
      conditions.push('r.invoice_date >= ?');
      replacements.push(startDate);
    }
    if (endDate) {
      conditions.push('r.invoice_date <= ?');
      replacements.push(endDate);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const allowedSort = ['invoice_number', 'invoice_date', 'seller_name', 'buyer_name', 'total_with_tax', 'm.created_at'];
    const sortField = allowedSort.includes(sort) ? `r.${sort}` : 'r.invoice_date';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    const offset = (page - 1) * size;

    const [rows, countResult] = await Promise.all([
      this.sequelize.query(
        `SELECT m.id, m.status, m.created_at,
                r.invoice_number, r.invoice_date, r.invoice_type,
                r.seller_name, r.seller_tax_id, r.buyer_name, r.buyer_tax_id,
                r.total_amount, r.total_tax, r.total_with_tax,
                r.item_count, r.remarks, r.ocr_method, r.extraction_status
         FROM mini_app_rows m
         LEFT JOIN app_invoice_mgr_rows r ON r.row_id = m.id
         ${where}
         ORDER BY ${sortField} ${sortOrder}
         LIMIT ? OFFSET ?`,
        { replacements: [...replacements, size, offset], type: Sequelize.QueryTypes.SELECT }
      ),
      this.sequelize.query(
        `SELECT COUNT(*) as total
         FROM mini_app_rows m
         LEFT JOIN app_invoice_mgr_rows r ON r.row_id = m.id
         ${where}`,
        { replacements, type: Sequelize.QueryTypes.SELECT }
      ),
    ]);

    return {
      list: rows,
      total: countResult[0]?.total || 0,
      page,
      size,
    };
  }

  async detail(rowId) {
    const [rows, items] = await Promise.all([
      this.sequelize.query(
        `SELECT m.id, m.status, m.created_at,
                r.invoice_number, r.invoice_date, r.invoice_type,
                r.seller_name, r.seller_tax_id, r.buyer_name, r.buyer_tax_id,
                r.total_amount, r.total_tax, r.total_with_tax,
                r.item_count, r.page_count, r.remarks, r.ocr_method, r.ocr_raw, r.extraction_status
         FROM mini_app_rows m
         LEFT JOIN app_invoice_mgr_rows r ON r.row_id = m.id
         WHERE m.id = ?`,
        { replacements: [rowId], type: Sequelize.QueryTypes.SELECT }
      ),
      this.sequelize.query(
        `SELECT * FROM app_invoice_mgr_items WHERE row_id = ? ORDER BY sort_order`,
        { replacements: [rowId], type: Sequelize.QueryTypes.SELECT }
      ),
    ]);

    return {
      ...(rows[0] || {}),
      items: items || [],
    };
  }
}

export default InvoiceService;
