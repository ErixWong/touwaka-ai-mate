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
import { getPermissionService } from '../services/permission.service.js';

class StreamController {
  constructor(db, chatService) {
    this.db = db;
    this.chatService = chatService;
    this.Topic = db.getModel('topic');
    this.Message = db.getModel('message');
    this.ChatRequest = db.getModel('chat_request');
    this.Expert = db.getModel('expert');
    this.systemSettingService = getSystemSettingService(db);
    this.permissionService = getPermissionService(db);
    // 存储活跃的 SSE 连接：Map<expertId, Set<{userId, res}>>
    this.expertConnections = new Map();
    // 存储活跃请求：Map<requestId, {expertId, userId, stopped}>
    this.activeRequests = new Map();
    // 存储聊天请求状态：Map<requestId, requestRecord>
    this.requestStore = new Map();
    this.REQUEST_STORE_MAX = 1000;
    this.REQUEST_STORE_TTL_MS = 30 * 60 * 1000;
    this.REQUEST_RUNNING_TIMEOUT_MS = 30 * 60 * 1000;
    this.requestMaintenanceReady = false;
    this.requestMaintenancePromise = null;
    // 事件序号：Map<expertId:userId, number>
    this.eventSequences = new Map();
    // 最新游标：Map<expertId:userId, { latest_message_id: string | null }>
    this.latestCursors = new Map();
  }

  async _createRequestRecord(data) {
    const now = new Date().toISOString();
    const record = {
      request_id: data.request_id,
      original_request_id: data.original_request_id || null,
      topic_id: data.topic_id || null,
      user_id: data.user_id,
      expert_id: data.expert_id,
      content: data.content,
      model_id: data.model_id || null,
      task_id: data.task_id || null,
      working_path: data.working_path || null,
      status: data.status || 'accepted',
      user_message_id: data.user_message_id || null,
      assistant_message_id: data.assistant_message_id || null,
      error_message: data.error_message || null,
      created_at: now,
      updated_at: now,
      started_at: data.started_at || null,
      completed_at: data.completed_at || null,
    };

    await this.ChatRequest.create(record);
    this.requestStore.set(record.request_id, record);
    this._cleanupRequestStore();
    return record;
  }

  async _getRequestRecord(request_id) {
    const cached = this.requestStore.get(request_id) || null;
    if (cached) return cached;

    const record = await this.ChatRequest.findOne({
      where: { request_id },
      raw: true,
    });
    if (record) {
      this.requestStore.set(request_id, record);
      this._cleanupRequestStore();
    }
    return record || null;
  }

  async _reconcileRequestRecord(request_id) {
    const record = await this._getRequestRecord(request_id);
    if (!record) return null;

    if (record.user_message_id && record.assistant_message_id) {
      return record;
    }

    const messages = await this.Message.findAll({
      where: {
        request_id,
        user_id: record.user_id,
        expert_id: record.expert_id,
      },
      attributes: ['id', 'role', 'created_at'],
      order: [['created_at', 'ASC']],
      raw: true,
    });

    let userMessageId = record.user_message_id || null;
    let assistantMessageId = record.assistant_message_id || null;

    for (const message of messages) {
      if (!userMessageId && message.role === 'user') {
        userMessageId = message.id;
      }
      if (!assistantMessageId && message.role === 'assistant') {
        assistantMessageId = message.id;
      }
      if (userMessageId && assistantMessageId) break;
    }

    if (userMessageId === record.user_message_id && assistantMessageId === record.assistant_message_id) {
      return record;
    }

    return await this._updateRequestRecord(request_id, {
      user_message_id: userMessageId,
      assistant_message_id: assistantMessageId,
    });
  }

