/**
 * Migration: Add embedding_dim column to ai_models table
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

async function migrate() {
  let connection;

  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected to database:', DB_CONFIG.database);

    const embeddingDimExists = await hasColumn(connection, 'ai_models', 'embedding_dim');

    if (embeddingDimExists) {
      console.log('✅ Column embedding_dim already exists. Nothing to do.');
      return;
    }

    console.log('Adding embedding_dim column to ai_models table...');
    await connection.execute(`
      ALTER TABLE ai_models
      ADD COLUMN embedding_dim INT NULL
      COMMENT '向量化模型的嵌入维度（仅 embedding 类型模型使用）'
      AFTER max_tokens
    `);

    console.log('✅ Migration completed successfully!');

  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

migrate().catch(console.error);