/**
 * 将历史 auto_backfill + valid + 未定位章节记录迁移为 suspected，恢复人工复核语义。
 *
 * 执行方式：
 *   node apps/standard-mgr/scripts/fix-legacy-backfill-valid.js
 *
 * 依赖环境变量：DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
 * （本仓库根目录无 .env，生产配置在 docker-compose environment 中；
 *  本地执行请先 export 上述变量，指向目标数据库）
 */

import 'dotenv/config';
import Database from '../../../lib/db.js';
import StandardMgrService from '../server/service.js';

const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`缺少数据库环境变量: ${missing.join(', ')}\n请先 export 后重试（参考 server/index.js 的启动配置）。`);
  process.exit(1);
}

const dbConfig = {
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT || '3306', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionLimit: 10,
};

async function main() {
  const db = new Database(dbConfig);

  try {
    await db.connect();
    const service = new StandardMgrService(db);
    const result = await service.migrateLegacyBackfillValid();
    console.log('Legacy backfill migration result:', JSON.stringify(result, null, 2));
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error('Legacy backfill migration failed:', error.message);
  process.exitCode = 1;
});
