/**
 * 数据库字符集修复脚本
 * 将所有表和字段转换为 utf8mb4_unicode_ci
 * 
 * 使用方法：node scripts/fix-charset.js
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
  multipleStatements: true,  // 允许多语句执行
};

const TARGET_CHARSET = 'utf8mb4';
const TARGET_COLLATION = 'utf8mb4_unicode_ci';

/**
 * 获取数据库当前字符集
 */
async function getDatabaseCharset(connection) {
  const [rows] = await connection.execute(`
    SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
    FROM INFORMATION_SCHEMA.SCHEMATA
    WHERE SCHEMA_NAME = ?
  `, [DB_CONFIG.database]);
  
  return rows[0] || {};
}

/**
 * 获取所有表的字符集
 */
async function getTableCharsets(connection) {
  const [rows] = await connection.execute(`
    SELECT 
      TABLE_NAME,
      TABLE_COLLATION
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
  `, [DB_CONFIG.database]);
  
  return rows;
}

/**
 * 获取所有文本列的字符集
 */
async function getColumnCharsets(connection) {
  const [rows] = await connection.execute(`
    SELECT 
      TABLE_NAME,
      COLUMN_NAME,
      CHARACTER_SET_NAME,
      COLLATION_NAME,
      COLUMN_TYPE,
      IS_NULLABLE,
      COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ?
      AND CHARACTER_SET_NAME IS NOT NULL
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `, [DB_CONFIG.database]);
  
  return rows;
}

/**
 * 获取所有外键约束
 */
async function getForeignKeys(connection) {
  const [rows] = await connection.execute(`
    SELECT 
      CONSTRAINT_NAME,
      TABLE_NAME,
      COLUMN_NAME,
      REFERENCED_TABLE_NAME,
      REFERENCED_COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = ?
      AND REFERENCED_TABLE_NAME IS NOT NULL
  `, [DB_CONFIG.database]);
  
  return rows;
}

/**
 * 修改数据库默认字符集
 */
async function alterDatabaseCharset(connection) {
  console.log(`\n📦 修改数据库默认字符集...`);
  await connection.execute(`
    ALTER DATABASE \`${DB_CONFIG.database}\`
    CHARACTER SET ${TARGET_CHARSET}
    COLLATE ${TARGET_COLLATION}
  `);
  console.log(`  ✅ 数据库默认字符集已修改为 ${TARGET_COLLATION}`);
}

/**
 * 主函数
 */
