/**
 * KB Editor Skill - 知识库编辑技能
 *
 * 用于知识专家创建和管理知识库、文章、节、段落、标签
 * 通过 API 调用执行操作，使用用户 Token 认证
 *
 * 适配新知识库结构：
 * - kb_articles (文章)
 * - kb_sections (节，自指向无限层级)
 * - kb_paragraphs (段，可标记为知识点)
 * - kb_tags (标签)
 * - kb_article_tags (文章-标签关联)
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
 * 获取文章的完整树状结构（包含节和段落）
 */
async function getArticleTree(params) {
  const { kb_id, article_id } = params;
  if (!kb_id || !article_id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  return await httpRequest('GET', `/api/kb/${kb_id}/articles/${article_id}/tree`);
}

/**
 * 创建文章
 */
async function createArticle(params) {
  const { kb_id, title, summary, source_type, source_url, file_path, status, tags } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  if (!title) {
    throw new Error('文章标题不能为空');
  }
  return await httpRequest('POST', `/api/kb/${kb_id}/articles`, {
    title,
    summary,
    source_type: source_type || 'manual',
    source_url,
    file_path,
    status: status || 'pending',
    tags,
  });
}

/**
 * 更新文章
 */
async function updateArticle(params) {
  const { kb_id, id, title, summary, source_type, source_url, file_path, status, tags } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (summary !== undefined) updates.summary = summary;
  if (source_type !== undefined) updates.source_type = source_type;
  if (source_url !== undefined) updates.source_url = source_url;
  if (file_path !== undefined) updates.file_path = file_path;
  if (status !== undefined) updates.status = status;
  if (tags !== undefined) updates.tags = tags;

  return await httpRequest('PUT', `/api/kb/${kb_id}/articles/${id}`, updates);
}

/**
 * 删除文章
 */
async function deleteArticle(params) {
  const { kb_id, id } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和文章 ID 不能为空');
  }
  return await httpRequest('DELETE', `/api/kb/${kb_id}/articles/${id}`);
}

// ==================== 节操作 ====================

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

/**
 * 创建节
 */
async function createSection(params) {
  const { kb_id, article_id, parent_id, title } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  if (!article_id) {
    throw new Error('文章 ID 不能为空');
  }
  if (!title) {
    throw new Error('节标题不能为空');
  }
  return await httpRequest('POST', `/api/kb/${kb_id}/sections`, {
    article_id,
    parent_id,
    title,
  });
}

/**
 * 更新节
 */
async function updateSection(params) {
  const { kb_id, id, title } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和节 ID 不能为空');
  }
  const updates = {};
  if (title !== undefined) updates.title = title;

  return await httpRequest('PUT', `/api/kb/${kb_id}/sections/${id}`, updates);
}

/**
 * 移动节（调整顺序）
 */
async function moveSection(params) {
  const { kb_id, id, direction } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和节 ID 不能为空');
  }
  if (!['up', 'down'].includes(direction)) {
    throw new Error('direction 必须是 "up" 或 "down"');
  }
  return await httpRequest('POST', `/api/kb/${kb_id}/sections/${id}/move`, { direction });
}

/**
 * 删除节
 */
async function deleteSection(params) {
  const { kb_id, id } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和节 ID 不能为空');
  }
  return await httpRequest('DELETE', `/api/kb/${kb_id}/sections/${id}`);
}

// ==================== 段落操作 ====================

/**
 * 查询段落列表
 */
async function listParagraphs(params) {
  const { kb_id, section_id, page = 1, pageSize = 100, is_knowledge_point } = params;
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
 * 创建段落
 * @param {string} context - 知识点上下文（可选）。用于语义检索。
 *        当 is_knowledge_point 为 true 时，使用一两句话总结该知识点及其所在文章（中文）。
 */
async function createParagraph(params) {
  const { kb_id, section_id, title, content, context, is_knowledge_point, token_count } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  if (!section_id) {
    throw new Error('节 ID 不能为空');
  }
  if (!content) {
    throw new Error('段落内容不能为空');
  }
  return await httpRequest('POST', `/api/kb/${kb_id}/paragraphs`, {
    section_id,
    title,
    content,
    context, // 知识点的上下文，用于语义检索
    is_knowledge_point: is_knowledge_point || false,
    token_count: token_count || 0,
  });
}

/**
 * 更新段落
 * @param {string} context - 知识点上下文（可选）。用于语义检索。
 *        当 is_knowledge_point 为 true 时，使用一两句话总结该知识点及其所在文章（中文）。
 */
async function updateParagraph(params) {
  const { kb_id, id, title, content, context, is_knowledge_point, token_count } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和段落 ID 不能为空');
  }
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (context !== undefined) updates.context = context;
  if (is_knowledge_point !== undefined) updates.is_knowledge_point = is_knowledge_point;
  if (token_count !== undefined) updates.token_count = token_count;

  return await httpRequest('PUT', `/api/kb/${kb_id}/paragraphs/${id}`, updates);
}

