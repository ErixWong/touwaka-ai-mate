/**
 * 企业花名册种子脚本
 *
 * 用途：在全新环境或需要初始化示例企业数据时运行，不污染数据库迁移脚本。
 * 行为：幂等，已存在同名企业时仅更新 code_prefixes，不会重复插入。
 *
 * 运行：node scripts/seed-enterprises.mjs
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import Utils from '../lib/utils.js';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const SEED_ENTERPRISES = [
  {
    name: '吉利',
    name_en: 'Geely',
    description: '浙江吉利控股集团',
    code_prefixes: 'Q-JL, Q-JLY, Q/JL, Q/JLY',
  },
  // 如需更多默认企业，在此添加
];

async function seed() {
  const conn = await mysql.createConnection(DB_CONFIG);
  try {
    console.log('🌱 Seeding enterprises...');

    for (const ent of SEED_ENTERPRISES) {
      const [rows] = await conn.execute(
        'SELECT id FROM app_enterprise WHERE name = ?',
        [ent.name]
      );

      if (rows.length > 0) {
        await conn.execute(
          'UPDATE app_enterprise SET code_prefixes = ?, updated_at = NOW() WHERE name = ?',
          [ent.code_prefixes, ent.name]
        );
        console.log(`  ✓ Updated prefixes for ${ent.name}`);
      } else {
        const id = Utils.newID(32);
        await conn.execute(
          `INSERT INTO app_enterprise
             (id, name, name_en, description, is_active, code_prefixes, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, NOW(), NOW())`,
          [id, ent.name, ent.name_en || null, ent.description || null, ent.code_prefixes]
        );
        console.log(`  ✓ Created enterprise ${ent.name} (${id})`);
      }
    }

    console.log('✅ Done');
  } finally {
    await conn.end();
  }
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
