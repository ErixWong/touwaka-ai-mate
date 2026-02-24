/**
 * 数据库查询测试脚本
 * 用法: node test/query-db.js "SELECT * FROM skills LIMIT 10"
 */

import Database from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载 .env 文件
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      // 跳过注释和空行
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // 移除引号
        value = value.replace(/^["']|["']$/g, '');
        // 设置到 process.env
        process.env[key] = value;
      }
    });
    console.log('已加载 .env 文件');
  } else {
    console.log('.env 文件不存在');
  }
}

// 替换配置中的环境变量占位符
function resolveEnvVars(obj) {
  const resolved = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      resolved[key] = value.replace(/\$\{([^}]+)\}/g, (_, envKey) => {
        return process.env[envKey] || '';
      });
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

async function main() {
  const sql = process.argv[2] || 'SELECT id, name, source_type, source_path FROM skills LIMIT 10';
  
  // 加载环境变量
  loadEnv();
  
  // 读取数据库配置
  const configPath = path.join(__dirname, '..', 'config', 'database.json');
  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const config = resolveEnvVars(rawConfig);
  
  console.log('正在连接数据库...');
  const db = new Database(config);
  await db.connect();
  
  console.log(`执行查询: ${sql}\n`);
  
  try {
    const results = await db.query(sql);
    console.log(JSON.stringify(results, null, 2));
    console.log(`\n共 ${results.length} 条记录`);
  } catch (error) {
    console.error('查询失败:', error.message);
  }
  
  process.exit(0);
}

main().catch(console.error);
