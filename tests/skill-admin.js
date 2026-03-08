/**
 * 技能管理脚本 - 通过 HTTP API 管理技能
 *
 * 使用方法：
 * node tests/skill-admin.js <类别> <操作> [参数]
 *
 * 示例：
 * # 列出知识库
 * node tests/skill-admin.js kb list
 *
 * # 搜索知识点
 * node tests/skill-admin.js kb search --kb_id=xxx --query="测试"
 *
 * # 列出技能
 * node tests/skill-admin.js skill list
 *
 * # 获取技能详情
 * node tests/skill-admin.js skill get --id=kb-search
 *
 * # 注册技能
 * node tests/skill-admin.js skill register --path=data/skills/kb-search
 *
 * 环境变量：
 * - API_BASE: API 地址，默认 http://localhost:3000
 * - USER_ACCESS_TOKEN: 用户访问令牌（可选，脚本会自动生成管理员 token）
 * - JWT_SECRET: JWT 密钥，默认 your-secret-key-change-in-production
 */

import https from 'https';
import http from 'http';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// 加载 .env 文件
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// 配置
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
let USER_ACCESS_TOKEN = process.env.USER_ACCESS_TOKEN || '';

// 从命令行参数获取
const category = process.argv[2];
const action = process.argv[3];

if (!category || !action) {
  console.error('❌ 请提供类别和操作');
  console.log('\n使用方法:');
  console.log('  node tests/skill-admin.js <类别> <操作> [参数]');
  console.log('\n类别和操作:');
  console.log('  kb list              - 列出知识库');
  console.log('  kb get               - 获取知识库详情 (--id)');
  console.log('  kb search            - 搜索知识点 (--kb_id, --query)');
  console.log('  kb articles          - 列出文章 (--kb_id)');
  console.log('  kb article-tree      - 获取文章树 (--kb_id, --article_id)');
  console.log('');
  console.log('  skill list           - 列出技能');
  console.log('  skill get            - 获取技能详情 (--id)');
  console.log('  skill register       - 注册技能 (--path)');
  console.log('  skill toggle         - 启用/禁用技能 (--id, --active)');
  console.log('  skill assign         - 分配技能 (--skill_id, --expert_id)');
  console.log('');
  console.log('  expert list          - 列出专家');
  console.log('  expert get           - 获取专家详情 (--id)');
  console.log('');
  console.log('示例:');
  console.log('  node tests/skill-admin.js kb list');
  console.log('  node tests/skill-admin.js kb search --kb_id=xxx --query="测试"');
  console.log('  node tests/skill-admin.js skill list');
  console.log('  node tests/skill-admin.js skill register --path=data/skills/kb-search');
  process.exit(1);
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
 * 注意：使用真实存在的用户 ID（c464d6d1e06b5d5d05c4 = admin）
 */
function generateAdminToken() {
  const adminUserId = 'c464d6d1e06b5d5d05c4';  // admin 用户的真实 ID
  const adminRole = 'admin';
  return jwt.sign({ userId: adminUserId, role: adminRole }, JWT_SECRET, { expiresIn: '1h' });
}

/**
 * 发起 HTTP 请求
 */
function httpRequest(method, reqPath, data) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(reqPath, API_BASE);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 3000),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${USER_ACCESS_TOKEN}`,
      },
      timeout: 30000,
    };

    const req = httpModule.request(requestOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 204) {
          resolve({ success: true });
          return;
        }
        try {
          const json = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json.data || json);
          } else {
            reject(new Error(json.message || json.error || `HTTP ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`Request failed: ${e.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * 知识库操作
 */
const kbActions = {
  async list(params) {
    const { page = 1, pageSize = 20 } = params;
    return await httpRequest('GET', `/api/kb?page=${page}&pageSize=${pageSize}`);
  },
  
  async get(params) {
    const { id } = params;
    if (!id) throw new Error('请提供 --id 参数');
    return await httpRequest('GET', `/api/kb/${id}`);
  },
  
  async search(params) {
    const { kb_id, query, top_k = 5 } = params;
    if (!kb_id) throw new Error('请提供 --kb_id 参数');
    if (!query) throw new Error('请提供 --query 参数');
    return await httpRequest('POST', `/api/kb/${kb_id}/search`, { query, top_k });
  },
  
  async articles(params) {
    const { kb_id, page = 1, pageSize = 20 } = params;
    if (!kb_id) throw new Error('请提供 --kb_id 参数');
    return await httpRequest('GET', `/api/kb/${kb_id}/articles?page=${page}&pageSize=${pageSize}`);
  },
  
  async 'article-tree'(params) {
    const { kb_id, article_id } = params;
    if (!kb_id) throw new Error('请提供 --kb_id 参数');
    if (!article_id) throw new Error('请提供 --article_id 参数');
    return await httpRequest('GET', `/api/kb/${kb_id}/articles/${article_id}/tree`);
  },
};

/**
 * 技能操作
 */
const skillActions = {
  async list(params) {
    const { is_active } = params;
    let query = '';
    if (is_active !== undefined) {
      query = `?is_active=${is_active ? 1 : 0}`;
    }
    return await httpRequest('GET', `/api/skills${query}`);
  },
  
  async get(params) {
    const { id } = params;
    if (!id) throw new Error('请提供 --id 参数');
    return await httpRequest('GET', `/api/skills/${id}`);
  },
  
  async register(params) {
    const { path } = params;
    if (!path) throw new Error('请提供 --path 参数');
    return await httpRequest('POST', '/api/skills/register', { source_path: path });
  },
  
  async toggle(params) {
    const { id, active = true } = params;
    if (!id) throw new Error('请提供 --id 参数');
    return await httpRequest('PATCH', `/api/skills/${id}/toggle`, { is_active: active });
  },
  
  async assign(params) {
    const { skill_id, expert_id } = params;
    if (!skill_id) throw new Error('请提供 --skill_id 参数');
    if (!expert_id) throw new Error('请提供 --expert_id 参数');
    return await httpRequest('POST', '/api/skills/assign', { skill_id, expert_id });
  },
  
  async unassign(params) {
    const { skill_id, expert_id } = params;
    if (!skill_id) throw new Error('请提供 --skill_id 参数');
    if (!expert_id) throw new Error('请提供 --expert_id 参数');
    return await httpRequest('POST', '/api/skills/unassign', { skill_id, expert_id });
  },
};

/**
 * 专家操作
 */
const expertActions = {
  async list(params) {
    const { page = 1, pageSize = 20 } = params;
    return await httpRequest('GET', `/api/experts?page=${page}&pageSize=${pageSize}`);
  },
  
  async get(params) {
    const { id } = params;
    if (!id) throw new Error('请提供 --id 参数');
    return await httpRequest('GET', `/api/experts/${id}`);
  },
};

/**
 * 主函数
 */
async function main() {
  try {
    console.log('🔧 技能管理工具');
    console.log('='.repeat(50));
    console.log(`📌 类别: ${category}`);
    console.log(`📌 操作: ${action}`);
    
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
    
    // 获取操作处理器
    const actionMaps = {
      kb: kbActions,
      skill: skillActions,
      expert: expertActions,
    };
    
    const actions = actionMaps[category];
    if (!actions) {
      throw new Error(`未知的类别: ${category}。可用: kb, skill, expert`);
    }
    
    const handler = actions[action];
    if (!handler) {
      throw new Error(`未知的操作: ${action}。可用: ${Object.keys(actions).join(', ')}`);
    }
    
    // 执行操作
    console.log('\n🚀 执行操作...');
    console.time('执行耗时');
    
    const result = await handler(params);
    
    console.timeEnd('执行耗时');
    
    // 输出结果
    console.log('\n📊 执行结果:');
    console.log('='.repeat(50));
    console.log(JSON.stringify(result, null, 2));
    console.log('='.repeat(50));
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