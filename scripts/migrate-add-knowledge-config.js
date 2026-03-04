/**
 * 添加知识库配置字段到专家表
 *
 * 运行方式: node scripts/migrate-add-knowledge-config.js
 */

import 'dotenv/config';
import mysql from 'mysql2/promise';

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'touwaka_mate',
  });

  console.log(`Connected to database: ${process.env.DB_NAME || 'touwaka_mate'}`);

  try {
    // 检查字段是否已存在
    const [columns] = await connection.query(`
      SHOW COLUMNS FROM experts LIKE 'knowledge_config'
    `);

    if (columns.length === 0) {
      console.log('Adding knowledge_config column to experts table...');
      await connection.query(`
        ALTER TABLE experts
        ADD COLUMN knowledge_config TEXT NULL
        COMMENT '知识库配置（JSON格式）：{enabled, kb_id, top_k, threshold, max_tokens, style}'
      `);
      console.log('  ✅ knowledge_config column added');
    } else {
      console.log('  ⏭️ knowledge_config column already exists');
    }

    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

migrate().catch(console.error);