/**
 * 更新数据库中的 API Keys
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

async function updateApiKeys() {
  let connection;
  
  try {
    connection = await mysql.createConnection(DB_CONFIG);

    // 更新 OpenAI
    if (process.env.OPENAI_API_KEY) {
      await connection.execute(
        "UPDATE providers SET api_key = ? WHERE name = 'OpenAI'",
        [process.env.OPENAI_API_KEY]
      );
      console.log('Updated OpenAI API key');
    }

    // 更新 DeepSeek
    if (process.env.DEEPSEEK_API_KEY) {
      await connection.execute(
        "UPDATE providers SET api_key = ? WHERE name = 'DeepSeek'",
        [process.env.DEEPSEEK_API_KEY]
      );
      console.log('Updated DeepSeek API key');
    }

    console.log('API keys updated successfully!');
  } catch (error) {
    console.error('Failed to update API keys:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

if (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database) {
  console.error('Error: DB_USER, DB_PASSWORD, DB_NAME environment variables are required');
  process.exit(1);
}

updateApiKeys();
