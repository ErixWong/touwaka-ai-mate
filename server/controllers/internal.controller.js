/**
 * Internal Controller - 内部 API 控制器
 * 
 * 用于驻留进程调用，插入消息并触发专家响应
 * 
 * 认证方式：
 * - IP 白名单（仅允许本地调用）
 * - 或内部服务密钥（X-Internal-Key header）
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';

class InternalController {
  /**
   * @param {Object} db - 数据库实例
   * @param {Object} options - 配置选项
   * @param {Map} options.expertConnections - SSE 连接池（来自 StreamController）
   */
  constructor(db, options = {}) {
    this.db = db;
    this.Message = db.getModel('message');
    this.Topic = db.getModel('topic');
    this.expertConnections = options.expertConnections || new Map();
    this.internalKey = process.env.INTERNAL_API_KEY || null;
  }

  /**
   * 插入消息并触发专家响应
   * POST /internal/messages/insert
   * 
   * @param {Object} ctx.request.body - 请求体
   * @param {string} ctx.request.body.user_id - 用户ID
   * @param {string} ctx.request.body.expert_id - 专家ID
   * @param {string} ctx.request.body.content - 消息内容
   * @param {string} ctx.request.body.role - 消息角色（user/assistant/system）
   * @param {string} [ctx.request.body.topic_id] - 话题ID（可选，不传则自动获取/创建）
   * @param {string} [ctx.request.body.task_id] - 任务ID（可选）
   * @param {string} [ctx.request.body.inner_voice] - 内心独白（JSON字符串）
   * @param {string} [ctx.request.body.tool_calls] - 工具调用（JSON字符串）
   */
  async insertMessage(ctx) {
    try {
      // 1. 验证内部调用权限
      if (!this.validateInternalAccess(ctx)) {
        ctx.status = 403;
        ctx.error('无权访问内部 API', 403, { code: 'FORBIDDEN' });
        return;
      }

      // 2. 验证必要参数
      const { user_id, expert_id, content, role = 'assistant', topic_id, task_id, inner_voice, tool_calls } = ctx.request.body;

      if (!user_id || !expert_id || !content) {
        ctx.error('缺少必要参数：user_id, expert_id, content');
        return;
      }

      // 3. 获取或创建 Topic
      let finalTopicId = topic_id;
      if (!finalTopicId) {
        finalTopicId = await this.getOrCreateActiveTopic(user_id, expert_id, task_id);
      }

      // 4. 创建消息
      const messageId = Utils.newID(20);
      const message = await this.Message.create({
        id: messageId,
        topic_id: finalTopicId,
        user_id,
        expert_id,
        role,
        content,
        inner_voice: inner_voice ? (typeof inner_voice === 'string' ? inner_voice : JSON.stringify(inner_voice)) : null,
        tool_calls: tool_calls ? (typeof tool_calls === 'string' ? tool_calls : JSON.stringify(tool_calls)) : null,
      });

      logger.info(`Internal API: 消息已插入 ${messageId}, expert=${expert_id}, user=${user_id}`);

      // 5. 通过 SSE 推送通知（如果连接存在）
      const sseSent = this.pushSSENotification(expert_id, user_id, {
        event: 'new_context',
        data: {
          message_id: messageId,
          topic_id: finalTopicId,
          role,
          preview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
        }
      });

      // 6. 返回成功
      ctx.success({
        message: '消息已插入',
        message_id: messageId,
        topic_id: finalTopicId,
        sse_sent: sseSent,
      });

    } catch (error) {
      logger.error('Internal API insert message error:', error);
      ctx.error(error.message || '插入消息失败', 500);
    }
  }

  /**
   * 验证内部调用权限
   */
  validateInternalAccess(ctx) {
    // 方式一：检查内部密钥
    if (this.internalKey) {
      const requestKey = ctx.get('X-Internal-Key');
      if (requestKey === this.internalKey) {
        return true;
      }
    }

    // 方式二：检查 IP（仅允许本地）
    const clientIp = ctx.ip || ctx.request.ip;
    const localIps = ['::1', '::ffff:127.0.0.1', '127.0.0.1', 'localhost'];
    if (localIps.includes(clientIp)) {
      return true;
    }

    logger.warn(`Internal API access denied from IP: ${clientIp}`);
    return false;
  }

  /**
   * 获取或创建活跃 Topic
   */
  async getOrCreateActiveTopic(user_id, expert_id, task_id = null) {
    const whereClause = {
      user_id,
      expert_id,
      status: 'active',
    };
    
    if (task_id) {
      whereClause.task_id = task_id;
    }

    // 查找最近活跃的 Topic
    const existingTopic = await this.Topic.findOne({
      where: whereClause,
      order: [['updated_at', 'DESC']],
      raw: true,
    });

    if (existingTopic) {
      return existingTopic.id;
    }

    // 创建新 Topic
    const topic_id = Utils.newID(20);
    await this.Topic.create({
      id: topic_id,
      user_id,
      expert_id,
      title: '新对话',
      status: 'active',
      task_id,
    });

    logger.info(`Internal API: 创建新对话 ${topic_id}`);
    return topic_id;
  }

  /**
   * 通过 SSE 推送通知
   * @returns {boolean} 是否成功推送
   */
  pushSSENotification(expert_id, user_id, notification) {
    const connections = this.expertConnections.get(expert_id);
    
    if (!connections || connections.size === 0) {
      logger.debug(`No SSE connections for expert: ${expert_id}`);
      return false;
    }

    // 找到该用户的连接
    for (const conn of connections) {
      if (conn.user_id === user_id && !conn.res.writableEnded) {
        try {
          conn.res.write(`event: ${notification.event}\n`);
          conn.res.write(`data: ${JSON.stringify(notification.data)}\n\n`);
          logger.info(`SSE notification sent: ${notification.event} to user=${user_id}`);
          return true;
        } catch (err) {
          logger.error('Failed to send SSE notification:', err);
        }
      }
    }

    return false;
  }

  /**
   * 更新 SSE 连接池引用（用于热更新）
   */
  setExpertConnections(connections) {
    this.expertConnections = connections;
  }
}

export default InternalController;