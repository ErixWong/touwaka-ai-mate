/**
 * Stream Controller - SSE 流式聊天控制器
 * 
 * API 设计：
 * - POST /api/chat - 发送消息给 Expert（content 在 body 中）
 * - GET /api/chat/stream?expertId=xxx - SSE 订阅 Expert 的消息流
 * 
 * 核心概念：
 * - 用户与 Expert 对话，不是与 Topic 对话
 * - Topic 是后端自动管理的，通过 SSE 事件通知前端刷新
 * 
 * 使用 Sequelize ORM 进行数据库操作
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';

class StreamController {
  constructor(db, chatService) {
    this.db = db;
    this.chatService = chatService;
    this.Topic = db.getModel('topic');
    // 存储活跃的 SSE 连接：Map<expertId, Set<{userId, res}>>
    this.expertConnections = new Map();
  }

  /**
   * 发送消息 - POST /api/chat
   * content 在 body 中，触发 Expert 处理并通过 SSE 推送响应
   */
  async sendMessage(ctx) {
    try {
      const { content, expert_id, model_id } = ctx.request.body;

      if (!content) {
        ctx.error('缺少必要参数：content');
        return;
      }

      if (!expert_id) {
        ctx.error('缺少必要参数：expert_id');
        return;
      }

      const user_id = ctx.state.userId;

      // 获取或创建该用户与 Expert 的活跃 Topic
      const topic_id = await this.getOrCreateActiveTopic(user_id, expert_id);

      // 异步处理消息，不等待完成
      this.processMessageAsync({
        topic_id,
        user_id,
        expert_id,
        content,
        model_id,
      });

      // 立即返回成功，消息将通过 SSE 推送
      ctx.success({
        message: '消息已发送',
        topic_id,
      });

    } catch (error) {
      logger.error('Send message error:', error);
      ctx.error(error.message || '发送消息失败');
    }
  }

  /**
   * 异步处理消息并通过 SSE 推送响应
   */
  async processMessageAsync({ topic_id, user_id, expert_id, content, model_id }) {
    // 获取该 Expert 的所有活跃连接
    const connections = this.expertConnections.get(expert_id);
    
    if (!connections || connections.size === 0) {
      logger.warn(`No active SSE connections for expert: ${expert_id}`);
      return;
    }

    // 找到该用户的连接
    let userConnection = null;
    for (const conn of connections) {
      if (conn.user_id === user_id) {
        userConnection = conn;
        break;
      }
    }

    if (!userConnection || userConnection.res.writableEnded) {
      logger.warn(`No active SSE connection for user: ${user_id}`);
      return;
    }

    const res = userConnection.res;

    try {
      // 使用 ChatService 处理流式对话
      await this.chatService.streamChat(
        {
          topic_id,
          user_id,
          expert_id,
          content,
          model_id,
        },
        // onDelta - 流式数据回调
        (delta) => {
          if (res.writableEnded) return;
          
          if (delta.type === 'start') {
            res.write(`event: start\n`);
            res.write(`data: ${JSON.stringify({ topic_id: delta.topic_id })}\n\n`);
          } else if (delta.type === 'delta') {
            res.write(`event: delta\n`);
            res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
          } else if (delta.type === 'tool_call') {
            res.write(`event: tool_call\n`);
            res.write(`data: ${JSON.stringify(delta)}\n\n`);
          }
        },
        // onComplete - 完成回调
        (result) => {
          if (res.writableEnded) return;
          
          res.write(`event: complete\n`);
          res.write(`data: ${JSON.stringify({
            content: result.content,
            usage: result.usage,
            model: result.model,
          })}\n\n`);
          
          // 通知前端刷新 Topic 列表（如果需要）
          res.write(`event: topic_updated\n`);
          res.write(`data: ${JSON.stringify({ topic_id })}\n\n`);
        },
        // onError - 错误回调
        (error) => {
          logger.error('Stream chat error:', error);
          if (!res.writableEnded) {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ message: error.message || '流式处理失败' })}\n\n`);
          }
        }
      );
    } catch (error) {
      logger.error('Process message error:', error);
      if (!res.writableEnded) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: error.message || '处理失败' })}\n\n`);
      }
    }
  }

  /**
   * 获取或创建用户与 Expert 的活跃 Topic
   */
  async getOrCreateActiveTopic(user_id, expert_id) {
    // 查找该用户与 Expert 的最近活跃 Topic
    const existingTopic = await this.Topic.findOne({
      where: {
        user_id,
        expert_id,
        status: 'active',
      },
      order: [['updated_at', 'DESC']],
      raw: true,
    });

    if (existingTopic) {
      return existingTopic.id;
    }

    // 创建新 Topic，使用 Utils.newID() 生成 ID
    const topic_id = Utils.newID(20);
    await this.Topic.create({
      id: topic_id,
      user_id,
      expert_id,
      title: '新对话',
      status: 'active',
    });

    return topic_id;
  }

  /**
   * SSE 订阅 - GET /api/chat/stream
   * 订阅 Expert 的消息流
   */
  async subscribe(ctx) {
    const { expert_id } = ctx.query;

    if (!expert_id) {
      ctx.error('缺少必要参数：expert_id');
      return;
    }

    const user_id = ctx.state.userId;

    // 设置 SSE 响应头
    ctx.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // 重要：设置 ctx.status 让 Koa 知道响应已处理
    ctx.status = 200;

    // 发送连接成功事件
    ctx.res.write(`event: connected\n`);
    ctx.res.write(`data: ${JSON.stringify({ status: 'connected', expert_id })}\n\n`);

    // 存储连接到 Expert 的连接池
    if (!this.expertConnections.has(expert_id)) {
      this.expertConnections.set(expert_id, new Set());
    }
    
    const connection = { user_id, res: ctx.res };
    this.expertConnections.get(expert_id).add(connection);

    logger.info(`SSE connection established: user=${user_id}, expert=${expert_id}`);

    // 心跳保活
    const heartbeat = setInterval(() => {
      if (ctx.res.writableEnded) {
        clearInterval(heartbeat);
        return;
      }
      ctx.res.write(': heartbeat\n\n');
    }, 30000);

    // 清理连接
    const cleanup = () => {
      clearInterval(heartbeat);
      this.expertConnections.get(expert_id)?.delete(connection);
      if (this.expertConnections.get(expert_id)?.size === 0) {
        this.expertConnections.delete(expert_id);
      }
      logger.info(`SSE connection closed: user=${user_id}, expert=${expert_id}`);
    };

    ctx.req.on('close', cleanup);
    ctx.req.on('end', cleanup);
    ctx.res.on('close', cleanup);

    // 重要：不要让函数返回，保持 SSE 连接
    // 返回一个永远不 resolve 的 Promise
    return new Promise(() => {});
  }
}

export default StreamController;
