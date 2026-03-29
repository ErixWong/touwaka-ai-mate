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
 * 工具合并：25 个工具 → 5 个工具（按资源类型）
 * - knowledge_base: 知识库操作
 * - article: 文章操作
 * - section: 节操作
 * - paragraph: 段落操作
 * - tag: 标签操作
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
 * 知识库统一操作处理器
 */
async function handleKb(params) {
  const { action, id, name, description, embedding_model_id, embedding_dim, page, pageSize } = params;

  switch (action) {
    case 'list':
      return await httpRequest('GET', `/api/kb?page=${page || 1}&pageSize=${pageSize || 20}`);

    case 'list_models':
      const data = await httpRequest('GET', '/api/models');
      return data?.filter(m => m.model_type === 'embedding')?.map(m => ({
        id: m.id,
        name: m.name,
        model_name: m.model_name,
        embedding_dim: m.embedding_dim,
        provider_name: m.provider_name,
        description: m.description,
      })) || [];

    case 'get':
      if (!id) throw new Error('知识库 ID 不能为空');
      return await httpRequest('GET', `/api/kb/${id}`);

    case 'create':
      if (!name) throw new Error('知识库名称不能为空');
      return await httpRequest('POST', '/api/kb', {
        name,
        description,
        embedding_model_id: embedding_model_id || 'bge-m3',
        embedding_dim: embedding_dim || 1024,
      });

    case 'update':
      if (!id) throw new Error('知识库 ID 不能为空');
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (embedding_model_id !== undefined) updates.embedding_model_id = embedding_model_id;
      if (embedding_dim !== undefined) updates.embedding_dim = embedding_dim;
      return await httpRequest('PUT', `/api/kb/${id}`, updates);

    case 'delete':
      if (!id) throw new Error('知识库 ID 不能为空');
      return await httpRequest('DELETE', `/api/kb/${id}`);

    default:
      throw new Error(`未知操作: ${action}. 可用操作: list, list_models, get, create, update, delete`);
  }
}

// ==================== 文章操作 ====================

/**
 * 文章统一操作处理器
 */
async function handleArticle(params) {
  const { action, kb_id, id, article_id, title, summary, source_type, source_url, file_path, status, tags, page, pageSize, search } = params;

  if (!kb_id) throw new Error('知识库 ID 不能为空');

  switch (action) {
    case 'list':
      let path = `/api/kb/${kb_id}/articles?page=${page || 1}&pageSize=${pageSize || 20}`;
      if (status) path += `&status=${status}`;
      if (search) path += `&search=${encodeURIComponent(search)}`;
      return await httpRequest('GET', path);

    case 'get':
      if (!id) throw new Error('文章 ID 不能为空');
      return await httpRequest('GET', `/api/kb/${kb_id}/articles/${id}`);

    case 'get_tree':
      if (!article_id) throw new Error('文章 ID 不能为空');
      return await httpRequest('GET', `/api/kb/${kb_id}/articles/${article_id}/tree`);

    case 'create':
      if (!title) throw new Error('文章标题不能为空');
      return await httpRequest('POST', `/api/kb/${kb_id}/articles`, {
        title,
        summary,
        source_type: source_type || 'manual',
        source_url,
        file_path,
        status: status || 'pending',
        tags,
      });

    case 'update':
      if (!id) throw new Error('文章 ID 不能为空');
      const updates = {};
      if (title !== undefined) updates.title = title;
      if (summary !== undefined) updates.summary = summary;
      if (source_type !== undefined) updates.source_type = source_type;
      if (source_url !== undefined) updates.source_url = source_url;
      if (file_path !== undefined) updates.file_path = file_path;
      if (status !== undefined) updates.status = status;
      if (tags !== undefined) updates.tags = tags;
      return await httpRequest('PUT', `/api/kb/${kb_id}/articles/${id}`, updates);

    case 'delete':
      if (!id) throw new Error('文章 ID 不能为空');
      return await httpRequest('DELETE', `/api/kb/${kb_id}/articles/${id}`);

    default:
      throw new Error(`未知操作: ${action}. 可用操作: list, get, get_tree, create, update, delete`);
  }
}

// ==================== 节操作 ====================

/**
 * 节统一操作处理器
 */
async function handleSection(params) {
  const { action, kb_id, id, article_id, parent_id, title, direction, page, pageSize } = params;

  if (!kb_id) throw new Error('知识库 ID 不能为空');

  switch (action) {
    case 'list':
      const body = { page: page || 1, pageSize: pageSize || 100 };
      if (article_id) {
        body.filter = [{ field: 'article_id', value: article_id }];
      }
      return await httpRequest('POST', `/api/kb/${kb_id}/sections/query`, body);

    case 'create':
      if (!article_id) throw new Error('文章 ID 不能为空');
      if (!title) throw new Error('节标题不能为空');
      return await httpRequest('POST', `/api/kb/${kb_id}/sections`, {
        article_id,
        parent_id,
        title,
      });

    case 'update':
      if (!id) throw new Error('节 ID 不能为空');
      return await httpRequest('PUT', `/api/kb/${kb_id}/sections/${id}`, { title });

    case 'move':
      if (!id) throw new Error('节 ID 不能为空');
      if (!['up', 'down'].includes(direction)) throw new Error('direction 必须是 "up" 或 "down"');
      return await httpRequest('POST', `/api/kb/${kb_id}/sections/${id}/move`, { direction });

    case 'delete':
      if (!id) throw new Error('节 ID 不能为空');
      return await httpRequest('DELETE', `/api/kb/${kb_id}/sections/${id}`);

    default:
      throw new Error(`未知操作: ${action}. 可用操作: list, create, update, move, delete`);
  }
}

