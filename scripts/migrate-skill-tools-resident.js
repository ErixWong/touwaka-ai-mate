/**
 * Migration: Add is_resident column to skill_tools table
 * Issue: #82
 * 
 * 为 skill_tools 表添加 is_resident 字段，支持驻留式技能工具
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

async function migrate() {
  let connection;

  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected to database');

    // 检查字段是否已存在
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'skill_tools' 
        AND COLUMN_NAME = 'is_resident'
    `, [DB_CONFIG.database]);

    if (columns.length > 0) {
      console.log('✅ Column is_resident already exists in skill_tools table');
      return;
    }

    // 添加 is_resident 字段
    console.log('Adding is_resident column to skill_tools table...');
    await connection.execute(`
      ALTER TABLE skill_tools 
      ADD COLUMN is_resident BIT(1) DEFAULT b'0' 
      COMMENT '是否驻留进程：0=普通工具（执行后返回），1=驻留工具（持续运行，stdio通信）'
      AFTER script_path
    `);

    console.log('✅ Migration completed successfully!');
    console.log('   - Added: is_resident BIT(1) DEFAULT b\'0\'');

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