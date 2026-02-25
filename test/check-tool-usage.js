const mysql = require('mysql2/promise');
const fs = require('fs');
const dbConfig = JSON.parse(fs.readFileSync('./config/database.json', 'utf8'));

(async () => {
  const conn = await mysql.createConnection({
    host: dbConfig.development.host,
    user: dbConfig.development.username,
    password: dbConfig.development.password,
    database: dbConfig.development.database
  });
  
  const [rows] = await conn.execute('SELECT * FROM skill_tools WHERE skill_id = ?', ['mm1ohcedgjw66943firi']);
  console.log('Found', rows.length, 'tools');
  console.log(JSON.stringify(rows, null, 2));
  
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
