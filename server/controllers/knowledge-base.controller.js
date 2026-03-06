/**
 * Knowledge Base Controller - 知识库控制器
 *
 * 管理知识库、文章和知识点
 *
 * 层级结构：
 * KnowledgeBase（知识库）
 * └── Knowledge（文章，树状结构 via parent_id）
 *     └── KnowledgePoint（知识点）
 */

// 重新向量化进度存储
const revectorizeProgress = new Map();

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { Op, DataTypes } from 'sequelize';
import {
  buildQueryOptions,
  buildPaginatedResponse,
} from '../../lib/query-builder.js';
import { generateEmbedding, isLocalModelAvailable } from '../../lib/local-embedding.js';

/**
 * 将向量数组转换为 MariaDB VECTOR SQL 格式
 * @param {number[]} embedding 向量数组
 * @returns {string} MariaDB VECTOR SQL 格式，如: VEC_FromText('[0.1, 0.2, ...]')
 */
function toVectorSQL(embedding) {
  if (!Array.isArray(embedding)) return null;
  // 使用 JSON 数组文本格式
  const jsonStr = JSON.stringify(embedding);
  return `VEC_FromText('${jsonStr}')`;
}

/**
 * 将数据库中的 embedding 转换为数组
 * @param {Buffer|Array|string} embedding 从数据库读取的 embedding
 * @returns {Array|null} 向量数组
 */
function parseEmbedding(embedding) {
  if (!embedding) return null;
  // 如果已经是数组，直接返回
  if (Array.isArray(embedding)) return embedding;

  // 如果是 Buffer，先尝试当作 JSON 字符串解析
  if (Buffer.isBuffer(embedding)) {
    try {
      const str = embedding.toString('utf8');
      // 尝试 JSON 解析
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // JSON 解析失败，可能是 VECTOR 类型的二进制数据
      // 直接从 buffer 创建 Float32Array
      try {
        const float32 = new Float32Array(embedding);
        return Array.from(float32);
      } catch {
        return null;
      }
    }
    return null;
  }

  // 如果是字符串，尝试 JSON 解析（旧格式）
  if (typeof embedding === 'string') {
    try {
      return JSON.parse(embedding);
    } catch {
      return null;
    }
  }

  return null;
}

// 允许过滤的字段白名单
const KB_FILTER_FIELDS = [
  'id', 'name', 'description', 'owner_id',
  'embedding_model_id', 'embedding_dim', 'is_public',
  'created_at', 'updated_at',
];

const KB_SORT_FIELDS = ['id', 'name', 'created_at', 'updated_at'];

const KNOWLEDGE_FILTER_FIELDS = [
  'id', 'kb_id', 'parent_id', 'title', 'summary',
  'source_type', 'status', 'position',
  'created_at', 'updated_at',
];

const KNOWLEDGE_SORT_FIELDS = ['id', 'title', 'position', 'status', 'created_at', 'updated_at'];

const POINT_FILTER_FIELDS = [
  'id', 'knowledge_id', 'title', 'position', 'token_count',
  'created_at', 'updated_at',
];

const POINT_SORT_FIELDS = ['id', 'position', 'token_count', 'created_at'];

class KnowledgeBaseController {
  constructor(db) {
    this.db = db;
    this.KnowledgeBase = null;
    this.Knowledge = null;
    this.KnowledgePoint = null;
    this.AiModel = null;
    this.Provider = null;
  }

  /**
   * 确保模型已初始化
   */
  ensureModels() {
    if (!this.KnowledgeBase) {
      this.KnowledgeBase = this.db.getModel('knowledge_base');
      this.Knowledge = this.db.getModel('knowledge');
      this.KnowledgePoint = this.db.getModel('knowledge_point');
      this.AiModel = this.db.getModel('ai_model');
      this.Provider = this.db.getModel('provider');
    }
  }

  /**
   * 获取嵌入模型的 API 配置（从提供商获取）
   */
  async getEmbeddingApiConfig(modelId) {
    // 如果是本地模型，返回 null
    if (modelId === 'local' || !modelId) {
      return null;
    }

    // 查询模型及其关联的提供商
    const model = await this.AiModel.findOne({
      where: { id: modelId },
      include: [{
        model: this.Provider,
        as: 'provider',
        attributes: ['id', 'name', 'base_url', 'api_key'],
      }],
      raw: true,
      nest: true,
    });

    if (model?.provider) {
      return {
        baseUrl: model.provider.base_url,
        apiKey: model.provider.api_key,
        modelName: model.model_name,
      };
    }

    return null;
  }

  /**
   * 获取模型的 embedding 维度
   * 优先从 ai_models 表获取，其次使用默认值
   */
  async getEmbeddingDim(modelId) {
    // 如果是本地模型（local），使用默认维度
    if (modelId === 'local' || !modelId) {
      return 384;
    }

    // 从 ai_models 表查询
    if (this.AiModel) {
      const model = await this.AiModel.findOne({
        where: { id: modelId },
        attributes: ['embedding_dim', 'model_type'],
        raw: true,
      });
      if (model && model.embedding_dim) {
        return model.embedding_dim;
      }
      // 如果是 embedding 类型但没有 embedding_dim，返回 null 让调用方处理
      if (model?.model_type === 'embedding') {
        return null;
      }
    }

    return 384; // 默认维度
  }

