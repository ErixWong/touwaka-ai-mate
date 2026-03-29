/**
 * KB Search Skill - 知识库检索技能
 *
 * 用于所有专家查询和搜索知识点
 * 通过 API 调用执行操作，使用用户 Token 认证
 *
 * 适配新知识库结构：
 * - kb_articles (文章)
 * - kb_sections (节，自指向无限层级)
 * - kb_paragraphs (段，可标记为知识点)
 * - kb_tags (标签)
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
            // 错误日志
            console.error(`[KB-SEARCH] HTTP ${res.statusCode} on ${method} ${path}:`, json.message || json.error);
            reject(new Error(json.message || json.error || `HTTP ${res.statusCode}`));
          }
        } catch (e) {
          console.error(`[KB-SEARCH] JSON parse error on ${method} ${path}:`, e.message);
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => {
      console.error(`[KB-SEARCH] Request error on ${method} ${path}:`, e.message);
      reject(new Error(`Request failed: ${e.message}`));
    });

    req.on('timeout', () => {
      console.error(`[KB-SEARCH] Request timeout on ${method} ${path}`);
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
async function listArticles(params) {
  const { kb_id, page = 1, pageSize = 20, status, search } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }

  let path = `/api/kb/${kb_id}/articles?page=${page}&pageSize=${pageSize}`;
  if (status) path += `&status=${status}`;
  if (search) path += `&search=${encodeURIComponent(search)}`;

  return await httpRequest('GET', path);
}

/**
 * 获取文章详情
 */
async function getArticle(params) {
  const { kb_id, id } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/articles/${id}`);
}

/**
 * 获取文章的完整树状结构（包含所有节和段落）
 */
async function getArticleTree(params) {
  const { kb_id, article_id } = params;
  if (!kb_id || !article_id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/articles/${article_id}/tree`);
}

// ==================== 节查询 ====================

/**
 * 查询节列表
 */
async function listSections(params) {
  const { kb_id, article_id, page = 1, pageSize = 100 } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }

  const body = { page, pageSize };
  if (article_id) {
    body.filter = [{ field: 'article_id', value: article_id }];
  }

  return await httpRequest('POST', `/api/kb/${kb_id}/sections/query`, body);
}

// ==================== 段落查询 ====================

/**
 * 查询段落列表
 */
async function listParagraphs(params) {
  const { kb_id, section_id, is_knowledge_point, page = 1, pageSize = 100 } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }

  const body = { page, pageSize };
  if (section_id) {
    body.filter = [{ field: 'section_id', value: section_id }];
  }
  if (is_knowledge_point !== undefined) {
    if (!body.filter) body.filter = [];
    body.filter.push({ field: 'is_knowledge_point', value: is_knowledge_point });
  }

  return await httpRequest('POST', `/api/kb/${kb_id}/paragraphs/query`, body);
}

/**
 * 获取知识点列表（便捷方法，只返回标记为知识点的段落）
 */
async function listKnowledgePoints(params) {
  const { kb_id, section_id, page = 1, pageSize = 100 } = params;
  return await listParagraphs({
    kb_id,
    section_id,
    is_knowledge_point: true,
    page,
    pageSize,
  });
}

// ==================== 标签查询 ====================

/**
 * 查询标签列表
 */
