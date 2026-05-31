/**
 * KB Recall Skill - 知识库召回技能
 *
 * 用于从知识库召回相关内容，支持图文召回和上下文增强
 * 返回可直接渲染的 Markdown（图片 URL 已包含 Token）
 *
 * 已切换到统一文档平台 /api/docs/recall
 *
 * @module kb-recall-skill
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
      reject(new Error('用户未登录，无法访问知识库（缺少 USER_ACCESS_TOKEN）'));
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

// ==================== 召回操作 ====================

/**
 * 单知识库召回
 */
async function handleRecall(params) {
  const {
    kb_id,
    query,
    top_k = 5,
    threshold = 0.1,
  } = params;

  if (!kb_id) throw new Error('知识库 ID 不能为空');
  if (!query) throw new Error('查询文本不能为空');

  return await httpRequest('POST', '/api/docs/recall', {
    query,
    scope: 'knowledge',
    top_k,
    threshold,
  });
}

async function handleGlobalRecall(params) {
  const {
    query,
    top_k = 10,
    threshold = 0.1,
  } = params;

  if (!query) throw new Error('查询文本不能为空');

  return await httpRequest('POST', '/api/docs/recall', {
    query,
    scope: 'all',
    top_k,
    threshold,
  });
}

// ==================== 执行入口 ====================

/**
 * Skill execute function - 被 skill-runner 调用
 *
 * @param {string} toolName - 工具名称（recall / global_recall）
 * @param {object} params - 工具参数
 * @param {object} context - 执行上下文（由 skill-loader 注入环境变量，context 可为空）
 * @returns {Promise<object>} 执行结果
 */
async function execute(toolName, params, context = {}) {
  // 验证用户认证
  if (!USER_ACCESS_TOKEN) {
    throw new Error('用户未登录，无法访问知识库。请确保 USER_ACCESS_TOKEN 环境变量已设置。');
  }

  // 处理器映射
  const handlers = {
    'recall': handleRecall,
    'global_recall': handleGlobalRecall,
  };

  // 获取处理器
  const handler = handlers[toolName];
  if (!handler) {
    const availableTools = Object.keys(handlers).join(', ');
    throw new Error(`未知工具: ${toolName}. 可用工具: ${availableTools}`);
  }

  // 执行操作
  const result = await handler(params);

  return {
    success: true,
    data: result,
  };
}

/**
 * 获取工具清单 - 用于技能注册
 * @returns {Array} 工具定义数组
 */
function getTools() {
  return [
    {
      name: 'recall',
      description: '从指定知识库召回相关内容。已切换统一文档平台 /api/docs/recall。',
      parameters: {
        type: 'object',
        properties: {
          kb_id: {
            type: 'string',
            description: '知识库 ID（必需）',
          },
          query: {
            type: 'string',
            description: '搜索查询文本（必需）',
          },
          top_k: {
            type: 'integer',
            description: '返回结果数量，默认 5',
            default: 5,
          },
          threshold: {
            type: 'number',
            description: '相似度阈值（0-1），默认 0.1',
            default: 0.1,
          },
        },
        required: ['kb_id', 'query'],
      },
    },
    {
      name: 'global_recall',
      description: '从用户所有可访问的文档中召回相关内容。已切换统一文档平台 /api/docs/recall。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索查询文本（必需）',
          },
          top_k: {
            type: 'integer',
            description: '返回结果数量（默认 10，最大 50）',
            default: 10,
            maximum: 50,
          },
threshold: {
            type: 'number',
            description: '相似度阈值（0-1），默认 0.1',
            default: 0.1,
          },
        },
        required: ['query'],
      },
    },
  ];
}

// Export for skill-runner
module.exports = {
  execute,
  getTools,
};
