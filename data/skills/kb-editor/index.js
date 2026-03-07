/**
 * KB Editor Skill - 知识库编辑技能
 *
 * 用于知识专家创建和管理知识库、文章、知识点
 * 通过 API 调用执行操作，使用用户 Token 认证
 *
 * @module kb-editor-skill
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
    // [DEBUG] 请求开始
    console.log('[KB-EDITOR DEBUG] ========== REQUEST START ==========');
    console.log('[KB-EDITOR DEBUG] Method:', method);
    console.log('[KB-EDITOR DEBUG] Path:', path);
    console.log('[KB-EDITOR DEBUG] API_BASE:', API_BASE);
    console.log('[KB-EDITOR DEBUG] TOKEN exists:', !!USER_ACCESS_TOKEN);
    console.log('[KB-EDITOR DEBUG] TOKEN (first 20 chars):', USER_ACCESS_TOKEN ? USER_ACCESS_TOKEN.substring(0, 20) + '...' : 'EMPTY');
    console.log('[KB-EDITOR DEBUG] Request Data:', JSON.stringify(data, null, 2));

    if (!USER_ACCESS_TOKEN) {
      console.log('[KB-EDITOR DEBUG] ERROR: Missing USER_ACCESS_TOKEN');
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

    console.log('[KB-EDITOR DEBUG] Full URL:', parsedUrl.toString());

    const req = httpModule.request(requestOptions, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        console.log('[KB-EDITOR DEBUG] Response Status:', res.statusCode);
        console.log('[KB-EDITOR DEBUG] Response Body (first 500 chars):', body.substring(0, 500));

        // 处理 204 No Content（删除操作成功）
        if (res.statusCode === 204) {
          console.log('[KB-EDITOR DEBUG] 204 No Content - Success');
          console.log('[KB-EDITOR DEBUG] ========== REQUEST END ==========');
          resolve({ success: true });
          return;
        }

        try {
          const json = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[KB-EDITOR DEBUG] Success! Parsed data:', JSON.stringify(json.data || json, null, 2).substring(0, 500));
            console.log('[KB-EDITOR DEBUG] ========== REQUEST END ==========');
            resolve(json.data || json);
          } else {
            console.log('[KB-EDITOR DEBUG] HTTP Error:', res.statusCode, json.message || json.error);
            console.log('[KB-EDITOR DEBUG] ========== REQUEST END ==========');
            reject(new Error(json.message || json.error || `HTTP ${res.statusCode}`));
          }
        } catch (e) {
          console.log('[KB-EDITOR DEBUG] JSON Parse Error:', e.message);
          console.log('[KB-EDITOR DEBUG] ========== REQUEST END ==========');
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => {
      console.log('[KB-EDITOR DEBUG] Request ERROR:', e.message);
      console.log('[KB-EDITOR DEBUG] ========== REQUEST END ==========');
      reject(new Error(`Request failed: ${e.message}`));
    });

    req.on('timeout', () => {
      console.log('[KB-EDITOR DEBUG] Request TIMEOUT');
      console.log('[KB-EDITOR DEBUG] ========== REQUEST END ==========');
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
    console.log('[KB-EDITOR DEBUG] Request sent, waiting for response...');
  });
}

// ==================== 知识库操作 ====================

/**
 * 获取我的知识库列表
 */
async function listMyKnowledgeBases(params) {
  const { page = 1, pageSize = 20 } = params;
  const data = await httpRequest('GET', `/api/kb?page=${page}&pageSize=${pageSize}`);
  return data;
}

/**
 * 获取可用的嵌入模型列表
 */
async function listEmbeddingModels(params) {
  const data = await httpRequest('GET', '/api/models');
  // 过滤出嵌入模型
  const embeddingModels = data
    ?.filter(m => m.model_type === 'embedding')
    ?.map(m => ({
      id: m.id,
      name: m.name,
      model_name: m.model_name,
      embedding_dim: m.embedding_dim,
      provider_name: m.provider_name,
      description: m.description,
    })) || [];
  return embeddingModels;
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

/**
 * 创建知识库
 */
async function createKnowledgeBase(params) {
  const { name, description, embedding_model_id, embedding_dim } = params;
  if (!name) {
    throw new Error('知识库名称不能为空');
  }
  // 默认使用 bge-m3 嵌入模型
  const finalEmbeddingModelId = embedding_model_id || 'bge-m3';
  // bge-m3 生成的向量维度为 1024
  const finalEmbeddingDim = embedding_dim || 1024;

  return await httpRequest('POST', '/api/kb', {
    name,
    description,
    embedding_model_id: finalEmbeddingModelId,
    embedding_dim: finalEmbeddingDim,
  });
}

/**
 * 更新知识库
 */
async function updateKnowledgeBase(params) {
  const { id, name, description, embedding_model_id, embedding_dim } = params;
  if (!id) {
    throw new Error('知识库 ID 不能为空');
  }
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (embedding_model_id !== undefined) updates.embedding_model_id = embedding_model_id;
  if (embedding_dim !== undefined) updates.embedding_dim = embedding_dim;

  return await httpRequest('PUT', `/api/kb/${id}`, updates);
}

/**
 * 删除知识库
 */
async function deleteKnowledgeBase(params) {
  const { id } = params;
  if (!id) {
    throw new Error('知识库 ID 不能为空');
  }
  return await httpRequest('DELETE', `/api/kb/${id}`);
}

// ==================== 文章操作 ====================

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

/**
 * 创建文章
 */
async function createKnowledge(params) {
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
  });
}

/**
 * 更新文章
 */
async function updateKnowledge(params) {
  const { kb_id, id, title, summary, status, position } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (summary !== undefined) updates.summary = summary;
  if (status !== undefined) updates.status = status;
  if (position !== undefined) updates.position = position;

  return await httpRequest('PUT', `/api/kb/${kb_id}/knowledges/${id}`, updates);
}

/**
 * 删除文章
 */
async function deleteKnowledge(params) {
  const { kb_id, id } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  return await httpRequest('DELETE', `/api/kb/${kb_id}/knowledges/${id}`);
}

// ==================== 知识点操作 ====================

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

/**
 * 创建知识点
 */
async function createPoint(params) {
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
  });
}

/**
 * 更新知识点
 */
async function updatePoint(params) {
  const { kb_id, knowledge_id, id, title, content, context: pointContext, position } = params;
  if (!kb_id || !knowledge_id || !id) {
    throw new Error('知识库 ID、文章 ID 和知识点 ID 不能为空');
  }
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (pointContext !== undefined) updates.context = pointContext;
  if (position !== undefined) updates.position = position;

  return await httpRequest('PUT', `/api/kb/${kb_id}/knowledges/${knowledge_id}/points/${id}`, updates);
}

/**
 * 删除知识点
 */
async function deletePoint(params) {
  const { kb_id, knowledge_id, id } = params;
  if (!kb_id || !knowledge_id || !id) {
    throw new Error('知识库 ID、文章 ID 和知识点 ID 不能为空');
  }
  return await httpRequest('DELETE', `/api/kb/${kb_id}/knowledges/${knowledge_id}/points/${id}`);
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
    // 知识库操作
    'list_my_kbs': listMyKnowledgeBases,
    'list_embedding_models': listEmbeddingModels,
    'get_kb': getKnowledgeBase,
    'create_kb': createKnowledgeBase,
    'update_kb': updateKnowledgeBase,
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
};