  async _settleStaleAcceptedRequests() {
    const cutoff = new Date(Date.now() - this.REQUEST_RUNNING_TIMEOUT_MS);

    const [updatedCount] = await this.ChatRequest.update({
      status: 'timeout',
      error_message: '请求未能开始执行，已在系统恢复时自动收口',
      completed_at: new Date(),
      updated_at: new Date(),
    }, {
      where: {
        status: 'accepted',
        started_at: null,
        updated_at: {
          [this.db.Op.lte]: cutoff,
        },
      },
    });

    if (updatedCount > 0) {
      logger.warn(`[StreamController] 自动收口 ${updatedCount} 个陈旧未开始请求`);
    }
  }

  async _ensureRequestMaintenanceReady() {
    if (this.requestMaintenanceReady) return;
    if (this.requestMaintenancePromise) {
      await this.requestMaintenancePromise;
      return;
    }

    this.requestMaintenancePromise = (async () => {
      await this._settleStaleAcceptedRequests();
      this.requestMaintenanceReady = true;
    })();

    try {
      await this.requestMaintenancePromise;
    } finally {
      this.requestMaintenancePromise = null;
    }
  }

  async _updateRequestRecord(request_id, patch) {
    const existing = await this._getRequestRecord(request_id);
    if (!existing) return null;

    const next = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    };

    await this.ChatRequest.update({
      original_request_id: next.original_request_id,
      topic_id: next.topic_id,
      user_id: next.user_id,
      expert_id: next.expert_id,
      model_id: next.model_id,
      task_id: next.task_id,
      user_message_id: next.user_message_id,
      assistant_message_id: next.assistant_message_id,
      status: next.status,
      content: next.content,
      working_path: next.working_path,
      error_message: next.error_message,
      started_at: next.started_at,
      completed_at: next.completed_at,
      updated_at: next.updated_at,
    }, {
      where: { request_id },
    });