async function fixCharset() {
  let connection;

  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log(`🔗 已连接数据库: ${DB_CONFIG.database}\n`);

    // 1. 检查数据库级别字符集
    console.log('🔍 检查数据库字符集...');
    const dbCharset = await getDatabaseCharset(connection);
    console.log(`  当前: ${dbCharset.DEFAULT_CHARACTER_SET_NAME} / ${dbCharset.DEFAULT_COLLATION_NAME}`);

    // 2. 检查表级别字符集
    console.log('\n🔍 检查表字符集...');
    const tables = await getTableCharsets(connection);
    
    const tablesNeedingFix = [];
    for (const table of tables) {
      const collation = table.TABLE_COLLATION || 'NULL';
      const needsFix = collation !== TARGET_COLLATION;
      console.log(`  ${table.TABLE_NAME}: ${collation}${needsFix ? ' ⚠️' : ' ✅'}`);
      if (needsFix) {
        tablesNeedingFix.push(table.TABLE_NAME);
      }
    }

    if (tablesNeedingFix.length === 0) {
      console.log('\n✅ 所有字符集已正确设置为 utf8mb4_unicode_ci，无需修复！');
      return;
    }

    console.log(`\n📊 需要修复: ${tablesNeedingFix.length} 个表`);

    // 3. 获取所有外键
    console.log('\n🔍 获取外键约束...');
    const foreignKeys = await getForeignKeys(connection);
    console.log(`  找到 ${foreignKeys.length} 个外键约束`);

    // 4. 禁用外键检查并转换
    console.log('\n🔧 开始修复表字符集...');
    
    // 使用 query 方法执行多语句
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    // 修改数据库默认字符集
    await alterDatabaseCharset(connection);

    // 获取所有需要修改的列
    const columns = await getColumnCharsets(connection);
    
    // 按表分组
    const columnsByTable = {};
    for (const col of columns) {
      if (!columnsByTable[col.TABLE_NAME]) {
        columnsByTable[col.TABLE_NAME] = [];
      }
      columnsByTable[col.TABLE_NAME].push(col);
    }

    // 逐表修改
    for (const tableName of tablesNeedingFix) {
      const tableColumns = columnsByTable[tableName] || [];
      if (tableColumns.length === 0) continue;

      console.log(`  修复表: ${tableName}...`);
      
      try {
        // 先修改表的默认字符集
        await connection.execute(`
          ALTER TABLE \`${tableName}\`
          DEFAULT CHARACTER SET ${TARGET_CHARSET}
          COLLATE ${TARGET_COLLATION}
        `);

        // 逐列修改
        for (const col of tableColumns) {
          const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
          const defaultVal = col.COLUMN_DEFAULT !== null ? `DEFAULT '${col.COLUMN_DEFAULT}'` : '';
          
          // 跳过 ENUM 和 SET 类型（它们有自己的字符集处理方式）
          if (col.COLUMN_TYPE.toUpperCase().startsWith('ENUM') || 
              col.COLUMN_TYPE.toUpperCase().startsWith('SET')) {
            // 对于 ENUM/SET，需要保留类型定义但修改字符集
            await connection.execute(`
              ALTER TABLE \`${tableName}\`
              MODIFY COLUMN \`${col.COLUMN_NAME}\` ${col.COLUMN_TYPE}
              CHARACTER SET ${TARGET_CHARSET} COLLATE ${TARGET_COLLATION}
              ${nullable}
            `);
          } else {
            // 对于普通文本列
            await connection.execute(`
              ALTER TABLE \`${tableName}\`
              MODIFY COLUMN \`${col.COLUMN_NAME}\` ${col.COLUMN_TYPE}
              CHARACTER SET ${TARGET_CHARSET} COLLATE ${TARGET_COLLATION}
              ${nullable}
            `);
          }
        }
        
        console.log(`    ✅ ${tableName} 已转换`);
      } catch (err) {
        console.error(`    ❌ ${tableName} 转换失败: ${err.message}`);
      }
    }

    // 重新启用外键检查
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    // 5. 验证修复结果
    console.log('\n🔍 验证修复结果...');
    
    const newDbCharset = await getDatabaseCharset(connection);
    console.log(`  数据库: ${newDbCharset.DEFAULT_CHARACTER_SET_NAME} / ${newDbCharset.DEFAULT_COLLATION_NAME}`);

    const newTables = await getTableCharsets(connection);
    let allTablesOk = true;
    let failedTables = [];
    
    for (const table of newTables) {
      if (table.TABLE_COLLATION !== TARGET_COLLATION) {
        console.log(`  ❌ ${table.TABLE_NAME}: ${table.TABLE_COLLATION}`);
        allTablesOk = false;
        failedTables.push(table.TABLE_NAME);
      }
    }
    
    if (allTablesOk) {
      console.log('  所有表字符集正确 ✅');
    } else {
      console.log(`\n  ⚠️ 仍有 ${failedTables.length} 个表未能转换`);
    }

    console.log('\n✅ 字符集修复完成！');

  } catch (error) {
    console.error('❌ 修复失败:', error.message);
    // 确保重新启用外键检查
    if (connection) {
      try {
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      } catch (e) {}
    }
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

// 检查必需的环境变量
if (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database) {
  console.error('❌ 错误: 需要设置 DB_USER, DB_PASSWORD, DB_NAME 环境变量');
  process.exit(1);
}

fixCharset();