/**
 * Migration: Update model_type ENUM values
 * 
 * 旧值: 'chat', 'embedding', 'image', 'audio'
 * 新值: 'text', 'multimodal', 'embedding'
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

async function migrate() {
  let connection;

  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected to database:', DB_CONFIG.database);

    // 检查当前 ENUM 类型
    const [rows] = await connection.execute(`
      SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ai_models' AND COLUMN_NAME = 'model_type'
    `, [DB_CONFIG.database]);
    
    console.log('Current COLUMN_TYPE:', rows[0]?.COLUMN_TYPE);

    // 步骤1: 先扩展 ENUM 包含新旧所有值
    console.log('Step 1: Extending ENUM to include both old and new values...');
    await connection.execute(`
      ALTER TABLE ai_models 
      MODIFY COLUMN model_type ENUM('chat', 'embedding', 'image', 'audio', 'text', 'multimodal') DEFAULT 'chat'
      COMMENT '模型类型'
    `);
    console.log('  Done');

    // 步骤2: 更新数据
    console.log('Step 2: Updating data...');
    const [result] = await connection.execute(`
      UPDATE ai_models SET model_type = 'text' WHERE model_type IN ('chat', 'image', 'audio')
    `);
    console.log(`  Updated ${result.affectedRows} rows to 'text'`);

    // 步骤3: 收缩 ENUM 只保留新值
    console.log('Step 3: Shrinking ENUM to new values only...');
    await connection.execute(`
      ALTER TABLE ai_models 
      MODIFY COLUMN model_type ENUM('text', 'multimodal', 'embedding') DEFAULT 'text'
      COMMENT '模型类型: text=文本, multimodal=多模态, embedding=向量化'
    `);

    // 验证
    const [newRows] = await connection.execute(`
      SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ai_models' AND COLUMN_NAME = 'model_type'
    `, [DB_CONFIG.database]);
    
    console.log('New COLUMN_TYPE:', newRows[0]?.COLUMN_TYPE);
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
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