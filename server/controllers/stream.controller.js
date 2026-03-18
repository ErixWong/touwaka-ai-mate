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
import { getSystemSettingService } from '../services/system-setting.service.js';

class StreamController {
  constructor(db, chatService) {
    this.db = db;
    this.chatService = chatService;
    this.Topic = db.getModel('topic');
    this.Message = db.getModel('message');
    this.systemSettingService = getSystemSettingService(db);
    // 存储活跃的 SSE 连接：Map<expertId, Set<{userId, res}>>
    this.expertConnections = new Map();
  }

  /**
   * 发送消息 - POST /api/chat
   * content 在 body 中，触发 Expert 处理并通过 SSE 推送响应
   */
  async sendMessage(ctx) {
    try {
      const { content, expert_id, model_id, task_id, task_path } = ctx.request.body;

      if (!content) {
        ctx.error('缺少必要参数：content');
        return;
      }

      if (!expert_id) {
        ctx.error('缺少必要参数：expert_id');
        return;
      }

      const user_id = ctx.state.session.id;

      // 检查 SSE 连接是否存在
      const connections = this.expertConnections.get(expert_id);
      const hasConnection = connections && [...connections].some(c => c.user_id === user_id);

      if (!hasConnection) {
        // 返回错误码告知前端需要重连 SSE
        ctx.status = 410;
        ctx.error('SSE 连接不存在，请重新建立连接', 410, { code: 'SSE_NOT_CONNECTED' });
        return;
      }

      // 获取或创建该用户与 Expert 的活跃 Topic（支持 task_id 关联）
      const topic_id = await this.getOrCreateActiveTopic(user_id, expert_id, task_id);

      // 异步处理消息，不等待完成
      this.processMessageAsync({
        topic_id,
        user_id,
        expert_id,
        content,
        model_id,
        task_id,
        task_path,  // 传递当前浏览路径
        access_token: ctx.state.session.accessToken,  // 传递用户 Token
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
   * 获取该用户在该 Expert 下的所有活跃连接
   * @param {string} expert_id - 专家ID
   * @param {string} user_id - 用户ID
   * @returns {Array<{user_id: string, res: ServerResponse}>} 活跃连接数组
   */
  _getUserConnections(expert_id, user_id) {
    const connections = this.expertConnections.get(expert_id);
    if (!connections || connections.size === 0) {
      return [];
    }

    // 找到该用户的所有活跃连接（支持多标签页）
    const userConnections = [];
    for (const conn of connections) {
      if (conn.user_id === user_id && !conn.res.writableEnded) {
        userConnections.push(conn);
      }
    }
    return userConnections;
  }

  /**
   * 向该用户的所有连接广播 SSE 事件
   * @param {Array} connections - 连接数组
   * @param {string} event - 事件名称
   * @param {object} data - 事件数据
   */
  _broadcastToConnections(connections, event, data) {
    const eventData = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const conn of connections) {
      if (!conn.res.writableEnded) {
        try {
          conn.res.write(eventData);
        } catch (err) {
          logger.warn(`Failed to write to connection: ${err.message}`);
        }
      }
    }
  }

  /**
   * 异步处理消息并通过 SSE 推送响应
   * 支持多标签页：向该用户的所有连接广播消息
   */
  async processMessageAsync({ topic_id, user_id, expert_id, content, model_id, task_id, task_path, access_token }) {
    // 获取该用户在该 Expert 下的所有活跃连接
    const userConnections = this._getUserConnections(expert_id, user_id);

    if (userConnections.length === 0) {
      logger.warn(`No active SSE connections for user: ${user_id}, expert: ${expert_id}`);
      return;
    }

    logger.info(`Broadcasting to ${userConnections.length} connection(s) for user: ${user_id}`);

    try {
      // 使用 ChatService 处理流式对话
      await this.chatService.streamChat(
        {
          topic_id,
          user_id,
          expert_id,
          content,
          model_id,
          task_id,
          task_path,  // 传递当前浏览路径
          access_token,  // 传递用户 Token，用于 skill 调用后台 API
        },
        // onDelta - 流式数据回调（广播到所有连接）
        (delta) => {
          if (delta.type === 'start') {
            this._broadcastToConnections(userConnections, 'start', {
              topic_id: delta.topic_id,
              is_new_topic: delta.is_new_topic || false
            });
          } else if (delta.type === 'delta') {
            this._broadcastToConnections(userConnections, 'delta', {
              content: delta.content
            });
          } else if (delta.type === 'reasoning_delta') {
            // 思考内容增量事件（DeepSeek R1、GLM-Z1、Qwen3 等支持）
            this._broadcastToConnections(userConnections, 'reasoning_delta', {
              content: delta.content
            });
          } else if (delta.type === 'tool_call') {
            this._broadcastToConnections(userConnections, 'tool_call', delta);
          } else if (delta.type === 'tool_result') {
            // 单个工具执行完成，实时推送结果
            this._broadcastToConnections(userConnections, 'tool_result', {
              result: delta.result
            });
          } else if (delta.type === 'topic_updated') {
            // 上下文压缩创建了新 Topic，通知前端刷新
            this._broadcastToConnections(userConnections, 'topic_updated', {
              topicsCreated: delta.topicsCreated
            });
          }
        },
        // onComplete - 完成回调（广播到所有连接）
        (result) => {
          this._broadcastToConnections(userConnections, 'complete', {
            message_id: result.message_id,  // 传递真实消息 ID，避免心跳检测误判
            content: result.content,
            reasoning_content: result.reasoning_content,  // 传递思考内容
            // 注意：不再传递 tool_calls，工具调用信息已通过 tool_result 事件传递
            usage: result.usage,
            model: result.model,
          });
        },
        // onError - 错误回调（广播到所有连接）
        (error) => {
          logger.error('Stream chat error:', error);
          this._broadcastToConnections(userConnections, 'error', {
            message: error.message || '流式处理失败'
          });
        }
      );
    } catch (error) {
      logger.error('Process message error:', error);
      this._broadcastToConnections(userConnections, 'error', {
        message: error.message || '处理失败'
      });
    }
  }

  /**
   * 获取或创建用户与 Expert 的活跃 Topic
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @param {string} task_id - 任务ID（可选，任务工作空间模式）
   * @returns {Promise<string>} topic_id
   */
  async getOrCreateActiveTopic(user_id, expert_id, task_id = null) {
    // 构建查询条件
    const whereClause = {
      user_id,
      expert_id,
      status: 'active',
    };
    
    // 如果有 task_id，只查找同一任务的对话
    if (task_id) {
      whereClause.task_id = task_id;
    }

    // 查找该用户与 Expert 的最近活跃 Topic
    const existingTopic = await this.Topic.findOne({
      where: whereClause,
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
      task_id,  // 关联任务ID（如果有）
    });

    logger.info(`StreamController: 创建新对话: ${topic_id}${task_id ? `, 任务: ${task_id}` : ''}`);
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

    const user_id = ctx.state.session.id;

    // 从系统配置获取连接数限制
    const connectionLimits = await this.systemSettingService.getConnectionLimits();
    const MAX_CONNECTIONS_PER_USER = connectionLimits.max_per_user;
    const MAX_CONNECTIONS_PER_EXPERT = connectionLimits.max_per_expert;

    // 检查用户连接数
    let userConnectionCount = 0;
    for (const [_, connections] of this.expertConnections) {
      for (const conn of connections) {
        if (conn.user_id === user_id) userConnectionCount++;
      }
    }

    if (userConnectionCount >= MAX_CONNECTIONS_PER_USER) {
      ctx.status = 429;
      ctx.error('连接数超过限制', 429, { code: 'TOO_MANY_CONNECTIONS', max: MAX_CONNECTIONS_PER_USER });
      return;
    }

    // 检查 Expert 连接数
    const expertConnectionCount = this.expertConnections.get(expert_id)?.size || 0;
    if (expertConnectionCount >= MAX_CONNECTIONS_PER_EXPERT) {
      ctx.status = 429;
      ctx.error('Expert 连接数超过限制', 429, { code: 'EXPERT_CONNECTION_LIMIT', max: MAX_CONNECTIONS_PER_EXPERT });
      return;
    }

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

    // 心跳保活 - 5秒间隔，用于快速检测连接状态
    // 同时携带最新消息ID，前端可据此判断是否需要拉取新消息
    const sendHeartbeat = async () => {
      if (ctx.res.writableEnded) {
        clearInterval(heartbeat);
        return;
      }
      
      try {
        // 查询当前专家与当前用户的最新一条消息ID
        const latestMessage = await this.Message.findOne({
          where: {
            expert_id,
            user_id,
          },
          order: [['created_at', 'DESC']],
          attributes: ['id'],
          raw: true,
        });
        
        const heartbeatData = {
          latest_message_id: latestMessage?.id || null,
        };
        
        ctx.res.write(`event: heartbeat\ndata: ${JSON.stringify(heartbeatData)}\n\n`);
      } catch (err) {
        logger.error('Heartbeat error:', err);
        // 即使查询失败也发送心跳，保持连接
        ctx.res.write(`event: heartbeat\ndata: ${JSON.stringify({ latest_message_id: null })}\n\n`);
      }
    };
    
    const heartbeat = setInterval(sendHeartbeat, 5000);

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