    this.requestStore.set(request_id, next);
    this._cleanupRequestStore();
    return next;
  }

  _cleanupRequestStore() {
    const now = Date.now();
    const terminalStatuses = new Set(['completed', 'failed', 'stopped', 'timeout']);

    for (const [requestId, record] of this.requestStore.entries()) {
      if (!terminalStatuses.has(record.status)) continue;

      const updatedAt = Date.parse(record.updated_at || record.created_at || 0);
      if (Number.isNaN(updatedAt)) continue;
      if (now - updatedAt > this.REQUEST_STORE_TTL_MS) {
        this.requestStore.delete(requestId);
      }
    }

    if (this.requestStore.size <= this.REQUEST_STORE_MAX) {
      return;
    }

    const removable = [...this.requestStore.entries()]
      .filter(([, record]) => terminalStatuses.has(record.status))
      .sort((a, b) => Date.parse(a[1].updated_at || a[1].created_at || 0) - Date.parse(b[1].updated_at || b[1].created_at || 0));

    for (const [requestId] of removable) {
      if (this.requestStore.size <= this.REQUEST_STORE_MAX) break;
      this.requestStore.delete(requestId);
    }
  }

  _serializeRequestRecord(record) {
    if (!record) return null;

    return {
      request_id: record.request_id,
      original_request_id: record.original_request_id,
      topic_id: record.topic_id,
      user_message_id: record.user_message_id,
      assistant_message_id: record.assistant_message_id,
      status: record.status,
      error_message: record.error_message,
      created_at: record.created_at,
      updated_at: record.updated_at,
      started_at: record.started_at || null,
      completed_at: record.completed_at || null,
      can_retry: ['failed', 'stopped'].includes(record.status),
    };
  }

  _getSequenceKey(expert_id, user_id) {
    return `${expert_id}:${user_id}`;
  }

  _nextSequence(expert_id, user_id) {
    const key = this._getSequenceKey(expert_id, user_id);
    const next = (this.eventSequences.get(key) || 0) + 1;
    this.eventSequences.set(key, next);
    return next;
  }

  _getCurrentSequence(expert_id, user_id) {
    return this.eventSequences.get(this._getSequenceKey(expert_id, user_id)) || 0;
  }

  _updateLatestCursor(expert_id, user_id, latest_message_id) {
    this.latestCursors.set(this._getSequenceKey(expert_id, user_id), {
      latest_message_id: latest_message_id || null,
    });
  }

  _getLatestCursor(expert_id, user_id) {
    return this.latestCursors.get(this._getSequenceKey(expert_id, user_id)) || { latest_message_id: null };
  }

  /**
   * 校验用户是否有权限访问指定专家
   * @param {string} userId - 用户ID
   * @param {string} expertId - 专家ID
   * @returns {Promise<{ allowed: boolean, reason: string | null }>}
   */
  async checkExpertAccess(userId, expertId) {
    try {
      const expert = await this.Expert.findOne({
        where: { id: expertId },
        attributes: ['id', 'is_active'],
        raw: true,
      });

      if (!expert) {
        return { allowed: false, reason: 'EXPERT_NOT_FOUND' };
      }

      if (!expert.is_active) {
        return { allowed: false, reason: 'EXPERT_INACTIVE' };
      }

      const hasAccess = await this.permissionService.canAccessExpert(userId, expertId);
      if (!hasAccess) {
        return { allowed: false, reason: 'NO_ACCESS' };
      }

      return { allowed: true, reason: null };
    } catch (error) {
      logger.error('[StreamController] checkExpertAccess error:', error.message);
      return { allowed: false, reason: 'CHECK_FAILED' };
    }
  }

  /**
   * 发送消息 - POST /api/chat
   * content 在 body 中，触发 Expert 处理并通过 SSE 推送响应
   */
  async sendMessage(ctx) {
    try {
      await this._ensureRequestMaintenanceReady();

      // 标准化任务主键字段：优先使用 task_db_id，兼容 task_id
      const { content, expert_id, model_id, task_id, task_db_id, working_path } = ctx.request.body;
      // 标准化：task_db_id 为语义明确的字段名，task_id 为兼容字段
      const normalizedTaskDbId = task_db_id || task_id || null;

      if (!content) {
        ctx.error('缺少必要参数：content');
        return;
      }

      if (!expert_id) {
        ctx.error('缺少必要参数：expert_id');
        return;
      }

      const user_id = ctx.state.session.id;

      // 校验用户是否有权限访问该专家
      const accessCheck = await this.checkExpertAccess(user_id, expert_id);
      if (!accessCheck.allowed) {
        // 统一返回 403，避免专家枚举侧信道
        ctx.error('无权访问该专家', 403);
        return;
      }

      // 检查 SSE 连接是否存在
      const connections = this.expertConnections.get(expert_id);
      const hasConnection = connections && [...connections].some(c => c.user_id === user_id);

      if (!hasConnection) {
        // 返回错误码告知前端需要重连 SSE
        ctx.status = 410;
        ctx.error('SSE 连接不存在，请重新建立连接', 410, { code: 'SSE_NOT_CONNECTED' });
        return;
      }

      // 获取或创建该用户与 Expert 的活跃 Topic（支持 task_db_id 关联）
      const topic_id = await this.getOrCreateActiveTopic(user_id, expert_id, normalizedTaskDbId);

      // 创建 request_id（一次流式生成请求的唯一标识）
      const request_id = `req_${Utils.newID(16)}`;

      await this._createRequestRecord({
        request_id,
        topic_id,
        user_id,
        expert_id,
        content,
        model_id,
        task_id: normalizedTaskDbId,  // 存储标准化后的主键
        working_path,
        status: 'accepted',
      });

      // 异步处理消息，不等待完成
      this.processMessageAsync({
        request_id,
        topic_id,
        user_id,
        expert_id,
        content,
        model_id,
        task_id: normalizedTaskDbId,  // 使用标准化后的主键
        working_path,
        session: ctx.state.session,
      });

      // 立即返回成功，消息将通过 SSE 推送
      ctx.success({
        request_id,
        topic_id,
      });

    } catch (error) {
      logger.error('Send message error:', error);
      ctx.error(error.message || '发送消息失败');
    }
  }

  /**
   * 查询聊天请求状态
   * GET /api/chat/requests/:request_id
   */
  async getRequestStatus(ctx) {
    await this._ensureRequestMaintenanceReady();

    const { request_id } = ctx.params;
    const user_id = ctx.state.session.id;

    if (!request_id) {
      ctx.error('缺少 request_id 参数', 400);
      return;
    }

    const record = await this._reconcileRequestRecord(request_id);
    if (!record || record.user_id !== user_id) {
      ctx.error('请求不存在', 404);
      return;
    }

    const accessCheck = await this.checkExpertAccess(user_id, record.expert_id);
    if (!accessCheck.allowed) {
      ctx.error('无权访问该专家', 403);
      return;
    }

    ctx.success(this._serializeRequestRecord(record));
  }

  /**
   * 重试聊天请求
   * POST /api/chat/requests/:request_id/retry
   */
  async retryRequest(ctx) {
    try {
      await this._ensureRequestMaintenanceReady();

      const { request_id } = ctx.params;
      const user_id = ctx.state.session.id;

      if (!request_id) {
        ctx.error('缺少 request_id 参数', 400);
        return;
      }

      const originalRequest = await this._getRequestRecord(request_id);
      if (!originalRequest || originalRequest.user_id !== user_id) {
        ctx.error('请求不存在', 404);
        return;
      }

      const accessCheck = await this.checkExpertAccess(user_id, originalRequest.expert_id);
      if (!accessCheck.allowed) {
        ctx.error('无权访问该专家', 403);
        return;
      }

      if (originalRequest.status === 'completed') {
        ctx.success({
          ...this._serializeRequestRecord(originalRequest),
          message: '请求已完成，无需重试',
        });
        return;
      }

      if (['accepted', 'running'].includes(originalRequest.status)) {
        ctx.error('请求仍在执行中，暂不允许重试', 409);
        return;
      }

      const newRequestId = `req_${Utils.newID(16)}`;
      const retryRecord = await this._createRequestRecord({
        request_id: newRequestId,
        original_request_id: originalRequest.request_id,
        topic_id: originalRequest.topic_id,
        user_id: originalRequest.user_id,
        expert_id: originalRequest.expert_id,
        content: originalRequest.content,
        model_id: originalRequest.model_id,
        task_id: originalRequest.task_id,
        working_path: originalRequest.working_path,
        status: 'accepted',
        user_message_id: originalRequest.user_message_id,
      });

      this.processMessageAsync({
        request_id: newRequestId,
        topic_id: originalRequest.topic_id,
        user_id: originalRequest.user_id,
        expert_id: originalRequest.expert_id,
        content: originalRequest.content,
        model_id: originalRequest.model_id,
        task_id: originalRequest.task_id,
        working_path: originalRequest.working_path,
        session: ctx.state.session,
        skip_user_message_persist: !!originalRequest.user_message_id,
        existing_user_message_id: originalRequest.user_message_id,
      });

      ctx.success({
        ...this._serializeRequestRecord(retryRecord),
        message: '请求已重新提交',
      });
    } catch (error) {
      logger.error('[StreamController] retryRequest error:', error);
      ctx.error(error.message || '重试请求失败');
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
  _broadcastToConnections(expert_id, user_id, connections, event, data) {
    const sequence = this._nextSequence(expert_id, user_id);
    const payload = { sequence, ...data };
    const eventData = `id: ${sequence}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
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
  async processMessageAsync({ request_id, topic_id, user_id, expert_id, content, model_id, task_id, working_path, session, skip_user_message_persist = false, existing_user_message_id = null }) {
    // 获取该用户在该 Expert 下的所有活跃连接
    const userConnections = this._getUserConnections(expert_id, user_id);

    if (userConnections.length === 0) {
      logger.warn(`No active SSE connections for user: ${user_id}, expert: ${expert_id}`);
      await this._updateRequestRecord(request_id, {
        status: 'failed',
        error_message: 'SSE 连接不存在，无法处理请求',
      });
      return;
    }

    logger.info(`Broadcasting to ${userConnections.length} connection(s) for user: ${user_id}`);
    this.activeRequests.set(request_id, { expert_id, user_id, stopped: false });
    await this._updateRequestRecord(request_id, {
      status: 'running',
      topic_id,
      error_message: null,
      started_at: new Date().toISOString(),
    });

    try {
      // 使用 ChatService 处理流式对话
      await this.chatService.streamChat(
        {
          request_id,
          topic_id,
          user_id,
          expert_id,
          content,
          model_id,
          task_id,
          working_path,  // 传递当前工作目录路径
          session,  // 直接传递 session 对象，chatService 只透传
          skip_user_message_persist,
          existing_user_message_id,
        },
        // onDelta - 流式数据回调（广播到所有连接）
        (delta) => {
          if (delta.type === 'start') {
            this._broadcastToConnections(expert_id, user_id, userConnections, 'start', {
              request_id,
              topic_id: delta.topic_id,
              is_new_topic: delta.is_new_topic || false
            });
            this._updateRequestRecord(request_id, {
              status: 'running',
              topic_id: delta.topic_id || topic_id,
            });
          } else if (delta.type === 'user_message_saved') {
            this._updateRequestRecord(request_id, {
              user_message_id: delta.message_id || existing_user_message_id || null,
            });
          } else if (delta.type === 'delta') {
            this._broadcastToConnections(expert_id, user_id, userConnections, 'delta', {
              request_id,
              content: delta.content
            });
          } else if (delta.type === 'reasoning_delta') {
            // 思考内容增量事件（DeepSeek R1、GLM-Z1、Qwen3 等支持）
            this._broadcastToConnections(expert_id, user_id, userConnections, 'reasoning_delta', {
              request_id,
              content: delta.content
            });
          } else if (delta.type === 'tool_call') {
            this._broadcastToConnections(expert_id, user_id, userConnections, 'tool_call', {
              request_id,
              ...delta,
            });
          } else if (delta.type === 'tool_result') {
            // 单个工具执行完成，实时推送结果
            this._broadcastToConnections(expert_id, user_id, userConnections, 'tool_result', {
              request_id,
              result: delta.result
            });
          } else if (delta.type === 'topic_updated') {
            // 上下文压缩创建了新 Topic，通知前端刷新
            this._broadcastToConnections(expert_id, user_id, userConnections, 'topic_updated', {
              request_id,
              topicsCreated: delta.topicsCreated
            });
          } else if (delta.type === 'tool_limit_warning' || delta.type === 'tool_limit_reached') {
            this._broadcastToConnections(expert_id, user_id, userConnections, delta.type, {
              request_id,
              ...delta,
            });
          }
        },
        // onComplete - 完成回调（广播到所有连接）
        (result) => {
          const activeRequest = this.activeRequests.get(request_id);
          if (activeRequest?.stopped) {
            this.activeRequests.delete(request_id);
            return;
          }

          if (result.message?.id) {
            this._updateLatestCursor(expert_id, user_id, result.message.id);
          }
          this._updateRequestRecord(request_id, {
            status: 'completed',
            topic_id: result.message?.topic_id || topic_id,
            user_message_id: result.user_message_id || existing_user_message_id || null,
            assistant_message_id: result.message?.id || null,
            error_message: null,
            completed_at: new Date().toISOString(),
          });
          this._broadcastToConnections(expert_id, user_id, userConnections, 'complete', {
            request_id,
            ...result,
          });
          this.activeRequests.delete(request_id);
        },
        // onError - 错误回调（广播到所有连接）
        (error) => {
          logger.error('Stream chat error:', error);
          const activeRequest = this.activeRequests.get(request_id);
          if (activeRequest?.stopped || error.message === 'Request aborted by user') {
            this._updateRequestRecord(request_id, {
              status: 'stopped',
              error_message: '请求已停止',
              completed_at: new Date().toISOString(),
            });
            this.activeRequests.delete(request_id);
            return;
          }
          this._updateRequestRecord(request_id, {
            status: 'failed',
            error_message: error.message || '流式处理失败',
            completed_at: new Date().toISOString(),
          });
          this._broadcastToConnections(expert_id, user_id, userConnections, 'error', {
            request_id,
            message: error.message || '流式处理失败'
          });
          this.activeRequests.delete(request_id);
        }
      );
    } catch (error) {
      logger.error('Process message error:', error);
      this._updateRequestRecord(request_id, {
        status: 'failed',
        error_message: error.message || '处理失败',
        completed_at: new Date().toISOString(),
      });
      this._broadcastToConnections(expert_id, user_id, userConnections, 'error', {
        request_id,
        message: error.message || '处理失败'
      });
      this.activeRequests.delete(request_id);
    }
  }

  async stopRequest(request_id, user_id) {
    const activeRequest = this.activeRequests.get(request_id);
    if (!activeRequest || activeRequest.user_id !== user_id) {
      return { success: false, aborted: false, expert_id: null };
    }

    activeRequest.stopped = true;
    const aborted = await this.chatService.abortRequest(activeRequest.expert_id, request_id);

    if (!aborted) {
      activeRequest.stopped = false;
      return {
        success: false,
        aborted: false,
        expert_id: activeRequest.expert_id,
      };
    }

    const userConnections = this._getUserConnections(activeRequest.expert_id, user_id);
    this._broadcastToConnections(activeRequest.expert_id, user_id, userConnections, 'stopped', { request_id });

    await this._updateRequestRecord(request_id, {
      status: 'stopped',
      error_message: '请求已停止',
      completed_at: new Date().toISOString(),
    });

    this.activeRequests.delete(request_id);

    return {
      success: true,
      aborted: true,
      expert_id: activeRequest.expert_id,
    };
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
    await this._ensureRequestMaintenanceReady();

    const { expert_id } = ctx.query;

    if (!expert_id) {
      ctx.error('缺少必要参数：expert_id');
      return;
    }

    const user_id = ctx.state.session.id;

    // 校验用户是否有权限访问该专家
    const accessCheck = await this.checkExpertAccess(user_id, expert_id);
    if (!accessCheck.allowed) {
      // 统一返回 403，避免专家枚举侧信道
      ctx.error('无权访问该专家', 403);
      return;
    }

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
    const connectedSequence = this._nextSequence(expert_id, user_id);
    ctx.res.write(`id: ${connectedSequence}\nevent: connected\n`);
    ctx.res.write(`data: ${JSON.stringify({ status: 'connected', expert_id, sequence: connectedSequence })}\n\n`);

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
        let latestMessageId = this._getLatestCursor(expert_id, user_id).latest_message_id;

        if (!latestMessageId) {
          const latestMessage = await this.Message.findOne({
            where: {
              expert_id,
              user_id,
            },
            order: [['created_at', 'DESC']],
            attributes: ['id'],
            raw: true,
          });
          latestMessageId = latestMessage?.id || null;
          this._updateLatestCursor(expert_id, user_id, latestMessageId);
        }
        
        const heartbeatData = {
          latest_message_id: latestMessageId,
          latest_sequence: this._getCurrentSequence(expert_id, user_id),
        };
        
        const heartbeatSequence = this._nextSequence(expert_id, user_id);
        ctx.res.write(`id: ${heartbeatSequence}\nevent: heartbeat\ndata: ${JSON.stringify({ sequence: heartbeatSequence, ...heartbeatData })}\n\n`);
      } catch (err) {
        logger.error('Heartbeat error:', err);
        // 即使查询失败也发送心跳，保持连接
        const heartbeatSequence = this._nextSequence(expert_id, user_id);
        ctx.res.write(`id: ${heartbeatSequence}\nevent: heartbeat\ndata: ${JSON.stringify({ sequence: heartbeatSequence, latest_message_id: null, latest_sequence: this._getCurrentSequence(expert_id, user_id) })}\n\n`);
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
