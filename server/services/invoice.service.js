import logger from '../../lib/logger.js';
import { Sequelize } from 'sequelize';
import ExcelJS from 'exceljs';

class InvoiceService {
  constructor(db) {
    this.db = db;
    this.sequelize = db.sequelize;
  }

  /**
   * 从备注中提取四位基地代码
   * 策略：找出所有四位数字，排除年份"XXXX年"，取"年"之后的第一个
   * 覆盖格式：
   *   "511045 吉利梅山基地（3316）"  → 3316
   *   "511045 5103 2025年9月(...)" → 5103
   *   "2026年3月，基地5812" → 5812
   */
  _extractSiteCode(remarks) {
    if (!remarks) return '';
    // (?<!\d) 前面不是数字, (?!\d|年) 后面不是数字也不是"年"
    const matches = [...remarks.matchAll(/(?<!\d)\d{4}(?!\d|年)/g)];
    if (matches.length === 0) return '';
    // 如果有"年"，取它之后第一个匹配
    const yearIdx = remarks.indexOf('年');
    if (yearIdx >= 0) {
      for (const m of matches) {
        if (m.index > yearIdx) return m[0];
      }
    }
    return matches[0][0];
  }

  _buildConditions({ invoiceNumber, sellerName, buyerName, status, startDate, endDate, userId, isAdmin, includeAll = false }) {
    const conditions = ['m.status IS NOT NULL'];
    const replacements = [];

    if (!isAdmin || !includeAll) {
      conditions.push('m.user_id = ?');
      replacements.push(userId);
    }
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

    return { conditions, replacements };
  }

  _getSortField(sort) {
    const sortFieldMap = {
      invoice_number: 'r.invoice_number',
      invoice_date: 'r.invoice_date',
      seller_name: 'r.seller_name',
      buyer_name: 'r.buyer_name',
      total_with_tax: 'r.total_with_tax',
      created_at: 'm.created_at',
      'm.created_at': 'm.created_at',
    };
    return sortFieldMap[sort] || 'm.created_at';
  }

  _buildOrderClause(sort = 'created_at', order = 'desc') {
    const sortField = this._getSortField(sort);
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    if (sortField === 'm.created_at') {
      return `m.created_at ${sortOrder}, r.invoice_number ${sortOrder}, m.id ${sortOrder}`;
    }

    return `${sortField} ${sortOrder}, m.created_at ${sortOrder}, r.invoice_number ${sortOrder}, m.id ${sortOrder}`;
  }

  /**
   * 基础查询条件拼接（列表、详情等读路径使用）
   * 不添加 rows 表过滤，允许 duplicate 空壳记录（r.row_id IS NULL）出现在列表中
   */
  _buildBaseWhereClause(baseConditions) {
    return `WHERE ${baseConditions.join(' AND ')}`;
  }

  /**
   * 导出专用条件拼接
   * 追加 r.row_id IS NOT NULL，确保 duplicate 空壳不进入导出
   */
  _buildExportWhereClause(baseConditions) {
    const conditions = [...baseConditions, 'r.row_id IS NOT NULL'];
    return `WHERE ${conditions.join(' AND ')}`;
  }