  // ==================== 知识库 CRUD ====================

  /**
   * 查询知识库列表（POST /query）
   */
  async queryKbs(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const queryRequest = ctx.request.body || {};

      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        baseWhere: { owner_id: ctx.state.userId },
        filterOptions: { allowedFields: KB_FILTER_FIELDS },
        sortOptions: { allowedFields: KB_SORT_FIELDS },
        pageOptions: { defaultSize: 10, maxSize: 100 },
        fieldsOptions: { allowedFields: KB_FILTER_FIELDS },
      });

      const result = await this.KnowledgeBase.findAndCountAll({
        ...queryOptions,
        raw: true,
      });

      const response = buildPaginatedResponse(result, pagination, startTime);
      ctx.success(response);
    } catch (error) {
      logger.error('Query knowledge bases error:', error);
      ctx.error('查询知识库失败', 500);
    }
  }

  /**
   * 获取知识库列表
   */
  async listKbs(ctx) {
    try {
      this.ensureModels();
      const { page = 1, pageSize = 20 } = ctx.query;

      const offset = (parseInt(page) - 1) * parseInt(pageSize);

      const { count, rows } = await this.KnowledgeBase.findAndCountAll({
        where: { owner_id: ctx.state.userId },
        order: [['updated_at', 'DESC']],
        limit: parseInt(pageSize),
        offset,
        raw: true,
      });

      ctx.success({
        items: rows,
        pagination: {
          page: parseInt(page),
          size: parseInt(pageSize),
          total: count,
          pages: Math.ceil(count / parseInt(pageSize)),
        },
      });
    } catch (error) {
      logger.error('List knowledge bases error:', error);
      ctx.error('获取知识库列表失败', 500);
    }
  }

  /**
   * 创建知识库
   * 使用随机数字作为 ID
   */
  async createKb(ctx) {
    try {
      this.ensureModels();
      const { name, description, embedding_model_id, embedding_dim } = ctx.request.body;

      if (!name) {
        ctx.error('知识库名称不能为空');
        return;
      }

      // 生成唯一 ID（20位字母数字，与技能 ID 一致）
      let newId = Utils.newID(20);
      let exists = await this.KnowledgeBase.findOne({ where: { id: newId } });
      let attempts = 0;
      while (exists && attempts < 10) {
        newId = Utils.newID(20);
        exists = await this.KnowledgeBase.findOne({ where: { id: newId } });
        attempts++;
      }

      if (exists) {
        ctx.error('无法生成唯一的知识库 ID，请重试', 500);
        return;
      }

      // 确定 embedding_model_id：优先使用用户选择的模型，否则使用 'local'
      const finalEmbeddingModelId = embedding_model_id || 'local';

      const kb = await this.KnowledgeBase.create({
        id: newId,
        name,
        description: description || null,
        owner_id: ctx.state.userId,
        embedding_model_id: finalEmbeddingModelId,
        embedding_dim: embedding_dim || 384, // all-MiniLM-L6-v2 默认维度
        is_public: false,
      });

      const result = await this.KnowledgeBase.findOne({
        where: { id: kb.id },
        raw: true,
      });

      ctx.status = 201;
      ctx.success(result, '知识库创建成功');
    } catch (error) {
      logger.error('Create knowledge base error:', error);
      ctx.error('创建知识库失败', 500);
    }
  }

  /**
   * 获取知识库详情
   */
  async getKb(ctx) {
    try {
      this.ensureModels();
      const { id } = ctx.params;

      const kb = await this.KnowledgeBase.findOne({
        where: { id },
        raw: true,
      });

      if (!kb) {
        ctx.error('知识库不存在', 404);
        return;
      }

      // 检查权限
      if (kb.owner_id !== ctx.state.userId) {
        ctx.error('无权限访问此知识库', 403);
        return;
      }

      // 获取统计信息
      const knowledgeCount = await this.Knowledge.count({
        where: { kb_id: id },
      });

      const pointCount = await this.KnowledgePoint.count({
        include: [{
          model: this.Knowledge,
          as: 'knowledge',
          where: { kb_id: id },
          attributes: [],
        }],
      });

      ctx.success({
        ...kb,
        stats: {
          knowledge_count: knowledgeCount,
          point_count: pointCount,
        },
      });
    } catch (error) {
      logger.error('Get knowledge base error:', error);
      ctx.error('获取知识库失败', 500);
    }
  }

  /**
   * 更新知识库
   */
  async updateKb(ctx) {
    try {
      this.ensureModels();
      const { id } = ctx.params;
      const { name, description, embedding_model_id, embedding_dim } = ctx.request.body;

      // 检查权限
      const kb = await this.KnowledgeBase.findOne({ where: { id }, raw: true });
      if (!kb) {
        ctx.error('知识库不存在', 404);
        return;
      }
      if (kb.owner_id !== ctx.state.userId) {
        ctx.error('无权限修改此知识库', 403);
        return;
      }

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (embedding_model_id !== undefined) updates.embedding_model_id = embedding_model_id;
      if (embedding_dim !== undefined) updates.embedding_dim = embedding_dim;

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段');
        return;
      }

      await this.KnowledgeBase.update(updates, { where: { id } });

      const result = await this.KnowledgeBase.findOne({ where: { id }, raw: true });
      ctx.success(result, '更新成功');
    } catch (error) {
      logger.error('Update knowledge base error:', error);
      ctx.error('更新知识库失败', 500);
    }
  }

  /**
   * 删除知识库
   */
  async deleteKb(ctx) {
    try {
      this.ensureModels();
      const { id } = ctx.params;

      const result = await this.KnowledgeBase.destroy({
        where: {
          id,
          owner_id: ctx.state.userId,
        },
      });

      if (result === 0) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      ctx.status = 204;
    } catch (error) {
      logger.error('Delete knowledge base error:', error);
      ctx.error('删除知识库失败', 500);
    }
  }

  // ==================== 文章 CRUD ====================

  /**
   * 获取文章列表（GET /:kb_id/knowledges）
   */
  async listKnowledges(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const { page = 1, pageSize = 20 } = ctx.query;

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      const offset = (parseInt(page) - 1) * parseInt(pageSize);

      const { count, rows } = await this.Knowledge.findAndCountAll({
        where: { kb_id },
        order: [['position', 'ASC']],
        limit: parseInt(pageSize),
        offset,
        raw: true,
      });

      ctx.success({
        items: rows,
        pagination: {
          page: parseInt(page),
          size: parseInt(pageSize),
          total: count,
          pages: Math.ceil(count / parseInt(pageSize)),
        },
      });
    } catch (error) {
      logger.error('List knowledges error:', error);
      ctx.error('获取文章列表失败', 500);
    }
  }

  /**
   * 查询文章列表（POST /query）
   */
  async queryKnowledges(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const queryRequest = ctx.request.body || {};

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        baseWhere: { kb_id },
        filterOptions: { allowedFields: KNOWLEDGE_FILTER_FIELDS },
        sortOptions: { allowedFields: KNOWLEDGE_SORT_FIELDS },
        pageOptions: { defaultSize: 20, maxSize: 200 },
        fieldsOptions: { allowedFields: KNOWLEDGE_FILTER_FIELDS },
      });

      const result = await this.Knowledge.findAndCountAll({
        ...queryOptions,
        raw: true,
      });

      const response = buildPaginatedResponse(result, pagination, startTime);
      ctx.success(response);
    } catch (error) {
      logger.error('Query knowledges error:', error);
      ctx.error('查询文章失败', 500);
    }
  }

  /**
   * 获取文章树状结构
   */
  async getKnowledgeTree(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      // 获取所有文章
      const knowledges = await this.Knowledge.findAll({
        where: { kb_id },
        order: [['position', 'ASC']],
        raw: true,
      });

      // 构建树状结构
      const buildTree = (items, parentId = null) => {
        return items
          .filter(item => item.parent_id === parentId)
          .map(item => ({
            ...item,
            children: buildTree(items, item.id),
          }));
      };

      const tree = buildTree(knowledges);
      ctx.success(tree);
    } catch (error) {
      logger.error('Get knowledge tree error:', error);
      ctx.error('获取文章树失败', 500);
    }
  }

  /**
   * 创建文章
   */
  async createKnowledge(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const { parent_id, title, summary, source_type, source_url, file_path } = ctx.request.body;

      if (!title) {
        ctx.error('文章标题不能为空');
        return;
      }

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      // 如果有父文章，验证父文章存在且属于同一知识库
      if (parent_id) {
        const parent = await this.Knowledge.findOne({
          where: { id: parent_id, kb_id },
          raw: true,
        });
        if (!parent) {
          ctx.error('父文章不存在', 404);
          return;
        }
      }

      // 获取同级最大 position
      const maxPos = await this.Knowledge.max('position', {
        where: { kb_id, parent_id: parent_id || null },
      }) || 0;

      // 生成唯一 ID（20位字母数字）
      const newId = Utils.newID(20);

      const knowledge = await this.Knowledge.create({
        id: newId,
        kb_id: kb_id,
        parent_id: parent_id || null,
        title,
        summary: summary || null,
        source_type: source_type || 'manual',
        source_url: source_url || null,
        file_path: file_path || null,
        status: 'pending',
        position: maxPos + 1,
      });

      const result = await this.Knowledge.findOne({
        where: { id: knowledge.id },
        raw: true,
      });

      ctx.status = 201;
      ctx.success(result, '文章创建成功');
    } catch (error) {
      logger.error('Create knowledge error:', error);
      ctx.error('创建文章失败', 500);
    }
  }

  /**
   * 获取文章详情
   */
  async getKnowledge(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      const knowledge = await this.Knowledge.findOne({
        where: { id, kb_id },
        raw: true,
      });

      if (!knowledge) {
        ctx.error('文章不存在', 404);
        return;
      }

      // 获取知识点数量
      const pointCount = await this.KnowledgePoint.count({
        where: { knowledge_id: id },
      });

      ctx.success({
        ...knowledge,
        point_count: pointCount,
      });
    } catch (error) {
      logger.error('Get knowledge error:', error);
      ctx.error('获取文章失败', 500);
    }
  }

  /**
   * 更新文章
   */
  async updateKnowledge(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;
      const { title, summary, status, position } = ctx.request.body;

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      const updates = {};
      if (title !== undefined) updates.title = title;
      if (summary !== undefined) updates.summary = summary;
      if (status !== undefined) updates.status = status;
      if (position !== undefined) updates.position = position;

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段');
        return;
      }

      const result = await this.Knowledge.update(updates, {
        where: { id, kb_id },
      });

      if (result[0] === 0) {
        ctx.error('文章不存在', 404);
        return;
      }

      const knowledge = await this.Knowledge.findOne({
        where: { id, kb_id },
        raw: true,
      });

      ctx.success(knowledge, '更新成功');
    } catch (error) {
      logger.error('Update knowledge error:', error);
      ctx.error('更新文章失败', 500);
    }
  }

  /**
   * 删除文章
   */
  async deleteKnowledge(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      // CASCADE 会自动删除子文章和知识点
      const result = await this.Knowledge.destroy({
        where: { id, kb_id },
      });

      if (result === 0) {
        ctx.error('文章不存在', 404);
        return;
      }

      ctx.status = 204;
    } catch (error) {
      logger.error('Delete knowledge error:', error);
      ctx.error('删除文章失败', 500);
    }
  }

  // ==================== 知识点 CRUD ====================

  /**
   * 获取文章的知识点列表（包含向量化状态）
   */
  async listPoints(ctx) {
    try {
      this.ensureModels();
      const { kb_id, knowledge_id } = ctx.params;
      const { page = 1, pageSize = 50 } = ctx.query;

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      // 验证文章存在
      const knowledge = await this.Knowledge.findOne({
        where: { id: knowledge_id, kb_id },
        raw: true,
      });
      if (!knowledge) {
        ctx.error('文章不存在', 404);
        return;
      }

      const offset = (parseInt(page) - 1) * parseInt(pageSize);

      const { count, rows } = await this.KnowledgePoint.findAndCountAll({
        where: { knowledge_id },
        order: [['position', 'ASC']],
        limit: parseInt(pageSize),
        offset,
        raw: true,
      });

      // 处理结果：添加 is_vectorized 字段，移除 embedding 字段
      const items = rows.map(point => {
        const { embedding, ...rest } = point;
        return {
          ...rest,
          is_vectorized: !!embedding,
        };
      });

      ctx.success({
        items,
        pagination: {
          page: parseInt(page),
          size: parseInt(pageSize),
          total: count,
          pages: Math.ceil(count / parseInt(pageSize)),
        },
      });
    } catch (error) {
      logger.error('List knowledge points error:', error);
      ctx.error('获取知识点列表失败', 500);
    }
  }

  /**
   * 创建知识点（自动生成向量）
   */
  async createPoint(ctx) {
    try {
      this.ensureModels();
      const { kb_id, knowledge_id } = ctx.params;
      const { title, content, context } = ctx.request.body;

      if (!content) {
        ctx.error('知识点内容不能为空');
        return;
      }

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      // 验证文章存在
      const knowledge = await this.Knowledge.findOne({
        where: { id: knowledge_id, kb_id },
        raw: true,
      });
      if (!knowledge) {
        ctx.error('文章不存在', 404);
        return;
      }

      // 获取最大 position
      const maxPos = await this.KnowledgePoint.max('position', {
        where: { knowledge_id },
      }) || 0;

      // 生成唯一 ID（20位字母数字）
      const newId = Utils.newID(20);

      // 创建知识点
      const point = await this.KnowledgePoint.create({
        id: newId,
        knowledge_id: knowledge_id,
        title: title || null,
        content,
        context: context || null,
        position: maxPos + 1,
        token_count: 0,
      });

      // 自动生成嵌入向量
      let is_vectorized = false;
      let actualEmbeddingDim = null;

      try {
        // 构建上下文增强的文本：文章摘要 + 知识点标题 + 知识点正文
        const summary = knowledge.summary || '';
        const contextText = summary ? `[文章摘要] ${summary}\n[知识点] ${title || ''}\n${content}` : (content || title);
        if (contextText) {
          const embedding = await this.generateQueryEmbedding(contextText, kb.embedding_model_id);
          if (embedding) {
            actualEmbeddingDim = embedding.length;
            const vectorSQL = toVectorSQL(embedding);
            await this.KnowledgePoint.update(
              { embedding: this.db.sequelize.literal(vectorSQL) },
              { where: { id: point.id } }
            );
            is_vectorized = true;
            logger.info(`[KB] Auto-generated embedding for point ${point.id}, dimension: ${actualEmbeddingDim}`);

            // 自动更新知识库的 embedding_dim（如果与实际维度不一致）
            if (actualEmbeddingDim && (!kb.embedding_dim || kb.embedding_dim !== actualEmbeddingDim)) {
              await this.KnowledgeBase.update(
                { embedding_dim: actualEmbeddingDim },
                { where: { id: kb_id } }
              );
              logger.info(`[KB] Updated knowledge base ${kb_id} embedding_dim to ${actualEmbeddingDim}`);
            }
          }
        }
      } catch (embedError) {
        logger.warn(`[KB] Failed to auto-generate embedding for point ${point.id}:`, embedError.message);
      }

      // 递归更新文章及其所有祖先节点的状态
      try {
        await this.updateKnowledgeStatusRecursively(knowledge_id);
      } catch (statusError) {
        logger.error(`[KB] Failed to update knowledge status:`, statusError.stack || statusError.message || statusError);
      }

      const result = await this.KnowledgePoint.findOne({
        where: { id: point.id },
        attributes: { exclude: ['embedding'] },
        raw: true,
      });

      ctx.status = 201;
      ctx.success({ ...result, is_vectorized }, '知识点创建成功');
    } catch (error) {
      logger.error('Create knowledge point error:', error);
      ctx.error('创建知识点失败', 500);
    }
  }

  /**
   * 获取知识点详情
   */
  async getPoint(ctx) {
    try {
      this.ensureModels();
      const { kb_id, knowledge_id, id } = ctx.params;

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      const point = await this.KnowledgePoint.findOne({
        where: { id, knowledge_id },
        attributes: { exclude: ['embedding'] },
        raw: true,
      });

      if (!point) {
        ctx.error('知识点不存在', 404);
        return;
      }

      ctx.success(point);
    } catch (error) {
      logger.error('Get knowledge point error:', error);
      ctx.error('获取知识点失败', 500);
    }
  }

  /**
   * 更新知识点
   */
  async updatePoint(ctx) {
    try {
      this.ensureModels();
      const { kb_id, knowledge_id, id } = ctx.params;
      const { title, content, context, position, embedding, token_count } = ctx.request.body;

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      const updates = {};
      if (title !== undefined) updates.title = title;
      if (content !== undefined) updates.content = content;
      if (context !== undefined) updates.context = context;
      if (position !== undefined) updates.position = position;
      if (token_count !== undefined) updates.token_count = token_count;
      if (embedding !== undefined) {
        // embedding 可以是数组或字符串（JSON）
        if (Array.isArray(embedding)) {
          updates.embedding = this.db.sequelize.literal(toVectorSQL(embedding));
        } else if (typeof embedding === 'string') {
          const parsed = JSON.parse(embedding);
          updates.embedding = this.db.sequelize.literal(toVectorSQL(parsed));
        }
      }

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段');
        return;
      }

      const result = await this.KnowledgePoint.update(updates, {
        where: { id, knowledge_id },
      });

      if (result[0] === 0) {
        ctx.error('知识点不存在', 404);
        return;
      }

      const point = await this.KnowledgePoint.findOne({
        where: { id, knowledge_id },
        attributes: { exclude: ['embedding'] },
        raw: true,
      });

      // 递归更新文章及其所有祖先节点的状态
      await this.updateKnowledgeStatusRecursively(knowledge_id);

      ctx.success(point, '更新成功');
    } catch (error) {
      logger.error('Update knowledge point error:', error);
      ctx.error('更新知识点失败', 500);
    }
  }

  /**
   * 获取知识点（包含 embedding）
   */
  async getPointWithEmbedding(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      const point = await this.KnowledgePoint.findOne({
        where: { id },
        raw: true,
      });

      if (!point) {
        ctx.error('知识点不存在', 404);
        return;
      }

      // 解析 embedding
      if (point.embedding) {
        point.embedding = parseEmbedding(point.embedding);
      }

      ctx.success(point);
    } catch (error) {
      logger.error('Get knowledge point with embedding error:', error);
      ctx.error('获取知识点失败', 500);
    }
  }

  /**
   * 删除知识点
   */
  async deletePoint(ctx) {
    try {
      this.ensureModels();
      const { kb_id, knowledge_id, id } = ctx.params;

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      const result = await this.KnowledgePoint.destroy({
        where: { id, knowledge_id },
      });

      if (result === 0) {
        ctx.error('知识点不存在', 404);
        return;
      }

      // 递归更新文章及其所有祖先节点的状态
      await this.updateKnowledgeStatusRecursively(knowledge_id);

      ctx.status = 204;
    } catch (error) {
      logger.error('Delete knowledge point error:', error);
      ctx.error('删除知识点失败', 500);
    }
  }

  // ==================== 向量化功能 ====================

  /**
   * 重新向量化知识库所有知识点
   * POST /api/kb/:kb_id/revectorize
   */
  async revectorize(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      // 获取知识库下的所有知识点（含摘要）
      const knowledges = await this.Knowledge.findAll({
        where: { kb_id },
        attributes: ['id', 'summary'],
        raw: true,
      });

      if (knowledges.length === 0) {
        ctx.success({ message: '知识库没有文章' });
        return;
      }

      const knowledgeIds = knowledges.map(k => k.id);
      const knowledgeSummaryMap = {};
      knowledges.forEach(k => {
        knowledgeSummaryMap[k.id] = k.summary || '';
      });

      const points = await this.KnowledgePoint.findAll({
        where: { knowledge_id: knowledgeIds },
        attributes: ['id', 'knowledge_id', 'title', 'content'],
        raw: true,
      });

      if (points.length === 0) {
        ctx.success({ message: '知识库没有知识点', total: 0, success: 0 });
        return;
      }

      // 初始化进度
      const progressKey = `${kb_id}_${Date.now()}`;
      revectorizeProgress.set(progressKey, {
        total: points.length,
        success: 0,
        failed: 0,
        current: 0,
        status: 'running',
        embedding_dim: kb.embedding_dim,
      });

      logger.info(`[KB] Revectorize started: ${progressKey}, total: ${points.length}`);

      // 重新生成所有知识点向量
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        try {
          const pointText = point.content || point.title;
          if (!pointText) {
            failCount++;
            continue;
          }

          // 构建上下文增强的文本：文章摘要 + 知识点标题 + 知识点正文
          const summary = knowledgeSummaryMap[point.knowledge_id] || '';
          const contextText = summary ? `[文章摘要] ${summary}\n[知识点] ${point.title || ''}\n${point.content}` : pointText;

          const embedding = await this.generateQueryEmbedding(contextText, kb.embedding_model_id);
          if (embedding) {
            const actualDim = embedding.length;
            const vectorSQL = toVectorSQL(embedding);
            await this.KnowledgePoint.update(
              { embedding: this.db.sequelize.literal(vectorSQL) },
              { where: { id: point.id } }
            );
            successCount++;

            // 更新知识库维度（如果不一致）
            if (kb.embedding_dim !== actualDim) {
              await this.KnowledgeBase.update(
                { embedding_dim: actualDim },
                { where: { id: kb_id } }
              );
              kb.embedding_dim = actualDim;
            }
          } else {
            failCount++;
          }
        } catch (err) {
          logger.warn(`[KB] Failed to revectorize point ${point.id}:`, err.message);
          failCount++;
        }

        // 更新进度
        revectorizeProgress.set(progressKey, {
          total: points.length,
          success: successCount,
          failed: failCount,
          current: i + 1,
          status: 'running',
          embedding_dim: kb.embedding_dim,
        });
      }

      // 完成进度
      revectorizeProgress.set(progressKey, {
        total: points.length,
        success: successCount,
        failed: failCount,
        current: points.length,
        status: 'completed',
        embedding_dim: kb.embedding_dim,
      });

      logger.info(`[KB] Revectorize completed: ${successCount} success, ${failCount} failed`);

      ctx.success({
        job_id: progressKey,
        total: points.length,
        success: successCount,
        failed: failCount,
        embedding_dim: kb.embedding_dim,
      });
    } catch (error) {
      logger.error('Revectorize error:', error);
      ctx.error('重新向量化失败: ' + error.message, 500);
    }
  }

  /**
   * 获取重新向量化进度
   * GET /api/kb/:kb_id/revectorize/:job_id
   */
  async getRevectorizeProgress(ctx) {
    const { kb_id, job_id } = ctx.params;

    const progress = revectorizeProgress.get(job_id);
    if (!progress) {
      ctx.success({ status: 'not_found' });
      return;
    }

    ctx.success(progress);
  }

  // ==================== 搜索功能 ====================

  /**
   * 语义搜索知识点
   * POST /api/kb/:kb_id/search
   */
  async search(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      // 注意：默认阈值设为 0.1，因为 all-MiniLM-L6-v2 的相似度通常在 0.1-0.5 之间
      const { query, top_k = 5, threshold = 0.1, knowledge_id } = ctx.request.body;

      if (!query) {
        ctx.error('搜索查询不能为空');
        return;
      }

      // 验证知识库权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kb_id, owner_id: ctx.state.userId },
        raw: true,
      });
      if (!kb) {
        ctx.error('知识库不存在或无权限', 404);
        return;
      }

      // 获取要搜索的文章ID列表
      let knowledgeIds;
      if (knowledge_id) {
        // 指定文章搜索（结构路径）
        const knowledge = await this.Knowledge.findOne({
          where: { id: knowledge_id, kb_id },
          raw: true,
        });
        if (!knowledge) {
          ctx.error('指定文章不存在或无权限', 404);
          return;
        }
        knowledgeIds = [knowledge_id];
      } else {
        // 全知识库搜索（语义路径）
        knowledgeIds = await this.Knowledge.findAll({
          where: { kb_id },
          attributes: ['id'],
          raw: true,
        }).then(rows => rows.map(r => r.id));
      }

      if (knowledgeIds.length === 0) {
        ctx.success([]);
        return;
      }

      // 获取这些文章下的有向量的知识点
      const points = await this.KnowledgePoint.findAll({
        where: {
          knowledge_id: knowledgeIds,
          embedding: { [Op.ne]: null },
        },
        raw: true,
      });

      if (points.length === 0) {
        ctx.success([]);
        return;
      }

      // 生成查询向量
      const queryEmbedding = await this.generateQueryEmbedding(query, kb.embedding_model_id);

      if (!queryEmbedding) {
        // 如果 embedding API 没有配置，返回空数组
        ctx.success([]);
        return;
      }

      // 计算相似度并排序
      const results = points
        .map(point => {
          const pointEmbedding = parseEmbedding(point.embedding);
          const similarity = this.cosineSimilarity(queryEmbedding, pointEmbedding);
          return {
            point: {
              id: point.id,
              title: point.title,
              content: point.content,
              context: point.context,
              token_count: point.token_count,
            },
            knowledge: {
              id: point.knowledge_id,
              title: null, // 需要单独查询获取
            },
            score: similarity,
          };
        })
        .filter(r => r.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, parseInt(top_k));

      // 获取相关文章的标题
      const resultKnowledgeIds = [...new Set(results.map(r => r.knowledge.id))];
      if (resultKnowledgeIds.length > 0) {
        const knowledges = await this.Knowledge.findAll({
          where: { id: resultKnowledgeIds },
          attributes: ['id', 'title'],
          raw: true,
        });
        const knowledgeMap = new Map(knowledges.map(k => [k.id, k.title]));
        results.forEach(r => {
          r.knowledge.title = knowledgeMap.get(r.knowledge.id);
        });
      }

      ctx.success(results);
    } catch (error) {
      logger.error('Search knowledge error:', error.message || error);
      logger.error('Search knowledge error stack:', error.stack);
      ctx.error('搜索失败: ' + (error.message || '未知错误'), 500);
    }
  }

  /**
   * 全局语义搜索知识点（跨所有知识库）
   * POST /api/kb/search
   */
  async globalSearch(ctx) {
    try {
      this.ensureModels();
      // 注意：默认阈值设为 0.1，因为 all-MiniLM-L6-v2 的相似度通常在 0.1-0.5 之间
      const { query, top_k = 10, threshold = 0.1 } = ctx.request.body;

      if (!query) {
        ctx.error('搜索查询不能为空');
        return;
      }

      // 获取用户所有知识库的 ID
      const userKbs = await this.KnowledgeBase.findAll({
        where: { owner_id: ctx.state.userId },
        attributes: ['id', 'name', 'embedding_model_id'],
        raw: true,
      });

      if (userKbs.length === 0) {
        ctx.success([]);
        return;
      }

      const kbIds = userKbs.map(kb => kb.id);
      const kbMap = new Map(userKbs.map(kb => [kb.id, kb]));

      // 获取这些知识库下的所有文章 ID
      const knowledges = await this.Knowledge.findAll({
        where: { kb_id: kbIds },
        attributes: ['id', 'kb_id', 'title'],
        raw: true,
      });

      if (knowledges.length === 0) {
        ctx.success([]);
        return;
      }

      const knowledgeIds = knowledges.map(k => k.id);
      const knowledgeMap = new Map(knowledges.map(k => [k.id, k]));

      // 获取所有有向量的知识点
      const points = await this.KnowledgePoint.findAll({
        where: {
          knowledge_id: knowledgeIds,
          embedding: { [Op.ne]: null },
        },
        raw: true,
      });

      if (points.length === 0) {
        ctx.success([]);
        return;
      }

      // 使用第一个知识库的 embedding_model_id（假设用户使用统一的模型）
      const defaultModelId = userKbs[0]?.embedding_model_id || 'local';

      // 生成查询向量
      const queryEmbedding = await this.generateQueryEmbedding(query, defaultModelId);

      if (!queryEmbedding) {
        ctx.success([]);
        return;
      }

      // 计算相似度并排序
      const results = points
        .map(point => {
          const pointEmbedding = parseEmbedding(point.embedding);
          const similarity = this.cosineSimilarity(queryEmbedding, pointEmbedding);
          const knowledge = knowledgeMap.get(point.knowledge_id);
          const kb = knowledge ? kbMap.get(knowledge.kb_id) : null;

          return {
            point: {
              id: point.id,
              title: point.title,
              content: point.content,
              context: point.context,
              token_count: point.token_count,
            },
            knowledge: {
              id: point.knowledge_id,
              title: knowledge?.title || null,
            },
            knowledge_base: {
              id: kb?.id || null,
              name: kb?.name || null,
            },
            score: similarity,
          };
        })
        .filter(r => r.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, parseInt(top_k));

      ctx.success(results);
    } catch (error) {
      logger.error('Global search knowledge error:', error.message || error);
      logger.error('Global search knowledge error stack:', error.stack);
      ctx.error('全局搜索失败: ' + (error.message || '未知错误'), 500);
    }
  }

  /**
   * 检查本地模型是否可用
   */
  isLocalModelAvailable() {
    try {
      return isLocalModelAvailable();
    } catch {
      return false;
    }
  }

  /**
   * 递归更新文章及其所有祖先节点的状态
   * @param {string} knowledgeId - 文章ID
   * @param {boolean} isChildUpdate - 是否是从子节点触发的更新
   */
  async updateKnowledgeStatusRecursively(knowledgeId, isChildUpdate = false) {
    // 获取当前文章的子节点数量
    const childResult = await this.Knowledge.findAndCountAll({
      where: { parent_id: knowledgeId },
      attributes: ['id'],
    });
    const childCountNum = childResult.count || 0;

    // 获取知识点统计（使用原始查询避免 Sequelize 问题）
    const pointStats = await this.KnowledgePoint.findAll({
      where: { knowledge_id: knowledgeId },
      attributes: ['id', 'embedding'],
      raw: true,
    });

    let totalPoints = 0;
    let vectorizedPoints = 0;
    for (const p of pointStats) {
      totalPoints++;
      if (p.embedding && Buffer.isBuffer(p.embedding) && p.embedding.length > 0) {
        vectorizedPoints++;
      }
    }

    let newStatus;
    if (childCountNum === 0 && totalPoints === 0) {
      newStatus = 'pending';
    } else if (childCountNum === 0) {
      // 叶子节点，检查知识点
      newStatus = (vectorizedPoints === totalPoints && totalPoints > 0) ? 'ready' : 'pending';
    } else {
      // 有子节点，需要检查所有子节点状态
      const children = await this.Knowledge.findAll({
        where: { parent_id: knowledgeId },
        attributes: ['id', 'status'],
        raw: true,
      });

      const childStatuses = children.map(c => c.status);
      const hasFailed = childStatuses.includes('failed');
      const hasPending = childStatuses.includes('pending');
      const hasProcessing = childStatuses.includes('processing');
      const allReady = childStatuses.every(s => s === 'ready');

      // 检查当前节点的知识点
      const hasPartialVectorized = vectorizedPoints > 0 && vectorizedPoints < totalPoints;

      if (allReady && (vectorizedPoints === totalPoints || totalPoints === 0)) {
        newStatus = 'ready';
      } else if (hasFailed || hasPartialVectorized) {
        newStatus = 'failed';
      } else if (hasProcessing) {
        newStatus = 'processing';
      } else {
        newStatus = 'pending';
      }
    }

    logger.info(`[KB] Setting knowledge ${knowledgeId} status to ${newStatus}`);

    // 更新当前节点状态
    await this.Knowledge.update({ status: newStatus }, { where: { id: knowledgeId } });
    logger.info(`[KB] Updated knowledge ${knowledgeId} status to ${newStatus}`);

    // 递归更新父节点
    const knowledge = await this.Knowledge.findByPk(knowledgeId, { attributes: ['parent_id'], raw: true });
    if (knowledge?.parent_id) {
      logger.info(`[KB] Recursing to parent ${knowledge.parent_id}`);
      await this.updateKnowledgeStatusRecursively(knowledge.parent_id, true);
    }
  }

  /**
   * 生成查询向量
   */
  async generateQueryEmbedding(text, modelId) {
    try {
      // 如果指定使用本地模型（modelId 为 'local' 或以 'local:' 开头）
      const useLocal = modelId === 'local' || modelId?.startsWith('local:');

      if (useLocal) {
        logger.info('[KB] Using local embedding model');
        const embeddings = await generateEmbedding(text);
        return embeddings?.[0] || null;
      }

      // 优先从模型关联的提供商获取 API 配置
      let apiConfig = await this.getEmbeddingApiConfig(modelId);

      // 如果没有获取到提供商配置，尝试使用 .env 配置
      if (!apiConfig) {
        apiConfig = {
          baseUrl: process.env.EMBEDDING_API_URL,
          apiKey: process.env.EMBEDDING_API_KEY,
          modelName: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
        };
      }

      logger.info('[KB] Embedding config:', {
        url: apiConfig.baseUrl ? 'set' : 'missing',
        key: apiConfig.apiKey ? 'set' : 'missing',
        model: apiConfig.modelName,
        modelId: modelId,
        from: apiConfig.baseUrl === process.env.EMBEDDING_API_URL ? 'env' : 'provider'
      });

      if (!apiConfig.baseUrl || !apiConfig.apiKey) {
        // 如果没有配置外部 API，尝试使用本地模型
        if (isLocalModelAvailable()) {
          logger.info('[KB] No external API configured, using local model');
          const embeddings = await generateEmbedding(text);
          return embeddings?.[0] || null;
        }
        logger.warn('[KB] Embedding API not configured and local model not available');
        return null;
      }

      const response = await fetch(apiConfig.baseUrl + '/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiConfig.apiKey}`,
        },
        body: JSON.stringify({
          input: text,
          model: apiConfig.modelName,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('[KB] Embedding API error:', response.status, errorText);
        return null;
      }

      const data = await response.json();
      // 支持 OpenAI 格式 (data[0].embedding) 和 Ollama 格式 (embeddings[0])
      return data.data?.[0]?.embedding || data.embeddings?.[0] || null;
    } catch (error) {
      logger.error('[KB] Generate embedding error:', error);
      return null;
    }
  }

  /**
   * 计算余弦相似度
   */
  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (normA * normB);
  }
}

export default KnowledgeBaseController;