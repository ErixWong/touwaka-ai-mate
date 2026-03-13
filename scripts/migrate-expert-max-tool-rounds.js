/**
 * 迁移脚本：为 experts 表添加 max_tool_rounds 字段
 * 
 * 用法：node scripts/migrate-expert-max-tool-rounds.js
 */

import { Sequelize } from 'sequelize';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载 .env 文件
dotenv.config({ path: join(__dirname, '..', '.env') });

// 数据库配置（从环境变量读取）
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};

// 验证必需的环境变量
if (!dbConfig.database || !dbConfig.user || !dbConfig.password) {
  console.error('❌ Error: DB_NAME, DB_USER, and DB_PASSWORD are required in .env file');
  process.exit(1);
}

async function migrate() {
  const sequelize = new Sequelize(
    dbConfig.database,
    dbConfig.user,
    dbConfig.password,
    {
      host: dbConfig.host,
      port: dbConfig.port,
      dialect: 'mysql',
      logging: false,
    }
  );

  try {
    console.log('连接数据库...');
    console.log(`   Database: ${dbConfig.database}`);
    console.log(`   Host: ${dbConfig.host}:${dbConfig.port}`);
    await sequelize.authenticate();
    console.log('数据库连接成功');

    // 检查字段是否已存在
    const [results] = await sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'experts' 
      AND COLUMN_NAME = 'max_tool_rounds'
    `, {
      replacements: [dbConfig.database]
    });

    if (results.length > 0) {
      console.log('字段 max_tool_rounds 已存在，跳过迁移');
      return;
    }

    // 添加字段
    console.log('添加 max_tool_rounds 字段...');
    await sequelize.query(`
      ALTER TABLE experts 
      ADD COLUMN max_tool_rounds INT DEFAULT NULL 
      COMMENT '最大工具调用轮数（NULL表示使用系统默认，范围 1-50）'
    `);

    console.log('✅ 迁移完成：experts 表已添加 max_tool_rounds 字段');
  } catch (error) {
    console.error('迁移失败:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

migrate();