async function listTags(params) {
  const { kb_id, page = 1, pageSize = 100 } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/tags?page=${page}&pageSize=${pageSize}`);
}

// ==================== 搜索操作 ====================

/**
 * 语义搜索（在指定知识库中搜索知识点段落）
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
 * 用于已知用户问题属于哪个文章时，精准搜索该文章下的内容
 */
async function searchInArticle(params) {
  const { kb_id, article_id, query, top_k = 5, threshold = 0.1 } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  if (!article_id) {
    throw new Error('文章 ID 不能为空（结构路径搜索需要指定文章）');
  }
  if (!query) {
    throw new Error('搜索查询不能为空');
  }
  return await httpRequest('POST', `/api/kb/${kb_id}/search`, {
    query,
    top_k,
    threshold,
    article_id, // 指定文章ID，实现结构路径搜索
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
    output += `   知识点: ${item.paragraph?.title || '无标题'}\n`;
    output += `   内容: ${item.paragraph?.content?.substring(0, 150) || '无内容'}...\n`;
    output += `   来自文章: ${item.article?.title || '未知'}\n`;
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
    'list_mine': listMyKnowledgeBases,
    'get': getKnowledgeBase,

    // 文章查询
    'list_articles': listArticles,
    'get_article': getArticle,
    'get_article_tree': getArticleTree,

    // 节查询
    'list_sections': listSections,

    // 段落查询
    'list_paragraphs': listParagraphs,
    'list_knowledge_points': listKnowledgePoints,

    // 标签查询
    'list_tags': listTags,

    // 搜索操作
    'search': search,
    'search_in_article': searchInArticle,
    'global_search': globalSearch,
  };

  const tool = tools[toolName];
  if (!tool) {
    const availableTools = Object.keys(tools).join(', ');
    throw new Error(`未知工具: ${toolName}. 可用工具: ${availableTools}`);
  }

  const result = await tool(params);

  // 如果是搜索操作且需要格式化
  if ((toolName === 'search' || toolName === 'global_search' || toolName === 'search_in_article') && params.format === 'table') {
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

/**
 * 获取工具清单 - 用于技能注册
 * @returns {Array} 工具定义数组
 */
function getTools() {
  return [
    // 知识库查询
    {
      name: 'list_mine',
      description: '列出当前用户可访问的知识库',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', description: '页码，默认 1' },
          pageSize: { type: 'integer', description: '每页数量，默认 20' },
        },
      },
    },
    {
      name: 'get',
      description: '获取知识库详情',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '知识库 ID' },
        },
        required: ['id'],
      },
    },
    // 文章查询
    {
      name: 'list_articles',
      description: '获取知识库下的文章列表',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          page: { type: 'integer', description: '页码，默认 1' },
          pageSize: { type: 'integer', description: '每页数量，默认 20' },
          status: { type: 'string', description: '状态过滤（pending/processing/ready/error）' },
          search: { type: 'string', description: '搜索关键词' },
        },
        required: ['kb_id'],
      },
    },
    {
      name: 'get_article',
      description: '获取文章详情',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          id: { type: 'string', description: '文章 ID' },
        },
        required: ['kb_id', 'id'],
      },
    },
    {
      name: 'get_article_tree',
      description: '获取文章的完整树状结构（包含所有节和段落）',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          article_id: { type: 'string', description: '文章 ID' },
        },
        required: ['kb_id', 'article_id'],
      },
    },
    // 节查询
    {
      name: 'list_sections',
      description: '查询节列表',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          article_id: { type: 'string', description: '文章 ID 过滤' },
          page: { type: 'integer', description: '页码，默认 1' },
          pageSize: { type: 'integer', description: '每页数量，默认 100' },
        },
        required: ['kb_id'],
      },
    },
    // 段落查询
    {
      name: 'list_paragraphs',
      description: '查询段落列表',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          section_id: { type: 'string', description: '节 ID 过滤' },
          is_knowledge_point: { type: 'boolean', description: '是否知识点过滤' },
          page: { type: 'integer', description: '页码，默认 1' },
          pageSize: { type: 'integer', description: '每页数量，默认 100' },
        },
        required: ['kb_id'],
      },
    },
    {
      name: 'list_knowledge_points',
      description: '获取知识点列表（只返回标记为知识点的段落）',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          section_id: { type: 'string', description: '节 ID 过滤' },
          page: { type: 'integer', description: '页码，默认 1' },
          pageSize: { type: 'integer', description: '每页数量，默认 100' },
        },
        required: ['kb_id'],
      },
    },
    // 标签查询
    {
      name: 'list_tags',
      description: '获取标签列表',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          page: { type: 'integer', description: '页码，默认 1' },
          pageSize: { type: 'integer', description: '每页数量，默认 100' },
        },
        required: ['kb_id'],
      },
    },
    // 搜索操作
    {
      name: 'search',
      description: '在指定知识库中进行语义搜索（搜索知识点段落）',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          query: { type: 'string', description: '搜索查询' },
          top_k: { type: 'integer', description: '返回结果数量，默认 5' },
          threshold: { type: 'number', description: '相似度阈值，默认 0.1' },
          format: { type: 'string', enum: ['table'], description: '输出格式' },
        },
        required: ['kb_id', 'query'],
      },
    },
    {
      name: 'search_in_article',
      description: '在指定文章中进行语义搜索（结构路径）',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          article_id: { type: 'string', description: '文章 ID' },
          query: { type: 'string', description: '搜索查询' },
          top_k: { type: 'integer', description: '返回结果数量，默认 5' },
          threshold: { type: 'number', description: '相似度阈值，默认 0.1' },
        },
        required: ['kb_id', 'article_id', 'query'],
      },
    },
    {
      name: 'global_search',
      description: '全局语义搜索，搜索用户所有知识库',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询' },
          top_k: { type: 'integer', description: '返回结果数量，默认 10' },
          threshold: { type: 'number', description: '相似度阈值，默认 0.1' },
          format: { type: 'string', enum: ['table'], description: '输出格式' },
        },
        required: ['query'],
      },
    },
  ];
}

// Export for skill-runner
module.exports = {
  execute,
  formatSearchResults,
  getTools,
};
