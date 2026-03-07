/**
 * Migration: Fix and update model_type field
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

    const modelTypeExists = await hasColumn(connection, 'ai_models', 'model_type');

    if (modelTypeExists) {
      // Drop the existing column and recreate with correct ENUM values
      console.log('Dropping old model_type column...');
      await connection.execute(`
        ALTER TABLE ai_models DROP COLUMN model_type
      `);
    }

    console.log('Adding new model_type column with correct ENUM values...');
    await connection.execute(`
      ALTER TABLE ai_models
      ADD COLUMN model_type ENUM('chat', 'embedding', 'image', 'audio') DEFAULT 'chat'
      COMMENT '模型类型: chat=对话, embedding=向量化, image=图像, audio=语音'
      AFTER model_name
    `);

    // Add index
    try {
      await connection.execute(`
        CREATE INDEX idx_model_type ON ai_models(model_type)
      `);
      console.log('Index added');
    } catch (e) {
      if (!e.message.includes('Duplicate')) {
        throw e;
      }
      console.log('Index already exists');
    }

    // Update embedding models based on name patterns
    console.log('Identifying embedding models...');
    const [result] = await connection.execute(`
      UPDATE ai_models
      SET model_type = 'embedding'
      WHERE model_name LIKE '%embedding%'
         OR model_name LIKE '%embed%'
         OR model_name LIKE 'text-embedding%'
    `);
    console.log(`Updated ${result.affectedRows} embedding models`);

    // Verify
    const [models] = await connection.execute(`
      SELECT id, name, model_name, model_type FROM ai_models
    `);

    console.log('\nCurrent models:');
    models.forEach(m => {
      console.log(`  - ${m.name} (${m.model_name}): ${m.model_type}`);
    });

    console.log('\n✅ Migration completed successfully!');

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
