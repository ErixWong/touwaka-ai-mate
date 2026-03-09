/**
 * Migration: Add context column to kb_paragraphs or knowledge_points table
 *
 * 用途：为知识点段落添加上下文字段，便于语义检索
 * 生成原则：用一两句话总结该知识点及其所在文章（中文）
 *
 * 注意：系统可能使用旧表名（knowledge_points）或新表名（kb_paragraphs）
 * 此脚本会自动检测并添加字段
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

async function hasColumn(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_CONFIG.database, tableName, columnName]
  );
  return rows.length > 0;
}

async function hasTable(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [DB_CONFIG.database, tableName]
  );
  return rows.length > 0;
}

async function migrate() {
  let connection;

  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected to database:', DB_CONFIG.database);

    // 检查并迁移 knowledge_points（旧表）
    if (await hasTable(connection, 'knowledge_points')) {
      const contextExists = await hasColumn(connection, 'knowledge_points', 'context');
      if (contextExists) {
        console.log('✅ knowledge_points.context already exists. Skipping.');
      } else {
        console.log('Adding context column to knowledge_points table...');
        await connection.execute(`
          ALTER TABLE knowledge_points
          ADD COLUMN context TEXT NULL
          COMMENT '知识点上下文，用于语义检索。用一两句话总结该知识点及其所在文章（中文）'
          AFTER content
        `);
        console.log('✅ knowledge_points migration completed.');
      }
    }

    // 检查并迁移 kb_paragraphs（新表）
    if (await hasTable(connection, 'kb_paragraphs')) {
      const contextExists = await hasColumn(connection, 'kb_paragraphs', 'context');
      if (contextExists) {
        console.log('✅ kb_paragraphs.context already exists. Skipping.');
      } else {
        console.log('Adding context column to kb_paragraphs table...');
        await connection.execute(`
          ALTER TABLE kb_paragraphs
          ADD COLUMN context TEXT NULL
          COMMENT '知识点上下文，用于语义检索。用一两句话总结该知识点及其所在文章（中文）'
          AFTER content
        `);
        console.log('✅ kb_paragraphs migration completed.');
      }
    }

    console.log('✅ All migrations completed successfully!');

  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

migrate();
