/**
 * 从 skills-data.json 初始化技能数据到数据库
 * 会先清空 skills, skill_tools, skill_parameters 表，然后导入 JSON 数据
 * 
 * 运行: node scripts/init-skills-from-json.js
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

async function initSkills() {
  // 读取导出的数据
  const dataPath = path.join(__dirname, 'skills-data.json');
  
  if (!fs.existsSync(dataPath)) {
    console.error('❌ skills-data.json 文件不存在');
    console.log('请先运行 export-skills-data.js 导出数据');
    process.exit(1);
  }
  
  const rawData = fs.readFileSync(dataPath, 'utf-8');
  const data = JSON.parse(rawData);
  
  const conn = await mysql.createConnection(DB_CONFIG);
  
  try {
    console.log('🗑️  清空技能相关表...');
    
    // 禁用外键检查，以便清空表
    await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
    
    // 清空表（按依赖顺序）
    await conn.execute('TRUNCATE TABLE skill_parameters');
    await conn.execute('TRUNCATE TABLE skill_tools');
    await conn.execute('TRUNCATE TABLE skills');
    
    // 重新启用外键检查
    await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
    
    console.log('  ✓ 表已清空');
    
    console.log(`\n📦 导入 ${data.skills.length} 个技能...`);
    
    // 插入技能
    for (const skill of data.skills) {
      await conn.execute(`
        INSERT INTO skills (id, name, description, version, author, tags, source_type, source_path,
                           source_url, skill_md, security_score, security_warnings, license,
                           argument_hint, disable_model_invocation, user_invocable, allowed_tools, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        skill.id, skill.name, skill.description, skill.version, skill.author,
        JSON.stringify(skill.tags), skill.source_type, skill.source_path,
        skill.source_url, skill.skill_md, skill.security_score, 
        skill.security_warnings ? JSON.stringify(skill.security_warnings) : null,
        skill.license, skill.argument_hint, skill.disable_model_invocation ? 1 : 0,
        skill.user_invocable ? 1 : 0, skill.allowed_tools, skill.is_active ? 1 : 0
      ]);
    }
    console.log(`  ✓ ${data.skills.length} 个技能已导入`);
    
    // 插入工具
    console.log(`\n🔧 导入 ${data.tools.length} 个工具...`);
    for (const tool of data.tools) {
      await conn.execute(`
        INSERT INTO skill_tools (id, skill_id, name, description, parameters, script_path, is_resident)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        tool.id, tool.skill_id, tool.name, tool.description,
        JSON.stringify(tool.parameters), tool.script_path || 'index.js', tool.is_resident ? 1 : 0
      ]);
    }
    console.log(`  ✓ ${data.tools.length} 个工具已导入`);
    
    // 插入参数
    console.log(`\n⚙️  导入 ${data.parameters.length} 个参数...`);
    for (const param of data.parameters) {
      await conn.execute(`
        INSERT INTO skill_parameters (id, skill_id, param_name, param_value, is_secret, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        param.id, param.skill_id, param.param_name, param.param_value, 
        param.is_secret ? 1 : 0, param.description || null
      ]);
    }
    console.log(`  ✓ ${data.parameters.length} 个参数已导入`);
    
    console.log('\n✅ 技能数据导入完成！');
    console.log('\n💡 提示: 参数值已留空，请在管理后台或通过环境变量配置实际值');
    
  } finally {
    await conn.end();
  }
}

// 检查环境变量
if (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database) {
  console.error('Error: DB_USER, DB_PASSWORD, DB_NAME environment variables are required');
  process.exit(1);
}

initSkills().catch(err => {
  console.error('导入失败:', err.message);
  process.exit(1);
});