/**
 * 技能执行脚本 - 开发调试专用
 *
 * ⚠️ 注意：此脚本仅用于本地开发调试，不是生产环境的运行时验证入口。
 *
 * 生产环境验证请使用：tests/skill-runtime/run-skill-real.js
 *
 * 使用方法：
 * node tests/skill-runtime/run-skill-dev.js <skill名称> <工具名称> [参数]
 *
 * 示例：
 * node tests/skill-runtime/run-skill-dev.js xlsx excel_read --path=test.xlsx
 *
 * 环境变量：
 * - API_BASE: API 地址，默认 http://localhost:3017
 * - USER_ACCESS_TOKEN: 用户访问令牌（可选，脚本会自动生成管理员 token）
 * - JWT_SECRET: JWT 密钥，默认 your-secret-key-change-in-production
 *
 * 与生产环境的区别：
 * 1. 使用简化的 VM 沙箱（不完全模拟 skill-runner 的安全限制）
 * 2. 自动注入管理员权限
 * 3. 相对路径解析到 cwd，不验证沙箱边界
 */

import path from 'path';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';

import { createDevSandbox } from './vm-sandbox.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:3017';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
let USER_ACCESS_TOKEN = process.env.USER_ACCESS_TOKEN || '';

const skillName = process.argv[2];
const toolName = process.argv[3];

if (!skillName || !toolName) {
  console.error('❌ 请提供技能名称和工具名称');
  console.log('\n使用方法:');
  console.log('  node tests/skill-runtime/run-skill-dev.js <skill名称> <工具名称> [参数]');
  console.log('\n示例:');
  console.log('  node tests/skill-runtime/run-skill-dev.js xlsx excel_read --path=test.xlsx');
  console.log('\n可用的技能目录:');
  listAvailableSkills();
  process.exit(1);
}

function listAvailableSkills() {
  const fs = require('fs');
  const skillsDir = path.join(process.cwd(), 'data', 'skills');
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skills = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const skillPath = path.join(skillsDir, e.name);
        const indexPath = path.join(skillPath, 'index.js');
        const hasIndex = fs.existsSync(indexPath);
        return `  - ${e.name}${hasIndex ? ' ✅' : ' ❌'}`;
      });
    console.log(skills.join('\n'));
  } catch (error) {
    console.log('  (无法读取技能目录)');
  }
}

function parseArgs(args) {
  const params = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 2) {
        const key = arg.substring(2, eqIndex);
        let value = arg.substring(eqIndex + 1);
        if ((value.startsWith('[') && value.endsWith(']')) ||
            (value.startsWith('{') && value.endsWith('}'))) {
          try { value = JSON.parse(value); } catch (e) {}
        } else if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (value === 'null') value = null;
        else if (!isNaN(Number(value)) && value !== '') value = Number(value);
        else if ((value.startsWith('"') && value.endsWith('"')) ||
                 (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        params[key] = value;
      } else {
        params[arg.substring(2)] = true;
      }
    }
  }
  return params;
}

function generateAdminToken() {
  const adminUserId = 'c464d6d1e06b5d5d05c4';
  const adminRole = 'admin';
  return jwt.sign({ userId: adminUserId, role: adminRole }, JWT_SECRET, { expiresIn: '1h' });
}

async function loadSkillParameters(skillName) {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME || 'touwaka_mate',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  };
  
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.query(`
      SELECT param_name, param_value 
      FROM skill_parameters 
      WHERE skill_id = ? OR skill_id IN (SELECT id FROM skills WHERE name = ?)
    `, [skillName, skillName]);
    
    if (rows.length > 0) {
      console.log(`📦 从数据库加载 ${rows.length} 个技能参数`);
      for (const row of rows) {
        let value = row.param_value;
        if (value && value.startsWith('${') && value.endsWith('}')) {
          const envKey = value.slice(2, -1);
          value = process.env[envKey] || '';
        }
        const envVarName = `SKILL_${row.param_name.toUpperCase()}`;
        process.env[envVarName] = value;
        process.env[row.param_name] = value;
        console.log(`   - ${envVarName}: ${value ? '✅' : '❌'}`);
      }
    }
  } catch (error) {
    console.warn(`⚠️  加载技能参数失败: ${error.message}`);
  } finally {
    if (connection) await connection.end();
  }
}

async function main() {
  try {
    console.log('🔧 技能执行工具 (开发调试专用)');
    console.log('='.repeat(50));
    console.log(`📌 技能: ${skillName}`);
    console.log(`📌 工具: ${toolName}`);
    
    const rawArgs = process.argv.slice(4);
    const params = parseArgs(rawArgs);
    console.log(`📌 参数: ${JSON.stringify(params)}`);
    console.log('='.repeat(50));
    
    if (!USER_ACCESS_TOKEN) {
      console.log('\n🔑 未提供 USER_ACCESS_TOKEN，生成管理员令牌...');
      USER_ACCESS_TOKEN = generateAdminToken();
      console.log('   ✅ 已生成管理员令牌');
    }
    
    await loadSkillParameters(skillName);
    
    process.env.API_BASE = API_BASE;
    process.env.USER_ACCESS_TOKEN = USER_ACCESS_TOKEN;
    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
    
    // 使用 vm-sandbox.js 创建开发���箱
    const sandbox = createDevSandbox();
    console.log('\n📦 加载技能模块...');
    
    const skillModule = sandbox.loadSkill(skillName);
    
    if (typeof skillModule.execute !== 'function') {
      console.error('❌ 技能模块没有 execute 函数');
      process.exit(1);
    }
    
    if (typeof skillModule.getTools === 'function') {
      const tools = skillModule.getTools();
      const toolNames = tools.map(t => t.name);
      console.log(`\n📋 可用工具: ${toolNames.join(', ')}`);
    }
    
    console.log('\n🚀 执行工具...');
    console.time('执行耗时');
    
    const result = await sandbox.execute(skillModule, toolName, params, {
      apiBase: API_BASE,
      accessToken: USER_ACCESS_TOKEN,
    });
    
    console.timeEnd('执行耗时');
    
    console.log('\n📊 执行结果:');
    console.log('='.repeat(50));
    console.log(JSON.stringify(result, null, 2));
    console.log('='.repeat(50));

    // R2-8：工具契约返回裸对象，不强制要求 success 字段
    // 没有 throw = 执行成功
    console.log('✅ 执行成功');

  } catch (error) {
    console.error('\n❌ 执行失败:', error.message);
    if (error.stack) {
      console.error('\n堆栈跟踪:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
