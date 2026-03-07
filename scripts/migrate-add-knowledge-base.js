/**
 * Database Migration: Add Knowledge Base Tables
 *
 * 创建知识库相关表：
 * - knowledge_bases: 知识库表
 * - knowledges: 文章表（树状结构）
 * - knowledge_points: 知识点表
 * - knowledge_relations: 知识点关联表
 *
 * 运行方式：node scripts/migrate-add-knowledge-base.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// 知识库图片存储目录
const KB_IMAGES_ROOT = process.env.KB_IMAGES_ROOT || './data/kb-images';

/**
 * 创建知识库表
 */
const CREATE_KNOWLEDGE_BASES_TABLE = `
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  owner_id VARCHAR(32) NOT NULL,
  embedding_model_id VARCHAR(50) COMMENT '关联 ai_models 表',
  embedding_dim INT DEFAULT 1536,
  is_public BOOLEAN DEFAULT FALSE COMMENT '预留，暂不使用',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_kb_owner (owner_id),
  INDEX idx_kb_public (is_public)
) COMMENT='知识库表';
`;

/**
 * 创建文章表（树状结构）
 */
const CREATE_KNOWLEDGES_TABLE = `
CREATE TABLE IF NOT EXISTS knowledges (
  id VARCHAR(20) PRIMARY KEY,
  kb_id VARCHAR(20) NOT NULL,
  parent_id VARCHAR(20) DEFAULT NULL COMMENT '自关联，形成树状结构',
  title VARCHAR(500) NOT NULL,
  summary TEXT COMMENT 'LLM 生成的摘要',
  source_type ENUM('file', 'web', 'manual') DEFAULT 'manual',
  source_url VARCHAR(1000),
  file_path VARCHAR(500) COMMENT '原始文件存储路径',
  status ENUM('pending', 'processing', 'ready', 'failed') DEFAULT 'pending',
  position INT DEFAULT 0 COMMENT '同级排序',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES knowledges(id) ON DELETE CASCADE,
  INDEX idx_knowledge_kb (kb_id),
  INDEX idx_knowledge_parent (parent_id),
  INDEX idx_knowledge_status (status)
) COMMENT='文章表（树状结构）';
`;

/**
 * 创建知识点表
 */
const CREATE_KNOWLEDGE_POINTS_TABLE = `
CREATE TABLE IF NOT EXISTS knowledge_points (
  id VARCHAR(20) PRIMARY KEY,
  knowledge_id VARCHAR(20) NOT NULL,
  title VARCHAR(500),
  content MEDIUMTEXT NOT NULL COMMENT 'Markdown 格式',
  context TEXT COMMENT '上下文信息（用于向量化）',
  embedding VECTOR(1024) COMMENT '向量（1024维）',
  position INT DEFAULT 0,
  token_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (knowledge_id) REFERENCES knowledges(id) ON DELETE CASCADE,
  INDEX idx_kp_knowledge (knowledge_id)
) COMMENT='知识点表';
`;

/**
 * 创建知识点关联表
 */
const CREATE_KNOWLEDGE_RELATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS knowledge_relations (
  id VARCHAR(20) PRIMARY KEY,
  source_id VARCHAR(20) NOT NULL,
  target_id VARCHAR(20) NOT NULL,
  relation_type ENUM('depends_on', 'references', 'related_to', 'contradicts', 'extends', 'example_of') NOT NULL,
  confidence DECIMAL(3,2) DEFAULT 1.00 COMMENT 'LLM 置信度 (0-1)',
  created_by ENUM('llm', 'manual') DEFAULT 'llm',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES knowledge_points(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES knowledge_points(id) ON DELETE CASCADE,
  UNIQUE KEY unique_relation (source_id, target_id, relation_type),
  INDEX idx_kr_source (source_id),
  INDEX idx_kr_target (target_id),
  INDEX idx_kr_type (relation_type)
) COMMENT='知识点关联表';
`;

/**
 * 检查表是否存在
 */
async function hasTable(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [DB_CONFIG.database, tableName]
  );
  return rows.length > 0;
}

/**
 * 迁移主函数
 */
async function migrate() {
  let connection;

  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected to database:', DB_CONFIG.database);

    // 1. 创建 knowledge_bases 表
    console.log('Checking knowledge_bases table...');
    if (await hasTable(connection, 'knowledge_bases')) {
      console.log('  ⏭️ knowledge_bases table already exists, skipping');
    } else {
      await connection.execute(CREATE_KNOWLEDGE_BASES_TABLE);
      console.log('  ✅ knowledge_bases table created');
    }

    // 2. 创建 knowledges 表
    console.log('Checking knowledges table...');
    if (await hasTable(connection, 'knowledges')) {
      console.log('  ⏭️ knowledges table already exists, skipping');
    } else {
      await connection.execute(CREATE_KNOWLEDGES_TABLE);
      console.log('  ✅ knowledges table created');
    }

    // 3. 创建 knowledge_points 表
    console.log('Checking knowledge_points table...');
    if (await hasTable(connection, 'knowledge_points')) {
      console.log('  ⏭️ knowledge_points table already exists, skipping');
    } else {
      await connection.execute(CREATE_KNOWLEDGE_POINTS_TABLE);
      console.log('  ✅ knowledge_points table created');
    }

    // 4. 创建 knowledge_relations 表
    console.log('Checking knowledge_relations table...');
    if (await hasTable(connection, 'knowledge_relations')) {
      console.log('  ⏭️ knowledge_relations table already exists, skipping');
    } else {
      await connection.execute(CREATE_KNOWLEDGE_RELATIONS_TABLE);
      console.log('  ✅ knowledge_relations table created');
    }

    // 5. 创建图片存储目录
    const imagesDir = path.resolve(KB_IMAGES_ROOT);
    try {
      await fs.mkdir(imagesDir, { recursive: true });
      console.log(`  ✅ KB images directory: ${imagesDir}`);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      console.log(`  ✅ KB images directory exists: ${imagesDir}`);
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\n表结构:');
    console.log('  knowledge_bases (知识库)');
    console.log('    └── knowledges (文章，树状结构 via parent_id)');
    console.log('        └── knowledge_points (知识点)');
    console.log('            └── knowledge_relations (知识点语义关联)');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

// 检查必需的环境变量
if (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database) {
  console.error('Error: DB_USER, DB_PASSWORD, DB_NAME environment variables are required');
  process.exit(1);
}

migrate();
