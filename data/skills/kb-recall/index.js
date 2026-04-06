/**
 * KB Recall Skill - 知识库召回技能
 *
 * 用于从知识库召回相关内容，支持图文召回和上下文增强
 * 返回可直接渲染的 Markdown（图片 URL 已包含 Token）
 *
 * Issue #558: 实现知识库图文召回 API
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
    article_id,
    min_tokens = 200,
    context_mode = 'auto'
  } = params;

  if (!kb_id) throw new Error('知识库 ID 不能为空');
  if (!query) throw new Error('查询文本不能为空');

  // 验证 context_mode
  const validModes = ['none', 'auto', 'section', 'article'];
  if (!validModes.includes(context_mode)) {
    throw new Error(`无效的 context_mode: ${context_mode}。可选值: ${validModes.join(', ')}`);
  }

  const requestBody = {
    query,
    top_k,
    threshold,
    min_tokens,
    context_mode,
  };

  if (article_id) {
    requestBody.article_id = article_id;
  }

  return await httpRequest('POST', `/api/kb/${kb_id}/recall`, requestBody);
}

/**
 * 全局召回（搜索用户所有可访问的知识库）
 */
async function handleGlobalRecall(params) {
  const {
    query,
    top_k = 10,
    threshold = 0.1,
    kb_ids,
    min_tokens = 200,
    context_mode = 'auto'
  } = params;

  if (!query) throw new Error('查询文本不能为空');

  // 验证 context_mode
  const validModes = ['none', 'auto', 'section', 'article'];
  if (!validModes.includes(context_mode)) {
    throw new Error(`无效的 context_mode: ${context_mode}。可选值: ${validModes.join(', ')}`);
  }

  const requestBody = {
    query,
    top_k,
    threshold,
    min_tokens,
    context_mode,
  };

  if (kb_ids && Array.isArray(kb_ids) && kb_ids.length > 0) {
    requestBody.kb_ids = kb_ids;
  }

  return await httpRequest('POST', '/api/kb/recall', requestBody);
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
      description: '从指定知识库召回相关内容，返回可直接渲染的 Markdown（图片 URL 已包含 Token）。支持上下文增强：当召回内容 Token 不足时，自动扩展相邻段落提供完整上下文。',
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
          article_id: {
            type: 'string',
            description: '限定在特定文章内搜索（可选）',
          },
          min_tokens: {
            type: 'integer',
            description: '最小 Token 数量，不足时自动扩展上下文，默认 200',
            default: 200,
          },
          context_mode: {
            type: 'string',
            enum: ['none', 'auto', 'section', 'article'],
            description: '上下文模式：none=仅返回匹配段落, auto=自动扩展相邻段落, section=返回整个节, article=返回整篇文章。默认 auto',
            default: 'auto',
          },
        },
        required: ['kb_id', 'query'],
      },
    },
    {
      name: 'global_recall',
      description: '从用户所有可访问的知识库中召回相关内容，返回可直接渲染的 Markdown（图片 URL 已包含 Token）。适用于不确定内容在哪个知识库的场景。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索查询文本（必需）',
          },
          top_k: {
            type: 'integer',
            description: '返回结果数量，默认 10',
            default: 10,
          },
          threshold: {
            type: 'number',
            description: '相似度阈值（0-1），默认 0.1',
            default: 0.1,
          },
          kb_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '限定知识库 ID 数组（可选，不提供则搜索所有可访问知识库）',
          },
          min_tokens: {
            type: 'integer',
            description: '最小 Token 数量，不足时自动扩展上下文，默认 200',
            default: 200,
          },
          context_mode: {
            type: 'string',
            enum: ['none', 'auto', 'section', 'article'],
            description: '上下文模式：none=仅返回匹配段落, auto=自动扩展相邻段落, section=返回整个节, article=返回整篇文章。默认 auto',
            default: 'auto',
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
