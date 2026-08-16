// standard-mgr 卸载迁移
// 反向清理：删除锚点副本、引用记录、标准主表与企业花名册（app_enterprise 由本 app 自治管理）
export default {
  async check(sequelize) {
    const rows = await sequelize.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (
        'app_standard',
        'app_standard_ref_anchor',
        'app_standard_anchored_section',
        'app_enterprise'
      )
    `, { type: sequelize.QueryTypes.SELECT });

    return rows.length > 0;
  },

  async up(sequelize) {
    // 先删有外键依赖的表，再删主表
    await sequelize.query(`DROP TABLE IF EXISTS app_standard_anchored_section`);
    console.log('  ✓ Dropped app_standard_anchored_section table');

    await sequelize.query(`DROP TABLE IF EXISTS app_standard_ref_anchor`);
    console.log('  ✓ Dropped app_standard_ref_anchor table');

    await sequelize.query(`DROP TABLE IF EXISTS app_standard`);
    console.log('  ✓ Dropped app_standard table');

    await sequelize.query(`DROP TABLE IF EXISTS app_enterprise`);
    console.log('  ✓ Dropped app_enterprise table');
  },

  async down(sequelize) {
    // 卸载回滚：恢复建表（结构同 install.js up，幂等）
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_enterprise (
        id VARCHAR(32) PRIMARY KEY COMMENT '主键，Utils.newID(32)',
        name VARCHAR(100) NOT NULL COMMENT '企业名称（如：吉利、小鹏、比亚迪）',
        name_en VARCHAR(200) NULL COMMENT '企业英文名',
        description TEXT NULL COMMENT '备注',
        code_prefixes TEXT NULL COMMENT '标准编号前缀（逗号分隔，如 Q-JL,Q-JLY；用于企业标准识别与归属推断）',
        is_active BIT(1) DEFAULT b'1' COMMENT '是否启用',
        created_by VARCHAR(32) NULL COMMENT '创建人 users.id',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_app_enterprise_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业花名册（标准归属）'
    `);
    console.log('  ✓ Restored app_enterprise table');
  }
};
