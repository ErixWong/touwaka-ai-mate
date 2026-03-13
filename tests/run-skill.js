/**
 * 技能执行脚本 - 使用与 skill-runner 相同的 vm 沙箱执行技能
 *
 * 使用方法：
 * node tests/run-skill.js <skill名称> <工具名称> [参数]
 *
 * 示例：
 * # 列出知识库
 * node tests/run-skill.js kb-search list_my_kbs
 *
 * # 搜索知识点
 * node tests/run-skill.js kb-search search --kb_id=xxx --query="测试"
 *
 * # 列出技能
 * node tests/run-skill.js skill-manager list_skills
 *
 * 环境变量：
 * - API_BASE: API 地址，默认 http://localhost:3000
 * - USER_ACCESS_TOKEN: 用户访问令牌（可选，脚本会自动生成管理员 token）
 * - JWT_SECRET: JWT 密钥，默认 your-secret-key-change-in-production
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import url from 'url';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import util from 'util';
import stream from 'stream';
import zlib from 'zlib';
import os from 'os';
import buffer from 'buffer';
import events from 'events';
import string_decoder from 'string_decoder';
import querystring from 'querystring';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载 .env 文件
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// 配置
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
let USER_ACCESS_TOKEN = process.env.USER_ACCESS_TOKEN || '';

// 从命令行参数获取
const skillName = process.argv[2];
const toolName = process.argv[3];

if (!skillName || !toolName) {
  console.error('❌ 请提供技能名称和工具名称');
  console.log('\n使用方法:');
  console.log('  node tests/run-skill.js <skill名称> <工具名称> [参数]');
  console.log('\n示例:');
  console.log('  node tests/run-skill.js kb-search list_my_kbs');
  console.log('  node tests/run-skill.js kb-search search --kb_id=xxx --query="测试"');
  console.log('  node tests/run-skill.js skill-manager list_skills');
  console.log('\n可用的技能目录:');
  listAvailableSkills();
  process.exit(1);
}

/**
 * 列出可用的技能
 */
function listAvailableSkills() {
  const skillsDir = path.join(process.cwd(), 'data', 'skills');
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skills = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const skillPath = path.join(skillsDir, e.name);
        const indexPath = path.join(skillPath, 'index.js');
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        const hasIndex = fs.existsSync(indexPath);
        const hasSkillMd = fs.existsSync(skillMdPath);
        return `  - ${e.name}${hasIndex ? ' ✅' : ' ❌ (无 index.js)'}${hasSkillMd ? '' : ' (无 SKILL.md)'}`;
      });
    console.log(skills.join('\n'));
  } catch (error) {
    console.log('  (无法读取技能目录)');
  }
}

/**
 * 解析命令行参数
 */
