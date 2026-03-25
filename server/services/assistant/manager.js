/**
 * AssistantManager - 助理管理核心协调器
 *
 * 负责：
 * - 协调各个子模块
 * - 请求执行调度
 * - 请求生命周期管理（CRUD）
 * - 工具调用入口
 */

import { v4 as uuidv4 } from 'uuid';
import { Sequelize } from 'sequelize';
import logger from '../../../lib/logger.js';
import Utils from '../../../lib/utils.js';
import AssistantMessageService from '../assistant-message-service.js';

// 导入子模块
import { getAssistantTools, getInheritedToolDefinitions, executeInheritedTool } from './tool-integration.js';
import { extractImageInput, executeVisionWithInput, readImageFile } from './vision-processor.js';
import { refreshAssistantsCache, getAssistant, createAssistant, updateAssistant, deleteAssistant, getAssistantDetail } from './config-repository.js';
import { executeAssistant } from './executor.js';
import { pushSSENotification, notifyExpertResult, triggerExpertResponse } from './expert-notifier.js';

class AssistantManager {
  /**
   * @param {Database} db - 数据库实例
   * @param {object} options - 配置选项
   * @param {ChatService} options.chatService - ChatService 实例
   * @param {Map} options.expertConnections - SSE 连接池
   */
  constructor(db, options = {}) {
    this.db = db;
    this.options = options;

    // 外部服务引用
    this.chatService = options.chatService || null;
    this.expertConnections = options.expertConnections || null;

    // 模型
    this.Assistant = db.getModel('assistant');
    this.AssistantRequest = db.getModel('assistant_request');
    this.AssistantMessage = db.getModel('assistant_message');
    this.Topic = db.getModel('topic');
    this.Task = db.getModel('task');
    this.Message = db.getModel('message');

    // 消息服务
    this.messageService = new AssistantMessageService(db.models);

    // 内存缓存
    this.assistantsCache = null;
    this.cacheTime = null;
    this.cacheTTL = 60000; // 缓存 60 秒

    // 请求队列（内存）
    this.requests = new Map();

    // 最大并发数
    this.maxConcurrent = options.maxConcurrent || 10;
    this.runningCount = 0;
  }

  /**
   * 设置 SSE 连接池引用
   * @param {Map} connections - SSE 连接池
   */
  setExpertConnections(connections) {
    this.expertConnections = connections;
  }

  /**
   * 初始化助理管理器
   */
  async initialize() {
    logger.info('[AssistantManager] 初始化');

    // 预加载助理配置
    await this.refreshAssistantsCache();

    // 从数据库恢复进行中的请求
    await this.restoreRunningRequests();

    logger.info('[AssistantManager] 初始化完成');
  }

  // ==================== 配置管理 ====================

  /**
   * 刷新助理配置缓存
   */
  async refreshAssistantsCache() {
    this.assistantsCache = await refreshAssistantsCache(this.db);
    this.cacheTime = Date.now();
    logger.info(`[AssistantManager] 缓存了 ${this.assistantsCache.size} 个助理配置`);
  }

  /**
   * 获取助理配置
   * @param {string} assistantId - 助理ID
   * @returns {object|null}
   */
  getAssistant(assistantId) {
    return getAssistant(this.assistantsCache, assistantId);
  }

  /**
   * 手动刷新缓存（供外部调用）
   */
  async refreshCache() {
    await this.refreshAssistantsCache();
  }