/**
 * 移动段落（调整顺序）
 */
async function moveParagraph(params) {
  const { kb_id, id, direction } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和段落 ID 不能为空');
  }
  if (!['up', 'down'].includes(direction)) {
    throw new Error('direction 必须是 "up" 或 "down"');
  }
  return await httpRequest('POST', `/api/kb/${kb_id}/paragraphs/${id}/move`, { direction });
}

/**
 * 删除段落
 */
async function deleteParagraph(params) {
  const { kb_id, id } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和段落 ID 不能为空');
  }
  return await httpRequest('DELETE', `/api/kb/${kb_id}/paragraphs/${id}`);
}

// ==================== 标签操作 ====================

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

/**
 * 创建标签
 */
async function createTag(params) {
  const { kb_id, name, description } = params;
  if (!kb_id) {
    throw new Error('知识库 ID 不能为空');
  }
  if (!name) {
    throw new Error('标签名称不能为空');
  }
  return await httpRequest('POST', `/api/kb/${kb_id}/tags`, {
    name,
    description,
  });
}

/**
 * 更新标签
 */
async function updateTag(params) {
  const { kb_id, id, name, description } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和标签 ID 不能为空');
  }
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;

  return await httpRequest('PUT', `/api/kb/${kb_id}/tags/${id}`, updates);
}

/**
 * 删除标签
 */
