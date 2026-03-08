/**
 * 列出数据库中所有表
 * 用法: node scripts/list-tables.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

async function listTables() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  console.log(`📊 Database: ${process.env.DB_NAME}\n`);

  try {
    const [tables] = await connection.execute(
      `SELECT TABLE_NAME, TABLE_COMMENT 
       FROM information_schema.tables 
       WHERE table_schema = ? 
       ORDER BY TABLE_NAME`,
      [process.env.DB_NAME]
    );

    console.log(`找到 ${tables.length} 张表:\n`);
    console.log('表名 | 注释');
    console.log('-'.repeat(50));
    
    for (const table of tables) {
      const comment = table.TABLE_COMMENT || '-';
      console.log(`${table.TABLE_NAME.padEnd(25)} | ${comment}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await connection.end();
  }
}

listTables();