  /**
   * 列出所有可用助理
   * @returns {Array}
   */
  async roster() {
    await this.refreshAssistantsCache();

    return Array.from(this.assistantsCache.values()).map(a => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      description: a.description,
      model_id: a.model_id,
      prompt_template: a.prompt_template,
      max_tokens: a.max_tokens,
      temperature: a.temperature,
      timeout: a.timeout,
      estimated_time: a.estimated_time,
      tool_name: a.tool_name,
      tool_description: a.tool_description,
      tool_parameters: a.tool_parameters,
      can_use_skills: a.can_use_skills,
      execution_mode: a.execution_mode,
      is_active: a.is_active,
    }));
  }

  /**
   * 获取单个助理详情
   * @param {string} assistantId - 助理ID
   * @returns {Promise<object|null>}
   */
  async getAssistantDetail(assistantId) {
    return await getAssistantDetail(this.db, assistantId);
  }

  /**
   * 创建新助理
   * @param {object} data - 助理数据
   * @returns {Promise<object>}
   */
  async createAssistant(data) {
    const result = await createAssistant(this.db, data);
    await this.refreshAssistantsCache();
    return result;
  }

  /**
   * 更新助理配置
   * @param {string} assistantId - 助理ID
   * @param {object} updates - 更新内容
   * @returns {Promise<object>}
   */
  async updateAssistant(assistantId, updates) {
    const result = await updateAssistant(this.db, assistantId, updates);
    await this.refreshAssistantsCache();
    return result;
  }

  /**
   * 删除助理
   * @param {string} assistantId - 助理ID
   */
  async deleteAssistant(assistantId) {
    const result = await deleteAssistant(this.db, assistantId);
    await this.refreshAssistantsCache();
    return result;
  }

  // ==================== 请求管理 ====================

  /**
   * 从数据库恢复进行中的请求
   */
  async restoreRunningRequests() {
    const runningRequests = await this.AssistantRequest.findAll({
      where: { status: 'running' },
      raw: true,
    });

    for (const request of runningRequests) {
      // 更新为 failed（因为进程可能已重启）
      await this.AssistantRequest.update(
        { status: 'failed', error_message: '服务重启，未完成执行' },
        { where: { request_id: request.request_id } }
      );
    }

    logger.info(`[AssistantManager] 恢复了 ${runningRequests.length} 个请求`);
  }

  /**
   * 召唤助理（异步委托）
   */
  async summon(summonRequest) {
    // 兼容旧版调用方式：summon(assistantId, input, context)
    let assistantId, input, context;

    if (typeof summonRequest === 'string') {
      assistantId = arguments[0];
      input = arguments[1];
      context = arguments[2] || {};
    } else {
      assistantId = summonRequest.assistant_id;
      input = summonRequest.input;
      context = {
        expertId: summonRequest.workspace?.expert_id,
        contactId: summonRequest.contactId,
        userId: summonRequest.userId,
        topicId: summonRequest.workspace?.topic_id,
        workdir: summonRequest.workspace?.workdir,
        task: summonRequest.task,
        background: summonRequest.background,
        expected_output: summonRequest.expected_output,
        inherited_tools: summonRequest.inherited_tools,
      };
    }

    // 获取助理配置
    const assistant = this.getAssistant(assistantId);
    if (!assistant) {
      throw new Error(`Assistant not found: ${assistantId}`);
    }

    // 生成请求 ID
    const requestId = `req_${uuidv4().replace(/-/g, '').substring(0, 16)}`;

    // 获取发起委托时的对话上下文
    let summonContext = '';
    if (context.topicId) {
      try {
        const recentMessages = await this.Message.findAll({
          where: { topic_id: context.topicId },
          order: [['created_at', 'DESC']],
          limit: 10,
          raw: true,
        });
        const contextMessages = recentMessages.reverse();
        const contextLines = [];
        for (const msg of contextMessages) {
          const roleLabel = msg.role === 'user' ? '用户' : '专家';
          let content = msg.content || '';
          if (content.length > 200) {
            content = content.substring(0, 200) + '...';
          }
          if (content.length > 10) {
            contextLines.push(`**${roleLabel}**: ${content}`);
          }
        }
        summonContext = contextLines.join('\n\n');
      } catch (e) {
        logger.warn(`[AssistantManager] 获取委托上下文失败:`, e.message);
      }
    }

    // 构建完整的输入结构
    const fullInput = {
      task: context.task || `执行 ${assistantId} 任务`,
      background: context.background,
      input: input,
      expected_output: context.expected_output,
      workspace: {
        topic_id: context.topicId,
        expert_id: context.expertId,
        workdir: context.workdir,
      },
      inherited_tools: context.inherited_tools,
      summon_context: summonContext,
    };

    // 创建委托记录
    const request = {
      request_id: requestId,
      assistant_id: assistantId,
      expert_id: context.expertId || null,
      contact_id: context.contactId || null,
      user_id: context.userId || null,
      topic_id: context.topicId || null,
      status: 'pending',
      input: JSON.stringify(fullInput),
      is_archived: 0,
      created_at: new Date(),
    };

    // 保存到数据库
    await this.AssistantRequest.create(request);

    // 写入任务消息
    await this.messageService.appendTaskMessage(requestId, {
      task: context.task || `执行 ${assistantId} 任务`,
      background: context.background,
      input: input,
      expectedOutput: context.expected_output,
      workspace: {
        topic_id: context.topicId,
        expert_id: context.expertId,
      },
    });

    // 添加到内存队列
    this.requests.set(requestId, { ...request, input: fullInput });

    // 启动异步执行（不等待）
    this.executeRequest(requestId).catch(err => {
      logger.error(`[AssistantManager] 执行请求失败: ${requestId}`, err.message);
    });

    return {
      request_id: requestId,
      message: '任务已提交，助理执行完结果会返回，请勿轮询',
    };
  }

  /**
   * 查询委托状态
   */
  async status(requestId) {
    const request = await this.AssistantRequest.findOne({
      where: { request_id: requestId },
      raw: true,
    });

    if (!request) {
      throw new Error(`Request not found: ${requestId}`);
    }

    return {
      request_id: request.request_id,
      assistant_id: request.assistant_id,
      status: request.status,
      input: JSON.parse(request.input || '{}'),
      result: request.result,
      error_message: request.error_message,
      tokens_input: request.tokens_input,
      tokens_output: request.tokens_output,
      model_used: request.model_used,
      latency_ms: request.latency_ms,
      created_at: request.created_at,
      started_at: request.started_at,
      completed_at: request.completed_at,
    };
  }

  /**
   * 获取请求列表
   */
  async list(filters = {}) {
    const where = {};

    if (filters.expert_id) where.expert_id = filters.expert_id;
    if (filters.user_id) where.user_id = filters.user_id;
    if (filters.status) where.status = filters.status;
    if (filters.assistant_id) where.assistant_id = filters.assistant_id;

    const requests = await this.AssistantRequest.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: filters.limit || 50,
      raw: true,
    });

    return requests.map(r => ({
      request_id: r.request_id,
      assistant_id: r.assistant_id,
      status: r.status,
      created_at: r.created_at,
      completed_at: r.completed_at,
      is_archived: Number(r.is_archived) || 0,
    }));
  }

  /**
   * 归档请求
   */
  async archive(requestId) {
    const request = await this.AssistantRequest.findOne({
      where: { request_id: requestId },
      raw: true,
    });

    if (!request) {
      throw new Error(`Request not found: ${requestId}`);
    }

    await this.AssistantRequest.update(
      { is_archived: Sequelize.literal("b'1'") },
      { where: { request_id: requestId } }
    );

    this.requests.delete(requestId);
    logger.info(`[AssistantManager] Request archived: ${requestId}`);

    return { request_id: requestId, is_archived: 1 };
  }

  /**
   * 取消归档请求
   */
  async unarchive(requestId) {
    const request = await this.AssistantRequest.findOne({
      where: { request_id: requestId },
      raw: true,
    });

    if (!request) {
      throw new Error(`Request not found: ${requestId}`);
    }

    await this.AssistantRequest.update(
      { is_archived: Sequelize.literal("b'0'") },
      { where: { request_id: requestId } }
    );

    logger.info(`[AssistantManager] Request unarchived: ${requestId}`);

    return { request_id: requestId, is_archived: 0 };
  }

  /**
   * 删除请求（物理删除）
   */
  async delete(requestId) {
    const request = await this.AssistantRequest.findOne({
      where: { request_id: requestId },
      raw: true,
    });

    if (!request) {
      throw new Error(`Request not found: ${requestId}`);
    }

    // 只允许删除已完成、失败或已取消的请求
    const deletableStatuses = ['completed', 'failed', 'timeout', 'cancelled'];
    if (!deletableStatuses.includes(request.status)) {
      throw new Error(`Cannot delete request with status: ${request.status}`);
    }

    // 删除关联的消息
    await this.AssistantMessage.destroy({
      where: { request_id: requestId },
    });

    // 删除请求
    await this.AssistantRequest.destroy({
      where: { request_id: requestId },
    });

    this.requests.delete(requestId);
    logger.info(`[AssistantManager] Request deleted: ${requestId}`);

    return { request_id: requestId, deleted: true };
  }

  /**
   * 重新执行请求
   * @param {string} requestId - 原请求ID
   * @returns {Promise<object>} 新请求信息
   */
  async retry(requestId) {
    // 获取原请求
    const originalRequest = await this.AssistantRequest.findOne({
      where: { request_id: requestId },
      raw: true,
    });

    if (!originalRequest) {
      throw new Error(`Request not found: ${requestId}`);
    }

    // 解析原始输入
    const originalInput = JSON.parse(originalRequest.input || '{}');

    // 生成新的请求 ID
    const newRequestId = `req_${uuidv4().replace(/-/g, '').substring(0, 16)}`;

    // 创建新请求
    const newRequest = {
      request_id: newRequestId,
      assistant_id: originalRequest.assistant_id,
      expert_id: originalRequest.expert_id,
      contact_id: originalRequest.contact_id,
      user_id: originalRequest.user_id,
      topic_id: originalRequest.topic_id,
      status: 'pending',
      input: JSON.stringify(originalInput),
      is_archived: 0,
      created_at: new Date(),
    };

    // 保存到数据库
    await this.AssistantRequest.create(newRequest);

    // 写入任务消息
    await this.messageService.appendTaskMessage(newRequestId, {
      task: originalInput.task || `执行 ${originalRequest.assistant_id} 任务`,
      background: originalInput.background,
      input: originalInput.input,
      expectedOutput: originalInput.expected_output,
      workspace: originalInput.workspace,
    });

    // 添加到内存队列
    this.requests.set(newRequestId, { ...newRequest, input: originalInput });

    // 启动异步执行
    this.executeRequest(newRequestId).catch(err => {
      logger.error(`[AssistantManager] 重试执行失败: ${newRequestId}`, err.message);
    });

    logger.info(`[AssistantManager] 重新执行请求: ${requestId} -> ${newRequestId}`);

    return {
      request_id: newRequestId,
      original_request_id: requestId,
      message: '任务已重新提交',
    };
  }

  /**
   * 获取请求的消息列表
   */
  async getMessages(requestId, debugMode = false) {
    return await this.messageService.getMessagesByRequestId(requestId, debugMode);
  }

  // ==================== 请求执行 ====================

  /**
   * 异步执行请求
   */
  async executeRequest(requestId) {
    // 检查并发限制
    if (this.runningCount >= this.maxConcurrent) {
      logger.warn(`[AssistantManager] 达到最大并发数，等待中...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return this.executeRequest(requestId);
    }

    this.runningCount++;

    try {
      // 从内存获取请求
      let request = this.requests.get(requestId);
      if (!request) {
        // 从数据库加载
        const dbRequest = await this.AssistantRequest.findOne({
          where: { request_id: requestId },
          raw: true,
        });
        if (!dbRequest) {
          throw new Error(`Request not found: ${requestId}`);
        }
        request = {
          ...dbRequest,
          input: JSON.parse(dbRequest.input || '{}'),
        };
      }

      // 获取助理配置
      const assistant = this.getAssistant(request.assistant_id);
      if (!assistant) {
        throw new Error(`Assistant not found: ${request.assistant_id}`);
      }

      // 更新状态为 running
      await this.AssistantRequest.update(
        { status: 'running', started_at: new Date() },
        { where: { request_id: requestId } }
      );

      // 写入状态消息
      await this.messageService.appendStatusMessage(requestId, 'running', 'Assistant 开始执行');

      request.status = 'running';
      request.started_at = new Date();
      this.requests.set(requestId, request);

      const startTime = Date.now();

      // 执行请求
      let result;
      try {
        result = await executeAssistant(this.db, assistant, request.input, {
          requestId,
          workdir: request.input?.workspace?.workdir,
          topicId: request.topic_id,
          expertId: request.expert_id,
          messageService: this.messageService,
        });
      } catch (execError) {
        result = { error: execError.message };
      }

      const latencyMs = Date.now() - startTime;

      // 写入最终消息
      if (result.error) {
        await this.messageService.appendErrorMessage(requestId, result.error);
      } else {
        await this.messageService.appendFinalMessage(
          requestId,
          typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
          result.tokens_input,
          result.tokens_output,
          latencyMs
        );
      }

      // 更新完成状态
      const finalStatus = result.error ? 'failed' : 'completed';
      await this.AssistantRequest.update(
        {
          status: finalStatus,
          result: result.error ? null : JSON.stringify(result),
          error_message: result.error || null,
          latency_ms: latencyMs,
          completed_at: new Date(),
        },
        { where: { request_id: requestId } }
      );

      request.status = finalStatus;
      request.result = result;
      request.error_message = result.error || null;
      request.completed_at = new Date();
      request.notified = true;
      this.requests.set(requestId, request);

      logger.info(
        `[AssistantManager] 请求完成: ${requestId}, 状态: ${finalStatus}, 耗时: ${latencyMs}ms`
      );

      // 通过 Internal API 通知 Expert 会话
      if (!request._notified) {
        request._notified = true;
        notifyExpertResult(this.db, request, {
          expertConnections: this.expertConnections,
          chatService: this.chatService,
        }).catch(err => {
          logger.error(`[AssistantManager] 通知 Expert 结果失败: ${requestId}`, err.message);
        });
      } else {
        logger.info(`[AssistantManager] 跳过通知：已通知过 ${requestId}`);
      }
    } catch (error) {
      logger.error(`[AssistantManager] 执行请求失败: ${requestId}`, error.message);

      // 写入错误消息
      await this.messageService.appendErrorMessage(requestId, error);

      await this.AssistantRequest.update(
        {
          status: 'failed',
          error_message: error.message,
          completed_at: new Date(),
        },
        { where: { request_id: requestId } }
      );

      // 从数据库获取请求信息，用于通知专家
      const failedRequest = await this.AssistantRequest.findOne({
        where: { request_id: requestId },
        raw: true,
      });

      // 通知专家执行失败
      if (failedRequest) {
        notifyExpertResult(this.db, {
          ...failedRequest,
          input: JSON.parse(failedRequest.input || '{}'),
          status: 'failed',
          error_message: error.message,
        }, {
          expertConnections: this.expertConnections,
          chatService: this.chatService,
        }).catch(err => {
          logger.error(`[AssistantManager] 通知 Expert 失败: ${requestId}`, err.message);
        });
      }
    } finally {
      this.runningCount--;
    }
  }

  // ==================== 工具集成 ====================

  /**
   * 获取助理系统提供的工具定义（供 Expert 使用）
   */
  getAssistantTools() {
    return getAssistantTools(this.assistantsCache);
  }

  /**
   * 根据工具ID列表获取工具定义
   */
  async getInheritedToolDefinitions(toolIds, expertId) {
    return await getInheritedToolDefinitions(this.db, toolIds, expertId);
  }

  /**
   * 执行继承的工具调用
   */
  async executeInheritedTool(toolId, params, context) {
    return await executeInheritedTool(this.db, toolId, params, context);
  }

  /**
   * 执行工具调用
   */
  async executeTool(toolName, params, context = {}) {
    switch (toolName) {
      case 'assistant_summon':
        return this.summon({
          assistant_id: params.assistant_id,
          task: params.task,
          background: params.background,
          input: params.input,
          expected_output: params.expected_output,
          inherited_tools: params.inherited_tools,
          userId: context.userId,
          contactId: context.contactId,
          workspace: {
            expert_id: context.expertId,
            topic_id: context.topicId,
            workdir: context.taskContext?.fullWorkspacePath || context.taskContext?.workspacePath,
          },
        });

      case 'assistant_roster':
        return this.roster();

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  // ==================== 视觉处理 ====================

  /**
   * 从输入参数中提取图片路径或 base64 数据
   */
  extractImageInput(input) {
    return extractImageInput(input);
  }

  /**
   * 使用输入参数中的图片执行视觉处理
   */
  async executeVisionWithInput(assistant, input, context, modelConfig, imageInput) {
    return await executeVisionWithInput(assistant, input, context, modelConfig, imageInput);
  }

  /**
   * 读取图片文件并转换为 data URL
   */
  async readImageFile(filePath, context = {}) {
    return await readImageFile(filePath, context);
  }
}

// 单例实例
let instance = null;

/**
 * 获取 AssistantManager 单例
 */
export function getAssistantManager(db, options = {}) {
  if (!instance && db) {
    instance = new AssistantManager(db, options);
  }
  return instance;
}

/**
 * 设置 AssistantManager 实例（用于测试或外部注入）
 */
export function setAssistantManager(manager) {
  instance = manager;
}

export default AssistantManager;