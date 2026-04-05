/**
 * Solution Controller - 解决方案控制器
 *
 * 管理解决方案（Solution）的 CRUD 操作
 * 解决方案是一套结构化的方法论文档，用于指导 AI 执行复杂任务
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { Op } from 'sequelize';
import {
  buildQueryOptions,
  buildPaginatedResponse,
} from '../../lib/query-builder.js';

// 允许过滤的字段白名单
const SOLUTION_FILTER_FIELDS = [
  'id', 'name', 'slug', 'is_active',
  'created_at', 'updated_at',
];

const SOLUTION_SORT_FIELDS = ['id', 'name', 'slug', 'created_at', 'updated_at'];

class SolutionController {
  constructor(db) {
    this.db = db;
    this.Solution = null;
  }

  /**
   * 确保模型已初始化
   */
  ensureModels() {
    if (!this.Solution) {
      this.Solution = this.db.getModel('solution');
    }
  }

  /**
   * 生成 URL 友好的 slug
   * @param {string} name - 解决方案名称
   * @returns {string} slug
   */
  generateSlug(name) {
    // 简单实现：将中文名转换为拼音或使用时间戳
    // 这里使用随机字符串作为后备方案
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    // 如果处理后为空或全是中文，使用随机字符串
    if (!baseSlug || /^[\u4e00-\u9fa5]+$/.test(baseSlug)) {
      return 'sol-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
    }
    
    return baseSlug + '-' + Date.now().toString(36);
  }

  /**
   * 获取解决方案列表
   * GET /api/solutions
   * POST /api/solutions/query (复杂查询)
   */
  async list(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      
      // 支持 GET (ctx.query) 和 POST (ctx.request.body) 两种方式
      const queryParams = ctx.method === 'GET' ? ctx.query : ctx.request.body;
      const queryRequest = queryParams || {};

      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        baseWhere: { is_active: true },
        filterFields: SOLUTION_FILTER_FIELDS,
        sortOptions: {
          allowedFields: SOLUTION_SORT_FIELDS,
          defaultSort: [['created_at', 'DESC']],
        },
      });

      // 如果有 tag 参数，过滤标签
      const tagFilter = queryRequest.tag || queryRequest.tags;
      if (tagFilter) {
        const tags = Array.isArray(tagFilter) ? tagFilter : [tagFilter];
        // 使用 JSON 函数查询标签（MariaDB 支持 JSON_CONTAINS）
        queryOptions.where[Op.and] = queryOptions.where[Op.and] || [];
        for (const tag of tags) {
          // 转义标签值防止 SQL 注入
          const escapedTag = String(tag).replace(/["'\\]/g, '\\$&');
          queryOptions.where[Op.and].push(
            this.db.sequelize.literal(`JSON_CONTAINS(tags, '"${escapedTag}"')`)
          );
        }
      }

      const result = await this.Solution.findAndCountAll({
        ...queryOptions,
        attributes: { exclude: ['guide'] }, // 列表不返回完整指南
        distinct: true,
      });

      ctx.success(buildPaginatedResponse(result, pagination, startTime));
      logger.info(`[Solution] list: ${result.count} solutions, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[Solution] list error:', error);
      ctx.throw(500, error.message);
    }
  }

  /**
   * 获取解决方案详情
   * GET /api/solutions/:id
   * GET /api/solutions/slug/:slug
   */
  async get(ctx) {
    try {
      this.ensureModels();
      const { id, slug } = ctx.params;

      let solution;
      if (slug) {
        solution = await this.Solution.findOne({
          where: { slug, is_active: true },
        });
      } else {
        solution = await this.Solution.findOne({
          where: { id, is_active: true },
        });
      }

      if (!solution) {
        ctx.throw(404, 'Solution not found');
      }

      ctx.success(solution);
    } catch (error) {
      logger.error('[Solution] get error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 创建解决方案（管理员）
   * POST /api/solutions
   */
  async create(ctx) {
    try {
      this.ensureModels();
      const data = ctx.request.body;

      if (!data.name || !data.name.trim()) {
        ctx.throw(400, 'Solution name is required');
      }

      // 检查 slug 是否已存在
      const slug = data.slug || this.generateSlug(data.name);
      const existing = await this.Solution.findOne({ where: { slug } });
      if (existing) {
        ctx.throw(400, 'Solution with this slug already exists');
      }

      const id = Utils.newID(32);
      const solution = await this.Solution.create({
        id,
        name: data.name.trim(),
        slug,
        description: data.description,
        guide: data.guide || '',
        tags: data.tags || [],
        is_active: data.is_active !== undefined ? data.is_active : true,
      });

      ctx.success(solution);
      ctx.status = 201;
      logger.info(`[Solution] create: ${id} - ${data.name}`);
    } catch (error) {
      logger.error('[Solution] create error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 更新解决方案（管理员）
   * PUT /api/solutions/:id
   */
  async update(ctx) {
    try {
      this.ensureModels();
      const { id } = ctx.params;
      const data = ctx.request.body;

      const solution = await this.Solution.findByPk(id);
      if (!solution) {
        ctx.throw(404, 'Solution not found');
      }

      // 如果更新 slug，检查是否冲突
      if (data.slug && data.slug !== solution.slug) {
        const existing = await this.Solution.findOne({
          where: { slug: data.slug },
        });
        if (existing) {
          ctx.throw(400, 'Solution with this slug already exists');
        }
      }

      await solution.update({
        name: data.name !== undefined ? data.name.trim() : solution.name,
        slug: data.slug !== undefined ? data.slug : solution.slug,
        description: data.description !== undefined ? data.description : solution.description,
        guide: data.guide !== undefined ? data.guide : solution.guide,
        tags: data.tags !== undefined ? data.tags : solution.tags,
        is_active: data.is_active !== undefined ? data.is_active : solution.is_active,
      });

      ctx.success(solution);
      logger.info(`[Solution] update: ${id}`);
    } catch (error) {
      logger.error('[Solution] update error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 删除解决方案（管理员）- 软删除
   * DELETE /api/solutions/:id
   */
  async delete(ctx) {
    try {
      this.ensureModels();
      const { id } = ctx.params;

      const solution = await this.Solution.findByPk(id);
      if (!solution) {
        ctx.throw(404, 'Solution not found');
      }

      // 软删除：设置 is_active = false
      await solution.update({ is_active: false });

      ctx.success({ success: true });
      logger.info(`[Solution] delete: ${id}`);
    } catch (error) {
      logger.error('[Solution] delete error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 从解决方案创建任务
   * POST /api/solutions/:id/tasks
   */
  async createTask(ctx) {
    try {
      this.ensureModels();
      const { id } = ctx.params;
      const data = ctx.request.body;
      const userId = ctx.state.session.id;

      // 获取解决方案
      const solution = await this.Solution.findOne({
        where: { id, is_active: true },
      });
      if (!solution) {
        ctx.throw(404, 'Solution not found');
      }

      // 获取 Task 模型
      const Task = this.db.getModel('task');
      
      // 创建任务
      const taskId = Utils.newID(32);
      const taskTaskId = Utils.newID(12);
      
      // 创建工作空间路径
      const workspacePath = `tasks/${taskTaskId}`;

      const task = await Task.create({
        id: taskId,
        task_id: taskTaskId,
        title: data.title || `${solution.name} - 任务`,
        description: data.description || solution.description,
        workspace_path: workspacePath,
        status: 'active',
        created_by: userId,
        solution_id: solution.id,
        expert_id: data.expert_id || null,
      });

      ctx.success({
        task,
        solution: {
          id: solution.id,
          name: solution.name,
          slug: solution.slug,
        },
      });
      ctx.status = 201;
      logger.info(`[Solution] createTask: task ${taskId} from solution ${solution.id}`);
    } catch (error) {
      logger.error('[Solution] createTask error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 验证启动条件
   * POST /api/solutions/:id/validate
   */
  async validate(ctx) {
    try {
      this.ensureModels();
      const { id } = ctx.params;
      const data = ctx.request.body;

      const solution = await this.Solution.findOne({
        where: { id, is_active: true },
      });
      if (!solution) {
        ctx.throw(404, 'Solution not found');
      }

      // 解析 guide 中的启动条件
      // MVP 阶段：简单返回成功
      // TODO: 实现启动条件解析和验证

      ctx.success({
        valid: true,
        conditions: [],
        message: '启动条件验证通过',
      });
    } catch (error) {
      logger.error('[Solution] validate error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 获取所有可用标签
   * GET /api/solutions/tags
   */
  async listTags(ctx) {
    try {
      this.ensureModels();
      
      // 查询所有解决方案的标签
      const solutions = await this.Solution.findAll({
        where: { is_active: true },
        attributes: ['tags'],
        raw: true,
      });

      // 聚合所有标签
      const tagSet = new Set();
      for (const solution of solutions) {
        if (solution.tags && Array.isArray(solution.tags)) {
          for (const tag of solution.tags) {
            tagSet.add(tag);
          }
        }
      }

      ctx.success({
        tags: Array.from(tagSet).sort(),
      });
    } catch (error) {
      logger.error('[Solution] listTags error:', error);
      ctx.throw(500, error.message);
    }
  }
}

export default SolutionController;