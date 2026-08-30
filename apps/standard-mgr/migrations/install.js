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

    // 首次安装：表不齐 → 需要执行 up
    if (rows.length < 4) return true;

    // 升级路径：表已存在时，检查是否有待迁移的历史数据
    // （历史 gap 回填以 valid 落库但仅文档级匹配、未定位章节 → 需迁为 suspected）
    const legacy = await sequelize.query(`
      SELECT COUNT(*) AS n FROM app_standard_ref_anchor
      WHERE source = 'auto_backfill' AND status = 'valid' AND target_outline_id IS NULL
    `, { type: sequelize.QueryTypes.SELECT });
    return (legacy[0]?.n || 0) > 0;
  },

  async up(sequelize) {
    // 企业花名册：标准归属（原由平台升级脚本 scripts/upgrade-database.js 创建，现归入 app 自治迁移）
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
    console.log('  ✓ Created app_enterprise table');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_standard (
        id VARCHAR(32) PRIMARY KEY,
        document_id VARCHAR(32) NOT NULL COMMENT '文档平台 documents.id，一份文档只纳管一次',
        standard_type VARCHAR(20) NOT NULL COMMENT '标准类型，当前取值 national/industry/enterprise/international，应用层校验，可扩展',
        standard_code VARCHAR(100) NOT NULL COMMENT '标准编号，如 GB/T 19001-2016',
        standard_name VARCHAR(500) NOT NULL COMMENT '标准名称',
        enterprise_id VARCHAR(32) NULL COMMENT '归属企业分类标签；NULL=公共标准库（承接国家/行业/国际标准）',
        current_revision_id VARCHAR(32) NULL COMMENT '当前采用版本 document_revisions.id',
        is_active BIT(1) DEFAULT 1 COMMENT '是否启用',
        anchor_build_status ENUM('pending','processing','done','error') DEFAULT 'pending' COMMENT '引用清洗状态',
        last_anchor_build_at DATETIME NULL COMMENT '最近一次清洗完成时间',
        last_anchor_build_error TEXT NULL COMMENT '最近一次清洗错误信息',
        needs_review BIT(1) DEFAULT 0 COMMENT '是否存在待人工处理的存疑/gap/无效引用',
        reference_count INT DEFAULT 0 COMMENT '引用总数',
        valid_reference_count INT DEFAULT 0 COMMENT '有效引用数',
        suspected_reference_count INT DEFAULT 0 COMMENT '存疑引用数',
        gap_reference_count INT DEFAULT 0 COMMENT '待回填缺口数',
        invalid_reference_count INT DEFAULT 0 COMMENT '无效引用数',
        has_manual_fix BIT(1) DEFAULT 0 COMMENT '是否存在人工修正',
        manual_fix_count INT DEFAULT 0 COMMENT '人工修正次数',
        last_manual_fix_at DATETIME NULL COMMENT '最近人工修正时间',
        last_manual_fix_by VARCHAR(32) NULL COMMENT '最近人工修正人 users.id',
        created_by VARCHAR(32) NULL COMMENT '创建人',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_app_standard_document_revision (document_id, current_revision_id),
        INDEX idx_document_id (document_id),
        INDEX idx_standard_code (standard_code),
        INDEX idx_enterprise (enterprise_id),
        INDEX idx_build_status (anchor_build_status),
        INDEX idx_current_revision (current_revision_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='标准纳管主对象表'
    `);
    console.log('  ✓ Created app_standard table');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_standard_ref_anchor (
        id VARCHAR(32) PRIMARY KEY,
        standard_id VARCHAR(32) NOT NULL COMMENT '所属标准 app_standard.id',
        source_revision_id VARCHAR(32) NOT NULL COMMENT '引用所在版本 document_revisions.id',
        source_outline_id VARCHAR(32) NOT NULL COMMENT '引用所在 section document_outlines.id',
        occurrence_index INT NOT NULL DEFAULT 0 COMMENT '同一引用片段在该 section 内第几次出现，从 0 起',
        source_text VARCHAR(500) NOT NULL COMMENT '原文引用片段（如 GB/T 2001），兼作 gap 回填预筛线索',
        context_text TEXT NULL COMMENT '引用片段上下文快照，供人工修正界面展示',
        ref_type ENUM('explicit','implicit') NOT NULL COMMENT '显式/隐式引用',
        status ENUM('valid','suspected','gap','invalid') NOT NULL COMMENT '有效/存疑/待回填/无效',
        source ENUM('auto','user_confirmed','manual','auto_backfill') NOT NULL DEFAULT 'auto' COMMENT '来源：自动识别/用户确认候选/人工新建/自动回填',
        target_document_id VARCHAR(32) NULL COMMENT '目标文档 documents.id，未定目标为 NULL',
        target_revision_id VARCHAR(32) NULL COMMENT '目标版本 document_revisions.id',
        target_outline_id VARCHAR(32) NULL COMMENT '目标 section document_outlines.id',
        candidates_json JSON NULL COMMENT '存疑候选列表 [{document_id,revision_id,outline_id,reason,score}]',
        status_reason VARCHAR(500) NULL COMMENT '状态原因元数据',
        retry_count INT DEFAULT 0 COMMENT 'gap 回填已重试次数',
        last_retry_at DATETIME NULL COMMENT '最近回填重试时间',
        created_by VARCHAR(32) NULL COMMENT '写入入口标识（清洗运行ID/用户ID/回填任务ID）',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_ref_anchor_occurrence (source_revision_id, source_outline_id, occurrence_index),
        INDEX idx_standard_status (standard_id, status),
        INDEX idx_target_document (target_document_id),
        INDEX idx_source_outline (source_outline_id),
        FOREIGN KEY (standard_id) REFERENCES app_standard(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='标准引用锚点记录表'
    `);
    console.log('  ✓ Created app_standard_ref_anchor table');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_standard_anchored_section (
        id VARCHAR(32) PRIMARY KEY,
        standard_id VARCHAR(32) NOT NULL COMMENT '所属标准 app_standard.id',
        revision_id VARCHAR(32) NOT NULL COMMENT '来源版本 document_revisions.id',
        outline_id VARCHAR(32) NOT NULL COMMENT '来源 section document_outlines.id',
        anchored_text LONGTEXT NULL COMMENT '插入 <document_id+revision_id(+outline_id)> 锚点后的文本',
        source_text_hash VARCHAR(64) NOT NULL COMMENT '对齐 document_outlines.text_hash，不符则副本失效',
        anchor_count INT DEFAULT 0 COMMENT '本 section 内锚点数量',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_anchored_section (revision_id, outline_id),
        INDEX idx_standard (standard_id),
        FOREIGN KEY (standard_id) REFERENCES app_standard(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='标准带锚点文本副本表'
    `);
    console.log('  ✓ Created app_standard_anchored_section table');

    // ==================== 数据迁移（幂等，升级路径） ====================
    // 历史 gap 回填直接落 valid（仅文档级匹配、未定位章节），污染“有效”语义。
    // 迁为 suspected（待人工确认），随后按 ref_anchor 实况重算标准汇总计数。
    // 该 UPDATE 幂等：条件不满足时影响 0 行；重复执行 status_reason 不会追加
    // （第二轮起 WHERE status='valid' 已不命中）。
    await sequelize.query(`
      UPDATE app_standard_ref_anchor
      SET status = 'suspected',
          status_reason = CONCAT(COALESCE(status_reason, ''), ' [迁移：文档级匹配待人工确认]'),
          updated_at = NOW()
      WHERE source = 'auto_backfill' AND status = 'valid' AND target_outline_id IS NULL
    `);
    console.log('  ✓ Migrated legacy auto_backfill valid → suspected');

    // 按 ref_anchor 实况全量重算标准汇总计数（与 service._refreshStandardCounts 同口径）
    await sequelize.query(`
      UPDATE app_standard s
      JOIN (
        SELECT standard_id,
               COUNT(*) AS total,
               COALESCE(SUM(status = 'valid'), 0) AS valid,
               COALESCE(SUM(status = 'suspected'), 0) AS suspected,
               COALESCE(SUM(status = 'gap'), 0) AS gap,
               COALESCE(SUM(status = 'invalid'), 0) AS invalid
        FROM app_standard_ref_anchor
        GROUP BY standard_id
      ) c ON c.standard_id = s.id
      SET s.reference_count = c.total,
          s.valid_reference_count = c.valid,
          s.suspected_reference_count = c.suspected,
          s.gap_reference_count = c.gap,
          s.invalid_reference_count = c.invalid,
          s.needs_review = (c.suspected > 0 OR c.gap > 0 OR c.invalid > 0)
    `);
    console.log('  ✓ Recalculated app_standard counters from ref_anchor');
  },

  async down(sequelize) {
    await sequelize.query(`DROP TABLE IF EXISTS app_standard_anchored_section`);
    console.log('  ✓ Dropped app_standard_anchored_section table');

    await sequelize.query(`DROP TABLE IF EXISTS app_standard_ref_anchor`);
    console.log('  ✓ Dropped app_standard_ref_anchor table');

    await sequelize.query(`DROP TABLE IF EXISTS app_standard`);
    console.log('  ✓ Dropped app_standard table');

    await sequelize.query(`DROP TABLE IF EXISTS app_enterprise`);
    console.log('  ✓ Dropped app_enterprise table');
  }
};
