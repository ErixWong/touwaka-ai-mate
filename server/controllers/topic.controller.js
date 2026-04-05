/**
 * Topic Controller - 话题控制器
 * 
 * 使用 Sequelize ORM 进行数据库操作
 */

import Utils from '../../lib/utils.js';
import logger from '../../lib/logger.js';
import {
  buildQueryOptions,
  buildPaginatedResponse,
} from '../../lib/query-builder.js';

// 允许过滤的字段白名单
const ALLOWED_FILTER_FIELDS = [
  'id', 'user_id', 'expert_id', 'provider_name', 'model_name',
  'title', 'status', 'created_at', 'updated_at',
];

// 允许排序的字段白名单
const ALLOWED_SORT_FIELDS = [
  'id', 'title', 'status', 'created_at', 'updated_at',
];

class TopicController {
  constructor(db, chatService = null) {
    this.db = db;
    this.chatService = chatService;
    this.Topic = db.getModel('topic');
    this.Message = db.getModel('message');
  }

  /**
   * 复杂查询话题列表（POST /query）
   * 支持分页、过滤、排序、字段选择
   */
  async query(ctx) {
    const startTime = Date.now();
    try {
      const queryRequest = ctx.request.body || {};

      // 构建查询选项，自动添加用户ID过滤
      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        baseWhere: { user_id: ctx.state.session.id },
        filterOptions: { allowedFields: ALLOWED_FILTER_FIELDS },
        sortOptions: { allowedFields: ALLOWED_SORT_FIELDS },
        pageOptions: { defaultSize: 10, maxSize: 100 },
        fieldsOptions: { allowedFields: ALLOWED_FILTER_FIELDS },
      });

      // 执行查询
      const result = await this.Topic.findAndCountAll({
        ...queryOptions,
        raw: true,
      });

