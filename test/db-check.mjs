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
  
  // 查询所有专家
  const [experts] = await conn.query('SELECT id, name FROM experts WHERE is_active = 1');
  console.log('活跃专家:', experts);
  
  // 查询所有技能
  const [skills] = await conn.query('SELECT id, name, source_type, source_path FROM skills WHERE is_active = 1');
  console.log('\n活跃技能:', skills);
  
  // 查询专家技能关联
  const [expertSkills] = await conn.query(`
    SELECT es.expert_id, es.skill_id, es.is_enabled, s.name as skill_name
    FROM expert_skills es
    JOIN skills s ON es.skill_id = s.id
  `);
  console.log('\n专家技能关联:', expertSkills);
  
  // 查询 skill_tools 表
  const [tools] = await conn.query(`
    SELECT st.id, st.skill_id, st.name, s.name as skill_name
    FROM skill_tools st
    JOIN skills s ON st.skill_id = s.id
    LIMIT 10
  `);
  console.log('\n技能工具 (前10):', tools);
  
  await conn.end();
}

test().catch(e => {
  console.error('错误:', e);
  process.exit(1);
});
