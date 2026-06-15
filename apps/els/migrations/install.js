/**
 * ELS Migration 安装脚本
 * 
 * 说明：
 * 1. 本脚本创建 7 张核心表，与 DDL-DRAFT.sql 保持一致
 * 2. 外键约束已在设计中定义，但第一阶段采用逻辑约束替代数据库外键
 * 3. 原因：避免 app 安装时因外键依赖顺序导致建表失败，保持 migration 简化
 * 4. Service 层已实现完整的逻辑约束，保证数据完整性
 * 5. 若后续版本需要加强数据库级约束，可追加 ALTER TABLE 添加外键
 */

const DDL_TABLES = [
  `CREATE TABLE IF NOT EXISTS app_els_libraries (
    id VARCHAR(32) NOT NULL,
    owner_user_id VARCHAR(32) NULL,
    name VARCHAR(128) NOT NULL,
    library_type ENUM('public', 'personal', 'shared') NOT NULL DEFAULT 'personal',
    description TEXT NULL,
    is_default BIT(1) NOT NULL DEFAULT b'0',
    is_active BIT(1) NOT NULL DEFAULT b'1',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_els_libraries_owner_user_id (owner_user_id),
    KEY idx_els_libraries_library_type (library_type),
    KEY idx_els_libraries_is_active (is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `-- 外键定义（DDL-DRAFT.sql 中已声明，Service 层实现逻辑约束）:
     -- CONSTRAINT fk_els_libraries_owner_user_id FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE`,

  `CREATE TABLE IF NOT EXISTS app_els_notebooks (
    id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    language VARCHAR(16) NOT NULL,
    name VARCHAR(128) NOT NULL,
    is_default BIT(1) NOT NULL DEFAULT b'0',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_els_notebooks_user_language (user_id, language),
    KEY idx_els_notebooks_user_id (user_id),
    KEY idx_els_notebooks_language (language)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `-- 外键定义（DDL-DRAFT.sql 中已声明，Service 层实现逻辑约束）:
     -- CONSTRAINT fk_els_notebooks_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`,

  `CREATE TABLE IF NOT EXISTS app_els_materials (
    id VARCHAR(32) NOT NULL,
    library_id VARCHAR(32) NOT NULL,
    owner_user_id VARCHAR(32) NULL,
    source_type ENUM('news', 'passage', 'curated', 'user_upload') NOT NULL,
    source_name VARCHAR(128) NULL,
    source_url VARCHAR(512) NULL,
    external_source_id VARCHAR(128) NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT NULL,
    content LONGTEXT NOT NULL,
    language VARCHAR(16) NOT NULL DEFAULT 'en',
    processing_status ENUM('processing', 'ready', 'rejected', 'failed') NOT NULL DEFAULT 'processing',
    status_reason TEXT NULL,
    topic VARCHAR(64) NULL,
    difficulty_level ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2') NULL,
    quiz_status ENUM('pending', 'ready', 'failed') NOT NULL DEFAULT 'pending',
    quiz_payload JSON NULL,
    cleaning_version VARCHAR(64) NULL,
    metadata JSON NULL,
    published_at DATETIME NULL,
    imported_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_els_materials_library_id (library_id),
    KEY idx_els_materials_owner_user_id (owner_user_id),
    KEY idx_els_materials_source_type (source_type),
    KEY idx_els_materials_processing_status (processing_status),
    KEY idx_els_materials_difficulty_level (difficulty_level),
    KEY idx_els_materials_published_at (published_at),
    KEY idx_els_materials_quiz_status (quiz_status),
    KEY idx_els_materials_topic (topic)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `-- 外键定义（DDL-DRAFT.sql 中已声明，Service 层实现逻辑约束）:
     -- CONSTRAINT fk_els_materials_library_id FOREIGN KEY (library_id) REFERENCES app_els_libraries(id) ON DELETE CASCADE ON UPDATE CASCADE
     -- CONSTRAINT fk_els_materials_owner_user_id FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE`,

  `CREATE TABLE IF NOT EXISTS app_els_user_words (
    id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    notebook_id VARCHAR(32) NOT NULL,
    material_id VARCHAR(32) NOT NULL,
    language VARCHAR(16) NOT NULL DEFAULT 'en',
    word_text VARCHAR(128) NOT NULL,
    word_lemma VARCHAR(128) NULL,
    phonetic VARCHAR(128) NULL,
    meaning TEXT NOT NULL,
    example_sentence TEXT NULL,
    source_sentence TEXT NULL,
    review_stage ENUM('D0', 'D1', 'D3', 'D7', 'D15', 'D30', 'D60', 'mastered') NOT NULL DEFAULT 'D0',
    next_review_at DATETIME NULL,
    last_review_at DATETIME NULL,
    wrong_count INT NOT NULL DEFAULT 0,
    consecutive_correct_count INT NOT NULL DEFAULT 0,
    is_in_wrong_bucket BIT(1) NOT NULL DEFAULT b'0',
    is_mastered BIT(1) NOT NULL DEFAULT b'0',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_els_user_words_notebook_material_word (notebook_id, material_id, word_text),
    KEY idx_els_user_words_user_id (user_id),
    KEY idx_els_user_words_notebook_id (notebook_id),
    KEY idx_els_user_words_material_id (material_id),
    KEY idx_els_user_words_language (language),
    KEY idx_els_user_words_next_review_at (next_review_at),
    KEY idx_els_user_words_review_stage (review_stage),
    KEY idx_els_user_words_wrong_bucket (is_in_wrong_bucket),
    KEY idx_els_user_words_is_mastered (is_mastered)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `-- 外键定义（DDL-DRAFT.sql 中已声明，Service 层实现逻辑约束）:
     -- CONSTRAINT fk_els_user_words_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
     -- CONSTRAINT fk_els_user_words_notebook_id FOREIGN KEY (notebook_id) REFERENCES app_els_notebooks(id) ON DELETE CASCADE ON UPDATE CASCADE
     -- CONSTRAINT fk_els_user_words_material_id FOREIGN KEY (material_id) REFERENCES app_els_materials(id) ON DELETE CASCADE ON UPDATE CASCADE`,

  `CREATE TABLE IF NOT EXISTS app_els_user_reviews (
    id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    word_id VARCHAR(32) NOT NULL,
    material_id VARCHAR(32) NULL,
    session_id VARCHAR(64) NULL,
    review_bucket ENUM('today', 'new', 'wrong') NOT NULL,
    review_type ENUM('meaning_choice', 'listen_pick', 'sentence_fill') NOT NULL,
    question_payload JSON NULL,
    user_answer TEXT NULL,
    correct_answer TEXT NULL,
    is_correct BIT(1) NOT NULL,
    self_rating ENUM('easy', 'normal', 'hard', 'forgot') NULL,
    stage_before ENUM('D0', 'D1', 'D3', 'D7', 'D15', 'D30', 'D60', 'mastered') NULL,
    stage_after ENUM('D0', 'D1', 'D3', 'D7', 'D15', 'D30', 'D60', 'mastered') NULL,
    answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_els_user_reviews_user_id (user_id),
    KEY idx_els_user_reviews_word_id (word_id),
    KEY idx_els_user_reviews_material_id (material_id),
    KEY idx_els_user_reviews_bucket (review_bucket),
    KEY idx_els_user_reviews_answered_at (answered_at),
    KEY idx_els_user_reviews_session_id (session_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `-- 外键定义（DDL-DRAFT.sql 中已声明，Service 层实现逻辑约束）:
     -- CONSTRAINT fk_els_user_reviews_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
     -- CONSTRAINT fk_els_user_reviews_word_id FOREIGN KEY (word_id) REFERENCES app_els_user_words(id) ON DELETE CASCADE ON UPDATE CASCADE
     -- CONSTRAINT fk_els_user_reviews_material_id FOREIGN KEY (material_id) REFERENCES app_els_materials(id) ON DELETE SET NULL ON UPDATE CASCADE`,

  `CREATE TABLE IF NOT EXISTS app_els_user_study_days (
    id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    study_date DATE NOT NULL,
    completed_reading BIT(1) NOT NULL DEFAULT b'0',
    completed_review BIT(1) NOT NULL DEFAULT b'0',
    is_checked_in BIT(1) NOT NULL DEFAULT b'0',
    streak_snapshot INT NOT NULL DEFAULT 0,
    first_completed_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_els_user_study_days_user_date (user_id, study_date),
    KEY idx_els_user_study_days_study_date (study_date),
    KEY idx_els_user_study_days_checked_in (is_checked_in)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `-- 外键定义（DDL-DRAFT.sql 中已声明，Service 层实现逻辑约束）:
     -- CONSTRAINT fk_els_user_study_days_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`,

  `CREATE TABLE IF NOT EXISTS app_els_user_preferences (
    id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    selected_library_id VARCHAR(32) NULL,
    selected_notebook_id VARCHAR(32) NULL,
    default_tts_voice VARCHAR(16) DEFAULT 'female',
    default_tts_speed DECIMAL(3,1) DEFAULT 1.0,
    daily_goal_reading INT DEFAULT 1,
    daily_goal_review INT DEFAULT 5,
    metadata JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_els_prefs_user_id (user_id),
    KEY idx_els_prefs_selected_library (selected_library_id),
    KEY idx_els_prefs_selected_notebook (selected_notebook_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `-- 外键定义（DDL-DRAFT.sql 中已声明，Service 层实现逻辑约束）:
     -- CONSTRAINT fk_els_prefs_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`,
];

const DDL_EXECUTABLE = DDL_TABLES.filter((ddl) => !ddl.startsWith('--'));

async function check(sequelize) {
  try {
    const [results] = await sequelize.query(
      "SHOW TABLES LIKE 'app_els_%'"
    );
    return results.length === 0;
  } catch (error) {
    console.error('ELS migration check error:', error);
    return false;
  }
}

async function up(sequelize) {
  console.log('ELS migration: Creating tables...');
  console.log('Note: Foreign keys are defined in DDL-DRAFT.sql, Service layer implements logical constraints');
  
  for (const ddl of DDL_EXECUTABLE) {
    try {
      await sequelize.query(ddl);
      console.log('ELS migration: Created table successfully');
    } catch (error) {
      console.error('ELS migration: Error creating table:', error.message);
      throw error;
    }
  }
  
  console.log('ELS migration: All 7 tables created successfully');
}

async function down(sequelize) {
  console.log('ELS migration: Dropping tables...');
  
  const tables = [
    'app_els_user_preferences',
    'app_els_user_study_days',
    'app_els_user_reviews',
    'app_els_user_words',
    'app_els_materials',
    'app_els_notebooks',
    'app_els_libraries',
  ];
  
  for (const table of tables) {
    try {
      await sequelize.query(`DROP TABLE IF EXISTS ${table}`);
      console.log(`ELS migration: Dropped ${table}`);
    } catch (error) {
      console.error(`ELS migration: Error dropping ${table}:`, error.message);
    }
  }
  
  console.log('ELS migration: All tables dropped');
}

export default { check, up, down };