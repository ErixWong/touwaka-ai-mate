// current-feature-analyzer 卸载迁移
// 反向清理：删除规则集主表与阶段定义表
export default {
  async check(sequelize) {
    const rows = await sequelize.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (
        'app_current_feature_rule_sets',
        'app_current_feature_rule_stages'
      )
    `, { type: sequelize.QueryTypes.SELECT });

    return rows.length > 0;
  },

  async up(sequelize) {
    await sequelize.query(`DROP TABLE IF EXISTS app_current_feature_rule_stages`);
    console.log('  ✓ Dropped app_current_feature_rule_stages table');

    await sequelize.query(`DROP TABLE IF EXISTS app_current_feature_rule_sets`);
    console.log('  ✓ Dropped app_current_feature_rule_sets table');
  },

  async down(sequelize) {
    // 卸载回滚：恢复建表（结构同 install.js up，幂等）
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_current_feature_rule_sets (
        id VARCHAR(32) NOT NULL COMMENT '主键ID，使用 Utils.newID()',
        rule_set_name VARCHAR(128) NOT NULL COMMENT '规则集名称',
        description TEXT NULL COMMENT '规则集描述',
        is_default BIT(1) NOT NULL DEFAULT b'0' COMMENT '是否默认规则集',
        is_enabled BIT(1) NOT NULL DEFAULT b'1' COMMENT '是否启用',
        created_by VARCHAR(32) NULL COMMENT '创建人ID',
        updated_by VARCHAR(32) NULL COMMENT '更新人ID',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        PRIMARY KEY (id),
        KEY idx_app_current_feature_rule_sets_default (is_default),
        KEY idx_app_current_feature_rule_sets_enabled (is_enabled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='电流采样特征分析-规则集主表'
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_current_feature_rule_stages (
        id VARCHAR(32) NOT NULL COMMENT '主键ID，使用 Utils.newID()',
        rule_set_id VARCHAR(32) NOT NULL COMMENT '所属规则集ID',
        stage_code VARCHAR(64) NOT NULL COMMENT '阶段编码',
        stage_name VARCHAR(128) NOT NULL COMMENT '阶段名称',
        stage_order INT NOT NULL COMMENT '阶段顺序',
        stage_color VARCHAR(32) NULL COMMENT '阶段标识颜色',
        semantic_definition TEXT NOT NULL COMMENT '语义定义',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        PRIMARY KEY (id),
        KEY idx_app_current_feature_rule_stages_rule_set_id (rule_set_id),
        KEY idx_app_current_feature_rule_stages_stage_order (rule_set_id, stage_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='电流采样特征分析-规则集阶段定义表'
    `);
    console.log('  ✓ Restored app_current_feature_rule_sets / app_current_feature_rule_stages tables');
  }
};