  _parseRecordData(data) {
    if (!data) return {};
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        return {};
      }
    }
    return typeof data === 'object' ? data : {};
  }

  /**
   * 在行数据上挂载 duplicate 元数据。
   * - 管理员：直接透传 existing_row_id
   * - 普通用户：通过 validSourceIds（批量模式）或调用方在 decorate 后自行二次校验
   * @param {object} row
   * @param {{ isAdmin?: boolean, validSourceIds?: Set<string> }} opts
   */
  _decorateDuplicateMeta(row, { isAdmin = false, validSourceIds = null } = {}) {
    const recordData = this._parseRecordData(row?.data);
    let sourceRowId = recordData.existing_row_id || null;

    // 非管理员：校验 source row 归属当前用户
    if (!isAdmin && sourceRowId) {
      if (validSourceIds) {
        // 批量模式：使用已验证的 ID 集合过滤
        if (!validSourceIds.has(sourceRowId)) {
          sourceRowId = null;
        }
      }
      // 非批量模式（detail）：调用方在 decorate 后自行做单行 DB 校验
    }

    return {
      ...row,
      is_duplicate: Boolean(recordData.duplicate),
      duplicate_source_row_id: sourceRowId,
    };
  }

  async list({ page = 1, size = 20, invoiceNumber, sellerName, buyerName, status, startDate, endDate, sort = 'created_at', order = 'desc', userId, isAdmin, includeAll = false }) {
    const { conditions, replacements } = this._buildConditions({
      invoiceNumber, sellerName, buyerName, status, startDate, endDate, userId, isAdmin, includeAll,
    });

    const where = this._buildBaseWhereClause(conditions);
    const orderClause = this._buildOrderClause(sort, order);
    const offset = (page - 1) * size;

    const [rows, countResult] = await Promise.all([
      this.sequelize.query(
        `SELECT m.id, m.status, m.created_at,
                m.data,
                r.invoice_number, r.invoice_date, r.invoice_type,
                r.seller_name, r.seller_tax_id, r.buyer_name, r.buyer_tax_id,
                r.total_amount, r.total_tax, r.total_with_tax,
                r.item_count, r.remarks, r.issuer, r.ocr_method, r.extraction_status,
                r.page_count, r.text_items_count, r.keyword_count
         FROM app_invoice_mgr_records m
         LEFT JOIN app_invoice_mgr_rows r ON r.row_id = m.id
         ${where}
         ORDER BY ${orderClause}
         LIMIT ? OFFSET ?`,
        { replacements: [...replacements, size, offset], type: Sequelize.QueryTypes.SELECT }
      ),
      this.sequelize.query(
        `SELECT COUNT(*) as total
         FROM app_invoice_mgr_records m
         LEFT JOIN app_invoice_mgr_rows r ON r.row_id = m.id
         ${where}`,
        { replacements, type: Sequelize.QueryTypes.SELECT }
      ),
    ]);

    // 批量校验 duplicate source row 归属（非管理员）
    let validSourceIds = null;
    if (!isAdmin) {
      const sourceIds = rows
        .map(row => this._parseRecordData(row?.data).existing_row_id)
        .filter(Boolean);
      if (sourceIds.length > 0) {
        const placeholders = sourceIds.map(() => '?').join(',');
        const validRows = await this.sequelize.query(
          `SELECT id FROM app_invoice_mgr_records WHERE id IN (${placeholders}) AND user_id = ?`,
          { replacements: [...sourceIds, userId], type: Sequelize.QueryTypes.SELECT }
        );
        validSourceIds = new Set(validRows.map(r => r.id));
      }
    }

    return {
      list: rows.map(row => this._decorateDuplicateMeta(row, { isAdmin, validSourceIds })),
      total: countResult[0]?.total || 0,
      page,
      size,
    };
  }

  async detail(rowId, userId, isAdmin) {
    const conditions = ['m.id = ?'];
    const replacements = [rowId];

    if (!isAdmin) {
      conditions.push('m.user_id = ?');
      replacements.push(userId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE 1=1';

    // 阶段 1：先查主记录并完成授权校验
    const rows = await this.sequelize.query(
      `SELECT m.id, m.status, m.created_at,
              m.data,
              r.invoice_number, r.invoice_date, r.invoice_type,
              r.seller_name, r.seller_tax_id, r.buyer_name, r.buyer_tax_id,
              r.total_amount, r.total_tax, r.total_with_tax,
              r.item_count, r.page_count, r.remarks, r.issuer, r.ocr_method, r.ocr_raw, r.extraction_status,
              r.text_items_count, r.keyword_count
       FROM app_invoice_mgr_records m
       LEFT JOIN app_invoice_mgr_rows r ON r.row_id = m.id
       ${where}`,
      { replacements, type: Sequelize.QueryTypes.SELECT }
    );

    const record = rows[0];
    if (!record) {
      return {};
    }

    // 阶段 2：主记录存在且可访问后，再查明细
    const items = await this.sequelize.query(
      `SELECT * FROM app_invoice_mgr_items WHERE row_id = ? ORDER BY sort_order`,
      { replacements: [rowId], type: Sequelize.QueryTypes.SELECT }
    );

    const decorated = this._decorateDuplicateMeta(record, { isAdmin });

    // 非管理员：单行校验 duplicate source row 归属
    if (!isAdmin && decorated.duplicate_source_row_id) {
      const [ownerCheck] = await this.sequelize.query(
        `SELECT id FROM app_invoice_mgr_records WHERE id = ? AND user_id = ? LIMIT 1`,
        { replacements: [decorated.duplicate_source_row_id, userId], type: Sequelize.QueryTypes.SELECT }
      );
      if (!ownerCheck) {
        decorated.duplicate_source_row_id = null;
      }
    }

    return {
      ...decorated,
      items: items || [],
    };
  }

  /**
   * 全部导出：两个 Sheet
   * - Sheet1「发票信息」：所有发票的 header 字段
   * - Sheet2「商品明细」：所有明细行（含发票号码用于 VLOOKUP）
   */
  async exportFull({ startDate, endDate, sort = 'created_at', order = 'desc', userId, isAdmin, invoiceNumber, sellerName, buyerName, status, includeAll = false }) {
    const { conditions, replacements } = this._buildConditions({
      startDate, endDate, userId, isAdmin, invoiceNumber, sellerName, buyerName, status, includeAll,
    });

    const where = this._buildExportWhereClause(conditions);
    const orderClause = this._buildOrderClause(sort, order);

    // 查询所有符合条件的发票 header
    const rows = await this.sequelize.query(
      `SELECT m.id, m.status, m.created_at,
              r.invoice_number, r.invoice_date, r.invoice_type,
              r.seller_name, r.seller_tax_id, r.buyer_name, r.buyer_tax_id,
              r.total_amount, r.total_tax, r.total_with_tax,
              r.item_count, r.remarks, r.issuer, r.ocr_method, r.extraction_status,
              r.page_count, r.text_items_count, r.keyword_count
       FROM app_invoice_mgr_records m
       LEFT JOIN app_invoice_mgr_rows r ON r.row_id = m.id
       ${where}
       ORDER BY ${orderClause}`,
      { replacements, type: Sequelize.QueryTypes.SELECT }
    );

    if (rows.length === 0) {
      return null; // 无数据，前端提示
    }

    // 查询所有关联的商品明细
    const rowIds = rows.map(r => r.id);
    let allItems = [];
    if (rowIds.length > 0) {
      const placeholders = rowIds.map(() => '?').join(',');
      allItems = await this.sequelize.query(
        `SELECT i.*, r.invoice_number
         FROM app_invoice_mgr_items i
         LEFT JOIN app_invoice_mgr_rows r ON r.row_id = i.row_id
         WHERE i.row_id IN (${placeholders})
         ORDER BY i.row_id, i.sort_order`,
        { replacements: rowIds, type: Sequelize.QueryTypes.SELECT }
      );
    }

    // 生成 Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'touwaka-ai-mate';

    // === Sheet 1: 发票信息 ===
    const headerSheet = workbook.addWorksheet('发票信息');
    headerSheet.columns = [
      { header: '发票号码', key: 'invoice_number', width: 22 },
      { header: '开票日期', key: 'invoice_date', width: 14 },
      { header: '发票类型', key: 'invoice_type', width: 22 },
      { header: '销售方名称', key: 'seller_name', width: 30 },
      { header: '销售方税号', key: 'seller_tax_id', width: 22 },
      { header: '购买方名称', key: 'buyer_name', width: 30 },
      { header: '购买方税号', key: 'buyer_tax_id', width: 22 },
      { header: '合计金额', key: 'total_amount', width: 14 },
      { header: '税额', key: 'total_tax', width: 14 },
      { header: '价税合计', key: 'total_with_tax', width: 14 },
      { header: '备注', key: 'remarks', width: 30 },
      { header: '开票人', key: 'issuer', width: 12 },
      { header: '识别方式', key: 'ocr_method', width: 12 },
      { header: '提取状态', key: 'extraction_status', width: 12 },
      { header: '状态', key: 'status', width: 12 },
    ];
    // 设置表头样式
    const headerRow = headerSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    for (const row of rows) {
      headerSheet.addRow(row);
    }

    // === Sheet 2: 商品明细 ===
    const detailSheet = workbook.addWorksheet('商品明细');
    detailSheet.columns = [
      { header: '发票号码', key: 'invoice_number', width: 22 },
      { header: '分类', key: 'category', width: 14 },
      { header: '商品名称', key: 'name', width: 30 },
      { header: '规格型号', key: 'model', width: 16 },
      { header: '单位', key: 'unit', width: 8 },
      { header: '数量', key: 'quantity', width: 12 },
      { header: '单价', key: 'price', width: 12 },
      { header: '金额', key: 'amount', width: 14 },
      { header: '税率', key: 'tax_rate', width: 10 },
      { header: '税额', key: 'tax_amount', width: 14 },
    ];
    const detailHeaderRow = detailSheet.getRow(1);
    detailHeaderRow.font = { bold: true };
    detailHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    for (const item of allItems) {
      detailSheet.addRow(item);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  /**
   * 个性化导出：用户选择字段 + 可选商品明细
   */
  async exportCustom({ startDate, endDate, sort = 'created_at', order = 'desc', userId, isAdmin, invoiceNumber, sellerName, buyerName, status, fields, includeItems, includeAll = false }) {
    // ⚠️ 字段定义需与前端 exportFieldGroups (InvoiceList.vue) 保持同步
    const ALL_HEADER_FIELDS = [
      { key: 'invoice_number', header: '发票号码', width: 22 },
      { key: 'invoice_date', header: '开票日期', width: 14 },
      { key: 'invoice_type', header: '发票类型', width: 22 },
      { key: 'seller_name', header: '销售方名称', width: 30 },
      { key: 'seller_tax_id', header: '销售方税号', width: 22 },
      { key: 'buyer_name', header: '购买方名称', width: 30 },
      { key: 'buyer_tax_id', header: '购买方税号', width: 22 },
      { key: 'total_amount', header: '合计金额', width: 14 },
      { key: 'total_tax', header: '税额', width: 14 },
      { key: 'total_with_tax', header: '价税合计', width: 14 },
      { key: 'remarks', header: '备注', width: 30 },
      { key: 'issuer', header: '开票人', width: 12 },
      { key: 'ocr_method', header: '识别方式', width: 12 },
      { key: 'extraction_status', header: '提取状态', width: 12 },
      { key: 'status', header: '状态', width: 12 },
    ];

    // 解析选中字段：默认全选
    const selectedKeys = (fields && fields.length > 0)
      ? fields
      : ALL_HEADER_FIELDS.map(f => f.key);
    const selectedFields = ALL_HEADER_FIELDS.filter(f => selectedKeys.includes(f.key));

    if (selectedFields.length === 0) {
      throw new Error('至少选择一列');
    }

    const { conditions, replacements } = this._buildConditions({
      startDate, endDate, userId, isAdmin, invoiceNumber, sellerName, buyerName, status, includeAll,
    });

    const where = this._buildExportWhereClause(conditions);
    const orderClause = this._buildOrderClause(sort, order);

    // 查询所有符合条件的发票 header
    const rows = await this.sequelize.query(
      `SELECT m.id, m.status, m.created_at,
              r.invoice_number, r.invoice_date, r.invoice_type,
              r.seller_name, r.seller_tax_id, r.buyer_name, r.buyer_tax_id,
              r.total_amount, r.total_tax, r.total_with_tax,
              r.item_count, r.remarks, r.issuer, r.ocr_method, r.extraction_status,
              r.page_count, r.text_items_count, r.keyword_count
       FROM app_invoice_mgr_records m
       LEFT JOIN app_invoice_mgr_rows r ON r.row_id = m.id
       ${where}
       ORDER BY ${orderClause}`,
      { replacements, type: Sequelize.QueryTypes.SELECT }
    );

    if (rows.length === 0) {
      return null;
    }

    // 查询关联的商品明细（仅当用户勾选了 includeItems 时）
    let allItems = [];
    if (includeItems) {
      const rowIds = rows.map(r => r.id);
      if (rowIds.length > 0) {
        const placeholders = rowIds.map(() => '?').join(',');
        allItems = await this.sequelize.query(
          `SELECT i.*, r.invoice_number
           FROM app_invoice_mgr_items i
           LEFT JOIN app_invoice_mgr_rows r ON r.row_id = i.row_id
           WHERE i.row_id IN (${placeholders})
           ORDER BY i.row_id, i.sort_order`,
          { replacements: rowIds, type: Sequelize.QueryTypes.SELECT }
        );
      }
    }

    // 生成 Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'touwaka-ai-mate';

    // === Sheet 1: 发票信息（仅选中字段）===
    const headerSheet = workbook.addWorksheet('发票信息');
    headerSheet.columns = selectedFields.map(f => ({
      header: f.header,
      key: f.key,
      width: f.width,
    }));
    const headerRow = headerSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    for (const row of rows) {
      headerSheet.addRow(row);
    }

    // === Sheet 2: 商品明细 ===
    if (includeItems && allItems.length > 0) {
      const detailSheet = workbook.addWorksheet('商品明细');
      detailSheet.columns = [
        { header: '发票号码', key: 'invoice_number', width: 22 },
        { header: '分类', key: 'category', width: 14 },
        { header: '商品名称', key: 'name', width: 30 },
        { header: '规格型号', key: 'model', width: 16 },
        { header: '单位', key: 'unit', width: 8 },
        { header: '数量', key: 'quantity', width: 12 },
        { header: '单价', key: 'price', width: 12 },
        { header: '金额', key: 'amount', width: 14 },
        { header: '税率', key: 'tax_rate', width: 10 },
        { header: '税额', key: 'tax_amount', width: 14 },
      ];
      const detailHeaderRow = detailSheet.getRow(1);
      detailHeaderRow.font = { bold: true };
      detailHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

      for (const item of allItems) {
        detailSheet.addRow(item);
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  /**
   * 负值导出：筛选金额为负的商品明细，每行带上发票 header 信息
   */
  async exportNegative({ startDate, endDate, sort = 'created_at', order = 'desc', userId, isAdmin, invoiceNumber, sellerName, buyerName, status, includeAll = false }) {
    const { conditions, replacements } = this._buildConditions({
      startDate, endDate, userId, isAdmin, invoiceNumber, sellerName, buyerName, status, includeAll,
    });

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE 1=1';
    const orderClause = this._buildOrderClause(sort, order);

    // 直接 JOIN 查出所有负值明细，一条 SQL 搞定
    // 同时检查 amount < 0 和 tax_amount < 0（防止负值金额混入名称导致 amount=0）
    const rows = await this.sequelize.query(
      `SELECT r.invoice_number, r.invoice_date, r.buyer_name, r.seller_name,
              r.remarks, i.amount, i.tax_amount, i.name AS item_name, i.sort_order
       FROM app_invoice_mgr_records m
       JOIN app_invoice_mgr_rows r ON r.row_id = m.id
       JOIN app_invoice_mgr_items i ON i.row_id = m.id
       ${where}
         AND (i.amount < 0 OR i.tax_amount < 0)
       ORDER BY ${orderClause}, i.row_id, i.sort_order`,
      { replacements, type: Sequelize.QueryTypes.SELECT }
    );

    if (rows.length === 0) {
      return null;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'touwaka-ai-mate';

    const sheet = workbook.addWorksheet('负值明细');
    sheet.columns = [
      { header: '发票号码', key: 'invoice_number', width: 22 },
      { header: '开票日期', key: 'invoice_date', width: 14 },
      { header: '购买方名称', key: 'buyer_name', width: 30 },
      { header: '销售方名称', key: 'seller_name', width: 30 },
      { header: '商品名称', key: 'item_name', width: 26 },
      { header: '负值金额', key: 'amount', width: 14 },
      { header: '负值税额', key: 'tax_amount', width: 14 },
      { header: '基地代码', key: 'site_code', width: 12 },
      { header: '备注', key: 'remarks', width: 30 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    for (const row of rows) {
      sheet.addRow({ ...row, site_code: this._extractSiteCode(row.remarks) });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }
}

export default InvoiceService;