      // 构建响应
      const response = buildPaginatedResponse(result, pagination, startTime);
      ctx.success(response);
    } catch (error) {
      logger.error('Query topics error:', error);
      ctx.error('查询话题失败', 500);
    }
  }

  /**
   * 获取话题列表（简单 GET 查询，保持向后兼容）
   *
   * 排序规则：
   * 1. 进行中(active)的排上面，已归档(archived)的排下面
   * 2. active 按 updated_at 降序（最新在前）
   * 3. archived 按 updated_at 升序（先老后新）
   */
  async list(ctx) {
    try {
      const { status, expert_id, page: pageNumber = 1, size: pageSize = 20 } = ctx.query;
      const { Op } = this.db;

      const where = { user_id: ctx.state.session.id };
      if (status) {
        where.status = status;
      }
      if (expert_id) {
        where.expert_id = expert_id;
      }

      const page = parseInt(pageNumber);
      const size = parseInt(pageSize);
      const offset = (page - 1) * size;

      // 排序逻辑：
      // 1. status 排序：active='a', archived='b'（active 在前）
      // 2. active: updated_at DESC（最新在前）
      // 3. archived: updated_at ASC（先老后新）
      // 使用 CASE WHEN 实现条件排序
      const order = [
        // 使用 sequelize.literal 实现 CASE WHEN 排序
        // active 排前面，archived 排后面
        [this.db.sequelize.literal(`
          CASE
            WHEN status = 'active' THEN 0
            ELSE 1
          END
        `), 'ASC'],
        // 然后按 updated_at 排序
        // 注意：这里使用字段排序，前端可以控制
        ['updated_at', 'DESC'],
      ];

      // 获取话题列表
      const { count, rows } = await this.Topic.findAndCountAll({
        where,
        order,
        limit: size,
        offset,
        raw: true,
      });

      // 对结果进行二次排序，确保 archived 是按时间升序
      const sortedRows = this.sortTopics(rows);

      const pages = Math.ceil(count / size);

      ctx.success({
        items: sortedRows,
        pagination: {
          page,
          size,
          total: count,
          pages,
          has_next: page < pages,
          has_prev: page > 1,
        },
      });
    } catch (error) {
      logger.error('Get topics error:', error);
      ctx.error('获取话题失败', 500);
    }
  }

  /**
   * 对话题列表进行排序
   * 1. active 在前，archived 在后
   * 2. active 按 updated_at 降序
   * 3. archived 按 updated_at 升序
   */
  sortTopics(topics) {
    const active = topics.filter(t => t.status === 'active');
    const archived = topics.filter(t => t.status === 'archived');
    const others = topics.filter(t => t.status !== 'active' && t.status !== 'archived');

    // active 按 updated_at 降序（最新在前）
    active.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    
    // archived 按 updated_at 升序（先老后新）
    archived.sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at));

    return [...active, ...archived, ...others];
  }

  /**
   * 创建话题
   */
  async create(ctx) {
    try {
      const { title, expertId, providerName, modelName } = ctx.request.body;

      if (!title) {
        ctx.error('标题不能为空');
        return;
      }

      const topicId = Utils.newID(20);

      await this.Topic.create({
        id: topicId,
        user_id: ctx.state.session.id,
        expert_id: expertId || null,
        provider_name: providerName || null,
        model_name: modelName || null,
        title,
        status: 'active',
      });

      const topic = await this.Topic.findOne({
        where: { id: topicId },
        raw: true,
      });

      ctx.status = 201;
      ctx.success(topic, '创建成功');
    } catch (error) {
      logger.error('Create topic error:', error);
      ctx.error('创建话题失败', 500);
    }
  }

  /**
   * 获取话题详情
   */
  async get(ctx) {
    try {
      const { id } = ctx.params;

      const topic = await this.Topic.findOne({
        where: { id },
        raw: true,
      });

      if (!topic) {
        ctx.error('话题不存在', 404);
        return;
      }

      ctx.success(topic);
    } catch (error) {
      logger.error('Get topic error:', error);
      ctx.error('获取话题失败', 500);
    }
  }

  /**
   * 更新话题
   */
  async update(ctx) {
    try {
      const { id } = ctx.params;
      const { title, status } = ctx.request.body;

      const updates = {};
      if (title !== undefined) updates.title = title;
      if (status !== undefined) updates.status = status;

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段');
        return;
      }

      const result = await this.Topic.update(updates, {
        where: {
          id,
          user_id: ctx.state.session.id,
        },
      });

      if (result[0] === 0) {
        ctx.error('话题不存在或无权限', 404);
        return;
      }

      ctx.success(null, '更新成功');
    } catch (error) {
      logger.error('Update topic error:', error);
      ctx.error('更新话题失败', 500);
    }
  }

  /**
   * 删除话题
   */
  async delete(ctx) {
    try {
      const { id } = ctx.params;

      // 先删除关联的消息
      await this.Message.destroy({ where: { topic_id: id } });

      // 删除话题
      const result = await this.Topic.destroy({
        where: {
          id,
          user_id: ctx.state.session.id,
        },
      });

      if (result === 0) {
        ctx.error('话题不存在或无权限', 404);
        return;
      }

      ctx.status = 204;
    } catch (error) {
      logger.error('Delete topic error:', error);
      ctx.error('删除话题失败', 500);
    }
  }

  /**
   * 手动触发压缩
   * 检查并更新 topics 表
   */
  async compress(ctx) {
    try {
      const { expert_id } = ctx.request.body || {};
      const userId = ctx.state.session.id;

      if (!this.chatService) {
        ctx.error('ChatService 未初始化', 500);
        return;
      }

      // 获取用户的所有专家（通过 user_profile 表）
      const experts = await this.db.models.user_profile.findAll({
        where: { user_id: userId },
        attributes: ['expert_id'],
        raw: true,
      });

      const expertIds = [...new Set(experts.map(e => e.expert_id))];  // 去重
      const targetExpertIds = expert_id ? [expert_id] : expertIds;

      const results = [];
      for (const eid of targetExpertIds) {
        try {
          const expertService = await this.chatService.getExpertService(eid);
          const result = await expertService.checkAndCompressContext(userId);
          results.push({
            expert_id: eid,
            ...result,
          });
        } catch (err) {
          logger.error(`Compress failed for expert ${eid}:`, err.message);
          results.push({
            expert_id: eid,
            success: false,
            error: err.message,
          });
        }
      }

      ctx.success({
        message: '压缩检查完成',
        results,
      });
    } catch (error) {
      logger.error('Compress topics error:', error);
      ctx.error('压缩检查失败', 500);
    }
  }
}

export default TopicController;
