/**
 * 从数据库导出技能数据为初始化脚本
 * 运行: node scripts/export-skills-data.js > scripts/skills-data.json
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

async function exportData() {
  const conn = await mysql.createConnection(DB_CONFIG);
  
  try {
    // 导出技能
    const [skills] = await conn.execute(`
      SELECT id, name, description, version, author, tags, source_type, source_path, 
             source_url, skill_md, security_score, security_warnings, license, 
             argument_hint, disable_model_invocation, user_invocable, allowed_tools, is_active
      FROM skills
      ORDER BY name
    `);
    
    // 导出工具
    const [tools] = await conn.execute(`
      SELECT id, skill_id, name, description, parameters, script_path, is_resident
      FROM skill_tools
      ORDER BY skill_id, name
    `);
    
    // 导出参数
    const [params] = await conn.execute(`
      SELECT id, skill_id, param_name, param_value, is_secret, allow_user_override, description
      FROM skill_parameters
      ORDER BY skill_id, param_name
    `);
    
    const exportData = {
      exportedAt: new Date().toISOString(),
      skills: skills.map(s => ({
        ...s,
        is_active: !!s.is_active?.[0],
        tags: typeof s.tags === 'string' ? JSON.parse(s.tags) : s.tags,
        security_warnings: typeof s.security_warnings === 'string' ? JSON.parse(s.security_warnings) : s.security_warnings,
        disable_model_invocation: !!s.disable_model_invocation,
        user_invocable: !!s.user_invocable,
      })),
      tools: tools.map(t => ({
        ...t,
        is_resident: !!t.is_resident?.[0],
        parameters: typeof t.parameters === 'string' ? JSON.parse(t.parameters) : t.parameters,
      })),
      parameters: params.map(p => ({
          ...p,
          is_secret: !!p.is_secret,
          allow_user_override: !!p.allow_user_override,
        })),
    };
    
    console.log(JSON.stringify(exportData, null, 2));
    
  } finally {
    await conn.end();
  }
}

// 检查环境变量
if (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database) {
  console.error('Error: DB_USER, DB_PASSWORD, DB_NAME environment variables are required');
  process.exit(1);
}

exportData();