/**
 * 完整测试远程 LLM 调用
 * 模拟 skill-loader 的环境变量注入
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { URL } from 'url';
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
      timeout: options.timeout || 60000,
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

// 测试完整的调用流程
async function testFullFlow() {
  console.log('🔧 完整测试远程 LLM 调用');
  console.log('='.repeat(60));
  
  const token = generateAdminToken();
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (INTERNAL_KEY) {
    headers['X-Internal-Key'] = INTERNAL_KEY;
  }

  // 1. 检查驻留进程状态
  console.log('\n📋 步骤 1: 检查驻留进程状态');
  const statusResp = await httpRequest(`${API_BASE}/api/debug/resident-status`, {
    method: 'GET',
    headers,
  });
  console.log(`状态: ${JSON.stringify(statusResp.data, null, 2)}`);
  
  if (statusResp.data.code !== 200 || !statusResp.data.data?.process_count) {
    console.log('❌ 驻留进程未运行');
    return;
  }
  console.log('✅ 驻留进程运行中');

  // 2. 获取 skill_parameters 配置
  console.log('\n📋 步骤 2: 获取 skill_parameters 配置');
  const paramsResp = await httpRequest(`${API_BASE}/api/debug/skill-parameters?skill_id=remote-llm`, {
    method: 'GET',
    headers,
  });
  console.log(`参数: ${JSON.stringify(paramsResp.data, null, 2)}`);

  // 3. 直接调用驻留进程（通过内部 API）
  console.log('\n📋 步骤 3: 调用驻留进程');
  const invokeResp = await httpRequest(`${API_BASE}/internal/resident/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, {
    skill_id: 'remote-llm',
    tool_name: 'remote-llm-executor',
    params: {
      user_id: 'admin_00000000000000000000',
      expert_id: 'test_expert_001',
      model_id: 'mmfxrlo40h7ybx33m8l5',  // kimi-k2.5
      prompt: '你好，请用一句话介绍自己。',
      max_tokens: 100,
    },
  });
  
  console.log(`调用结果: ${JSON.stringify(invokeResp.data, null, 2)}`);
  
  if (invokeResp.data.code === 200) {
    console.log('✅ 驻留进程调用成功');
    console.log('   任务已入队，等待处理...');
    
    // 等待 5 秒后检查结果
    console.log('\n📋 步骤 4: 等待 5 秒后检查消息记录');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 检查数据库消息
    const msgResp = await httpRequest(`${API_BASE}/api/debug/messages?expert_id=test_expert_001&limit=3`, {
      method: 'GET',
      headers,
    });
    console.log(`消息记录: ${JSON.stringify(msgResp.data, null, 2)}`);
  } else {
    console.log('❌ 驻留进程调用失败');
  }
}

testFullFlow().catch(console.error);