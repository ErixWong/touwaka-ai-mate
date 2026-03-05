/**
 * Knowledge Base Skill - 知识库管理技能
 *
 * 通过内部API调用知识库功能
 *
 * @module knowledge-base-skill
 */

const https = require('https');
const http = require('http');
const url = require('url');

// API 配置
const API_BASE = process.env.KB_API_BASE || process.env.API_BASE || 'http://localhost:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'internal-api-secret';

/**
 * 发起 HTTP 请求
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径
 * @param {object} data - 请求数据
 * @param {string} userId - 用户 ID
 * @returns {Promise<object>} 响应数据
 */
function httpRequest(method, path, data, userId) {
  return new Promise((resolve, reject) => {
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
        'X-User-Id': String(userId),
        'X-Internal-Secret': INTERNAL_SECRET,
      },
      timeout: 30000,
      rejectUnauthorized: false,
    };

    const req = httpModule.request(requestOptions, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        // 处理 204 No Content（删除操作成功）
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

// 提取 userId（兼容 userId 和 user_id 两种格式）
function getUserId(context) {
  // 添加调试信息
  console.log('[KB Skill] Context:', JSON.stringify(context));
  console.log('[KB Skill] userId:', context?.userId, 'user_id:', context?.user_id);
  return context.userId || context.user_id;
}

// ==================== 知识库操作 ====================

/**
 * 获取知识库列表
 */
async function listKnowledgeBases(params, context) {
  const userId = getUserId(context);
  const { page = 1, pageSize = 20 } = params;
  const data = await httpRequest('GET', `/api/kb?page=${page}&pageSize=${pageSize}`, null, userId);
  return data;
}

/**
 * 获取知识库详情
 */
async function getKnowledgeBase(params, context) {
  const userId = getUserId(context);
  const { id } = params;
  if (!id) {
    throw new Error('知识库 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${id}`, null, userId);
}

/**
 * 创建知识库
 */
async function createKnowledgeBase(params, context) {
  const userId = getUserId(context);
  const { name, description, embedding_model_id, embedding_dim } = params;
  if (!name) {
    throw new Error('知识库名称不能为空');
  }
  return await httpRequest('POST', '/api/kb', {
    name,
    description,
    embedding_model_id,
    embedding_dim,
  }, userId);
}

/**
 * 更新知识库
 */
async function updateKnowledgeBase(params, context) {
  const userId = getUserId(context);
  const { id, name, description, embedding_model_id, embedding_dim } = params;
  if (!id) {
    throw new Error('知识库 ID 不能为空');
  }
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (embedding_model_id !== undefined) updates.embedding_model_id = embedding_model_id;
  if (embedding_dim !== undefined) updates.embedding_dim = embedding_dim;

  return await httpRequest('PUT', `/api/kb/${id}`, updates, userId);
}

/**
 * 删除知识库
 */
async function deleteKnowledgeBase(params, context) {
  const userId = getUserId(context);
  const { id } = params;
  if (!id) {
    throw new Error('知识库 ID 不能为空');
  }
  return await httpRequest('DELETE', `/api/kb/${id}`, null, userId);
}

// ==================== 文章操作 ====================

/**
 * 获取知识库下的文章列表
 */
async function listKnowledges(params, context) {
  const userId = getUserId(context);
  const { kb_id, page = 1, pageSize = 20 } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/knowledges?page=${page}&pageSize=${pageSize}`, null, userId);
}

/**
 * 获取文章树状结构
 */
async function getKnowledgeTree(params, context) {
  const userId = getUserId(context);
  const { kb_id } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/knowledges/tree`, null, userId);
}

/**
 * 获取文章详情
 */
async function getKnowledge(params, context) {
  const userId = getUserId(context);
  const { kb_id, id } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/knowledges/${id}`, null, userId);
}

/**
 * 创建文章
 */
async function createKnowledge(params, context) {
  const userId = getUserId(context);
  const { kb_id, title, parent_id, summary, source_type, source_url } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  if (!title) {
    throw new Error('文章标题不能为空');
  }
  return await httpRequest('POST', `/api/kb/${kb_id}/knowledges`, {
    title,
    parent_id,
    summary,
    source_type,
    source_url,
  }, userId);
}

/**
 * 更新文章
 */
async function updateKnowledge(params, context) {
  const userId = getUserId(context);
  const { kb_id, id, title, summary, status, position } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (summary !== undefined) updates.summary = summary;
  if (status !== undefined) updates.status = status;
  if (position !== undefined) updates.position = position;

  return await httpRequest('PUT', `/api/kb/${kb_id}/knowledges/${id}`, updates, userId);
}

/**
 * 删除文章
 */
async function deleteKnowledge(params, context) {
  const userId = getUserId(context);
  const { kb_id, id } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  return await httpRequest('DELETE', `/api/kb/${kb_id}/knowledges/${id}`, null, userId);
}

// ==================== 知识点操作 ====================

/**
 * 获取知识点列表
 */
async function listPoints(params, context) {
  const userId = getUserId(context);
  const { kb_id, knowledge_id, page = 1, pageSize = 50 } = params;
  if (!kb_id || !knowledge_id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/knowledges/${knowledge_id}/points?page=${page}&pageSize=${pageSize}`, null, userId);
}

/**
 * 获取知识点详情
 */
async function getPoint(params, context) {
  const userId = getUserId(context);
  const { kb_id, knowledge_id, id } = params;
  if (!kb_id || !knowledge_id || !id) {
    throw new Error('知识库 ID、文章 ID 和知识点 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/knowledges/${knowledge_id}/points/${id}`, null, userId);
}

/**
 * 创建知识点
 */
async function createPoint(params, context) {
  const userId = getUserId(context);
  const { kb_id, knowledge_id, content, title, context: pointContext } = params;
  if (!kb_id || !knowledge_id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  if (!content) {
    throw new Error('知识点内容不能为空');
  }
  return await httpRequest('POST', `/api/kb/${kb_id}/knowledges/${knowledge_id}/points`, {
    content,
    title,
    context: pointContext,
  }, userId);
}

/**
 * 更新知识点
 */
async function updatePoint(params, context) {
  const userId = getUserId(context);
  const { kb_id, knowledge_id, id, title, content, context: pointContext, position } = params;
  if (!kb_id || !knowledge_id || !id) {
    throw new Error('知识库 ID、文章 ID 和知识点 ID 不能为空');
  }
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (pointContext !== undefined) updates.context = pointContext;
  if (position !== undefined) updates.position = position;

  return await httpRequest('PUT', `/api/kb/${kb_id}/knowledges/${knowledge_id}/points/${id}`, updates, userId);
}

/**
 * 删除知识点
 */
async function deletePoint(params, context) {
  const userId = getUserId(context);
  const { kb_id, knowledge_id, id } = params;
  if (!kb_id || !knowledge_id || !id) {
    throw new Error('知识库 ID、文章 ID 和知识点 ID 不能为空');
  }
  return await httpRequest('DELETE', `/api/kb/${kb_id}/knowledges/${knowledge_id}/points/${id}`, null, userId);
}

// ==================== 搜索操作 ====================

/**
 * 语义搜索
 */
async function search(params, context) {
  const userId = getUserId(context);
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
  }, userId);
}

/**
 * 全局语义搜索
 */
async function globalSearch(params, context) {
  const userId = getUserId(context);
  const { query, top_k = 10, threshold = 0.1 } = params;
  if (!query) {
    throw new Error('搜索查询不能为空');
  }
  return await httpRequest('POST', '/api/kb/search', {
    query,
    top_k,
    threshold,
  }, userId);
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
 * @param {object} context - 执行上下文 (userId, user_id, expertId等)
 * @returns {Promise<object>} 执行结果
 */
async function execute(toolName, params, context = {}) {
  const userId = getUserId(context);
  if (!userId) {
    throw new Error('用户未登录，无法访问知识库');
  }

  const tools = {
    // 知识库操作
    'list_knowledge_bases': listKnowledgeBases,
    'list_kbs': listKnowledgeBases,
    'get_knowledge_base': getKnowledgeBase,
    'get_kb': getKnowledgeBase,
    'create_knowledge_base': createKnowledgeBase,
    'create_kb': createKnowledgeBase,
    'update_knowledge_base': updateKnowledgeBase,
    'update_kb': updateKnowledgeBase,
    'delete_knowledge_base': deleteKnowledgeBase,
    'delete_kb': deleteKnowledgeBase,

    // 文章操作
    'list_knowledges': listKnowledges,
    'get_knowledge_tree': getKnowledgeTree,
    'get_knowledge': getKnowledge,
    'create_knowledge': createKnowledge,
    'update_knowledge': updateKnowledge,
    'delete_knowledge': deleteKnowledge,

    // 知识点操作
    'list_points': listPoints,
    'get_point': getPoint,
    'create_point': createPoint,
    'update_point': updatePoint,
    'delete_point': deletePoint,

    // 搜索操作
    'search': search,
    'global_search': globalSearch,
  };

  const tool = tools[toolName];
  if (!tool) {
    const availableTools = Object.keys(tools).join(', ');
    throw new Error(`未知工具: ${toolName}. 可用工具: ${availableTools}`);
  }

  const result = await tool(params, context);

  // 如果是搜索操作且需要格式化
  if ((toolName === 'search' || toolName === 'global_search') && params.format === 'table') {
    return {
      success: true,
      format: 'table',
      output: formatSearchResults(result, params.query || params.kb_id),
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