async function deleteTag(params) {
  const { kb_id, id } = params;
  if (!kb_id || !id) {
    throw new Error('知识库 ID 和标签 ID 不能为空');
  }
  return await httpRequest('DELETE', `/api/kb/${kb_id}/tags/${id}`);
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
    'list_articles': listArticles,
    'get_article': getArticle,
    'get_article_tree': getArticleTree,
    'create_article': createArticle,
    'update_article': updateArticle,
    'delete_article': deleteArticle,

    // 节操作
    'list_sections': listSections,
    'create_section': createSection,
    'update_section': updateSection,
    'move_section': moveSection,
    'delete_section': deleteSection,

    // 段落操作
    'list_paragraphs': listParagraphs,
    'create_paragraph': createParagraph,
    'update_paragraph': updateParagraph,
    'move_paragraph': moveParagraph,
    'delete_paragraph': deleteParagraph,

    // 标签操作
    'list_tags': listTags,
    'create_tag': createTag,
    'update_tag': updateTag,
    'delete_tag': deleteTag,
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

/**
 * 获取工具清单 - 用于技能注册
 * @returns {Array} 工具定义数组
 */
function getTools() {
  return [
    // 知识库操作
    {
      name: 'list_my_kbs',
      description: '列出当前用户拥有的知识库',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', description: '页码，默认 1' },
          pageSize: { type: 'integer', description: '每页数量，默认 20' },
        },
      },
    },
    {
      name: 'list_embedding_models',
      description: '获取可用的嵌入模型列表，用于创建知识库时选择',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_kb',
      description: '获取知识库详情',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '知识库 ID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'create_kb',
      description: '创建知识库',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '知识库名称' },
          description: { type: 'string', description: '知识库描述' },
          embedding_model_id: { type: 'string', description: '嵌入模型 ID，默认 bge-m3' },
          embedding_dim: { type: 'integer', description: '向量维度，默认 1024' },
        },
        required: ['name'],
      },
    },
    {
      name: 'update_kb',
      description: '更新知识库',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '知识库 ID' },
          name: { type: 'string', description: '新名称' },
          description: { type: 'string', description: '新描述' },
          embedding_model_id: { type: 'string', description: '新嵌入模型 ID' },
          embedding_dim: { type: 'integer', description: '新向量维度' },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_kb',
      description: '删除知识库',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '知识库 ID' },
        },
        required: ['id'],
      },
    },
    // 文章操作
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
    {
      name: 'create_article',
      description: '创建文章',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          title: { type: 'string', description: '文章标题' },
          summary: { type: 'string', description: '文章摘要' },
          source_type: { type: 'string', description: '来源类型（manual/upload/url）' },
          source_url: { type: 'string', description: '来源 URL' },
          file_path: { type: 'string', description: '本地文件路径' },
          status: { type: 'string', description: '状态（pending/processing/ready/error）' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签名数组' },
        },
        required: ['kb_id', 'title'],
      },
    },
    {
      name: 'update_article',
      description: '更新文章',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          id: { type: 'string', description: '文章 ID' },
          title: { type: 'string', description: '新标题' },
          summary: { type: 'string', description: '新摘要' },
          source_type: { type: 'string', description: '来源类型' },
          source_url: { type: 'string', description: '来源 URL' },
          file_path: { type: 'string', description: '本地文件路径' },
          status: { type: 'string', description: '状态' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签名数组' },
        },
        required: ['kb_id', 'id'],
      },
    },
    {
      name: 'delete_article',
      description: '删除文章（级联删除所有节和段落）',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          id: { type: 'string', description: '文章 ID' },
        },
        required: ['kb_id', 'id'],
      },
    },
    // 节操作
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
    {
      name: 'create_section',
      description: '创建节（支持无限层级）',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          article_id: { type: 'string', description: '所属文章 ID' },
          parent_id: { type: 'string', description: '父节 ID（用于创建子节）' },
          title: { type: 'string', description: '节标题' },
        },
        required: ['kb_id', 'article_id', 'title'],
      },
    },
    {
      name: 'update_section',
      description: '更新节',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          id: { type: 'string', description: '节 ID' },
          title: { type: 'string', description: '新标题' },
        },
        required: ['kb_id', 'id'],
      },
    },
    {
      name: 'move_section',
      description: '移动节（与相邻节交换位置）',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          id: { type: 'string', description: '节 ID' },
          direction: { type: 'string', enum: ['up', 'down'], description: '移动方向' },
        },
        required: ['kb_id', 'id', 'direction'],
      },
    },
    {
      name: 'delete_section',
      description: '删除节（级联删除所有子节和段落）',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          id: { type: 'string', description: '节 ID' },
        },
        required: ['kb_id', 'id'],
      },
    },
    // 段落操作
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
      name: 'create_paragraph',
      description: '创建段落（可标记为知识点）。⚠️核心原则：content必须是原文完整复制，禁止提炼、总结、改写或省略。即使原文很长也要完整录入。',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          section_id: { type: 'string', description: '所属节 ID' },
          title: { type: 'string', description: '段落标题' },
          content: { type: 'string', description: '段落内容（必须是原文完整复制，禁止提炼、总结、改写、省略或截断）' },
          context: { type: 'string', description: '知识点上下文（可选）。当 is_knowledge_point 为 true 时，使用一两句话总结该知识点及其所在文章（中文），便于语义检索' },
          is_knowledge_point: { type: 'boolean', description: '是否为知识点，默认 false' },
          token_count: { type: 'integer', description: 'Token 数量，默认 0' },
        },
        required: ['kb_id', 'section_id', 'content'],
      },
    },
    {
      name: 'update_paragraph',
      description: '更新段落。⚠️核心原则：content必须是原文完整复制，禁止提炼、总结、改写或省略。',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          id: { type: 'string', description: '段落 ID' },
          title: { type: 'string', description: '新标题' },
          content: { type: 'string', description: '新内容（必须是原文完整复制，禁止提炼、总结、改写、省略或截断）' },
          context: { type: 'string', description: '知识点上下文（可选）。当 is_knowledge_point 为 true 时，使用一两句话总结该知识点及其所在文章（中文），便于语义检索' },
          is_knowledge_point: { type: 'boolean', description: '是否为知识点' },
          token_count: { type: 'integer', description: 'Token 数量' },
        },
        required: ['kb_id', 'id'],
      },
    },
    {
      name: 'move_paragraph',
      description: '移动段落（与相邻段交换位置）',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          id: { type: 'string', description: '段落 ID' },
          direction: { type: 'string', enum: ['up', 'down'], description: '移动方向' },
        },
        required: ['kb_id', 'id', 'direction'],
      },
    },
    {
      name: 'delete_paragraph',
      description: '删除段落',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          id: { type: 'string', description: '段落 ID' },
        },
        required: ['kb_id', 'id'],
      },
    },
    // 标签操作
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
    {
      name: 'create_tag',
      description: '创建标签',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          name: { type: 'string', description: '标签名称' },
          description: { type: 'string', description: '标签描述' },
        },
        required: ['kb_id', 'name'],
      },
    },
    {
      name: 'update_tag',
      description: '更新标签',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          id: { type: 'string', description: '标签 ID' },
          name: { type: 'string', description: '新名称' },
          description: { type: 'string', description: '新描述' },
        },
        required: ['kb_id', 'id'],
      },
    },
    {
      name: 'delete_tag',
      description: '删除标签',
      parameters: {
        type: 'object',
        properties: {
          kb_id: { type: 'string', description: '知识库 ID' },
          id: { type: 'string', description: '标签 ID' },
        },
        required: ['kb_id', 'id'],
      },
    },
  ];
}

// Export for skill-runner
module.exports = {
  execute,
  getTools,
};