function parseArgs(args) {
  const params = {};
  
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 2) {
        const key = arg.substring(2, eqIndex);
        let value = arg.substring(eqIndex + 1);
        
        if (value === 'true') value = true;
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

/**
 * 生成管理员访问令牌
 */
function generateAdminToken() {
  const adminUserId = 'c464d6d1e06b5d5d05c4';  // admin 用户的真实 ID
  const adminRole = 'admin';
  return jwt.sign({ userId: adminUserId, role: adminRole }, JWT_SECRET, { expiresIn: '1h' });
}

/**
 * 从数据库加载技能参数并注入环境变量
 * 与 skill-loader.js 的 buildSkillEnvironment 保持一致：
 * - 参数名会被转换为 SKILL_{PARAM_NAME} 格式的环境变量
 * - 例如：UNIFUNCS_API_KEY -> SKILL_UNIFUNCS_API_KEY
 * @param {string} skillName - 技能名称
 */
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
    
    // 查询技能参数 - 支持两种方式：
    // 1. skill_id 为技能名称（如 'unifuncs-web-reader'）
    // 2. skill_id 为技能 ID（如 'mmoasyw4iar2f9qi4z96'）
    const [rows] = await connection.query(`
      SELECT param_name, param_value 
      FROM skill_parameters 
      WHERE skill_id = ? OR skill_id IN (SELECT id FROM skills WHERE name = ?)
    `, [skillName, skillName]);
    
    if (rows.length > 0) {
      console.log(`📦 从数据库加载 ${rows.length} 个技能参数`);
      for (const row of rows) {
        // 替换环境变量引用
        let value = row.param_value;
        if (value && value.startsWith('${') && value.endsWith('}')) {
          const envKey = value.slice(2, -1);
          value = process.env[envKey] || '';
        }
        
        // 与 skill-loader.js 保持一致：添加 SKILL_ 前缀
        const envVarName = `SKILL_${row.param_name.toUpperCase()}`;
        process.env[envVarName] = value;
        
        // 同时设置无前缀版本（方便本地测试和向后兼容）
        process.env[row.param_name] = value;
        
        console.log(`   - ${envVarName}: ${value ? '✅' : '❌'}`);
      }
    }
  } catch (error) {
    console.warn(`⚠️  加载技能参数失败: ${error.message}`);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

/**
 * 加载技能代码
 */
function loadSkillCode(skillName) {
  const possiblePaths = [
    path.join(process.cwd(), 'data', 'skills', skillName, 'index.js'),
    path.join(process.cwd(), 'data', 'skills', 'installed', skillName, 'index.js'),
  ];
  
  for (const skillPath of possiblePaths) {
    if (fs.existsSync(skillPath)) {
      console.log(`📁 加载技能: ${skillPath}`);
      return fs.readFileSync(skillPath, 'utf-8');
    }
  }
  
  throw new Error(`找不到技能: ${skillName}`);
}

/**
 * 执行技能代码（使用 vm 沙箱）
 */
function executeSkill(code, skillId) {
  // 构建安全的 process.env 副本
  const safeEnv = { ...process.env };
  
  const context = {
    module: { exports: {} },
    exports: {},
    require: (moduleName) => {
      // 白名单模块
      const moduleMap = {
        'fs': fs,
        'path': path,
        'url': url,
        'querystring': querystring,
        'http': http,
        'https': https,
        'crypto': crypto,
        'util': util,
        'stream': stream,
        'zlib': zlib,
        'os': os,
        'buffer': buffer,
        'events': events,
        'string_decoder': string_decoder,
      };
      
      if (moduleMap[moduleName]) {
        return moduleMap[moduleName];
      }
      
      throw new Error(`Module '${moduleName}' is not allowed in sandbox`);
    },
    console: {
      log: (...args) => process.stderr.write(`[${skillId}] ${args.join(' ')}\n`),
      error: (...args) => process.stderr.write(`[${skillId}:ERROR] ${args.join(' ')}\n`),
      warn: (...args) => process.stderr.write(`[${skillId}:WARN] ${args.join(' ')}\n`),
    },
    process: {
      env: safeEnv,
      cwd: () => process.cwd(),
    },
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  
  vm.createContext(context);
  
  try {
    vm.runInContext(code, context, {
      timeout: 10000,
      displayErrors: true,
    });
  } catch (vmError) {
    process.stderr.write(`[test-skill] VM 执行错误: ${vmError.message}\n`);
    throw vmError;
  }
  
  const exports = context.module.exports;
  if (Object.keys(exports).length === 0 && Object.keys(context.exports).length > 0) {
    return context.exports;
  }
  
  return exports;
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log('🔧 技能执行工具');
    console.log('='.repeat(50));
    console.log(`📌 技能: ${skillName}`);
    console.log(`📌 工具: ${toolName}`);
    
    // 解析参数
    const rawArgs = process.argv.slice(4);
    const params = parseArgs(rawArgs);
    
    console.log(`📌 参数: ${JSON.stringify(params)}`);
    console.log('='.repeat(50));
    
    // 如果没有提供 token，生成管理员 token
    if (!USER_ACCESS_TOKEN) {
      console.log('\n🔑 未提供 USER_ACCESS_TOKEN，生成管理员令牌...');
      USER_ACCESS_TOKEN = generateAdminToken();
      console.log('   ✅ 已生成管理员令牌');
    }
    
    // 从数据库加载技能参数并注入环境变量
    await loadSkillParameters(skillName);
    
    // 设置环境变量（技能模块会读取这些）
    process.env.API_BASE = API_BASE;
    process.env.USER_ACCESS_TOKEN = USER_ACCESS_TOKEN;
    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
    
    // 加载技能代码
    const code = loadSkillCode(skillName);
    console.log(`   代码长度: ${code.length} 字符`);
    
    // 在 vm 沙箱中执行技能
    const skillModule = executeSkill(code, skillName);
    
    // 检查是否有 execute 函数
    if (typeof skillModule.execute !== 'function') {
      console.error('❌ 技能模块没有 execute 函数');
      console.log('导出的内容:', Object.keys(skillModule));
      process.exit(1);
    }
    
    // 如果有 getTools，列出可用工具
    if (typeof skillModule.getTools === 'function') {
      const tools = skillModule.getTools();
      const toolNames = tools.map(t => t.name);
      console.log(`\n📋 可用工具: ${toolNames.join(', ')}`);
      
      const toolDef = tools.find(t => t.name === toolName);
      if (toolDef) {
        console.log(`\n📝 工具定义:`);
        console.log(`   描述: ${toolDef.description}`);
        if (toolDef.parameters?.properties) {
          console.log(`   参数:`);
          for (const [key, prop] of Object.entries(toolDef.parameters.properties)) {
            const required = toolDef.parameters.required?.includes(key);
            console.log(`     - ${key}${required ? ' (必填)' : ''}: ${prop.description || prop.type}`);
          }
        }
      } else {
        console.warn(`\n⚠️  工具 "${toolName}" 不在工具列表中，但仍尝试执行`);
      }
    }
    
    // 执行工具
    console.log('\n🚀 执行工具...');
    console.time('执行耗时');
    
    const context = {
      apiBase: API_BASE,
      accessToken: USER_ACCESS_TOKEN,
    };
    
    const result = await skillModule.execute(toolName, params, context);
    
    console.timeEnd('执行耗时');
    
    // 输出结果
    console.log('\n📊 执行结果:');
    console.log('='.repeat(50));
    console.log(JSON.stringify(result, null, 2));
    console.log('='.repeat(50));
    
    if (result && result.success) {
      console.log('✅ 执行成功');
    } else {
      console.log('❌ 执行失败');
    }
    
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