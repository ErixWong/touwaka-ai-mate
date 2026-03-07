/**
 * 迁移脚本：将 messages 表的 content 字段从 TEXT 改为 LONGTEXT
 * 以支持存储包含 base64 图片的多模态消息内容
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

async function migrateContentToLongText() {
  let connection;

  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected to database:', DB_CONFIG.database);

    // 检查当前字段类型
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'messages'
      AND COLUMN_NAME = 'content'
    `);

    if (columns.length === 0) {
      console.error('messages 表或 content 字段不存在');
      process.exit(1);
    }

    console.log('当前 content 字段类型:', columns[0]);

    // 修改字段类型为 LONGTEXT
    await connection.execute(`
      ALTER TABLE messages
      MODIFY COLUMN content LONGTEXT NOT NULL
    `);

    console.log('字段类型已修改为 LONGTEXT');

    // 验证修改
    const [newColumns] = await connection.execute(`
      SELECT COLUMN_NAME, COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'messages'
      AND COLUMN_NAME = 'content'
    `);

    console.log('修改后的字段类型:', newColumns[0]);
    console.log('迁移完成！');

  } catch (error) {
    console.error('迁移失败:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
    process.exit(0);
  }
}

migrateContentToLongText();
