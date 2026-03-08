/**
 * Database Migration: KB Refactor - New Table Structure
 *
 * 创建新知识库表结构：
 * - kb_articles: 文章表
 * - kb_sections: 节表（自指向，无限层级）
 * - kb_paragraphs: 段表
 * - kb_tags: 标签表
 * - kb_article_tags: 文章-标签关联表
 *
 * 运行方式：node scripts/migrate-kb-refactor.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

/**
 * 创建文章表
 */
const CREATE_KB_ARTICLES_TABLE = `
CREATE TABLE IF NOT EXISTS kb_articles (
  id VARCHAR(20) PRIMARY KEY,
  kb_id VARCHAR(20) NOT NULL COMMENT '所属知识库',
  title VARCHAR(500) NOT NULL COMMENT '文章标题',
  summary TEXT COMMENT '文章摘要',
  source_type ENUM('upload', 'url', 'manual') DEFAULT 'manual' COMMENT '来源类型',
  source_url VARCHAR(1000) COMMENT '来源URL',
  file_path VARCHAR(500) COMMENT '本地文件路径',
  status ENUM('pending', 'processing', 'ready', 'error') DEFAULT 'pending' COMMENT '状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  INDEX idx_article_kb (kb_id),
  INDEX idx_article_status (status)
) COMMENT='文章表';
`;

/**
 * 创建节表（自指向，无限层级）
 */
const CREATE_KB_SECTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS kb_sections (
  id VARCHAR(20) PRIMARY KEY,
  article_id VARCHAR(20) NOT NULL COMMENT '所属文章',
  parent_id VARCHAR(20) DEFAULT NULL COMMENT '父节ID（自指向，形成无限层级）',
  title VARCHAR(500) NOT NULL COMMENT '节标题',
  level INT DEFAULT 1 COMMENT '层级深度（1=章, 2=节, 3=小节...）',
  position INT DEFAULT 0 COMMENT '排序位置（同级内的顺序）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES kb_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES kb_sections(id) ON DELETE CASCADE,
  INDEX idx_section_article (article_id),
  INDEX idx_section_parent (parent_id),
  INDEX idx_section_level (level),
  INDEX idx_section_position (position)
) COMMENT='节表（无限层级）';
`;

/**
 * 创建段表
 */
const CREATE_KB_PARAGRAPHS_TABLE = `
CREATE TABLE IF NOT EXISTS kb_paragraphs (
  id VARCHAR(20) PRIMARY KEY,
  section_id VARCHAR(20) NOT NULL COMMENT '所属节',
  title VARCHAR(500) COMMENT '段落标题（可选）',
  content TEXT NOT NULL COMMENT '段落内容',
  is_knowledge_point BOOLEAN DEFAULT FALSE COMMENT '是否是知识点',
  embedding VECTOR(384) COMMENT '向量（只有知识点才向量化）',
  position INT DEFAULT 0 COMMENT '排序位置（同一节内的顺序）',
  token_count INT DEFAULT 0 COMMENT 'Token 数量',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (section_id) REFERENCES kb_sections(id) ON DELETE CASCADE,
  INDEX idx_paragraph_section (section_id),
  INDEX idx_paragraph_kp (is_knowledge_point),
  INDEX idx_paragraph_position (position)
) COMMENT='段表';
`;

/**
 * 创建标签表
 */
const CREATE_KB_TAGS_TABLE = `
CREATE TABLE IF NOT EXISTS kb_tags (
  id VARCHAR(20) PRIMARY KEY,
  kb_id VARCHAR(20) NOT NULL COMMENT '所属知识库',
  name VARCHAR(100) NOT NULL COMMENT '标签名',
  description VARCHAR(500) COMMENT '标签描述',
  article_count INT DEFAULT 0 COMMENT '关联文章数（缓存）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  UNIQUE KEY uk_kb_tag (kb_id, name),
  INDEX idx_tag_kb (kb_id)
) COMMENT='标签表';
`;

/**
 * 创建文章-标签关联表
 */
const CREATE_KB_ARTICLE_TAGS_TABLE = `
CREATE TABLE IF NOT EXISTS kb_article_tags (
  id VARCHAR(20) PRIMARY KEY,
  article_id VARCHAR(20) NOT NULL COMMENT '文章ID',
  tag_id VARCHAR(20) NOT NULL COMMENT '标签ID',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES kb_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES kb_tags(id) ON DELETE CASCADE,
  UNIQUE KEY uk_article_tag (article_id, tag_id),
  INDEX idx_at_article (article_id),
  INDEX idx_at_tag (tag_id)
) COMMENT='文章-标签关联表';
`;

/**
 * 执行迁移
 */
async function migrate() {
  let connection;
  
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected successfully.');

    // 创建 kb_articles 表
    console.log('Creating kb_articles table...');
    await connection.query(CREATE_KB_ARTICLES_TABLE);
    console.log('✓ kb_articles table created.');

    // 创建 kb_sections 表
    console.log('Creating kb_sections table...');
    await connection.query(CREATE_KB_SECTIONS_TABLE);
    console.log('✓ kb_sections table created.');

    // 创建 kb_paragraphs 表
    console.log('Creating kb_paragraphs table...');
    await connection.query(CREATE_KB_PARAGRAPHS_TABLE);
    console.log('✓ kb_paragraphs table created.');

    // 创建 kb_tags 表
    console.log('Creating kb_tags table...');
    await connection.query(CREATE_KB_TAGS_TABLE);
    console.log('✓ kb_tags table created.');

    // 创建 kb_article_tags 表
    console.log('Creating kb_article_tags table...');
    await connection.query(CREATE_KB_ARTICLE_TAGS_TABLE);
    console.log('✓ kb_article_tags table created.');

    console.log('\n========================================');
    console.log('Migration completed successfully!');
    console.log('========================================');
    console.log('\nNew tables created:');
    console.log('  - kb_articles');
    console.log('  - kb_sections');
    console.log('  - kb_paragraphs');
    console.log('  - kb_tags');
    console.log('  - kb_article_tags');
    console.log('\nNote: Legacy tables (knowledges, knowledge_points, knowledge_relations) are preserved.');
    console.log('Run migrate-kb-cleanup.js after verifying the new structure works correctly.');

  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 运行迁移
migrate().catch(console.error);
