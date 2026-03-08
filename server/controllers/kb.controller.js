/**
 * KB Controller - 新知识库控制器
 *
 * 管理新知识库结构：
 * - kb_articles (文章)
 * - kb_sections (节，自指向无限层级)
 * - kb_paragraphs (段)
 * - kb_tags (标签)
 * - kb_article_tags (文章-标签关联)
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { Op, Sequelize, ForeignKeyConstraintError } from 'sequelize';
import {
  buildQueryOptions,
  buildPaginatedResponse,
} from '../../lib/query-builder.js';

// 最大章节层级深度限制
const MAX_SECTION_DEPTH = 10; // 允许 10 层深度（1-10）

// 允许过滤的字段白名单
const ARTICLE_FILTER_FIELDS = [
  'id', 'kb_id', 'title', 'summary', 'source_type', 'status',
  'created_at', 'updated_at',
];

const ARTICLE_SORT_FIELDS = ['id', 'title', 'status', 'created_at', 'updated_at'];

const SECTION_FILTER_FIELDS = [
  'id', 'article_id', 'parent_id', 'title', 'level', 'position',
  'created_at', 'updated_at',
];

const SECTION_SORT_FIELDS = ['id', 'title', 'level', 'position', 'created_at'];

const PARAGRAPH_FILTER_FIELDS = [
  'id', 'section_id', 'title', 'is_knowledge_point', 'position', 'token_count',
  'created_at', 'updated_at',
];

const PARAGRAPH_SORT_FIELDS = ['id', 'position', 'token_count', 'created_at'];

const TAG_FILTER_FIELDS = [
  'id', 'kb_id', 'name', 'description', 'article_count',
  'created_at',
];

const TAG_SORT_FIELDS = ['id', 'name', 'article_count', 'created_at'];

class KbController {
  constructor(db) {
    this.db = db;
    this.KbArticle = null;
    this.KbSection = null;
    this.KbParagraph = null;
    this.KbTag = null;
    this.KbArticleTag = null;
    this.KnowledgeBase = null;
  }

  /**
   * 确保模型已初始化
   */
  ensureModels() {
    if (!this.KbArticle) {
      this.KbArticle = this.db.getModel('kb_article');
      this.KbSection = this.db.getModel('kb_section');
      this.KbParagraph = this.db.getModel('kb_paragraph');
      this.KbTag = this.db.getModel('kb_tag');
      this.KbArticleTag = this.db.getModel('kb_article_tag');
      this.KnowledgeBase = this.db.getModel('knowledge_basis');
    }
  }

  // ==================== Knowledge Base CRUD ====================

  /**
   * 获取知识库列表
   * GET /api/kb
   */
  async listKnowledgeBases(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const { page = 1, pageSize = 12, search } = ctx.query;

      const where = {};
      if (search) {
        where[Op.or] = [
          { name: { [Op.like]: `%${search}%` } },
          { description: { [Op.like]: `%${search}%` } },
        ];
      }

      const limit = Math.min(parseInt(pageSize) || 12, 100);
      const offset = (parseInt(page) - 1) * limit;

      const { rows, count } = await this.KnowledgeBase.findAndCountAll({
        where,
        limit,
        offset,
        order: [['created_at', 'DESC']],
      });

      // 获取每个知识库的文章数和段落数
      const kbIds = rows.map(kb => kb.id);
      const articleCounts = await this.KbArticle.findAll({
        where: { kb_id: { [Op.in]: kbIds } },
        attributes: ['kb_id', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
        group: ['kb_id'],
        raw: true,
      });
      const articleCountMap = new Map(articleCounts.map(a => [a.kb_id, parseInt(a.count)]));

      // 添加统计信息
      const result = rows.map(kb => ({
        ...kb.toJSON(),
        article_count: articleCountMap.get(kb.id) || 0,
      }));

      ctx.body = {
        items: result,
        total: count,
        page: parseInt(page),
        limit,
        pages: Math.ceil(count / limit),
      };
      logger.info(`[KB] listKnowledgeBases: ${count} kbs, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[KB] listKnowledgeBases error:', error);
      ctx.throw(500, error.message);
    }
  }

  /**
   * 创建知识库
   * POST /api/kb
   */
  async createKnowledgeBase(ctx) {
    try {
      this.ensureModels();
      const data = ctx.request.body;
      const userId = ctx.state.user?.id;

      if (!data.name || !data.name.trim()) {
        ctx.throw(400, 'Knowledge base name is required');
      }

      const id = Utils.generateId('kb');
      const kb = await this.KnowledgeBase.create({
        id,
        name: data.name.trim(),
        description: data.description,
        owner_id: userId,
        embedding_dim: data.embedding_dim || 1536,
        is_public: data.is_public || false,
      });

      ctx.body = kb;
      ctx.status = 201;
    } catch (error) {
      logger.error('[KB] createKnowledgeBase error:', error);
      ctx.throw(500, error.message);
    }
  }

  /**
   * 获取知识库详情
   * GET /api/kb/:kb_id
   */
  async getKnowledgeBase(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;

      const kb = await this.KnowledgeBase.findByPk(kb_id);
      if (!kb) {
        ctx.throw(404, 'Knowledge base not found');
      }

      // 获取文章数
      const articleCount = await this.KbArticle.count({
        where: { kb_id },
      });

      ctx.body = {
        ...kb.toJSON(),
        article_count: articleCount,
      };
    } catch (error) {
      logger.error('[KB] getKnowledgeBase error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 更新知识库
   * PUT /api/kb/:kb_id
   */
  async updateKnowledgeBase(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const data = ctx.request.body;

      const kb = await this.KnowledgeBase.findByPk(kb_id);
      if (!kb) {
        ctx.throw(404, 'Knowledge base not found');
      }

      await kb.update({
        name: data.name !== undefined ? data.name : kb.name,
        description: data.description !== undefined ? data.description : kb.description,
        embedding_model_id: data.embedding_model_id !== undefined ? data.embedding_model_id : kb.embedding_model_id,
        embedding_dim: data.embedding_dim !== undefined ? data.embedding_dim : kb.embedding_dim,
        is_public: data.is_public !== undefined ? data.is_public : kb.is_public,
      });

      ctx.body = kb;
    } catch (error) {
      logger.error('[KB] updateKnowledgeBase error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 删除知识库
   * DELETE /api/kb/:kb_id
   */
  async deleteKnowledgeBase(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;

      const kb = await this.KnowledgeBase.findByPk(kb_id);
      if (!kb) {
        ctx.throw(404, 'Knowledge base not found');
      }

      // 级联删除文章、节、段落、标签（由数据库外键处理）
      await kb.destroy();

      ctx.body = { success: true };
    } catch (error) {
      logger.error('[KB] deleteKnowledgeBase error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  // ==================== Article CRUD ====================

  /**
   * 查询文章列表
   * POST /api/kb/:kb_id/articles/query
   */
  async queryArticles(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const queryRequest = ctx.request.body || {};

      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        baseWhere: { kb_id },
        filterFields: ARTICLE_FILTER_FIELDS,
        sortFields: ARTICLE_SORT_FIELDS,
        defaultSort: [{ field: 'created_at', order: 'DESC' }],
      });

      const { rows, count } = await this.KbArticle.findAndCountAll({
        ...queryOptions,
        distinct: true,
      });

      ctx.body = buildPaginatedResponse(rows, count, pagination);
      logger.info(`[KB] queryArticles: ${count} articles, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[KB] queryArticles error:', error);
      ctx.throw(500, error.message);
    }
  }

  /**
   * 获取单个文章
   * GET /api/kb/:kb_id/articles/:id
   */
  async getArticle(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;

      const article = await this.KbArticle.findOne({
        where: { id, kb_id },
        include: [{
          model: this.KbTag,
          as: 'tags',
          through: { attributes: [] },
        }],
      });

      if (!article) {
        ctx.throw(404, 'Article not found');
      }

      ctx.body = article;
    } catch (error) {
      logger.error('[KB] getArticle error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 创建文章
   * POST /api/kb/:kb_id/articles
   */
  async createArticle(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const data = ctx.request.body;

      // 验证知识库存在
      const kb = await this.KnowledgeBase.findByPk(kb_id);
      if (!kb) {
        ctx.throw(404, 'Knowledge base not found');
      }

      const id = Utils.generateId('art');
      const article = await this.KbArticle.create({
        id,
        kb_id,
        title: data.title,
        summary: data.summary,
        source_type: data.source_type || 'manual',
        source_url: data.source_url,
        file_path: data.file_path,
        status: data.status || 'pending',
      });

      // 如果有标签，创建关联
      if (data.tags && Array.isArray(data.tags)) {
        await this._setArticleTags(article.id, data.tags, kb_id);
      }

      ctx.body = await this.KbArticle.findByPk(id, {
        include: [{
          model: this.KbTag,
          as: 'tags',
          through: { attributes: [] },
        }],
      });
      ctx.status = 201;
    } catch (error) {
      logger.error('[KB] createArticle error:', error);
      ctx.throw(500, error.message);
    }
  }

  /**
   * 更新文章
   * PUT /api/kb/:kb_id/articles/:id
   */
  async updateArticle(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;
      const data = ctx.request.body;

      const article = await this.KbArticle.findOne({ where: { id, kb_id } });
      if (!article) {
        ctx.throw(404, 'Article not found');
      }

      await article.update({
        title: data.title !== undefined ? data.title : article.title,
        summary: data.summary !== undefined ? data.summary : article.summary,
        source_type: data.source_type !== undefined ? data.source_type : article.source_type,
        source_url: data.source_url !== undefined ? data.source_url : article.source_url,
        file_path: data.file_path !== undefined ? data.file_path : article.file_path,
        status: data.status !== undefined ? data.status : article.status,
      });

      // 更新标签
      if (data.tags && Array.isArray(data.tags)) {
        await this._setArticleTags(id, data.tags, kb_id);
      }

      ctx.body = await this.KbArticle.findByPk(id, {
        include: [{
          model: this.KbTag,
          as: 'tags',
          through: { attributes: [] },
        }],
      });
    } catch (error) {
      logger.error('[KB] updateArticle error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 删除文章
   * DELETE /api/kb/:kb_id/articles/:id
   */
  async deleteArticle(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;

      const article = await this.KbArticle.findOne({ where: { id, kb_id } });
      if (!article) {
        ctx.throw(404, 'Article not found');
      }

      // 获取文章关联的标签ID（用于后续递减计数）
      const tags = await article.getTags();
      const tagIds = tags.map(tag => tag.id);

      // 1. 先删除文章（级联删除 sections, paragraphs, article_tags）
      await article.destroy();

      // 2. 再批量递减标签计数（避免 N+1 查询）
      // 注意：必须先删除文章再递减，保证数据一致性
      if (tagIds.length > 0) {
        await this.KbTag.update(
          { article_count: Sequelize.literal('article_count - 1') },
          { where: { id: { [Op.in]: tagIds } } }
        );
      }

      ctx.body = { success: true };
    } catch (error) {
      logger.error('[KB] deleteArticle error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  // ==================== Section CRUD ====================

  /**
   * 查询节列表
   * POST /api/kb/:kb_id/sections/query
   */
  async querySections(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const queryRequest = ctx.request.body || {};

      // 先获取 kb_id 下的所有文章 ID
      const articles = await this.KbArticle.findAll({
        where: { kb_id },
        attributes: ['id'],
        raw: true,
      });
      const articleIds = articles.map(a => a.id);

      if (articleIds.length === 0) {
        ctx.body = buildPaginatedResponse([], 0, queryRequest.pagination || {});
        return;
      }

      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        baseWhere: { article_id: { [Op.in]: articleIds } },
        filterFields: SECTION_FILTER_FIELDS,
        sortFields: SECTION_SORT_FIELDS,
        defaultSort: [{ field: 'position', order: 'ASC' }],
      });

      const { rows, count } = await this.KbSection.findAndCountAll({
        ...queryOptions,
        distinct: true,
      });

      ctx.body = buildPaginatedResponse(rows, count, pagination);
      logger.info(`[KB] querySections: ${count} sections, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[KB] querySections error:', error);
      ctx.throw(500, error.message);
    }
  }

  /**
   * 获取文章的完整节树
   * GET /api/kb/:kb_id/articles/:article_id/tree
   */
  async getArticleTree(ctx) {
    try {
      this.ensureModels();
      const { kb_id, article_id } = ctx.params;

      // 验证文章存在
      const article = await this.KbArticle.findOne({ where: { id: article_id, kb_id } });
      if (!article) {
        ctx.throw(404, 'Article not found');
      }

      // 获取所有节
      const sections = await this.KbSection.findAll({
        where: { article_id },
        order: [['position', 'ASC']],
        raw: true,
      });

      // 获取所有段落
      const sectionIds = sections.map(s => s.id);
      const paragraphs = sectionIds.length > 0 
        ? await this.KbParagraph.findAll({
            where: { section_id: { [Op.in]: sectionIds } },
            order: [['position', 'ASC']],
            raw: true,
          })
        : [];

      // 构建树结构
      const tree = this._buildSectionTree(sections, paragraphs);

      ctx.body = {
        article,
        tree,
      };
    } catch (error) {
      logger.error('[KB] getArticleTree error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 创建节
   * POST /api/kb/:kb_id/sections
   */
  async createSection(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const data = ctx.request.body;

      // 验证文章存在且属于该知识库
      const article = await this.KbArticle.findOne({
        where: { id: data.article_id, kb_id },
      });
      if (!article) {
        ctx.throw(404, 'Article not found');
      }

      // 计算层级
      let level = 1;
      if (data.parent_id) {
        const parent = await this.KbSection.findByPk(data.parent_id);
        if (!parent || parent.article_id !== data.article_id) {
          ctx.throw(400, 'Invalid parent section');
        }
        
        // 检查层级深度限制
        if (parent.level >= MAX_SECTION_DEPTH) {
          ctx.throw(400, `Section depth exceeds maximum limit of ${MAX_SECTION_DEPTH} levels`);
        }
        
        level = parent.level + 1;
      }

      // 计算位置
      const maxPosition = await this.KbSection.max('position', {
        where: {
          article_id: data.article_id,
          parent_id: data.parent_id || null,
        },
      }) || 0;

      const id = Utils.generateId('sec');
      const section = await this.KbSection.create({
        id,
        article_id: data.article_id,
        parent_id: data.parent_id || null,
        title: data.title,
        level,
        position: maxPosition + 1,
      });

      ctx.body = section;
      ctx.status = 201;
    } catch (error) {
      logger.error('[KB] createSection error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 更新节
   * PUT /api/kb/:kb_id/sections/:id
   */
  async updateSection(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;
      const data = ctx.request.body;

      const section = await this.KbSection.findByPk(id, {
        include: [{ model: this.KbArticle, as: 'article' }],
      });
      if (!section || section.article.kb_id !== kb_id) {
        ctx.throw(404, 'Section not found');
      }

      await section.update({
        title: data.title !== undefined ? data.title : section.title,
      });

      ctx.body = section;
    } catch (error) {
      logger.error('[KB] updateSection error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 移动节（与相邻节交换位置）
   * POST /api/kb/:kb_id/sections/:id/move
   */
  async moveSection(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;
      const { direction } = ctx.request.body;

      if (!['up', 'down'].includes(direction)) {
        ctx.throw(400, 'Invalid direction, must be "up" or "down"');
      }

      const section = await this.KbSection.findByPk(id, {
        include: [{ model: this.KbArticle, as: 'article' }],
      });
      if (!section || section.article.kb_id !== kb_id) {
        ctx.throw(404, 'Section not found');
      }

      const parentId = section.parent_id;
      const position = section.position;

      // 找到相邻节
      const adjacent = direction === 'up'
        ? await this.KbSection.findOne({
            where: { parent_id: parentId, position: position - 1 },
          })
        : await this.KbSection.findOne({
            where: { parent_id: parentId, position: position + 1 },
          });

      if (!adjacent) {
        ctx.throw(400, 'Cannot move: already at boundary');
      }

      // 交换 position
      await this.KbSection.update(
        { position: position },
        { where: { id: adjacent.id } }
      );
      await this.KbSection.update(
        { position: direction === 'up' ? position - 1 : position + 1 },
        { where: { id: section.id } }
      );

      ctx.body = { success: true };
    } catch (error) {
      logger.error('[KB] moveSection error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 删除节
   * DELETE /api/kb/:kb_id/sections/:id
   */
  async deleteSection(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;

      const section = await this.KbSection.findByPk(id, {
        include: [{ model: this.KbArticle, as: 'article' }],
      });
      if (!section || section.article.kb_id !== kb_id) {
        ctx.throw(404, 'Section not found');
      }

      // 级联删除子节和段（由数据库外键处理）
      await section.destroy();

      ctx.body = { success: true };
    } catch (error) {
      logger.error('[KB] deleteSection error:', error);
      // 外键约束错误友好提示
      if (error instanceof ForeignKeyConstraintError) {
        ctx.throw(409, 'Cannot delete section: it has child sections or paragraphs');
      }
      ctx.throw(error.status || 500, error.message);
    }
  }

  // ==================== Paragraph CRUD ====================

  /**
   * 查询段落列表
   * POST /api/kb/:kb_id/paragraphs/query
   */
  async queryParagraphs(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const queryRequest = ctx.request.body || {};

      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        filterFields: PARAGRAPH_FILTER_FIELDS,
        sortFields: PARAGRAPH_SORT_FIELDS,
        defaultSort: [{ field: 'position', order: 'ASC' }],
      });

      // 如果有 section_id 过滤，验证其属于该知识库
      if (queryOptions.where?.section_id) {
        const section = await this.KbSection.findByPk(queryOptions.where.section_id, {
          include: [{ model: this.KbArticle, as: 'article' }],
        });
        if (!section || section.article.kb_id !== kb_id) {
          ctx.throw(400, 'Invalid section_id');
        }
      }

      const { rows, count } = await this.KbParagraph.findAndCountAll({
        ...queryOptions,
        distinct: true,
      });

      ctx.body = buildPaginatedResponse(rows, count, pagination);
      logger.info(`[KB] queryParagraphs: ${count} paragraphs, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[KB] queryParagraphs error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 创建段落
   * POST /api/kb/:kb_id/paragraphs
   */
  async createParagraph(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const data = ctx.request.body;

      // 验证节存在且属于该知识库
      const section = await this.KbSection.findByPk(data.section_id, {
        include: [{ model: this.KbArticle, as: 'article' }],
      });
      if (!section || section.article.kb_id !== kb_id) {
        ctx.throw(404, 'Section not found');
      }

      // 计算位置
      const maxPosition = await this.KbParagraph.max('position', {
        where: { section_id: data.section_id },
      }) || 0;

      const id = Utils.generateId('para');
      const paragraph = await this.KbParagraph.create({
        id,
        section_id: data.section_id,
        title: data.title,
        content: data.content,
        is_knowledge_point: data.is_knowledge_point || false,
        position: maxPosition + 1,
        token_count: data.token_count || 0,
      });

      ctx.body = paragraph;
      ctx.status = 201;
    } catch (error) {
      logger.error('[KB] createParagraph error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 更新段落
   * PUT /api/kb/:kb_id/paragraphs/:id
   */
  async updateParagraph(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;
      const data = ctx.request.body;

      const paragraph = await this.KbParagraph.findByPk(id, {
        include: [{
          model: this.KbSection,
          as: 'section',
          include: [{ model: this.KbArticle, as: 'article' }],
        }],
      });
      if (!paragraph || paragraph.section.article.kb_id !== kb_id) {
        ctx.throw(404, 'Paragraph not found');
      }

      await paragraph.update({
        title: data.title !== undefined ? data.title : paragraph.title,
        content: data.content !== undefined ? data.content : paragraph.content,
        is_knowledge_point: data.is_knowledge_point !== undefined 
          ? data.is_knowledge_point : paragraph.is_knowledge_point,
        token_count: data.token_count !== undefined 
          ? data.token_count : paragraph.token_count,
      });

      ctx.body = paragraph;
    } catch (error) {
      logger.error('[KB] updateParagraph error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 移动段落（与相邻段交换位置）
   * POST /api/kb/:kb_id/paragraphs/:id/move
   */
  async moveParagraph(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;
      const { direction } = ctx.request.body;

      if (!['up', 'down'].includes(direction)) {
        ctx.throw(400, 'Invalid direction, must be "up" or "down"');
      }

      const paragraph = await this.KbParagraph.findByPk(id, {
        include: [{
          model: this.KbSection,
          as: 'section',
          include: [{ model: this.KbArticle, as: 'article' }],
        }],
      });
      if (!paragraph || paragraph.section.article.kb_id !== kb_id) {
        ctx.throw(404, 'Paragraph not found');
      }

      const sectionId = paragraph.section_id;
      const position = paragraph.position;

      // 找到相邻段
      const adjacent = direction === 'up'
        ? await this.KbParagraph.findOne({
            where: { section_id: sectionId, position: position - 1 },
          })
        : await this.KbParagraph.findOne({
            where: { section_id: sectionId, position: position + 1 },
          });

      if (!adjacent) {
        ctx.throw(400, 'Cannot move: already at boundary');
      }

      // 交换 position
      await this.KbParagraph.update(
        { position: position },
        { where: { id: adjacent.id } }
      );
      await this.KbParagraph.update(
        { position: direction === 'up' ? position - 1 : position + 1 },
        { where: { id: paragraph.id } }
      );

      ctx.body = { success: true };
    } catch (error) {
      logger.error('[KB] moveParagraph error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 删除段落
   * DELETE /api/kb/:kb_id/paragraphs/:id
   */
  async deleteParagraph(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;

      const paragraph = await this.KbParagraph.findByPk(id, {
        include: [{
          model: this.KbSection,
          as: 'section',
          include: [{ model: this.KbArticle, as: 'article' }],
        }],
      });
      if (!paragraph || paragraph.section.article.kb_id !== kb_id) {
        ctx.throw(404, 'Paragraph not found');
      }

      await paragraph.destroy();

      ctx.body = { success: true };
    } catch (error) {
      logger.error('[KB] deleteParagraph error:', error);
      // 外键约束错误友好提示
      if (error instanceof ForeignKeyConstraintError) {
        ctx.throw(409, 'Cannot delete paragraph: it is referenced by other records');
      }
      ctx.throw(error.status || 500, error.message);
    }
  }

  // ==================== Tag CRUD ====================

  /**
   * 查询标签列表
   * POST /api/kb/:kb_id/tags/query
   */
  async queryTags(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const queryRequest = ctx.request.body || {};

      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        baseWhere: { kb_id },
        filterFields: TAG_FILTER_FIELDS,
        sortFields: TAG_SORT_FIELDS,
        defaultSort: [{ field: 'article_count', order: 'DESC' }],
      });

      const { rows, count } = await this.KbTag.findAndCountAll({
        ...queryOptions,
        distinct: true,
      });

      ctx.body = buildPaginatedResponse(rows, count, pagination);
      logger.info(`[KB] queryTags: ${count} tags, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[KB] queryTags error:', error);
      ctx.throw(500, error.message);
    }
  }

  /**
   * 创建标签
   * POST /api/kb/:kb_id/tags
   */
  async createTag(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const data = ctx.request.body;

      // 验证知识库存在
      const kb = await this.KnowledgeBase.findByPk(kb_id);
      if (!kb) {
        ctx.throw(404, 'Knowledge base not found');
      }

      // 检查标签名是否已存在
      const existing = await this.KbTag.findOne({
        where: { kb_id, name: data.name },
      });
      if (existing) {
        ctx.throw(400, 'Tag already exists');
      }

      const id = Utils.generateId('tag');
      const tag = await this.KbTag.create({
        id,
        kb_id,
        name: data.name,
        description: data.description,
        article_count: 0,
      });

      ctx.body = tag;
      ctx.status = 201;
    } catch (error) {
      logger.error('[KB] createTag error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 更新标签
   * PUT /api/kb/:kb_id/tags/:id
   */
  async updateTag(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;
      const data = ctx.request.body;

      const tag = await this.KbTag.findOne({ where: { id, kb_id } });
      if (!tag) {
        ctx.throw(404, 'Tag not found');
      }

      // 检查新名称是否与其他标签冲突
      if (data.name && data.name !== tag.name) {
        const existing = await this.KbTag.findOne({
          where: { kb_id, name: data.name },
        });
        if (existing) {
          ctx.throw(400, 'Tag name already exists');
        }
      }

      await tag.update({
        name: data.name !== undefined ? data.name : tag.name,
        description: data.description !== undefined ? data.description : tag.description,
      });

      ctx.body = tag;
    } catch (error) {
      logger.error('[KB] updateTag error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 删除标签
   * DELETE /api/kb/:kb_id/tags/:id
   */
  async deleteTag(ctx) {
    try {
      this.ensureModels();
      const { kb_id, id } = ctx.params;

      const tag = await this.KbTag.findOne({ where: { id, kb_id } });
      if (!tag) {
        ctx.throw(404, 'Tag not found');
      }

      // 级联删除关联（由数据库外键处理）
      await tag.destroy();

      ctx.body = { success: true };
    } catch (error) {
      logger.error('[KB] deleteTag error:', error);
      // 外键约束错误友好提示
      if (error instanceof ForeignKeyConstraintError) {
        ctx.throw(409, 'Cannot delete tag: it is still referenced by articles');
      }
      ctx.throw(error.status || 500, error.message);
    }
  }

  // ==================== Helper Methods ====================

  /**
   * 设置文章标签
   * @param {string} articleId 文章ID
   * @param {string[]} tags 标签名数组
   * @param {string} kbId 知识库ID
   */
  async _setArticleTags(articleId, tags, kbId) {
    // 使用事务包裹整个标签设置过程
    const transaction = await this.db.sequelize.transaction();
    
    try {
      // 获取现有标签
      const existingTags = await this.KbTag.findAll({
        where: { kb_id: kbId, name: { [Op.in]: tags } },
        transaction,
      });
      const existingTagMap = new Map(existingTags.map(t => [t.name, t]));

      // 批量创建不存在的标签
      const tagIds = [];
      const newTags = [];
      
      for (const tagName of tags) {
        if (existingTagMap.has(tagName)) {
          tagIds.push(existingTagMap.get(tagName).id);
        } else {
          const id = Utils.generateId('tag');
          newTags.push({
            id,
            kb_id: kbId,
            name: tagName,
            article_count: 0,
          });
          tagIds.push(id);
        }
      }

      // 批量创建新标签
      if (newTags.length > 0) {
        await this.KbTag.bulkCreate(newTags, { transaction });
      }

      // 删除现有关联
      await this.KbArticleTag.destroy({
        where: { article_id: articleId },
        transaction,
      });

      // 批量创建新关联
      if (tagIds.length > 0) {
        const articleTagAssociations = tagIds.map(tagId => ({
          id: Utils.generateId('at'),
          article_id: articleId,
          tag_id: tagId,
        }));
        await this.KbArticleTag.bulkCreate(articleTagAssociations, { transaction });
      }

      // 批量更新标签的 article_count（使用子查询避免 N+1）
      if (tagIds.length > 0) {
        await this.KbTag.update(
          {
            article_count: Sequelize.literal(`(
              SELECT COUNT(*) FROM kb_article_tags
              WHERE tag_id = kb_tags.id
            )`)
          },
          {
            where: { id: { [Op.in]: tagIds } },
            transaction
          }
        );
      }

      // 提交事务
      await transaction.commit();
    } catch (error) {
      // 回滚事务
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * 构建节树结构
   * @param {Object[]} sections 节数组
   * @param {Object[]} paragraphs 段落数组
   * @returns {Object[]} 树结构
   */
  _buildSectionTree(sections, paragraphs) {
    const sectionMap = new Map(sections.map(s => [s.id, { ...s, children: [], paragraphs: [] }]));
    const paragraphMap = new Map();
    
    // 按section_id分组段落
    for (const p of paragraphs) {
      if (!paragraphMap.has(p.section_id)) {
        paragraphMap.set(p.section_id, []);
      }
      paragraphMap.get(p.section_id).push(p);
    }

    // 构建树
    const roots = [];
    for (const section of sectionMap.values()) {
      // 添加段落
      section.paragraphs = paragraphMap.get(section.id) || [];
      
      if (section.parent_id && sectionMap.has(section.parent_id)) {
        sectionMap.get(section.parent_id).children.push(section);
      } else {
        roots.push(section);
      }
    }

    return roots;
  }
}

export default KbController;
