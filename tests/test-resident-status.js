/**
 * 测试驻留进程状态 API
 * 
 * 使用方法：
 * node tests/test-resident-status.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

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
        // 移除引号
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

// 生成管理员 JWT Token
function generateAdminToken() {
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
  
  // 简单的 JWT 生成（Header.Payload.Signature）
  const header = Buffer.from(JSON.stringify({
    alg: 'HS256',
    typ: 'JWT'
  })).toString('base64url');
  
  const payload = Buffer.from(JSON.stringify({
    user_id: 'admin_00000000000000000000',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 365 // 1年有效期
  })).toString('base64url');
  
  const signature = crypto.createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  
  return `${header}.${payload}.${signature}`;
}

async function main() {
  console.log('🔧 驻留进程状态测试');
  console.log('='.repeat(60));
  
  try {
    const token = generateAdminToken();
    
    console.log(`🔑 Token: ${token.substring(0, 50)}...`);
    
    // 调用 API
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
    const url = `${baseUrl}/api/debug/resident-status`;
    
    console.log(`📡 请求: GET ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    
    console.log('\n📊 响应结果:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.code === 200) {
      console.log('\n✅ 驻留进程状态获取成功！');
      
      if (result.data && result.data.processes) {
        for (const proc of result.data.processes) {
          console.log(`\n📌 进程: ${proc.tool_name}`);
          console.log(`   状态: ${proc.state}`);
          console.log(`   待处理任务: ${proc.pending_tasks}`);
        }
      }
    } else {
      console.log('\n❌ 获取失败:', result.message);
    }
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    console.error(error.stack);
  }
}

main();