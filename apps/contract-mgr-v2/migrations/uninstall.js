export default {
  async check(sequelize) {
    const rows = await sequelize.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (
        'contract_v2_org_nodes',
        'contract_v2_main_records',
        'contract_v2_versions',
        'app_contract_mgr_v2_rows',
        'app_contract_mgr_v2_content'
      )
    `, { type: sequelize.QueryTypes.SELECT });

    return rows.length > 0;
  },

  async up(sequelize) {
    await sequelize.query(`DROP TABLE IF EXISTS app_contract_mgr_v2_rows`);
    console.log('  ✓ Dropped app_contract_mgr_v2_rows table');

    await sequelize.query(`DROP TABLE IF EXISTS app_contract_mgr_v2_content`);
    console.log('  ✓ Dropped app_contract_mgr_v2_content table');

    await sequelize.query(`DROP TABLE IF EXISTS contract_v2_versions`);
    console.log('  ✓ Dropped contract_v2_versions table');

    await sequelize.query(`DROP TABLE IF EXISTS contract_v2_main_records`);
    console.log('  ✓ Dropped contract_v2_main_records table');

    await sequelize.query(`DROP TABLE IF EXISTS contract_v2_org_nodes`);
    console.log('  ✓ Dropped contract_v2_org_nodes table');
  },

  async down(sequelize) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS contract_v2_org_nodes (
        id VARCHAR(32) PRIMARY KEY,
        parent_id VARCHAR(32) NULL,
        node_type ENUM('group', 'party', 'project') NOT NULL,
        name VARCHAR(128) NOT NULL,
        path VARCHAR(255),
        level INT DEFAULT 1,
        sort_order INT DEFAULT 0,
        is_active BIT(1) DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_parent (parent_id),
        INDEX idx_type (node_type),
        INDEX idx_path (path),
        INDEX idx_level (level),
        FOREIGN KEY (parent_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  ✓ Recreated contract_v2_org_nodes table');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS contract_v2_main_records (
        id VARCHAR(32) PRIMARY KEY,
        org_node_id VARCHAR(32) NOT NULL,
        contract_name VARCHAR(128) NOT NULL,
        contract_type ENUM('strategy','framework','development','supply','purchase','quality','nda','technical','other'),
        current_version_id VARCHAR(32),
        version_count INT DEFAULT 0,
        status ENUM('draft','active','expired','terminated') DEFAULT 'active',
        created_by VARCHAR(32),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_org_node (org_node_id),
        INDEX idx_type (contract_type),
        INDEX idx_status (status),
        FOREIGN KEY (org_node_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  ✓ Recreated contract_v2_main_records table');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS contract_v2_versions (
        id VARCHAR(32) PRIMARY KEY,
        contract_id VARCHAR(32) NOT NULL,
        row_id VARCHAR(32) NOT NULL,
        file_id VARCHAR(32),
        version_number VARCHAR(16) NOT NULL,
        version_name VARCHAR(64),
        version_type ENUM('draft','signed','amendment','supplement'),
        version_status ENUM('draft','reviewing','approved','rejected','archived') DEFAULT 'draft',
        effective_date DATE,
        expiry_date DATE,
        contract_number VARCHAR(64),
        party_a VARCHAR(128),
        party_b VARCHAR(128),
        total_amount DECIMAL(15,2),
        change_summary TEXT,
        is_current BIT(1) DEFAULT 0,
        created_by VARCHAR(32),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_contract_version (contract_id, version_number),
        INDEX idx_contract (contract_id),
        INDEX idx_row (row_id),
        INDEX idx_current (is_current),
        INDEX idx_status (version_status),
        FOREIGN KEY (contract_id) REFERENCES contract_v2_main_records(id) ON DELETE CASCADE,
        FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  ✓ Recreated contract_v2_versions table');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_contract_mgr_v2_content (
        row_id VARCHAR(32) PRIMARY KEY,
        ocr_text LONGTEXT NULL,
        ocr_service VARCHAR(64) NULL,
        ocr_at DATETIME NULL,
        filtered_text LONGTEXT NULL,
        filter_at DATETIME NULL,
        sections JSON NULL,
        extract_prompt TEXT NULL,
        extract_json LONGTEXT NULL,
        extract_model VARCHAR(64) NULL,
        extract_temperature DECIMAL(3,2) NULL,
        extract_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  ✓ Recreated app_contract_mgr_v2_content table');

    await sequelize.query(`
      ALTER TABLE app_contract_mgr_v2_content
      ADD CONSTRAINT fk_app_contract_mgr_v2_content_row_id
      FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
    `);
    console.log('  ✓ Added FK for app_contract_mgr_v2_content');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_contract_mgr_v2_rows (
        row_id VARCHAR(32) PRIMARY KEY,
        contract_number VARCHAR(64) NULL,
        party_a VARCHAR(128) NULL,
        parent_company VARCHAR(128) NULL,
        contract_amount DECIMAL(15,2) NULL,
        contract_date DATE NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_contract_number (contract_number),
        INDEX idx_party_a (party_a),
        INDEX idx_contract_amount (contract_amount),
        INDEX idx_contract_date (contract_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  ✓ Recreated app_contract_mgr_v2_rows table');

    await sequelize.query(`
      ALTER TABLE app_contract_mgr_v2_rows
      ADD CONSTRAINT fk_app_contract_mgr_v2_rows_row_id
      FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
    `);
    console.log('  ✓ Added FK for app_contract_mgr_v2_rows');
  }
};
