/**
 * Database Migration: KB Refactor - Cleanup Legacy Tables
 *
 * 删除旧知识库表结构：
 * - knowledges: 旧知识条目表
 * - knowledge_points: 旧知识点表
 * - knowledge_relations: 旧知识关系表
 *
 * ⚠️ 警告：此操作不可逆！请确保已备份数据并验证新表结构正常工作。
 *
 * 运行方式：node scripts/migrate-kb-cleanup.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import readline from 'readline';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const LEGACY_TABLES = [
  'knowledge_relations',
  'knowledge_points',
  'knowledges',
];

/**
 * 检查表是否存在
 */
async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) as count FROM information_schema.tables 
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  return rows[0].count > 0;
}

/**
 * 获取表行数
 */
async function getTableCount(connection, tableName) {
  try {
    const [rows] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
    return rows[0].count;
  } catch {
    return 0;
  }
}

/**
 * 用户确认
 */
function askConfirmation() {
  // 检查是否有 --force 参数
  if (process.argv.includes('--force') || process.argv.includes('-f')) {
    console.log('Force mode: skipping confirmation.');
    return Promise.resolve(true);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('⚠️  This will permanently delete legacy tables. Continue? (yes/no): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

/**
 * 执行清理
 */
async function cleanup() {
  let connection;
  
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected successfully.\n');

    // 显示将要删除的表信息
    console.log('Legacy tables to be dropped:');
    console.log('================================');
    
    const tablesToDrop = [];
    for (const table of LEGACY_TABLES) {
      const exists = await tableExists(connection, table);
      if (exists) {
        const count = await getTableCount(connection, table);
        console.log(`  - ${table}: ${count} rows`);
        tablesToDrop.push(table);
      } else {
        console.log(`  - ${table}: (not exists)`);
      }
    }
    console.log('');

    if (tablesToDrop.length === 0) {
      console.log('No legacy tables found. Nothing to clean up.');
      return;
    }

    // 确认删除
    const confirmed = await askConfirmation();
    if (!confirmed) {
      console.log('Cleanup cancelled.');
      return;
    }

    // 删除表（按依赖顺序）
    console.log('\nDropping tables...');
    for (const table of tablesToDrop) {
      console.log(`  Dropping ${table}...`);
      await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
      console.log(`  ✓ ${table} dropped.`);
    }

    console.log('\n========================================');
    console.log('Cleanup completed successfully!');
    console.log('========================================');
    console.log('\nDropped tables:');
    tablesToDrop.forEach(t => console.log(`  - ${t}`));
    console.log('\nNew KB structure is now the only structure in use.');

  } catch (error) {
    console.error('Cleanup failed:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 运行清理
cleanup().catch(console.error);