// ==================== 段落操作 ====================

/**
 * 段落统一操作处理器
 */
async function handleParagraph(params) {
  const { action, kb_id, id, section_id, title, content, context, is_knowledge_point, token_count, direction, page, pageSize } = params;

  if (!kb_id) throw new Error('知识库 ID 不能为空');

  switch (action) {
    case 'list':
      const body = { page: page || 1, pageSize: pageSize || 100 };
      if (section_id) {
        body.filter = [{ field: 'section_id', value: section_id }];
      }
      if (is_knowledge_point !== undefined) {
        if (!body.filter) body.filter = [];
        body.filter.push({ field: 'is_knowledge_point', value: is_knowledge_point });
      }
      return await httpRequest('POST', `/api/kb/${kb_id}/paragraphs/query`, body);

    case 'create':
      if (!section_id) throw new Error('节 ID 不能为空');
      if (!content) throw new Error('段落内容不能为空');
      return await httpRequest('POST', `/api/kb/${kb_id}/paragraphs`, {
        section_id,
        title,
        content,
        context,
        is_knowledge_point: is_knowledge_point || false,
        token_count: token_count || 0,
      });

    case 'update':
      if (!id) throw new Error('段落 ID 不能为空');
      const updates = {};
      if (title !== undefined) updates.title = title;
      if (content !== undefined) updates.content = content;
      if (context !== undefined) updates.context = context;
      if (is_knowledge_point !== undefined) updates.is_knowledge_point = is_knowledge_point;
      if (token_count !== undefined) updates.token_count = token_count;
      return await httpRequest('PUT', `/api/kb/${kb_id}/paragraphs/${id}`, updates);

    case 'move':
      if (!id) throw new Error('段落 ID 不能为空');
      if (!['up', 'down'].includes(direction)) throw new Error('direction 必须是 "up" 或 "down"');
      return await httpRequest('POST', `/api/kb/${kb_id}/paragraphs/${id}/move`, { direction });

    case 'delete':
      if (!id) throw new Error('段落 ID 不能为空');
      return await httpRequest('DELETE', `/api/kb/${kb_id}/paragraphs/${id}`);

    default:
      throw new Error(`未知操作: ${action}. 可用操作: list, create, update, move, delete`);
  }
}

// ==================== 标签操作 ====================

/**
 * 标签统一操作处理器
 */
async function handleTag(params) {
  const { action, kb_id, id, name, description, page, pageSize } = params;

  if (!kb_id) throw new Error('知识库 ID 不能为空');

  switch (action) {
    case 'list':
      return await httpRequest('GET', `/api/kb/${kb_id}/tags?page=${page || 1}&pageSize=${pageSize || 100}`);

    case 'create':
      if (!name) throw new Error('标签名称不能为空');
      return await httpRequest('POST', `/api/kb/${kb_id}/tags`, { name, description });

    case 'update':
      if (!id) throw new Error('标签 ID 不能为空');
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      return await httpRequest('PUT', `/api/kb/${kb_id}/tags/${id}`, updates);

    case 'delete':
      if (!id) throw new Error('标签 ID 不能为空');
      return await httpRequest('DELETE', `/api/kb/${kb_id}/tags/${id}`);

    default:
      throw new Error(`未知操作: ${action}. 可用操作: list, create, update, delete`);
  }
}

// ==================== 执行入口 ====================

