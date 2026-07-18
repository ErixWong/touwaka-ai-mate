/**
 * 技能真实运行时验证脚本
 *
 * ⚠️ 注意：此脚本模拟生产环境的 skill-runner 执行，用于验证真实运行时行为。
 *
 * 与 dev 模式的区别：
 * - 使用真实的 skill-runner 执行
 * - 验证沙箱路径边界
 * - 不自动注入管理员权限
 * - 测试真实的 token 验证
 * - 设置完整的环境变量以匹配生产环境
 *
 * 使用方法：
 * node tests/skill-runtime/run-skill-real.js <skill名称> <工具名称> [参数]
 *
 * 示例：
 * node tests/skill-runtime/run-skill-real.js xlsx excel_read --path=test.xlsx
 *
 * 环境变量：
 * - DATA_BASE_PATH: 数据基础路径（默认 ./data）
 * - SKILL_PATH: 技能目录路径（可选，默认从 data/skills/<skillName> 加载）
 * - WORKING_DIRECTORY: 工作目录（默认 <DATA_BASE_PATH>/work/<USER_ID>/temp）
 * - USER_ID: 用户ID（默认 test-user）
 * - IS_ADMIN: 是否管理员（默认 false）
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:3017';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(__dirname, '..', '..', 'data');
const USER_ID = process.env.USER_ID || 'test-user';
const WORKING_DIRECTORY = process.env.WORKING_DIRECTORY || path.join(DATA_BASE_PATH, 'work', USER_ID, 'temp');

const skillName = process.argv[2];
const toolName = process.argv[3];

if (!skillName || !toolName) {
  console.error('❌ 请提供技能名称和工具名称');
  console.log('\n使用方法:');
  console.log('  node tests/skill-runtime/run-skill-real.js <skill名称> <工具名称> [参数]');
  console.log('\n示例:');
  console.log('  node tests/skill-runtime/run-skill-real.js xlsx excel_read --path=test.xlsx');
  console.log('\n环境变量（可选）:');
  console.log('  DATA_BASE_PATH: 数据基础路径');
  console.log('  USER_ID: 用户ID（默认 test-user）');
  console.log('  WORKING_DIRECTORY: 工作目录');
  console.log('  IS_ADMIN: 是否管理员（默认 false）');
  process.exit(1);
}

// 计算 SKILL_PATH：技能目录 = data/skills/<skillName>
const SKILL_PATH = path.join(DATA_BASE_PATH, 'skills', skillName);
const SCRIPT_PATH = 'index.js';

// 验证技能目录是否存在
if (!fs.existsSync(SKILL_PATH)) {
  console.error(`❌ 技能目录不存在: ${SKILL_PATH}`);
  console.log('   请确保技能已正确安装');
  process.exit(1);
}

// 确保工作目录存在
if (!fs.existsSync(WORKING_DIRECTORY)) {
  console.log(`📁 创建工作目录: ${WORKING_DIRECTORY}`);
  fs.mkdirSync(WORKING_DIRECTORY, { recursive: true });
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

async function main() {
  console.log('🔧 技能真实运行时验证');
  console.log('='.repeat(50));
  console.log(`📌 技能: ${skillName}`);
  console.log(`📌 工具: ${toolName}`);
  console.log(`📌 技能路径: ${SKILL_PATH}`);
  console.log(`📌 工作目录: ${WORKING_DIRECTORY}`);
  console.log(`📌 用户ID: ${USER_ID}`);
  
  const rawArgs = process.argv.slice(4);
  const params = parseArgs(rawArgs);
  console.log(`📌 参数: ${JSON.stringify(params)}`);
  console.log('='.repeat(50));
  
  const SKILL_RUNNER_PATH = path.join(__dirname, '..', '..', 'lib', 'skill-runner.js');
  
  console.log('\n🚀 使用 skill-runner 执行...');
  console.time('执行耗时');
  
  // 构建完整的环境变量，匹配 skill-loader 的 buildSkillEnvironment
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    
    // 技能执行必需的环境变量
    SKILL_ID: skillName,
    SKILL_PATH: SKILL_PATH,                    // 技能目录路径
    SCRIPT_PATH: SCRIPT_PATH,                  // 技能入口脚本
    DATA_BASE_PATH: DATA_BASE_PATH,            // 数据基础路径
    SKILLS_BASE_PATH: path.join(DATA_BASE_PATH, 'skills'),
    
    // 用户上下文
    USER_ID: USER_ID,
    IS_ADMIN: process.env.IS_ADMIN || 'false',
    IS_SKILL_CREATOR: process.env.IS_SKILL_CREATOR || 'false',
    
    // 工作目录（绝对路径）
    WORKING_DIRECTORY: WORKING_DIRECTORY,
    
    // API 配置
    API_BASE: API_BASE,
    
    // 项目根目录
    PROJECT_ROOT: path.join(__dirname, '..', '..'),
  };
  
  // 移除可能导致问题的变量
  delete env.USER_ACCESS_TOKEN;
  
  console.log('\n📝 环境变量:');
  console.log(`   SKILL_PATH: ${env.SKILL_PATH}`);
  console.log(`   SCRIPT_PATH: ${env.SCRIPT_PATH}`);
  console.log(`   WORKING_DIRECTORY: ${env.WORKING_DIRECTORY}`);
  console.log(`   DATA_BASE_PATH: ${env.DATA_BASE_PATH}`);
  console.log(`   IS_ADMIN: ${env.IS_ADMIN}`);
  
  const runner = spawn('node', [SKILL_RUNNER_PATH, skillName, toolName], {
    env,
    cwd: WORKING_DIRECTORY,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  
  let stdout = '';
  let stderr = '';
  
  runner.stdout.on('data', (data) => {
    stdout += data.toString();
  });
  
  runner.stderr.on('data', (data) => {
    stderr += data.toString();
  });
  
  runner.on('close', (code) => {
    console.timeEnd('执行耗时');
    
    if (stderr) {
      console.log('\n📝 stderr:');
      console.log(stderr);
    }
    
    if (stdout) {
      console.log('\n📊 执行结果:');
      console.log('='.repeat(50));
      try {
        const result = JSON.parse(stdout);
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        console.log(stdout);
      }
      console.log('='.repeat(50));
    }
    
    if (code === 0) {
      console.log('✅ 执行成功');
    } else {
      console.log(`❌ 执行失败，退出码: ${code}`);
    }
  });
  
  runner.on('error', (err) => {
    console.error('\n❌ 启动 skill-runner 失败:', err.message);
    console.log('\n💡 提示:');
    console.log('   - 确保 NODE_ENV 设置正确');
    console.log('   - 检查技能目录是否存在');
    console.log('   - 检查工作目录是否有权限');
    process.exit(1);
  });
  
  // 注意：skill-runner 期望的输入格式是 { params, context }
  // 而不是 { toolName, params, context }
  const requestData = JSON.stringify({
    params,
    context: {
      apiBase: API_BASE,
      userId: USER_ID,
      accessToken: 'test-token',
    },
  });
  
  runner.stdin.write(requestData);
  runner.stdin.end();
}

main();
