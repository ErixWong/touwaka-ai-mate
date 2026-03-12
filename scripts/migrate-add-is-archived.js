/**
 * Database Migration: Add is_archived column to assistant_requests table
 *
 * 运行方式：node scripts/migrate-add-is-archived.js
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
 * 检查列是否存在
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
 * 迁移主函数
 */
async function migrate() {
  let connection;

  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected to database:', DB_CONFIG.database);

    // 检查 assistant_requests 表是否存在
    const [tables] = await connection.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [DB_CONFIG.database, 'assistant_requests']
    );

    if (tables.length === 0) {
      console.log('❌ assistant_requests table does not exist. Run migrate-add-assistants.js first.');
      process.exit(1);
    }

    // 检查 is_archived 列是否已存在
    console.log('Checking is_archived column...');
    if (await hasColumn(connection, 'assistant_requests', 'is_archived')) {
      console.log('  ⏭️ is_archived column already exists, skipping');
    } else {
      await connection.execute(
        `ALTER TABLE assistant_requests 
         ADD COLUMN is_archived INT DEFAULT 0 COMMENT '是否已归档' 
         AFTER completed_at`
      );
      console.log('  ✅ is_archived column added to assistant_requests table');
    }

    console.log('\n✅ Migration completed successfully!');

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