/**
 * Skill execute function - 被 skill-runner 调用
 *
 * @param {string} toolName - 工具名称（kb/article/section/paragraph/tag）
 * @param {object} params - 工具参数（必须包含 action 字段）
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
    'knowledge_base': handleKb,
    'article': handleArticle,
    'section': handleSection,
    'paragraph': handleParagraph,
    'tag': handleTag,
  };

  // 获取处理器
  const handler = handlers[toolName];
  if (!handler) {
    const availableTools = Object.keys(handlers).join(', ');
    throw new Error(`未知工具: ${toolName}. 可用工具: ${availableTools}`);
  }

  // 验证 action 参数
  if (!params.action) {
    throw new Error('缺少 action 参数。请指定操作类型。');
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
    // ==================== 新工具（5个） ====================
    {
      name: 'knowledge_base',
      description: '知识库操作。通过 action 参数区分具体操作：list（列出知识库）、list_models（列出嵌入模型）、get（获取详情）、create（创建）、update（更新）、delete（删除）。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'list_models', 'get', 'create', 'update', 'delete'],
            description: '操作类型',
          },
          id: { type: 'string', description: '知识库 ID（get/update/delete 时必需）' },
          name: { type: 'string', description: '知识库名称（create/update 时使用）' },
          description: { type: 'string', description: '知识库描述' },
          embedding_model_id: { type: 'string', description: '嵌入模型 ID，默认 bge-m3' },
          embedding_dim: { type: 'integer', description: '向量维度，默认 1024' },
          page: { type: 'integer', description: '页码，默认 1' },
          pageSize: { type: 'integer', description: '每页数量，默认 20' },
        },
        required: ['action'],
      },
    },
    {
      name: 'article',
      description: '文章操作。通过 action 参数区分具体操作：list（列出文章）、get（获取详情）、get_tree（获取完整结构）、create（创建）、update（更新）、delete（删除）。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'get', 'get_tree', 'create', 'update', 'delete'],
            description: '操作类型',
          },
          kb_id: { type: 'string', description: '知识库 ID（必需）' },
          id: { type: 'string', description: '文章 ID（get/update/delete 时必需）' },
          article_id: { type: 'string', description: '文章 ID（get_tree 时必需）' },
          title: { type: 'string', description: '文章标题' },
          summary: { type: 'string', description: '文章摘要' },
          source_type: { type: 'string', description: '来源类型（manual/upload/url）' },
          source_url: { type: 'string', description: '来源 URL' },
          file_path: { type: 'string', description: '本地文件路径' },
          status: { type: 'string', description: '状态（pending/processing/ready/error）' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签名数组' },
          page: { type: 'integer', description: '页码，默认 1' },
          pageSize: { type: 'integer', description: '每页数量，默认 20' },
          search: { type: 'string', description: '搜索关键词' },
        },
        required: ['action', 'kb_id'],
      },
    },
    {
      name: 'section',
      description: '节操作。通过 action 参数区分具体操作：list（列出节）、create（创建）、update（更新）、move（移动）、delete（删除）。支持无限层级。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'create', 'update', 'move', 'delete'],
            description: '操作类型',
          },
          kb_id: { type: 'string', description: '知识库 ID（必需）' },
          id: { type: 'string', description: '节 ID（update/move/delete 时必需）' },
          article_id: { type: 'string', description: '所属文章 ID（create/list 时使用）' },
          parent_id: { type: 'string', description: '父节 ID（用于创建子节）' },
          title: { type: 'string', description: '节标题' },
          direction: { type: 'string', enum: ['up', 'down'], description: '移动方向（move 时必需）' },
          page: { type: 'integer', description: '页码，默认 1' },
          pageSize: { type: 'integer', description: '每页数量，默认 100' },
        },
        required: ['action', 'kb_id'],
      },
    },
    {
      name: 'paragraph',
      description: '段落操作。通过 action 参数区分具体操作：list（列出段落）、create（创建）、update（更新）、move（移动）、delete（删除）。⚠️核心原则：content必须是原文完整复制，禁止提炼、总结、改写或省略。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'create', 'update', 'move', 'delete'],
            description: '操作类型',
          },
          kb_id: { type: 'string', description: '知识库 ID（必需）' },
          id: { type: 'string', description: '段落 ID（update/move/delete 时必需）' },
          section_id: { type: 'string', description: '所属节 ID（create/list 时使用）' },
          title: { type: 'string', description: '段落标题' },
          content: { type: 'string', description: '段落内容（必须是原文完整复制，禁止提炼、总结、改写、省略或截断）' },
          context: { type: 'string', description: '知识点上下文（可选）。当 is_knowledge_point 为 true 时，使用一两句话总结该知识点及其所在文章（中文），便于语义检索' },
          is_knowledge_point: { type: 'boolean', description: '是否为知识点，默认 false' },
          token_count: { type: 'integer', description: 'Token 数量' },
          direction: { type: 'string', enum: ['up', 'down'], description: '移动方向（move 时必需）' },
          page: { type: 'integer', description: '页码，默认 1' },
          pageSize: { type: 'integer', description: '每页数量，默认 100' },
        },
        required: ['action', 'kb_id'],
      },
    },
    {
      name: 'tag',
      description: '标签操作。通过 action 参数区分具体操作：list（列出标签）、create（创建）、update（更新）、delete（删除）。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'create', 'update', 'delete'],
            description: '操作类型',
          },
          kb_id: { type: 'string', description: '知识库 ID（必需）' },
          id: { type: 'string', description: '标签 ID（update/delete 时必需）' },
          name: { type: 'string', description: '标签名称' },
          description: { type: 'string', description: '标签描述' },
          page: { type: 'integer', description: '页码，默认 1' },
          pageSize: { type: 'integer', description: '每页数量，默认 100' },
        },
        required: ['action', 'kb_id'],
      },
    },
  ];
}

// Export for skill-runner
module.exports = {
  execute,
  getTools,
};
