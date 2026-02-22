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
  constructor(db) {
    this.db = db;
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
        baseWhere: { user_id: ctx.state.userId },
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
   */
  async list(ctx) {
    try {
      const { status, expert_id, page = 1, pageSize = 20 } = ctx.query;
      const { Op } = this.db;

      const where = { user_id: ctx.state.userId };
      if (status) {
        where.status = status;
      }
      if (expert_id) {
        where.expert_id = expert_id;
      }

      const offset = (parseInt(page) - 1) * parseInt(pageSize);

      // 获取话题列表
      const { count, rows } = await this.Topic.findAndCountAll({
        where,
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
      logger.error('Get topics error:', error);
      ctx.error('获取话题失败', 500);
    }
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
        user_id: ctx.state.userId,
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
          user_id: ctx.state.userId,
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
          user_id: ctx.state.userId,
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
}

export default TopicController;
