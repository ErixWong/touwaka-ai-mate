/**
 * Skill Manager - 技能管理技能
 *
 * 用于管理技能的注册、删除、分配等操作
 * 仅供技能管理专家（如 skill-studio）使用
 *
 * 重构说明：此技能现在通过 API 调用后台服务，不再直接访问数据库
 * 业务逻辑集中在 server/controllers/skill.controller.js
 *
 * @module skill-manager
 */

const https = require('https');
const http = require('http');

// API 配置（从环境变量获取，由 skill-loader 注入）
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const USER_ACCESS_TOKEN = process.env.USER_ACCESS_TOKEN || '';
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * 发起 HTTP 请求
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径
 * @param {object} data - 请求数据
 * @returns {Promise<object>} 响应数据
 */
function httpRequest(method, path, data) {
  return new Promise((resolve, reject) => {
    if (!USER_ACCESS_TOKEN) {
      reject(new Error('用户未登录，无法管理技能（缺少 USER_ACCESS_TOKEN）'));
      return;
    }

    const parsedUrl = new URL(path, API_BASE);
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
      // 生产环境启用 SSL 证书验证，开发环境可禁用（自签名证书）
      rejectUnauthorized: NODE_ENV === 'production',
    };

    const req = httpModule.request(requestOptions, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        // 处理 204 No Content
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

    req.on('error', (e) => {
      reject(new Error(`Request failed: ${e.message}`));
    });

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

// ==================== 技能管理操作 ====================

/**
 * 列出所有技能（精简列表，不含工具详情）
 */
async function list(params) {
  const { is_active, search } = params;
  let query = '?';
  if (is_active !== undefined) {
    query += `is_active=${is_active ? 1 : 0}&`;
  }
  if (search) {
    query += `search=${encodeURIComponent(search)}&`;
  }
  return await httpRequest('GET', `/api/skills${query}`);
}

/**
 * 获取技能完整详情（包含工具定义）
 */
async function details(params) {
  const { skill_id } = params;
  if (!skill_id) {
    throw new Error('技能 ID 不能为空');
  }
  return await httpRequest('GET', `/api/skills/${skill_id}`);
}

/**
 * 注册技能（从本地目录）
 */
async function register(params) {
  let { source_path, name, description, tools } = params;
  
  if (!source_path) {
    throw new Error('source_path 不能为空');
  }
  if (!tools || !Array.isArray(tools) || tools.length === 0) {
    throw new Error('tools 参数是必需的。请先读取 SKILL.md，理解工具定义后传入 tools 数组。');
  }

  // 规范化 source_path：提取技能目录名
  // 支持多种格式：skills/pdf, data/skills/pdf, pdf
  // 最终只保留技能目录名（如 pdf）
  
  // 移除 data/ 前缀
  if (source_path.startsWith('data/')) {
    source_path = source_path.substring(5); // data/skills/pdf → skills/pdf
  }
  // 移除 skills/ 前缀，只保留技能目录名
  if (source_path.startsWith('skills/')) {
    source_path = source_path.substring(7); // skills/pdf → pdf
  }
  // 此时 source_path 应该只是技能目录名（如 pdf）

  return await httpRequest('POST', '/api/skills/register', {
    source_path,
    name,
    description,
    tools,
  });
}

/**
 * 删除技能
 */
async function deleteSkill(params) {
  const { skill_id } = params;
  if (!skill_id) {
    throw new Error('技能 ID 不能为空');
  }
  return await httpRequest('DELETE', `/api/skills/${skill_id}`);
}

/**
 * 启用/禁用技能
 */
async function toggle(params) {
  const { skill_id, is_active } = params;
  if (!skill_id) {
    throw new Error('技能 ID 不能为空');
  }
  if (is_active === undefined) {
    throw new Error('is_active 不能为空');
  }
  return await httpRequest('PATCH', `/api/skills/${skill_id}/toggle`, { is_active });
}

/**
 * Skill execute function - 被 skill-runner 调用
 *
 * @param {string} toolName - 工具名称
 * @param {object} params - 工具参数
 * @param {object} context - 执行上下文（由 skill-loader 注入环境变量，context 可为空）
 * @returns {Promise<object>} 执行结果
 */
async function execute(toolName, params, context = {}) {
  // 验证用户认证
  if (!USER_ACCESS_TOKEN) {
    throw new Error('用户未登录，无法管理技能。请确保 USER_ACCESS_TOKEN 环境变量已设置。');
  }

  const tools = {
    'list': list,
    'details': details,
    'register': register,
    'delete': deleteSkill,
    'toggle': toggle,
  };

  const tool = tools[toolName];
  if (!tool) {
    const availableTools = Object.keys(tools).join(', ');
    throw new Error(`未知工具: ${toolName}. 可用工具: ${availableTools}`);
  }

  const result = await tool(params);

  return {
    success: true,
    data: result,
  };
}

// Export for skill-runner
module.exports = {
  execute,
  name: 'skill-manager',
  description: '技能管理工具：注册、删除、分配技能（通过 API 调用）',
};
