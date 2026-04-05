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
import {
  validateKbCreation,
  buildAccessibleKbWhere,
  canAccessKb,
  canEditKb,
  canDeleteKb,
  canTransferOwner,
  getKbPermissionInfo,
} from '../../lib/kb-permission.js';

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

const PARAGRAPH_SORT_FIELDS = ['id', 'position', 'token_count', 'created_at', 'updated_at'];

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
      const userId = ctx.state.session.id;
      const { page = 1, pageSize = 12, search } = ctx.query;

      // 构建权限过滤条件
      const permissionWhere = await buildAccessibleKbWhere(this.db, userId);

      const where = { ...permissionWhere };
      if (search) {
        where[Op.and] = [
          permissionWhere,
          {
            [Op.or]: [
              { name: { [Op.like]: `%${search}%` } },
              { description: { [Op.like]: `%${search}%` } },
            ],
          },
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

      // 获取段落数量（需要通过 article -> section -> paragraph 关联）
      const paragraphCounts = await this.KbParagraph.findAll({
        include: [{
          model: this.KbSection,
          as: 'section',
          include: [{
            model: this.KbArticle,
            as: 'article',
            where: { kb_id: { [Op.in]: kbIds } },
            attributes: ['kb_id'],
          }],
        }],
        attributes: ['section.article.kb_id', [Sequelize.fn('COUNT', Sequelize.col('kb_paragraph.id')), 'count']],
        group: ['section.article.kb_id'],
        raw: true,
      });
      const paragraphCountMap = new Map(paragraphCounts.map(p => [p.kb_id, parseInt(p.count)]));

      // 添加统计信息和权限信息
      const result = await Promise.all(rows.map(async (kb) => {
        const permInfo = await getKbPermissionInfo(this.db, kb, userId);
        return {
          ...kb.toJSON(),
          article_count: articleCountMap.get(kb.id) || 0,
          paragraph_count: paragraphCountMap.get(kb.id) || 0,
          ...permInfo,
        };
      }));

      // 获取所有相关用户的用户名
      const userIds = [...new Set(result.flatMap(kb => [kb.owner_id, kb.creator_id]))];
      const User = this.db.getModel('user');
      const users = await User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ['id', 'username'],
        raw: true,
      });
      const userMap = new Map(users.map(u => [u.id, u.username]));

      // 添加用户名到结果
      const resultWithUsernames = result.map(kb => ({
        ...kb,
        owner_name: userMap.get(kb.owner_id) || kb.owner_id,
        creator_name: userMap.get(kb.creator_id) || kb.creator_id,
      }));

      ctx.success({
        items: resultWithUsernames,
        total: count,
        page: parseInt(page),
        limit,
        pages: Math.ceil(count / limit),
      });
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
      const userId = ctx.state.session.id;

      if (!data.name || !data.name.trim()) {
        ctx.throw(400, 'Knowledge base name is required');
      }

      // 权限校验
      const validation = await validateKbCreation(this.db, {
        owner_id: data.owner_id,
        visibility: data.visibility,
      }, { id: userId });

      if (!validation.valid) {
        ctx.throw(403, validation.error);
      }

      const id = Utils.newID(20);
      const kb = await this.KnowledgeBase.create({
        id,
        name: data.name.trim(),
        description: data.description,
        visibility: validation.visibility,
        owner_id: validation.owner_id,
        creator_id: validation.creator_id,
        embedding_dim: data.embedding_dim || 1536,
        is_public: data.is_public || false,
      });

      ctx.success(kb);
      ctx.status = 201;
    } catch (error) {
      logger.error('[KB] createKnowledgeBase error:', error.message, error.stack);
      ctx.throw(error.status || 500, error.message);
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
      const userId = ctx.state.session.id;

      const kb = await this.KnowledgeBase.findByPk(kb_id);
      if (!kb) {
        ctx.throw(404, 'Knowledge base not found');
      }

      // 权限检查
      const hasAccess = await canAccessKb(this.db, kb_id, userId);
      if (!hasAccess) {
        ctx.throw(403, '无权访问此知识库');
      }

      // 获取文章数
      const articleCount = await this.KbArticle.count({
        where: { kb_id },
      });

      // 获取权限信息
      const permInfo = await getKbPermissionInfo(this.db, kb, userId);

      ctx.success({
        ...kb.toJSON(),
        article_count: articleCount,
        ...permInfo,
      });
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
      const userId = ctx.state.session.id;

      const kb = await this.KnowledgeBase.findByPk(kb_id);
      if (!kb) {
        ctx.throw(404, 'Knowledge base not found');
      }

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

      await kb.update({
        name: data.name !== undefined ? data.name : kb.name,
        description: data.description !== undefined ? data.description : kb.description,
        visibility: data.visibility !== undefined ? data.visibility : kb.visibility,
        embedding_model_id: data.embedding_model_id !== undefined ? data.embedding_model_id : kb.embedding_model_id,
        embedding_dim: data.embedding_dim !== undefined ? data.embedding_dim : kb.embedding_dim,
        is_public: data.is_public !== undefined ? data.is_public : kb.is_public,
      });

      ctx.success(kb);
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
      const userId = ctx.state.session.id;

      const kb = await this.KnowledgeBase.findByPk(kb_id);
      if (!kb) {
        ctx.throw(404, 'Knowledge base not found');
      }

      // 权限检查
      const deleteCheck = await canDeleteKb(this.db, kb_id, userId);
      if (!deleteCheck.canDelete) {
        ctx.throw(403, deleteCheck.reason);
      }

      // 级联删除文章、节、段落、标签（由数据库外键处理）
      await kb.destroy();

      ctx.success({ success: true });
    } catch (error) {
      logger.error('[KB] deleteKnowledgeBase error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 转移知识库 owner
   * POST /api/kb/:kb_id/transfer-owner
   */
  async transferOwner(ctx) {
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const { new_owner_id } = ctx.request.body;
      const userId = ctx.state.session.id;

      if (!new_owner_id) {
        ctx.throw(400, 'new_owner_id is required');
      }

      // 权限检查：只有 admin 可以转移 owner
      const canTransfer = await canTransferOwner(this.db, userId);
      if (!canTransfer) {
        ctx.throw(403, '只有系统管理员可以转移知识库管理员');
      }

      const kb = await this.KnowledgeBase.findByPk(kb_id);
      if (!kb) {
        ctx.throw(404, 'Knowledge base not found');
      }

      // 验证新 owner 用户存在
      const User = this.db.getModel('user');
      const newOwner = await User.findByPk(new_owner_id);
      if (!newOwner) {
        ctx.throw(404, '新管理员用户不存在');
      }

      const oldOwnerId = kb.owner_id;

      // 更新 owner
      await kb.update({ owner_id: new_owner_id });

      logger.info(`[KB] transferOwner: kb ${kb_id} transferred from ${oldOwnerId} to ${new_owner_id} by ${userId}`);

      ctx.success({
        success: true,
        old_owner_id: oldOwnerId,
        new_owner_id: new_owner_id,
      });
    } catch (error) {
      logger.error('[KB] transferOwner error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  // ==================== Article CRUD ====================

  /**
   * 查询文章列表
   * POST /api/kb/:kb_id/articles/query (复杂查询)
   * GET /api/kb/:kb_id/articles (简单查询)
   * 支持参数：
   * - tag_ids: 标签ID数组，用于过滤包含指定标签的文章
   */
  async queryArticles(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const userId = ctx.state.session.id;

      // 权限检查
      const hasAccess = await canAccessKb(this.db, kb_id, userId);
      if (!hasAccess) {
        ctx.throw(403, '无权访问此知识库');
      }

      // 支持 GET (ctx.query) 和 POST (ctx.request.body) 两种方式
      const queryParams = ctx.method === 'GET' ? ctx.query : ctx.request.body;
      const queryRequest = queryParams || {};

      // 提取 tag_ids 参数，并确保是数组
      // GET 请求中 tag_ids 可能是字符串（逗号分隔），POST 请求中是数组
      let tagIds = queryRequest.tag_ids;
      if (tagIds) {
        if (typeof tagIds === 'string') {
          // GET 请求中可能是逗号分隔的字符串
          tagIds = tagIds.split(',').map(t => t.trim()).filter(t => t);
        } else if (!Array.isArray(tagIds)) {
          tagIds = [tagIds];
        }
      }

      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        baseWhere: { kb_id },
        filterFields: ARTICLE_FILTER_FIELDS,
        sortOptions: {
          allowedFields: ARTICLE_SORT_FIELDS,
          defaultSort: [['created_at', 'DESC']],
        },
      });

      // 始终包含 tags 关联，用于显示文章标签
      // 如果有 tag_ids 参数，添加 where 条件过滤
      const include = [{
        model: this.KbTag,
        as: 'tag_id_kb_tags',
        through: { attributes: [] },
      }];

      // 如果有 tag_ids 参数，修改 include 中的 where 条件
      if (tagIds && Array.isArray(tagIds) && tagIds.length > 0) {
        include[0].where = {
          id: { [Op.in]: tagIds },
        };
      }

      const result = await this.KbArticle.findAndCountAll({
        ...queryOptions,
        include,
        distinct: true,
      });

      ctx.success(buildPaginatedResponse(result, pagination, startTime));
      logger.info(`[KB] queryArticles: ${result.count} articles, ${Date.now() - startTime}ms`);
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
      const userId = ctx.state.session.id;

      // 权限检查
      const hasAccess = await canAccessKb(this.db, kb_id, userId);
      if (!hasAccess) {
        ctx.throw(403, '无权访问此知识库');
      }

      const article = await this.KbArticle.findOne({
        where: { id, kb_id },
        include: [{
          model: this.KbTag,
          as: 'tag_id_kb_tags',
          through: { attributes: [] },
        }],
      });

      if (!article) {
        ctx.throw(404, 'Article not found');
      }

      ctx.success(article);
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
      const userId = ctx.state.session.id;

      // 验证知识库存在
      const kb = await this.KnowledgeBase.findByPk(kb_id);
      if (!kb) {
        ctx.throw(404, 'Knowledge base not found');
      }

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

      const id = Utils.newID(20);
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

      ctx.success(await this.KbArticle.findByPk(id, {
        include: [{
          model: this.KbTag,
          as: 'tag_id_kb_tags',
          through: { attributes: [] },
        }],
      }));
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

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

      ctx.success(await this.KbArticle.findByPk(id, {
        include: [{
          model: this.KbTag,
          as: 'tag_id_kb_tags',
          through: { attributes: [] },
        }],
      }));
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

      const article = await this.KbArticle.findOne({ where: { id, kb_id } });
      if (!article) {
        ctx.throw(404, 'Article not found');
      }

      // 获取文章关联的标签ID（用于后续递减计数）
      const tags = await article.getTag_id_kb_tags();
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

      ctx.success({ success: true });
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
      const userId = ctx.state.session.id;
      const queryRequest = ctx.request.body || {};

      // 权限检查
      const hasAccess = await canAccessKb(this.db, kb_id, userId);
      if (!hasAccess) {
        ctx.throw(403, '无权访问此知识库');
      }

      // 先获取 kb_id 下的所有文章 ID
      const articles = await this.KbArticle.findAll({
        where: { kb_id },
        attributes: ['id'],
        raw: true,
      });
      const articleIds = articles.map(a => a.id);

      if (articleIds.length === 0) {
        ctx.success(buildPaginatedResponse({ rows: [], count: 0 }, queryRequest.pagination || {}, startTime));
        return;
      }

      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        baseWhere: { article_id: { [Op.in]: articleIds } },
        filterFields: SECTION_FILTER_FIELDS,
        sortOptions: {
          allowedFields: SECTION_SORT_FIELDS,
          defaultSort: [['position', 'ASC']],
        },
      });

      const result = await this.KbSection.findAndCountAll({
        ...queryOptions,
        distinct: true,
      });

      ctx.success(buildPaginatedResponse(result, pagination, startTime));
      logger.info(`[KB] querySections: ${result.count} sections, ${Date.now() - startTime}ms`);
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
      const userId = ctx.state.session.id;

      // 权限检查
      const hasAccess = await canAccessKb(this.db, kb_id, userId);
      if (!hasAccess) {
        ctx.throw(403, '无权访问此知识库');
      }

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
      let paragraphs = [];
      if (sectionIds.length > 0) {
        const paragraphRows = await this.KbParagraph.findAll({
          where: { section_id: { [Op.in]: sectionIds } },
          order: [['position', 'ASC']],
        });
        // 添加 is_vectorized 字段
        paragraphs = paragraphRows.map(p => {
          const pJson = p.toJSON();
          return {
            ...pJson,
            is_vectorized: pJson.embedding !== null && pJson.embedding !== undefined,
          };
        });
      }

      // 构建树结构
      const tree = this._buildSectionTree(sections, paragraphs);

      ctx.success({
        article,
        tree,
      });
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

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

      const id = Utils.newID(20);
      const section = await this.KbSection.create({
        id,
        article_id: data.article_id,
        parent_id: data.parent_id || null,
        title: data.title,
        level,
        position: maxPosition + 1,
      });

      ctx.success(section);
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

      const section = await this.KbSection.findByPk(id, {
        include: [{ model: this.KbArticle, as: 'article' }],
      });
      if (!section || section.article.kb_id !== kb_id) {
        ctx.throw(404, 'Section not found');
      }

      await section.update({
        title: data.title !== undefined ? data.title : section.title,
      });

      ctx.success(section);
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

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

      ctx.success({ success: true });
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

      const section = await this.KbSection.findByPk(id, {
        include: [{ model: this.KbArticle, as: 'article' }],
      });
      if (!section || section.article.kb_id !== kb_id) {
        ctx.throw(404, 'Section not found');
      }

      // 级联删除子节和段（由数据库外键处理）
      await section.destroy();

      ctx.success({ success: true });
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
      const userId = ctx.state.session.id;
      const queryRequest = ctx.request.body || {};

      // 权限检查
      const hasAccess = await canAccessKb(this.db, kb_id, userId);
      if (!hasAccess) {
        ctx.throw(403, '无权访问此知识库');
      }

      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        filterFields: PARAGRAPH_FILTER_FIELDS,
        sortOptions: {
          allowedFields: PARAGRAPH_SORT_FIELDS,
          defaultSort: [['position', 'ASC']],
        },
      });

      // 如果有 section_id 过滤，验证其属于该知识库
      // 注意：queryOptions.where.section_id 是 Sequelize 条件对象 { [Op.eq]: 'xxx' }
      // 需要从原始请求中获取 section_id 的值
      const sectionId = queryRequest.filter?.section_id;
      if (sectionId) {
        const section = await this.KbSection.findByPk(sectionId, {
          include: [{ model: this.KbArticle, as: 'article' }],
        });
        if (!section || section.article.kb_id !== kb_id) {
          ctx.throw(400, 'Invalid section_id');
        }
      }

      const result = await this.KbParagraph.findAndCountAll({
        ...queryOptions,
        distinct: true,
      });

      // 添加 is_vectorized 字段（根据 embedding 是否为 NULL 判断）
      const rowsWithVectorizedStatus = result.rows.map(p => {
        const pJson = p.toJSON();
        return {
          ...pJson,
          is_vectorized: pJson.embedding !== null && pJson.embedding !== undefined,
        };
      });

      ctx.success(buildPaginatedResponse({
        rows: rowsWithVectorizedStatus,
        count: result.count,
      }, pagination, startTime));
      logger.info(`[KB] queryParagraphs: ${result.count} paragraphs, ${Date.now() - startTime}ms`);
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

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

      const id = Utils.newID(20);
      const paragraph = await this.KbParagraph.create({
        id,
        section_id: data.section_id,
        title: data.title,
        content: data.content,
        context: data.context, // 知识点的上下文，用于检索
        is_knowledge_point: data.is_knowledge_point || false,
        position: maxPosition + 1,
        token_count: data.token_count || 0,
      });

      ctx.success(paragraph);
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
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

      await paragraph.update({
        title: data.title !== undefined ? data.title : paragraph.title,
        content: data.content !== undefined ? data.content : paragraph.content,
        context: data.context !== undefined ? data.context : paragraph.context,
        is_knowledge_point: data.is_knowledge_point !== undefined
          ? data.is_knowledge_point : paragraph.is_knowledge_point,
        token_count: data.token_count !== undefined
          ? data.token_count : paragraph.token_count,
      });

      ctx.success(paragraph);
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

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

      ctx.success({ success: true });
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
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

      await paragraph.destroy();

      ctx.success({ success: true });
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
   * POST /api/kb/:kb_id/tags/query (复杂查询)
   * GET /api/kb/:kb_id/tags (简单查询)
   */
  async queryTags(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const userId = ctx.state.session.id;
      
      // 权限检查
      const hasAccess = await canAccessKb(this.db, kb_id, userId);
      if (!hasAccess) {
        ctx.throw(403, '无权访问此知识库');
      }

      // 支持 GET (ctx.query) 和 POST (ctx.request.body) 两种方式
      const queryParams = ctx.method === 'GET' ? ctx.query : ctx.request.body;
      const queryRequest = queryParams || {};

      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        baseWhere: { kb_id },
        filterFields: TAG_FILTER_FIELDS,
        sortOptions: {
          allowedFields: TAG_SORT_FIELDS,
          defaultSort: [['article_count', 'DESC']],
        },
      });

      const result = await this.KbTag.findAndCountAll({
        ...queryOptions,
        distinct: true,
      });

      ctx.success(buildPaginatedResponse(result, pagination, startTime));
      logger.info(`[KB] queryTags: ${result.count} tags, ${Date.now() - startTime}ms`);
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

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

      const id = Utils.newID(20);
      const tag = await this.KbTag.create({
        id,
        kb_id,
        name: data.name,
        description: data.description,
        article_count: 0,
      });

      ctx.success(tag);
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

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

      ctx.success(tag);
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
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

      const tag = await this.KbTag.findOne({ where: { id, kb_id } });
      if (!tag) {
        ctx.throw(404, 'Tag not found');
      }

      // 级联删除关联（由数据库外键处理）
      await tag.destroy();

      ctx.success({ success: true });
    } catch (error) {
      logger.error('[KB] deleteTag error:', error);
      // 外键约束错误友好提示
      if (error instanceof ForeignKeyConstraintError) {
        ctx.throw(409, 'Cannot delete tag: it is still referenced by articles');
      }
      ctx.throw(error.status || 500, error.message);
    }
  }

  // ==================== Search ====================

  /**
   * 在指定知识库中搜索
   * POST /api/kb/:kb_id/search
   */
  async searchInKnowledgeBase(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const { query, top_k = 5, threshold = 0.1, article_id } = ctx.request.body;
      const userId = ctx.state.session.id;

      if (!query || !query.trim()) {
        ctx.throw(400, 'Search query is required');
      }

      // 权限检查
      const hasAccess = await canAccessKb(this.db, kb_id, userId);
      if (!hasAccess) {
        ctx.throw(403, '无权访问此知识库');
      }

      // 验证知识库存在
      const kb = await this.KnowledgeBase.findByPk(kb_id);
      if (!kb) {
        ctx.throw(404, 'Knowledge base not found');
      }

      // 生成查询向量
      const queryEmbedding = await this._generateEmbedding(query, kb.embedding_model_id);
      if (!queryEmbedding) {
        ctx.throw(500, 'Failed to generate query embedding');
      }

      // 构建搜索条件（使用参数化查询避免 SQL 注入）
      const articleFilter = article_id
        ? 'AND s.article_id = ?'
        : '';
      const replacements = article_id
        ? [kb_id, article_id, top_k]
        : [kb_id, top_k];

      // 执行向量搜索（使用 MariaDB VECTOR 功能）
      const results = await this.db.sequelize.query(
        `SELECT
          p.id, p.title, p.content, p.is_knowledge_point, p.token_count,
          s.id as section_id, s.title as section_title, s.level as section_level,
          a.id as article_id, a.title as article_title,
          k.id as kb_id, k.name as kb_name,
          VEC_DISTANCE_COSINE(p.embedding, VEC_FromText(?)) as distance
        FROM kb_paragraphs p
        JOIN kb_sections s ON p.section_id = s.id
        JOIN kb_articles a ON s.article_id = a.id
        JOIN knowledge_bases k ON a.kb_id = k.id
        WHERE k.id = ? ${articleFilter}
          AND p.embedding IS NOT NULL
          AND p.is_knowledge_point = 1
        ORDER BY distance ASC
        LIMIT ?`,
        {
          replacements: [JSON.stringify(queryEmbedding), ...replacements],
          type: this.db.sequelize.QueryTypes.SELECT,
        }
      );

      // 过滤低于阈值的结果并格式化
      const filteredResults = results
        .filter(r => (1 - r.distance) >= threshold)
        .map(r => ({
          score: 1 - r.distance,
          paragraph: {
            id: r.id,
            title: r.title,
            content: r.content?.substring(0, 500), // 截取前 500 字符
            is_knowledge_point: r.is_knowledge_point,
            token_count: r.token_count,
          },
          section: {
            id: r.section_id,
            title: r.section_title,
            level: r.section_level,
          },
          article: {
            id: r.article_id,
            title: r.article_title,
          },
          knowledge_base: {
            id: r.kb_id,
            name: r.kb_name,
          },
        }));

      ctx.success(filteredResults);
      logger.info(`[KB] searchInKnowledgeBase: ${filteredResults.length} results, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[KB] searchInKnowledgeBase error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 全局搜索（搜索用户所有可访问的知识库）
   * POST /api/kb/search
   */
  async globalSearch(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const userId = ctx.state.session.id;
      const { query, top_k = 10, threshold = 0.1 } = ctx.request.body;

      if (!query || !query.trim()) {
        ctx.throw(400, 'Search query is required');
      }

      // 使用权限过滤获取用户可访问的知识库列表
      const permissionWhere = await buildAccessibleKbWhere(this.db, userId);
      const userKBs = await this.KnowledgeBase.findAll({
        where: permissionWhere,
        attributes: ['id', 'name', 'embedding_model_id'],
        raw: true,
      });

      if (userKBs.length === 0) {
        ctx.success([]);
        return;
      }

      // 使用第一个知识库的 embedding_model_id（假设用户使用统一的嵌入模型）
      const embeddingModelId = userKBs[0].embedding_model_id;

      // 生成查询向量
      const queryEmbedding = await this._generateEmbedding(query, embeddingModelId);
      if (!queryEmbedding) {
        ctx.throw(500, 'Failed to generate query embedding');
      }

      const kbIds = userKBs.map(kb => kb.id);

      // 执行向量搜索（使用参数化查询）
      const results = await this.db.sequelize.query(
        `SELECT
          p.id, p.title, p.content, p.is_knowledge_point, p.token_count,
          s.id as section_id, s.title as section_title, s.level as section_level,
          a.id as article_id, a.title as article_title,
          k.id as kb_id, k.name as kb_name,
          VEC_DISTANCE_COSINE(p.embedding, VEC_FromText(?)) as distance
        FROM kb_paragraphs p
        JOIN kb_sections s ON p.section_id = s.id
        JOIN kb_articles a ON s.article_id = a.id
        JOIN knowledge_bases k ON a.kb_id = k.id
        WHERE k.id IN (?)
          AND p.embedding IS NOT NULL
          AND p.is_knowledge_point = 1
        ORDER BY distance ASC
        LIMIT ?`,
        {
          replacements: [JSON.stringify(queryEmbedding), kbIds, top_k],
          type: this.db.sequelize.QueryTypes.SELECT,
        }
      );

      // 过滤低于阈值的结果并格式化
      const filteredResults = results
        .filter(r => (1 - r.distance) >= threshold)
        .map(r => ({
          score: 1 - r.distance,
          paragraph: {
            id: r.id,
            title: r.title,
            content: r.content?.substring(0, 500),
            is_knowledge_point: r.is_knowledge_point,
            token_count: r.token_count,
          },
          section: {
            id: r.section_id,
            title: r.section_title,
            level: r.section_level,
          },
          article: {
            id: r.article_id,
            title: r.article_title,
          },
          knowledge_base: {
            id: r.kb_id,
            name: r.kb_name,
          },
        }));

      ctx.success(filteredResults);
      logger.info(`[KB] globalSearch: ${filteredResults.length} results, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[KB] globalSearch error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 生成文本的嵌入向量（通过远程 API）
   * @param {string} text - 要生成嵌入的文本
   * @param {string} modelId - 嵌入模型 ID
   * @returns {Promise<number[]|null>} 嵌入向量
   */
  async _generateEmbedding(text, modelId) {
    try {
      // 获取 API 配置
      const AiModel = this.db.getModel('ai_model');
      const Provider = this.db.getModel('provider');

      const model = await AiModel.findOne({
        where: { id: modelId },
        include: [{
          model: Provider,
          as: 'provider',
          attributes: ['base_url', 'api_key'],
        }],
        raw: true,
        nest: true,
      });

      if (!model?.provider) {
        logger.warn('[KB] No embedding API configured for model:', modelId);
        return null;
      }

      const response = await fetch(model.provider.base_url + '/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.provider.api_key}`,
        },
        body: JSON.stringify({
          input: text,
          model: model.model_name || 'text-embedding-3-small',
        }),
      });

      if (!response.ok) {
        logger.error('[KB] Embedding API error:', response.status);
        return null;
      }

      const data = await response.json();
      return data.data?.[0]?.embedding || data.embeddings?.[0] || null;
    } catch (error) {
      logger.error('[KB] _generateEmbedding error:', error);
      return null;
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
          const id = Utils.newID(20);
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
          id: Utils.newID(20),
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

  // ==================== Revectorize ====================

  // 内存中的任务存储（生产环境应该用 Redis 或数据库）
  static revectorizeJobs = new Map();

  /**
   * 启动知识库重新向量化任务
   * POST /api/kb/:kb_id/revectorize
   */
  async startRevectorize(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const { kb_id } = ctx.params;
      const userId = ctx.state.session.id;

      // 权限检查：只有 owner 或 admin 可以编辑
      const canEdit = await canEditKb(this.db, kb_id, userId);
      if (!canEdit) {
        ctx.throw(403, '无权编辑此知识库');
      }

      // 验证知识库存在
      const kb = await this.KnowledgeBase.findByPk(kb_id);
      if (!kb) {
        ctx.throw(404, 'Knowledge base not found');
      }

      // 获取所有段落
      const paragraphs = await this.KbParagraph.findAll({
        include: [{
          model: this.KbSection,
          as: 'section',
          include: [{
            model: this.KbArticle,
            as: 'article',
            where: { kb_id },
            attributes: ['id'],
          }],
        }],
        attributes: ['id', 'content'],
      });

      if (paragraphs.length === 0) {
        ctx.throw(400, 'No paragraphs to revectorize');
      }

      // 创建任务
      const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const job = {
        id: jobId,
        kb_id,
        total: paragraphs.length,
        success: 0,
        failed: 0,
        current: 0,
        status: 'running',
        embedding_dim: kb.embedding_dim || 1536,
        started_at: new Date(),
      };

      KbController.revectorizeJobs.set(jobId, job);

      // 异步执行向量化
      this._runRevectorizeJob(jobId, paragraphs, kb.embedding_model_id, kb.embedding_dim || 1536);

      ctx.success({
        job_id: jobId,
        total: job.total,
        success: 0,
        failed: 0,
        embedding_dim: job.embedding_dim,
      });
      logger.info(`[KB] startRevectorize: job ${jobId} started for ${paragraphs.length} paragraphs, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[KB] startRevectorize error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 获取重新向量化进度
   * GET /api/kb/:kb_id/revectorize/:jobId
   */
  async getRevectorizeProgress(ctx) {
    try {
      this.ensureModels();
      const { kb_id, jobId } = ctx.params;
      const userId = ctx.state.session.id;

      // 权限检查
      const hasAccess = await canAccessKb(this.db, kb_id, userId);
      if (!hasAccess) {
        ctx.throw(403, '无权访问此知识库');
      }

      const job = KbController.revectorizeJobs.get(jobId);
      if (!job) {
        ctx.throw(404, 'Job not found');
      }

      // 验证 job 属于该知识库
      if (job.kb_id !== kb_id) {
        ctx.throw(404, 'Job not found');
      }

      ctx.success({
        total: job.total,
        success: job.success,
        failed: job.failed,
        current: job.current,
        status: job.status,
        embedding_dim: job.embedding_dim,
      });
    } catch (error) {
      logger.error('[KB] getRevectorizeProgress error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 将向量数组转换为 MariaDB VECTOR 二进制格式
   * @param {number[]} embedding 向量数组
   * @returns {Buffer} MariaDB VECTOR 二进制格式
   */
  _toVectorBuffer(embedding) {
    if (!Array.isArray(embedding)) return null;

    // 验证数组元素都是数字
    for (let i = 0; i < embedding.length; i++) {
      if (typeof embedding[i] !== 'number' || !Number.isFinite(embedding[i])) {
        logger.error(`[KB] Invalid embedding value at index ${i}: ${embedding[i]}`);
        return null;
      }
    }

    // 将浮点数数组转换为二进制 Buffer (Float32Array)
    const floatArray = new Float32Array(embedding);
    return Buffer.from(floatArray.buffer);
  }

  /**
   * 异步执行向量化任务
   * @private
   */
  async _runRevectorizeJob(jobId, paragraphs, modelId, embeddingDim) {
    const job = KbController.revectorizeJobs.get(jobId);
    if (!job) return;

    try {
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];

        try {
          // 生成嵌入向量
          const embedding = await this._generateEmbedding(paragraph.content, modelId);

          if (embedding) {
            // 处理维度不匹配的情况
            let finalEmbedding = embedding;
            if (embedding.length !== embeddingDim) {
              logger.warn(`[KB] _runRevectorizeJob: dimension mismatch for paragraph ${paragraph.id}: expected ${embeddingDim}, got ${embedding.length}`);
              if (embedding.length > embeddingDim) {
                finalEmbedding = embedding.slice(0, embeddingDim);
              } else {
                finalEmbedding = [...embedding, ...new Array(embeddingDim - embedding.length).fill(0)];
              }
            }

            // 转换为二进制格式（与 embedding-worker.js 保持一致）
            const vectorBuffer = this._toVectorBuffer(finalEmbedding);
            if (!vectorBuffer) {
              logger.error(`[KB] _runRevectorizeJob: failed to convert embedding for paragraph ${paragraph.id}`);
              job.failed++;
            } else {
              // 使用 VEC_FromText 函数插入向量
                const embeddingJson = JSON.stringify(finalEmbedding);
                await this.db.sequelize.query(
                  `UPDATE kb_paragraphs SET embedding = VEC_FromText(?) WHERE id = ?`,
                  {
                    replacements: [embeddingJson, paragraph.id],
                    type: this.db.sequelize.QueryTypes.UPDATE,
                  }
                );
              job.success++;
            }
          } else {
            job.failed++;
          }
        } catch (e) {
          logger.error(`[KB] _runRevectorizeJob: failed paragraph ${paragraph.id}:`, e.message);
          job.failed++;
        }

        job.current = i + 1;
      }

      job.status = 'completed';
      job.completed_at = new Date();
      logger.info(`[KB] _runRevectorizeJob: job ${jobId} completed: ${job.success} success, ${job.failed} failed`);
    } catch (error) {
      logger.error('[KB] _runRevectorizeJob error:', error);
      job.status = 'failed';
      job.error = error.message;
    }
  }
}

export default KbController;
