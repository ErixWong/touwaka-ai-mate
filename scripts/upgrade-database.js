/**
 * Database Upgrade Script
 * 自动检查并添加缺失的表和字段
 * 
 * 运行方式：node scripts/upgrade-database.js
 * 也可以在服务器启动时自动调用
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

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
 * 检查字段是否存在
 */
async function hasColumn(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_CONFIG.database, tableName, columnName]
  );
  return rows.length > 0;
}

/**
 * 迁移定义
 * 每个迁移包含检查函数和执行函数
 */
const MIGRATIONS = [
  // 1. ai_models.model_type
  {
    name: 'ai_models.model_type',
    check: async (conn) => await hasColumn(conn, 'ai_models', 'model_type'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE ai_models
        ADD COLUMN model_type ENUM('chat', 'embedding', 'image', 'audio') DEFAULT 'chat'
        COMMENT '模型类型: chat=对话, embedding=向量化, image=图像, audio=语音'
        AFTER model_name
      `);
      // 添加索引
      try {
        await conn.execute(`CREATE INDEX idx_model_type ON ai_models(model_type)`);
      } catch (e) {
        if (!e.message.includes('Duplicate')) throw e;
      }
    }
  },

  // 2. experts.knowledge_config
  {
    name: 'experts.knowledge_config',
    check: async (conn) => await hasColumn(conn, 'experts', 'knowledge_config'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE experts
        ADD COLUMN knowledge_config TEXT COMMENT '知识库配置（JSON格式）：{enabled, kb_id, top_k, threshold, max_tokens, style}'
        AFTER presence_penalty
      `);
    }
  },

  // 3. messages.content -> LONGTEXT
  {
    name: 'messages.content LONGTEXT',
    check: async (conn) => {
      const [rows] = await conn.execute(
        `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'content'`,
        [DB_CONFIG.database]
      );
      return rows.length > 0 && rows[0].COLUMN_TYPE === 'longtext';
    },
    migrate: async (conn) => {
      await conn.execute(`ALTER TABLE messages MODIFY COLUMN content LONGTEXT NOT NULL`);
    }
  },

  // 4. knowledge_bases 表
  {
    name: 'knowledge_bases table',
    check: async (conn) => await hasTable(conn, 'knowledge_bases'),
    migrate: async (conn) => {
      await conn.execute(`
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
        ) COMMENT='知识库表'
      `);
    }
  },

  // 5. knowledges 表
  {
    name: 'knowledges table',
    check: async (conn) => await hasTable(conn, 'knowledges'),
    migrate: async (conn) => {
      await conn.execute(`
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
        ) COMMENT='文章表（树状结构）'
      `);
    }
  },

  // 6. knowledge_points 表
  {
    name: 'knowledge_points table',
    check: async (conn) => await hasTable(conn, 'knowledge_points'),
    migrate: async (conn) => {
      await conn.execute(`
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
        ) COMMENT='知识点表'
      `);
    }
  },

  // 7. knowledge_relations 表
  {
    name: 'knowledge_relations table',
    check: async (conn) => await hasTable(conn, 'knowledge_relations'),
    migrate: async (conn) => {
      await conn.execute(`
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
        ) COMMENT='知识点关联表'
      `);
    }
  },
];

/**
 * 升级主函数
 */
async function upgrade() {
  let connection;
  const results = {
    applied: [],
    skipped: [],
    failed: []
  };

  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected to database:', DB_CONFIG.database);
    console.log('\n🔍 Checking database schema...\n');

    for (const migration of MIGRATIONS) {
      try {
        const needsMigration = !(await migration.check(connection));
        
        if (needsMigration) {
          console.log(`⏳ Applying: ${migration.name}...`);
          await migration.migrate(connection);
          console.log(`  ✅ Applied: ${migration.name}`);
          results.applied.push(migration.name);
        } else {
          console.log(`  ⏭️  Skipped: ${migration.name} (already exists)`);
          results.skipped.push(migration.name);
        }
      } catch (error) {
        console.error(`  ❌ Failed: ${migration.name} - ${error.message}`);
        results.failed.push({ name: migration.name, error: error.message });
      }
    }

    // 创建图片存储目录
    const imagesDir = path.resolve(KB_IMAGES_ROOT);
    try {
      await fs.mkdir(imagesDir, { recursive: true });
      console.log(`\n📁 KB images directory: ${imagesDir}`);
    } catch (err) {
      if (err.code !== 'EEXIST') {
        console.error(`  ⚠️  Could not create KB images directory: ${err.message}`);
      }
    }

    // 打印摘要
    console.log('\n' + '='.repeat(50));
    console.log('📊 Upgrade Summary:');
    console.log(`  ✅ Applied: ${results.applied.length}`);
    console.log(`  ⏭️  Skipped: ${results.skipped.length}`);
    console.log(`  ❌ Failed:  ${results.failed.length}`);
    
    if (results.applied.length > 0) {
      console.log('\nApplied migrations:');
      results.applied.forEach(name => console.log(`  - ${name}`));
    }
    
    if (results.failed.length > 0) {
      console.log('\nFailed migrations:');
      results.failed.forEach(({ name, error }) => console.log(`  - ${name}: ${error}`));
    }

    console.log('\n✅ Database upgrade completed!\n');

  } catch (error) {
    console.error('❌ Upgrade failed:', error.message);
    throw error;
  } finally {
    if (connection) await connection.end();
  }

  return results;
}

/**
 * 检查是否需要升级（用于服务器启动时自动检查）
 */
async function needsUpgrade() {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    
    for (const migration of MIGRATIONS) {
      const needsMigration = !(await migration.check(connection));
      if (needsMigration) {
        return true;
      }
    }
    return false;
  } finally {
    if (connection) await connection.end();
  }
}

// 检查必需的环境变量
if (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database) {
  console.error('Error: DB_USER, DB_PASSWORD, DB_NAME environment variables are required');
  process.exit(1);
}

// 如果直接运行此脚本，执行升级
// 使用 import.meta.url 检测是否为主模块
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] &&
  path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  upgrade().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

export { upgrade, needsUpgrade, MIGRATIONS };