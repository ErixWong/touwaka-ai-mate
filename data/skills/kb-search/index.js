/**
 * KB Search Skill - 知识库检索技能
 *
 * 用于所有专家查询和搜索知识点
 * 通过 API 调用执行操作，使用用户 Token 认证
 *
 * @module kb-search-skill
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
        'Authorization': `Bearer ${USER_ACCESS_TOKEN}`,  // 使用用户 Token
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

// ==================== 知识库查询 ====================

/**
 * 获取我可访问的知识库列表
 */
async function listMyKnowledgeBases(params) {
  const { page = 1, pageSize = 20 } = params;
  const data = await httpRequest('GET', `/api/kb?page=${page}&pageSize=${pageSize}`);
  return data;
}

/**
 * 获取知识库详情
 */
async function getKnowledgeBase(params) {
  const { id } = params;
  if (!id) {
    throw new Error('知识库 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${id}`);
}

// ==================== 文章查询 ====================

/**
 * 获取知识库下的文章列表
 */
async function listKnowledges(params) {
  const { kb_id, page = 1, pageSize = 20 } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/knowledges?page=${page}&pageSize=${pageSize}`);
}

/**
 * 获取文章树状结构
 */
async function getKnowledgeTree(params) {
  const { kb_id } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/knowledges/tree`);
}

/**
 * 获取文章详情
 */
async function getKnowledge(params) {
  const { kb_id, id } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/knowledges/${id}`);
}

// ==================== 知识点查询 ====================

/**
 * 获取知识点列表
 */
async function listPoints(params) {
  const { kb_id, knowledge_id, page = 1, pageSize = 50 } = params;
  if (!kb_id || !knowledge_id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/knowledges/${knowledge_id}/points?page=${page}&pageSize=${pageSize}`);
}

/**
 * 获取知识点详情
 */
async function getPoint(params) {
  const { kb_id, knowledge_id, id } = params;
  if (!kb_id || !knowledge_id || !id) {
    throw new Error('知识库 ID、文章 ID 和知识点 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/knowledges/${knowledge_id}/points/${id}`);
}

// ==================== 搜索操作 ====================

/**
 * 语义搜索
 */
async function search(params) {
  const { kb_id, query, top_k = 5, threshold = 0.1 } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  if (!query) {
    throw new Error('搜索查询不能为空');
  }
  return await httpRequest('POST', `/api/kb/${kb_id}/search`, {
    query,
    top_k,
    threshold,
  });
}

/**
 * 在指定文章中进行语义搜索（结构路径）
 * 用于已知用户问题属于哪个分类/章节时，精准搜索该分类下的内容
 */
async function searchInKnowledge(params) {
  const { kb_id, knowledge_id, query, top_k = 5, threshold = 0.1 } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  if (!knowledge_id) {
    throw new Error('文章 ID 不能为空（结构路径搜索需要指定分类/章节）');
  }
  if (!query) {
    throw new Error('搜索查询不能为空');
  }
  return await httpRequest('POST', `/api/kb/${kb_id}/search`, {
    query,
    top_k,
    threshold,
    knowledge_id, // 指定文章ID，实现结构路径搜索
  });
}

/**
 * 全局语义搜索
 */
async function globalSearch(params) {
  const { query, top_k = 10, threshold = 0.1 } = params;
  if (!query) {
    throw new Error('搜索查询不能为空');
  }
  return await httpRequest('POST', '/api/kb/search', {
    query,
    top_k,
    threshold,
  });
}

/**
 * 格式化搜索结果为易读文本
 */
function formatSearchResults(results, query) {
  if (!results || results.length === 0) {
    return `未找到与 "${query}" 相关的知识点。`;
  }

  let output = `=== 搜索结果: "${query}" ===\n\n`;

  results.forEach((item, index) => {
    const score = (item.score * 100).toFixed(1);
    output += `${index + 1}. [${score}% 相似度]\n`;
    output += `   知识点: ${item.point?.title || '无标题'}\n`;
    output += `   内容: ${item.point?.content?.substring(0, 150) || '无内容'}...\n`;
    output += `   来自文章: ${item.knowledge?.title || '未知'}\n`;
    output += `   知识库: ${item.knowledge_base?.name || '未知'}\n`;
    output += '\n';
  });

  return output;
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
    throw new Error('用户未登录，无法访问知识库。请确保 USER_ACCESS_TOKEN 环境变量已设置。');
  }

  const tools = {
    // 知识库查询
    'list_my_kbs': listMyKnowledgeBases,
    'get_kb': getKnowledgeBase,

    // 文章查询
    'list_knowledges': listKnowledges,
    'get_knowledge_tree': getKnowledgeTree,
    'get_knowledge': getKnowledge,

    // 知识点查询
    'list_points': listPoints,
    'get_point': getPoint,

    // 搜索操作
    'search': search,
    'search_in_knowledge': searchInKnowledge,
    'global_search': globalSearch,
  };

  const tool = tools[toolName];
  if (!tool) {
    const availableTools = Object.keys(tools).join(', ');
    throw new Error(`未知工具: ${toolName}. 可用工具: ${availableTools}`);
  }

  const result = await tool(params);

  // 如果是搜索操作且需要格式化
  if ((toolName === 'search' || toolName === 'global_search' || toolName === 'search_in_knowledge') && params.format === 'table') {
    return {
      success: true,
      format: 'table',
      output: formatSearchResults(result, params.query || 'search'),
      data: result,
    };
  }

  return {
    success: true,
    data: result,
  };
}

// Export for skill-runner
module.exports = {
  execute,
  formatSearchResults,
};
