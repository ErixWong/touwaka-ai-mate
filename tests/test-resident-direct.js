/**
 * 驻留进程内部 API 调试测试
 * 测试内部 API 的模型配置获取和消息插入功能
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
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
const INTERNAL_KEY = process.env.INTERNAL_KEY || '';

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

// 测试获取模型配置
async function testGetModelConfig() {
  console.log('\n📋 测试获取模型配置');
  console.log('-'.repeat(60));
  
  const modelId = 'mmfxrlo40h7ybx33m8l5';  // kimi-k2.5
  
  const headers = {};
  if (INTERNAL_KEY) {
    headers['X-Internal-Key'] = INTERNAL_KEY;
  }
  
  const response = await httpRequest(`${API_BASE}/internal/models/${modelId}`, {
    method: 'GET',
    headers,
  });
  
  console.log(`状态码: ${response.status}`);
  console.log(`结果: ${JSON.stringify(response.data, null, 2)}`);
  
  if (response.data.code === 200 && response.data.data) {
    console.log('✅ 模型配置获取成功');
    return response.data.data;
  } else {
    console.log('❌ 模型配置获取失败');
    return null;
  }
}

// 测试消息插入
async function testInsertMessage() {
  console.log('\n📋 测试消息插入');
  console.log('-'.repeat(60));
  
  const headers = {};
  if (INTERNAL_KEY) {
    headers['X-Internal-Key'] = INTERNAL_KEY;
  }
  
  const response = await httpRequest(`${API_BASE}/internal/messages/insert`, {
    method: 'POST',
    headers,
  }, {
    user_id: 'c464d6d1e06b5d5d05c4',  // 真实用户 ID
    expert_id: 'mmhe8thlii2ttugmo7v1',  // 真实专家 ID
    content: '【测试消息】这是一条测试消息，时间戳: ' + new Date().toISOString(),
    role: 'assistant',
  });
  
  console.log(`状态码: ${response.status}`);
  console.log(`结果: ${JSON.stringify(response.data, null, 2)}`);
  
  if (response.data.code === 200) {
    console.log('✅ 消息插入成功');
    return true;
  } else {
    console.log('❌ 消息插入失败');
    return false;
  }
}

// 主函数
async function main() {
  console.log('🔧 驻留进程调试测试');
  console.log('='.repeat(60));
  console.log(`API_BASE: ${API_BASE}`);
  console.log(`INTERNAL_KEY: ${INTERNAL_KEY ? '已设置' : '未设置'}`);
  
  // 测试 1: 获取模型配置
  await testGetModelConfig();

  // 测试 2: 消息插入
  await testInsertMessage();
  
  console.log('\n' + '='.repeat(60));
  console.log('测试完成');
}

main().catch(console.error);