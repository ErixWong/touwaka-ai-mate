import Database from '../lib/db.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkKb() {
  // 验证必填环境变量
  const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`数据库配置缺失: ${missing.join(', ')}`);
    console.error('请设置环境变量或在 .env 文件中配置');
    process.exit(1);
  }

  const dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionLimit: 10,
  };
  
  console.log('Connecting to database:', dbConfig.database, 'on', dbConfig.host);
  
  const db = new Database(dbConfig);
  await db.connect();
  
  const result = await db.query(
    'SELECT id, name, owner_id, created_at FROM knowledge_basis ORDER BY created_at DESC'
  );
  
  console.log('Knowledge bases in database:');
  console.log(JSON.stringify(result, null, 2));
  
  process.exit(0);
}

checkKb().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});