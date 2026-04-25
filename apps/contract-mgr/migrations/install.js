export default {
  async check(sequelize) {
    const [rows] = await sequelize.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('app_contract_rows', 'app_document_content')
    `, { type: sequelize.QueryTypes.SELECT });
    
    return rows.length < 2;
  },

  async up(sequelize) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_contract_rows (
        row_id VARCHAR(32) PRIMARY KEY COMMENT '关联 mini_app_rows.id',
        contract_number VARCHAR(64) NULL COMMENT '合同编号',
        party_a VARCHAR(128) NULL COMMENT '甲方',
        parent_company VARCHAR(128) NULL COMMENT '上级公司',
        contract_amount DECIMAL(15,2) NULL COMMENT '合同金额',
        contract_date DATE NULL COMMENT '签订日期',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        
        INDEX idx_contract_number (contract_number),
        INDEX idx_party_a (party_a),
        INDEX idx_parent_company (parent_company),
        INDEX idx_contract_amount (contract_amount),
        INDEX idx_contract_date (contract_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同管理扩展表'
    `);
    console.log('  ✓ Created app_contract_rows table');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_document_content (
        row_id VARCHAR(32) PRIMARY KEY COMMENT '关联 mini_app_rows.id',
        ocr_text LONGTEXT NULL COMMENT 'OCR 原文',
        ocr_service VARCHAR(64) NULL COMMENT 'OCR 服务名称',
        ocr_at DATETIME NULL COMMENT 'OCR 时间',
        filtered_text LONGTEXT NULL COMMENT '过滤后文本',
        filter_at DATETIME NULL COMMENT '过滤时间',
        extract_prompt TEXT NULL COMMENT '提取提示词',
        extract_json LONGTEXT NULL COMMENT '提取的原始 JSON',
        extract_model VARCHAR(64) NULL COMMENT '使用的模型',
        extract_temperature DECIMAL(3,2) NULL COMMENT '模型温度',
        extract_at DATETIME NULL COMMENT '提取时间',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档内容表'
    `);
    console.log('  ✓ Created app_document_content table');

    await sequelize.query(`
      ALTER TABLE app_contract_rows
      ADD CONSTRAINT fk_app_contract_rows_row_id
      FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
    `);
    console.log('  ✓ Added FK for app_contract_rows');

    await sequelize.query(`
      ALTER TABLE app_document_content
      ADD CONSTRAINT fk_app_document_content_row_id
      FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
    `);
    console.log('  ✓ Added FK for app_document_content');
  },

  async down(sequelize) {
    await sequelize.query(`DROP TABLE IF EXISTS app_document_content`);
    console.log('  ✓ Dropped app_document_content table');
    
    await sequelize.query(`DROP TABLE IF EXISTS app_contract_rows`);
    console.log('  ✓ Dropped app_contract_rows table');
  }
};