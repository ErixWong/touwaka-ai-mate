/**
 * 数据库查询脚本 - 用于调试和数据比对
 * 
 * 使用方法：
 * node tests/db-query.js <表名> [选项]
 * 
 * 示例：
 * # 查看所有表
 * node tests/db-query.js --tables
 * 
 * # 查询知识库列表
 * node tests/db-query.js knowledge_bases
 * 
 * # 查询文章，限制 10 条
 * node tests/db-query.js kb_articles --limit=10
 * 
 * # 查询特定文章的节
 * node tests/db-query.js kb_sections --where="article_id=xxx"
 * 
 * # 执行原始 SQL
 * node tests/db-query.js --sql="SELECT * FROM kb_articles LIMIT 5"
 * 
 * # 统计表记录数
 * node tests/db-query.js kb_articles --count
 * 
 * # 查看表结构
 * node tests/db-query.js kb_articles --schema
 * 
 * 环境变量：
 * - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD: 数据库连接信息
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 从 .env 文件加载环境变量
function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();
        // 移除引号
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnvFile();

// 数据库配置
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  database: process.env.DB_NAME || 'touwaka_mate',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};

// 解析命令行参数
const args = process.argv.slice(2);

/**
 * 解析参数
 */
function parseArgs(args) {
  const params = {
    table: null,
    where: null,
    limit: 20,
    offset: 0,
    order: null,
    count: false,
    schema: false,
    tables: false,
    sql: null,
    format: 'table',
    fields: null,
  };
  
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 2) {
        const key = arg.substring(2, eqIndex);
        const value = arg.substring(eqIndex + 1);
        switch (key) {
          case 'where':
            params.where = value;
            break;
          case 'limit':
            params.limit = parseInt(value);
            break;
          case 'offset':
            params.offset = parseInt(value);
            break;
          case 'order':
            params.order = value;
            break;
          case 'format':
            params.format = value;
            break;
          case 'fields':
            params.fields = value.split(',').map(f => f.trim());
            break;
          case 'sql':
            params.sql = value;
            break;
        }
      } else {
        const flag = arg.substring(2);
        switch (flag) {
          case 'count':
            params.count = true;
            break;
          case 'schema':
            params.schema = true;
            break;
          case 'tables':
            params.tables = true;
            break;
          case 'json':
            params.format = 'json';
            break;
        }
      }
    } else if (!arg.startsWith('-')) {
      params.table = arg;
    }
  }
  
  return params;
}

/**
 * 格式化表格输出
 */
function formatTable(rows, fields = null) {
  if (!rows || rows.length === 0) {
    return '(空结果)';
  }
  
  // 获取所有字段
  const allFields = fields || Object.keys(rows[0]);
  
  // 计算每列最大宽度
  const widths = {};
  for (const field of allFields) {
    widths[field] = field.length;
    for (const row of rows) {
      const value = formatValue(row[field]);
      widths[field] = Math.max(widths[field], value.length);
    }
  }
  
  // 限制最大宽度
  const maxWidth = 50;
  for (const field of allFields) {
    widths[field] = Math.min(widths[field], maxWidth);
  }
  
  // 构建表头
  const header = allFields.map(f => f.padEnd(widths[f])).join(' | ');
  const separator = allFields.map(f => '-'.repeat(widths[f])).join('-+-');
  
  // 构建行
  const formattedRows = rows.map(row => {
    return allFields.map(f => {
      const value = formatValue(row[f]);
      if (value.length > widths[f]) {
        return value.substring(0, widths[f] - 3) + '...';
      }
      return value.padEnd(widths[f]);
    }).join(' | ');
  });
  
  return [header, separator, ...formattedRows].join('\n');
}

/**
 * 格式化值
 */
