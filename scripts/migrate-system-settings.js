/**
 * 系统配置表迁移脚本
 * 创建 system_settings 表，用于存储系统级配置
 * 
 * 使用方法: node scripts/migrate-system-settings.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

// 默认配置数据
const DEFAULT_SETTINGS = [
  // LLM 默认参数
  { key: 'llm.context_threshold', value: '0.70', type: 'number', desc: '上下文压缩阈值' },
  { key: 'llm.temperature', value: '0.70', type: 'number', desc: '表达温度默认值' },
  { key: 'llm.reflective_temperature', value: '0.30', type: 'number', desc: '反思温度默认值' },
  { key: 'llm.top_p', value: '1.0', type: 'number', desc: 'Top-p 采样默认值' },
  { key: 'llm.frequency_penalty', value: '0.0', type: 'number', desc: '频率惩罚默认值' },
  { key: 'llm.presence_penalty', value: '0.0', type: 'number', desc: '存在惩罚默认值' },
  // Note: max_tokens 不在系统设置中管理，由模型表和专家配置决定
  
  // 连接限制
  { key: 'connection.max_per_user', value: '5', type: 'number', desc: '每用户最大 SSE 连接数' },
  { key: 'connection.max_per_expert', value: '100', type: 'number', desc: '每 Expert 最大 SSE 连接数' },
  
  // Token 配置
  { key: 'token.access_expiry', value: '15m', type: 'string', desc: 'Access Token 过期时间' },
  { key: 'token.refresh_expiry', value: '7d', type: 'string', desc: 'Refresh Token 过期时间' },
  
  // 分页配置
  { key: 'pagination.default_size', value: '20', type: 'number', desc: '默认分页大小' },
  { key: 'pagination.max_size', value: '100', type: 'number', desc: '最大分页大小' },
];

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  console.log('📦 系统配置表迁移脚本');
  console.log('🔗 已连接到数据库');

  try {
    // 创建表
    console.log('\n📋 创建 system_settings 表...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        value_type VARCHAR(20) DEFAULT 'string',
        description VARCHAR(500),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ 表创建成功');

    // 插入默认数据
    console.log('\n📋 插入默认配置数据...');

    let inserted = 0;
    for (const setting of DEFAULT_SETTINGS) {
      const [result] = await connection.execute(
        `INSERT IGNORE INTO system_settings (setting_key, setting_value, value_type, description)
         VALUES (?, ?, ?, ?)`,
        [setting.key, setting.value, setting.type, setting.desc]
      );
      if (result.affectedRows > 0) {
        inserted++;
        console.log(`  ✅ ${setting.key} = ${setting.value}`);
      }
    }

    console.log(`\n📊 插入 ${inserted} 条新配置，${DEFAULT_SETTINGS.length - inserted} 条已存在`);

    // 验证
    const [rows] = await connection.execute('SELECT COUNT(*) as count FROM system_settings');
    console.log(`\n✅ 迁移完成！当前共有 ${rows[0].count} 条系统配置`);
  } catch (error) {
    console.error('❌ 迁移失败:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

migrate();
