/**
 * 测试远程 LLM 调用技能
 * 
 * 使用方法：
 * node tests/test-remote-llm.js
 * 
 * 测试流程：
 * 1. 测试驻留进程状态
 * 2. 测试内部 API 模型解析
 * 3. 测试 submit 工具（VM 沙箱）
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import crypto from 'crypto';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 从 .env 文件加载环境变量
function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnvFile();

// 配置
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const INTERNAL_KEY = process.env.INTERNAL_KEY || '';

// 生成管理员 JWT Token
function generateAdminToken() {
  const header = Buffer.from(JSON.stringify({
    alg: 'HS256',
    typ: 'JWT'
  })).toString('base64url');
  
  const payload = Buffer.from(JSON.stringify({
    user_id: 'admin_00000000000000000000',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 365
  })).toString('base64url');
  
  const signature = crypto.createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  
  return `${header}.${payload}.${signature}`;
}

// HTTP 请求封装
async function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      timeout: options.timeout || 30000,
    };

    const req = transport.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (err) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// 加载并执行技能代码（VM 沙箱）
function executeSkill(code, skillId) {
  const safeEnv = { ...process.env };
  
  const context = {
    module: { exports: {} },
    exports: {},
    require: (moduleName) => {
      const moduleMap = {
        'fs': fs,
        'path': path,
        'url': { URL },
        'http': http,
        'https': https,
        'crypto': crypto,
      };
      
      if (moduleMap[moduleName]) {
        return moduleMap[moduleName];
      }
      
      throw new Error(`Module '${moduleName}' is not allowed in sandbox`);
    },
    console: {
      log: (...args) => process.stderr.write(`[${skillId}] ${args.join(' ')}\n`),
      error: (...args) => process.stderr.write(`[${skillId}:ERROR] ${args.join(' ')}\n`),
    },
    process: {
      env: safeEnv,
      cwd: () => process.cwd(),
    },
    Buffer,
    URL,
    setTimeout,
    clearTimeout,
  };
  
  vm.createContext(context);
  vm.runInContext(code, context, { timeout: 10000 });
  
  const exports = context.module.exports;
  if (Object.keys(exports).length === 0 && Object.keys(context.exports).length > 0) {
    return context.exports;
  }
  
  return exports;
}

// 测试驻留进程状态
async function testResidentStatus(token) {
  console.log('\n📋 测试 1: 驻留进程状态');
  console.log('-'.repeat(50));
  
  const response = await httpRequest(`${API_BASE}/api/debug/resident-status`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  
  console.log(`状态码: ${response.status}`);
  console.log(`结果: ${JSON.stringify(response.data, null, 2)}`);
  
  if (response.data.code === 200 && response.data.data?.process_count > 0) {
    console.log('✅ 驻留进程运行中');
    return true;
  } else {
    console.log('❌ 驻留进程未运行');
    return false;
  }
}

// 测试模型解析 API
async function testModelResolve(modelName) {
  console.log('\n📋 测试 2: 模型解析 API');
  console.log('-'.repeat(50));
  
  const headers = {};
  if (INTERNAL_KEY) {
    headers['X-Internal-Key'] = INTERNAL_KEY;
  }
  
  const response = await httpRequest(
    `${API_BASE}/internal/models/resolve?name=${encodeURIComponent(modelName)}`,
    { method: 'GET', headers }
  );
  
  console.log(`状态码: ${response.status}`);
  console.log(`结果: ${JSON.stringify(response.data, null, 2)}`);
  
  if (response.data.code === 200 && response.data.data?.model_id) {
    console.log(`✅ 模型解析成功: ${modelName} -> ${response.data.data.model_id}`);
    return response.data.data.model_id;
  } else {
    console.log(`❌ 模型解析失败`);
    return null;
  }
}

// 测试 submit 工具
async function testSubmitTool(modelId) {
  console.log('\n📋 测试 3: submit 工具（VM 沙箱）');
  console.log('-'.repeat(50));
  
  // 加载 submit.js
  const submitPath = path.join(process.cwd(), 'data', 'skills', 'remote-llm', 'submit.js');
  if (!fs.existsSync(submitPath)) {
    console.log(`❌ 找不到 submit.js: ${submitPath}`);
    return false;
  }
  
  console.log(`加载脚本: ${submitPath}`);
  const code = fs.readFileSync(submitPath, 'utf-8');
  
  // 设置环境变量
  process.env.API_BASE = API_BASE;
  process.env.INTERNAL_KEY = INTERNAL_KEY;
  
  // 在 VM 沙箱中执行
  const skillModule = executeSkill(code, 'remote-llm');
  
  if (typeof skillModule.execute !== 'function') {
    console.log('❌ 模块没有 execute 函数');
    return false;
  }
  
  // 执行工具
  const params = {
    model_id: modelId,
    prompt: '你好，请用一句话介绍自己。',
  };
  
  const context = {
    user_id: 'admin_00000000000000000000',
    expert_id: 'test_expert_001',
    USER_ID: 'admin_00000000000000000000',
    expertId: 'test_expert_001',
  };
  
  console.log(`参数: ${JSON.stringify(params, null, 2)}`);
  console.log(`上下文: ${JSON.stringify(context, null, 2)}`);
  
  try {
    const result = await skillModule.execute('submit', params, context);
    console.log(`\n结果: ${JSON.stringify(result, null, 2)}`);
    
    if (result.success) {
      console.log(`✅ submit 工具执行成功，任务已入队`);
      console.log(`   task_id: ${result.task_id}`);
      console.log(`   message: ${result.message}`);
      return true;
    } else {
      console.log(`❌ submit 工具执行失败: ${result.error}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ 执行出错: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

// 主函数
async function main() {
  console.log('🔧 远程 LLM 技能测试');
  console.log('='.repeat(50));
  console.log(`API_BASE: ${API_BASE}`);
  console.log(`INTERNAL_KEY: ${INTERNAL_KEY ? '已设置' : '未设置'}`);
  
  const token = generateAdminToken();
  console.log(`Token: ${token.substring(0, 30)}...`);
  
  try {
    // 测试 1: 驻留进程状态
    const residentOk = await testResidentStatus(token);
    if (!residentOk) {
      console.log('\n⚠️  驻留进程未运行，请先启动后端服务');
      return;
    }
    
    // 测试 2: 模型解析
    const modelName = 'GLM-4.7';  // 使用一个存在的模型名称
    const modelId = await testModelResolve(modelName);
    if (!modelId) {
      console.log('\n⚠️  模型解析失败，使用默认 ID');
    }
    
    // 测试 3: submit 工具
    const submitOk = await testSubmitTool(modelId || '827b6afc546ee86fafb1');
    
    // 总结
    console.log('\n' + '='.repeat(50));
    console.log('📊 测试总结');
    console.log('='.repeat(50));
    console.log(`驻留进程状态: ${residentOk ? '✅ 通过' : '❌ 失败'}`);
    console.log(`模型解析 API: ${modelId ? '✅ 通过' : '❌ 失败'}`);
    console.log(`submit 工具: ${submitOk ? '✅ 通过' : '❌ 失败'}`);
    
    if (residentOk && submitOk) {
      console.log('\n🎉 所有测试通过！');
    } else {
      console.log('\n⚠️  部分测试失败，请检查日志');
    }
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    console.error(error.stack);
  }
}

main();