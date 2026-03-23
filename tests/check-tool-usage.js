const mysql = require('mysql2/promise');
require('dotenv').config();

// 验证必填环境变量
const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`数据库配置缺失: ${missing.join(', ')}`);
  console.error('请设置环境变量或在 .env 文件中配置');
  process.exit(1);
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
  
  const [rows] = await conn.execute('SELECT * FROM skill_tools WHERE skill_id = ?', ['mm1ohcedgjw66943firi']);
  console.log('Found', rows.length, 'tools');
  console.log(JSON.stringify(rows, null, 2));
  
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
