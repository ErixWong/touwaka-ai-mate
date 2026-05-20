export default {
  async check(sequelize) {
    const rows = await sequelize.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (
        'app_invoice_mgr_rows',
        'app_invoice_mgr_items'
      )
    `, { type: sequelize.QueryTypes.SELECT });

    return rows.length < 2;
  },

  async up(sequelize) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_invoice_mgr_rows (
        row_id VARCHAR(32) PRIMARY KEY COMMENT '关联 mini_app_rows.id',
        invoice_number VARCHAR(20) COMMENT '发票号码（20位），用于去重',
        invoice_date DATE COMMENT '开票日期',
        invoice_type VARCHAR(64) COMMENT '发票类型',
        seller_name VARCHAR(128) COMMENT '销售方名称',
        seller_tax_id VARCHAR(20) COMMENT '销售方税号',
        buyer_name VARCHAR(128) COMMENT '购买方名称',
        buyer_tax_id VARCHAR(20) COMMENT '购买方税号',
        total_amount DECIMAL(12,2) DEFAULT 0 COMMENT '合计金额',
        total_tax DECIMAL(12,2) DEFAULT 0 COMMENT '税额',
        total_with_tax DECIMAL(12,2) DEFAULT 0 COMMENT '价税合计',
        item_count INT DEFAULT 0 COMMENT '商品明细总数',
        page_count INT DEFAULT 0 COMMENT 'PDF页数',
        remarks TEXT COMMENT '备注',
        ocr_method VARCHAR(32) COMMENT '识别方法：fapiao/markitdown',
        ocr_raw LONGTEXT COMMENT 'OCR原始输出JSON',
        extraction_status VARCHAR(16) DEFAULT 'success' COMMENT '提取状态',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_invoice_number (invoice_number),
        INDEX idx_seller (seller_name),
        INDEX idx_buyer (buyer_name),
        INDEX idx_date (invoice_date),
        INDEX idx_amount (total_with_tax)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='发票元数据扩展表'
    `);
    console.log('  ✓ Created app_invoice_mgr_rows table');

    await sequelize.query(`
      ALTER TABLE app_invoice_mgr_rows
      ADD CONSTRAINT fk_app_invoice_mgr_rows_row_id
      FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
    `);
    console.log('  ✓ Added FK for app_invoice_mgr_rows');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_invoice_mgr_items (
        id VARCHAR(32) PRIMARY KEY,
        row_id VARCHAR(32) NOT NULL COMMENT '关联 mini_app_rows.id',
        page_number INT DEFAULT 1 COMMENT '所在页码',
        sort_order INT DEFAULT 0 COMMENT '行内排序',
        category VARCHAR(64) COMMENT '商品分类',
        name VARCHAR(128) COMMENT '商品名称',
        model VARCHAR(64) COMMENT '规格型号',
        unit VARCHAR(16) COMMENT '单位',
        quantity DECIMAL(12,4) COMMENT '数量',
        price DECIMAL(12,4) COMMENT '单价',
        amount DECIMAL(12,2) COMMENT '金额',
        tax_rate VARCHAR(8) COMMENT '税率',
        tax_amount DECIMAL(12,2) COMMENT '税额',
        issuer VARCHAR(32) COMMENT '开票人',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_row_id (row_id),
        FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='发票商品明细表'
    `);
    console.log('  ✓ Created app_invoice_mgr_items table');
  },

  async down(sequelize) {
    await sequelize.query(`DROP TABLE IF EXISTS app_invoice_mgr_items`);
    console.log('  ✓ Dropped app_invoice_mgr_items table');

    await sequelize.query(`DROP TABLE IF EXISTS app_invoice_mgr_rows`);
    console.log('  ✓ Dropped app_invoice_mgr_rows table');
  }
};
