/**
 * Message Controller - 消息控制器
 *
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 *
 * 核心设计：
 * - 消息是按 expert + user 组织的，不是按 topic 组织的
 * - topic 只是对对话历史的阶段性总结，不是消息的容器
 * - 一个 expert 对一个 user 只有一个连续的对话 session
 * 
 * 使用 Sequelize ORM 进行数据库操作
 */

import logger from '../../lib/logger.js';

class MessageController {
  constructor(db) {
    this.db = db;
    this.Message = db.getModel('message');
  }

  /**
   * 按 expert + user 获取消息列表（主要入口）
   * 这是新的核心 API，用于加载某个 expert 与当前用户的对话历史
   */
  async listByExpert(ctx) {
    try {
      const { expertId } = ctx.params;
      const { page = 1, pageSize = 50 } = ctx.query;
      const userId = ctx.state.userId;  // auth 中间件设置的 userId

      if (!expertId) {
        ctx.error('缺少 expertId 参数');
        return;
      }

      if (!userId) {
        ctx.error('未登录', 401);
        return;
      }

      const limit = parseInt(pageSize);
      const offset = (parseInt(page) - 1) * limit;

      // 先按时间倒序获取最近的消息，然后再反转成正序（最早的在前）
      // 这样第1页返回的就是最近的50条消息
      const { count, rows } = await this.Message.findAndCountAll({
        where: {
          expert_id: expertId,
          user_id: userId,
        },
        attributes: [
          'id', 'expert_id', 'user_id', 'topic_id', 'role', 'content',
          'prompt_tokens', 'completion_tokens',
          'inner_voice', 'tool_calls', 'error_info', 'created_at', 'latency_ms'
        ],
        order: [['created_at', 'DESC']],  // 先倒序获取最新的
        limit,
        offset,
        raw: true,
      });

      // 反转数组，使消息按时间正序返回（最早的在前，便于聊天界面显示）
      const sortedRows = rows.reverse();

      ctx.success({
        items: sortedRows.map(m => ({
          ...m,
          inner_voice: m.inner_voice ? JSON.parse(m.inner_voice) : null,
          tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
          error_info: m.error_info ? JSON.parse(m.error_info) : null,
          // 将数据库字段转换为前端期望的 metadata 格式
          metadata: {
            tokens: (m.prompt_tokens || m.completion_tokens) ? {
              total_tokens: (m.prompt_tokens || 0) + (m.completion_tokens || 0),
              prompt_tokens: m.prompt_tokens || 0,
              completion_tokens: m.completion_tokens || 0,
            } : null,
            latency: m.latency_ms || null,
          },
        })),
        pagination: {
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          total: count,
          totalPages: Math.ceil(count / parseInt(pageSize)),
        },
      });
    } catch (error) {
      logger.error('Get messages by expert error:', error);
      ctx.error('获取消息失败', 500);
    }
  }

  /**
   * 获取消息列表（旧 API，按 topic，保留兼容）
   */
  async list(ctx) {
    try {
      const { topic_id, page = 1, pageSize = 20 } = ctx.query;

      if (!topic_id) {
        ctx.error('缺少 topic_id 参数');
        return;
      }

      const offset = (parseInt(page) - 1) * parseInt(pageSize);

      // 获取消息
      const { count, rows } = await this.Message.findAndCountAll({
        where: { topic_id },
        attributes: [
          'id', 'topic_id', 'role', 'content', 'tokens', 'inner_voice', 'tool_calls',
          'error_info', 'created_at', 'latency_ms'
        ],
        order: [['created_at', 'DESC']],
        limit: parseInt(pageSize),
        offset,
        raw: true,
      });

      ctx.success({
        list: rows.map(m => ({
          ...m,
          inner_voice: m.inner_voice ? JSON.parse(m.inner_voice) : null,
          tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
          error_info: m.error_info ? JSON.parse(m.error_info) : null,
        })),
        pagination: {
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          total: count,
          totalPages: Math.ceil(count / parseInt(pageSize)),
        },
      });
    } catch (error) {
      logger.error('Get messages error:', error);
      ctx.error('获取消息失败', 500);
    }
  }

  /**
   * 根据话题 ID 获取消息列表（从 URL 参数获取 topic_id）
   */
  async listByTopic(ctx) {
    try {
      const { topicId } = ctx.params;
      const { page = 1, pageSize = 20 } = ctx.query;

      if (!topicId) {
        ctx.error('缺少 topicId 参数');
        return;
      }

      const offset = (parseInt(page) - 1) * parseInt(pageSize);

      // 获取消息
      const { count, rows } = await this.Message.findAndCountAll({
        where: { topic_id: topicId },
        attributes: [
          'id', 'topic_id', 'role', 'content', 'tokens', 'inner_voice', 'tool_calls',
          'error_info', 'created_at', 'latency_ms'
        ],
        order: [['created_at', 'ASC']],
        limit: parseInt(pageSize),
        offset,
        raw: true,
      });

      ctx.success({
        list: rows.map(m => ({
          ...m,
          inner_voice: m.inner_voice ? JSON.parse(m.inner_voice) : null,
          tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
          error_info: m.error_info ? JSON.parse(m.error_info) : null,
        })),
        pagination: {
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          total: count,
          totalPages: Math.ceil(count / parseInt(pageSize)),
        },
      });
    } catch (error) {
      logger.error('Get messages by topic error:', error);
      ctx.error('获取消息失败', 500);
    }
  }

  /**
   * 获取单条消息详情
   */
  async get(ctx) {
    try {
      const { id } = ctx.params;

      const message = await this.Message.findOne({
        where: { id },
        attributes: [
          'id', 'topic_id', 'role', 'content', 'tokens', 'inner_voice', 'tool_calls',
          'error_info', 'created_at', 'latency_ms'
        ],
        raw: true,
      });

      if (!message) {
        ctx.error('消息不存在', 404);
        return;
      }

      ctx.success({
        ...message,
        inner_voice: message.inner_voice ? JSON.parse(message.inner_voice) : null,
        tool_calls: message.tool_calls ? JSON.parse(message.tool_calls) : null,
        error_info: message.error_info ? JSON.parse(message.error_info) : null,
      });
    } catch (error) {
      logger.error('Get message error:', error);
      ctx.error('获取消息失败', 500);
    }
  }

  /**
   * 清空指定 expert 与当前用户的所有消息（仅管理员）
   */
  async clearByExpert(ctx) {
    try {
      const { expertId } = ctx.params;
      const userId = ctx.state.userId;

      if (!expertId) {
        ctx.error('缺少 expertId 参数');
        return;
      }

      if (!userId) {
        ctx.error('未登录', 401);
        return;
      }

      // 获取 Topic 模型
      const Topic = this.db.getModel('topic');

      // 删除该 expert 与该用户的所有消息
      const deletedMessagesCount = await this.Message.destroy({
        where: {
          expert_id: expertId,
          user_id: userId,
        },
      });

      // 将该 expert 与该用户的所有话题标记为已删除
      const deletedTopicsCount = await Topic.destroy({
        where: {
          expert_id: expertId,
          user_id: userId,
        },
      });

      logger.info(`Admin cleared ${deletedMessagesCount} messages and ${deletedTopicsCount} topics for expert ${expertId} and user ${userId}`);

      ctx.success({
        message: '对话历史和话题已清空',
        deleted_messages_count: deletedMessagesCount,
        deleted_topics_count: deletedTopicsCount,
      });
    } catch (error) {
      logger.error('Clear messages by expert error:', error);
      ctx.error('清空对话历史失败', 500);
    }
  }
}

export default MessageController;
