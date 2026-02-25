import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'touwaka',
    password: 'erixPwd@2026',
    database: 'touwaka_mate'
  });
  
  // 查询 skill_tools 表的完整记录
  const [tools] = await conn.query(`
    SELECT *
    FROM skill_tools 
    WHERE skill_id = 'mm1ohcedgjw66943firi'
  `);
  
  console.log('Found', tools.length, 'tools for searxng:');
  console.log(JSON.stringify(tools, null, 2));
  
  await conn.end();
}

test().catch(e => {
  console.error('错误:', e);
  process.exit(1);
});