function formatValue(value) {
  if (value === null) return 'NULL';
  if (value === undefined) return 'UNDEF';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * 主函数
 */
async function main() {
  const params = parseArgs(args);
  
  console.log('🔧 数据库查询工具');
  console.log('='.repeat(60));
  console.log(`📌 数据库: ${dbConfig.database}@${dbConfig.host}:${dbConfig.port}`);
  console.log(`📌 用户: ${dbConfig.user}`);
  console.log('='.repeat(60));
  
  let connection;
  
  try {
    // 连接数据库
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功\n');
    
    // 列出所有表
    if (params.tables) {
      console.log('📋 数据库表列表:');
      const [tables] = await connection.query(`
        SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, CREATE_TIME 
        FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME
      `, [dbConfig.database]);
      
      if (tables.length > 0) {
        console.log(formatTable(tables.map(t => ({
          表名: t.TABLE_NAME,
          行数: t.TABLE_ROWS || 0,
          大小: formatBytes(t.DATA_LENGTH || 0),
          创建时间: t.CREATE_TIME,
        }))));
      } else {
        console.log('(无表)');
      }
      return;
    }
    
    // 执行原始 SQL
    if (params.sql) {
      console.log(`📝 执行 SQL: ${params.sql}\n`);
      const [rows] = await connection.query(params.sql);
      
      if (Array.isArray(rows)) {
        console.log(`📊 结果: ${rows.length} 行\n`);
        if (params.format === 'json') {
          console.log(JSON.stringify(rows, null, 2));
        } else {
          console.log(formatTable(rows));
        }
      } else {
        console.log('📊 结果:', rows);
      }
      return;
    }
    
    // 检查表名
    if (!params.table) {
      console.error('❌ 请提供表名或使用 --tables 查看所有表');
      console.log('\n使用方法:');
      console.log('  node tests/db-query.js <表名> [选项]');
      console.log('  node tests/db-query.js --tables');
      console.log('  node tests/db-query.js --sql="SELECT ..."');
      process.exit(1);
    }
    
    // 查看表结构
    if (params.schema) {
      console.log(`📋 表结构: ${params.table}\n`);
      const [columns] = await connection.query(`
        SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [dbConfig.database, params.table]);
      
      if (columns.length > 0) {
        console.log(formatTable(columns.map(c => ({
          字段: c.COLUMN_NAME,
          类型: c.COLUMN_TYPE,
          可空: c.IS_NULLABLE,
          键: c.COLUMN_KEY,
          默认值: c.COLUMN_DEFAULT || 'NULL',
          额外: c.EXTRA,
          注释: c.COLUMN_COMMENT,
        }))));
      } else {
        console.log(`❌ 表 ${params.table} 不存在`);
      }
      return;
    }
    
    // 统计记录数
    if (params.count) {
      let sql = `SELECT COUNT(*) as total FROM ${params.table}`;
      if (params.where) {
        sql += ` WHERE ${params.where}`;
      }
      console.log(`📝 执行: ${sql}\n`);
      const [rows] = await connection.query(sql);
      console.log(`📊 记录数: ${rows[0].total}`);
      return;
    }
    
    // 查询表数据
    const fields = params.fields ? params.fields.join(', ') : '*';
    let sql = `SELECT ${fields} FROM ${params.table}`;
    
    if (params.where) {
      sql += ` WHERE ${params.where}`;
    }
    
    if (params.order) {
      sql += ` ORDER BY ${params.order}`;
    }
    
    sql += ` LIMIT ${params.limit}`;
    
    if (params.offset > 0) {
      sql += ` OFFSET ${params.offset}`;
    }
    
    console.log(`📝 执行: ${sql}\n`);
    
    const [rows] = await connection.query(sql);
    
    console.log(`📊 结果: ${rows.length} 行\n`);
    
    if (params.format === 'json') {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log(formatTable(rows));
    }
    
  } catch (error) {
    console.error('\n❌ 查询失败:', error.message);
    if (error.code) {
      console.error(`   错误码: ${error.code}`);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

/**
 * 格式化字节
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

main();