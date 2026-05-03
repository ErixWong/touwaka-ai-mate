export default {
  async check(sequelize) {
    const rows = await sequelize.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (
        'contract_v2_org_nodes',
        'contract_v2_main_records',
        'contract_v2_versions',
        'app_contract_v2_rows',
        'app_contract_v2_content'
      )
    `, { type: sequelize.QueryTypes.SELECT });

    return rows.length < 5;
  },

  async up(sequelize) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS contract_v2_org_nodes (
        id VARCHAR(32) PRIMARY KEY,
        parent_id VARCHAR(32) NULL,
        node_type ENUM('group', 'party', 'project') NOT NULL COMMENT '节点类型',
        name VARCHAR(128) NOT NULL COMMENT '节点名称',
        path VARCHAR(255) COMMENT '层级路径',
        level INT DEFAULT 1 COMMENT '层级深度',
        sort_order INT DEFAULT 0 COMMENT '同级排序',
        is_active BIT(1) DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_parent (parent_id),
        INDEX idx_type (node_type),
        INDEX idx_path (path),
        INDEX idx_level (level),
        FOREIGN KEY (parent_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同组织节点表'
    `);
    console.log('  ✓ Created contract_v2_org_nodes table');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS contract_v2_main_records (
        id VARCHAR(32) PRIMARY KEY,
        org_node_id VARCHAR(32) NOT NULL COMMENT '所属组织节点',
        contract_name VARCHAR(128) NOT NULL COMMENT '合同名称',
        contract_type ENUM('strategy','framework','development','supply','purchase','quality','nda','technical','other') COMMENT '合同类型',
        current_version_id VARCHAR(32) COMMENT '当前生效版本ID',
        version_count INT DEFAULT 0 COMMENT '版本总数',
        status ENUM('draft','active','expired','terminated') DEFAULT 'active',
        created_by VARCHAR(32) COMMENT '创建人',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_org_node (org_node_id),
        INDEX idx_type (contract_type),
        INDEX idx_status (status),
        FOREIGN KEY (org_node_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同主记录表'
    `);
    console.log('  ✓ Created contract_v2_main_records table');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS contract_v2_versions (
        id VARCHAR(32) PRIMARY KEY,
        contract_id VARCHAR(32) NOT NULL COMMENT '合同主记录ID',
        row_id VARCHAR(32) NOT NULL COMMENT 'mini_app_rows ID',
        file_id VARCHAR(32) COMMENT '文件ID',
        version_number VARCHAR(16) NOT NULL COMMENT '版本号',
        version_name VARCHAR(64) COMMENT '版本名称',
        version_type ENUM('draft','signed','amendment','supplement') COMMENT '版本类型',
        version_status ENUM('draft','reviewing','approved','rejected','archived') DEFAULT 'draft',
        effective_date DATE COMMENT '生效日期',
        expiry_date DATE COMMENT '失效日期',
        contract_number VARCHAR(64) COMMENT '合同编号',
        party_a VARCHAR(128) COMMENT '甲方',
        party_b VARCHAR(128) COMMENT '乙方',
        total_amount DECIMAL(15,2) COMMENT '合同金额',
        change_summary TEXT COMMENT '变更说明',
        is_current BIT(1) DEFAULT 0 COMMENT '是否当前版本',
        created_by VARCHAR(32) COMMENT '上传人',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_contract_version (contract_id, version_number),
        INDEX idx_contract (contract_id),
        INDEX idx_row (row_id),
        INDEX idx_current (is_current),
        INDEX idx_status (version_status),
        FOREIGN KEY (contract_id) REFERENCES contract_v2_main_records(id) ON DELETE CASCADE,
        FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同版本表'
    `);
    console.log('  ✓ Created contract_v2_versions table');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_contract_v2_content (
        row_id VARCHAR(32) PRIMARY KEY COMMENT '关联 mini_app_rows.id',
        ocr_text LONGTEXT NULL COMMENT 'OCR 原文',
        ocr_service VARCHAR(64) NULL COMMENT 'OCR 服务',
        ocr_at DATETIME NULL COMMENT 'OCR 时间',
        filtered_text LONGTEXT NULL COMMENT '过滤后文本',
        filter_at DATETIME NULL COMMENT '过滤时间',
        sections JSON NULL COMMENT '章节结构',
        extract_prompt TEXT NULL COMMENT '提取提示词',
        extract_json LONGTEXT NULL COMMENT '提取的原始JSON',
        extract_model VARCHAR(64) NULL COMMENT '提取模型',
        extract_temperature DECIMAL(3,2) NULL COMMENT '模型温度',
        extract_at DATETIME NULL COMMENT '提取时间',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同内容扩展表'
    `);
    console.log('  ✓ Created app_contract_v2_content table');

    await sequelize.query(`
      ALTER TABLE app_contract_v2_content
      ADD CONSTRAINT fk_app_contract_v2_content_row_id
      FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
    `);
    console.log('  ✓ Added FK for app_contract_v2_content');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_contract_v2_rows (
        row_id VARCHAR(32) PRIMARY KEY COMMENT '关联 mini_app_rows.id',
        contract_number VARCHAR(64) NULL COMMENT '合同编号',
        party_a VARCHAR(128) NULL COMMENT '甲方',
        parent_company VARCHAR(128) NULL COMMENT '上级公司',
        contract_amount DECIMAL(15,2) NULL COMMENT '合同金额',
        contract_date DATE NULL COMMENT '签订日期',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_contract_number (contract_number),
        INDEX idx_party_a (party_a),
        INDEX idx_contract_amount (contract_amount),
        INDEX idx_contract_date (contract_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同元数据扩展表'
    `);
    console.log('  ✓ Created app_contract_v2_rows table');

    await sequelize.query(`
      ALTER TABLE app_contract_v2_rows
      ADD CONSTRAINT fk_app_contract_v2_rows_row_id
      FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
    `);
    console.log('  ✓ Added FK for app_contract_v2_rows');
  },

  async down(sequelize) {
    await sequelize.query(`DROP TABLE IF EXISTS app_contract_v2_rows`);
    console.log('  ✓ Dropped app_contract_v2_rows table');

    await sequelize.query(`DROP TABLE IF EXISTS app_contract_v2_content`);
    console.log('  ✓ Dropped app_contract_v2_content table');

    await sequelize.query(`DROP TABLE IF EXISTS contract_v2_versions`);
    console.log('  ✓ Dropped contract_v2_versions table');

    await sequelize.query(`DROP TABLE IF EXISTS contract_v2_main_records`);
    console.log('  ✓ Dropped contract_v2_main_records table');

    await sequelize.query(`DROP TABLE IF EXISTS contract_v2_org_nodes`);
    console.log('  ✓ Dropped contract_v2_org_nodes table');
  }
};
