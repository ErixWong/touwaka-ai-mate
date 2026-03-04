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

import logger from '../../lib/logger.js';
import {
  buildQueryOptions,
  buildPaginatedResponse,
} from '../../lib/query-builder.js';

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
  }

  /**
   * 确保模型已初始化
   */
  ensureModels() {
    if (!this.KnowledgeBase) {
      this.KnowledgeBase = this.db.getModel('knowledge_base');
      this.Knowledge = this.db.getModel('knowledge');
      this.KnowledgePoint = this.db.getModel('knowledge_point');
    }
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
   */
  async createKb(ctx) {
    try {
      this.ensureModels();
      const { name, description, embedding_model_id, embedding_dim } = ctx.request.body;

      if (!name) {
        ctx.error('知识库名称不能为空');
        return;
      }

      const kb = await this.KnowledgeBase.create({
        name,
        description: description || null,
        owner_id: ctx.state.userId,
        embedding_model_id: embedding_model_id || null,
        embedding_dim: embedding_dim || 1536,
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

      const knowledge = await this.Knowledge.create({
        kb_id: parseInt(kb_id),
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
   * 获取文章的知识点列表
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
        // 不返回 embedding 字段（太大）
        attributes: { exclude: ['embedding'] },
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
      logger.error('List knowledge points error:', error);
      ctx.error('获取知识点列表失败', 500);
    }
  }

  /**
   * 创建知识点
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

      const point = await this.KnowledgePoint.create({
        knowledge_id: parseInt(knowledge_id),
        title: title || null,
        content,
        context: context || null,
        position: maxPos + 1,
        token_count: 0,
      });

      const result = await this.KnowledgePoint.findOne({
        where: { id: point.id },
        attributes: { exclude: ['embedding'] },
        raw: true,
      });

      ctx.status = 201;
      ctx.success(result, '知识点创建成功');
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
      const { title, content, context, position } = ctx.request.body;

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

      ctx.success(point, '更新成功');
    } catch (error) {
      logger.error('Update knowledge point error:', error);
      ctx.error('更新知识点失败', 500);
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

      ctx.status = 204;
    } catch (error) {
      logger.error('Delete knowledge point error:', error);
      ctx.error('删除知识点失败', 500);
    }
  }
}

export default KnowledgeBaseController;