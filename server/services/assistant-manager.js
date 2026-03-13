/**
 * AssistantManager - 助理管理系统
 *
 * 核心服务，负责：
 * - 管理助理配置
 * - 处理异步委托请求
 * - 流式执行 LLM 调用
 *
 * 与 Skill 系统的区别：
 * - 执行位置：主进程内（非子进程）
 * - 调用模式：异步委托（非同步阻塞）
 * - 状态管理：数据库持久化
 */

import { v4 as uuidv4 } from 'uuid';
import { Sequelize } from 'sequelize';
import https from 'https';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../lib/logger.js';
import AssistantMessageService from './assistant-message-service.js';
import { getSystemSettingService } from './system-setting.service.js';

// 支持的图片格式
const IMAGE_EXTENSIONS = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

class AssistantManager {
  /**
   * @param {Database} db - 数据库实例
   * @param {object} options - 配置选项
   */
  constructor(db, options = {}) {
    this.db = db;
    this.options = options;

    // 模型
    this.Assistant = db.getModel('assistant');
    this.AssistantRequest = db.getModel('assistant_request');
    this.AssistantMessage = db.getModel('assistant_message');

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

  /**
   * 刷新助理配置缓存
   */
  async refreshAssistantsCache() {
    // 使用 Sequelize.literal 处理 BIT 类型字段
    const assistants = await this.Assistant.findAll({
      where: Sequelize.literal('is_active = 1'),
      raw: true,
    });

    this.assistantsCache = new Map();
    for (const assistant of assistants) {
      // 将 BIT(1) 转换为布尔值
      assistant.can_use_skills = !!assistant.can_use_skills;
      assistant.is_active = !!assistant.is_active;
      this.assistantsCache.set(assistant.assistant_type, assistant);
    }

    this.cacheTime = Date.now();
    logger.info(`[AssistantManager] 缓存了 ${this.assistantsCache.size} 个助理配置`);
  }

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
   * 获取助理配置
   * @param {string} assistantType - 助理类型
   * @returns {object|null}
   */
  getAssistant(assistantType) {
    // 直接从缓存获取，不触发异步刷新
    // 缓存刷新由 initialize() 和外部定时任务控制
    return this.assistantsCache?.get(assistantType) || null;
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
      assistant_type: a.assistant_type,
      name: a.name,
      icon: a.icon,
      description: a.description,
      model_id: a.model_id,
      prompt_template: a.prompt_template,
      estimated_time: a.estimated_time,
      execution_mode: a.execution_mode,
      is_active: a.is_active,
    }));
  }

  /**
   * 召唤助理（异步委托）
   *
   * @param {object} summonRequest - 召唤请求对象
   * @param {string} summonRequest.assistant_type - 助理类型（必填）
   * @param {string} summonRequest.task - 任务描述（必填）
   * @param {string} [summonRequest.background] - 任务背景（可选）
   * @param {object} summonRequest.input - 输入数据（必填）
   * @param {object} [summonRequest.expected_output] - 期望输出格式（可选）
   * @param {object} [summonRequest.workspace] - 工作空间上下文（可选）
   * @param {string[]} [summonRequest.inherited_tools] - 继承的工具列表（可选）
   * @param {string} [summonRequest.userId] - 用户ID
   * @param {string} [summonRequest.contactId] - 联系人ID
   * @returns {Promise<{request_id: string, status: string, estimated_time: number, message: string}>}
   */
  async summon(summonRequest) {
    // 兼容旧版调用方式：summon(assistantType, input, context)
    let assistantType, input, context;

    if (typeof summonRequest === 'string') {
      // 旧版调用：summon(assistantType, input, context)
      assistantType = arguments[0];
      input = arguments[1];
      context = arguments[2] || {};
    } else {
      // 新版调用：summon(requestObject)
      assistantType = summonRequest.assistant_type;
      input = summonRequest.input;
      context = {
        expertId: summonRequest.workspace?.expert_id,
        contactId: summonRequest.contactId,
        userId: summonRequest.userId,
        topicId: summonRequest.workspace?.topic_id,
        workdir: summonRequest.workspace?.workdir,  // 工作目录
        task: summonRequest.task,
        background: summonRequest.background,
        expected_output: summonRequest.expected_output,
        inherited_tools: summonRequest.inherited_tools,
      };
    }

    // 获取助理配置
    const assistant = this.getAssistant(assistantType);
    if (!assistant) {
      throw new Error(`Assistant not found: ${assistantType}`);
    }

    // 生成请求 ID
    const requestId = `req_${uuidv4().replace(/-/g, '').substring(0, 16)}`;

    // 构建完整的输入结构（存储到数据库）
    const fullInput = {
      task: context.task || `执行 ${assistantType} 任务`,
      background: context.background,
      input: input,
      expected_output: context.expected_output,
      workspace: {
        topic_id: context.topicId,
        expert_id: context.expertId,
        workdir: context.workdir,  // 工作目录
      },
      inherited_tools: context.inherited_tools,
    };

    // 创建委托记录（数据库 + 内存）
    const request = {
      request_id: requestId,
      assistant_type: assistantType,
      expert_id: context.expertId || null,
      contact_id: context.contactId || null,
      user_id: context.userId || null,
      topic_id: context.topicId || null,
      status: 'pending',
      input: JSON.stringify(fullInput),
      created_at: new Date(),
    };

    // 保存到数据库
    await this.AssistantRequest.create(request);

    // 写入任务消息
    await this.messageService.appendTaskMessage(requestId, {
      task: context.task || `执行 ${assistantType} 任务`,
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
      assistant_type: assistantType,
      status: 'pending',
      estimated_time: assistant.estimated_time || 30,
      message: `助理已召唤，预计 ${assistant.estimated_time || 30} 秒完成`,
    };
  }

  /**
   * 查询委托状态
   * @param {string} requestId - 请求ID
   * @returns {Promise<object>}
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
      assistant_type: request.assistant_type,
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
   * @param {object} filters - 过滤条件
   * @returns {Promise<Array>}
   */
  async list(filters = {}) {
    const where = {};

    if (filters.expert_id) where.expert_id = filters.expert_id;
    if (filters.user_id) where.user_id = filters.user_id;
    if (filters.status) where.status = filters.status;
    if (filters.assistant_type) where.assistant_type = filters.assistant_type;

    const requests = await this.AssistantRequest.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: filters.limit || 50,
      raw: true,
    });

    return requests.map(r => ({
      request_id: r.request_id,
      assistant_type: r.assistant_type,
      status: r.status,
      created_at: r.created_at,
      completed_at: r.completed_at,
      is_archived: r.is_archived,
    }));
  }

  /**
   * 归档请求
   * @param {string} requestId - 请求ID
   * @returns {Promise<object>}
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
      { is_archived: 1 },
      { where: { request_id: requestId } }
    );

    // 从内存移除
    this.requests.delete(requestId);

    logger.info(`[AssistantManager] Request archived: ${requestId}`);

    return {
      request_id: requestId,
      is_archived: true,
    };
  }

  /**
   * 取消归档请求
   * @param {string} requestId - 请求ID
   * @returns {Promise<object>}
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
      { is_archived: 0 },
      { where: { request_id: requestId } }
    );

    logger.info(`[AssistantManager] Request unarchived: ${requestId}`);

    return {
      request_id: requestId,
      is_archived: false,
    };
  }

  /**
   * 删除请求（物理删除）
   * @param {string} requestId - 请求ID
   * @returns {Promise<object>}
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

    // 从内存移除
    this.requests.delete(requestId);

    logger.info(`[AssistantManager] Request deleted: ${requestId}`);

    return {
      request_id: requestId,
      deleted: true,
    };
  }

  /**
   * 获取请求的消息列表
   * @param {string} requestId - 请求ID
   * @param {boolean} debugMode - 是否返回完整内容
   * @returns {Promise<Array>}
   */
  async getMessages(requestId, debugMode = false) {
    return await this.messageService.getMessagesByRequestId(requestId, debugMode);
  }

  /**
   * 异步执行请求
   * @param {string} requestId - 请求ID
   */
  async executeRequest(requestId) {
    // 检查并发限制
    if (this.runningCount >= this.maxConcurrent) {
      logger.warn(`[AssistantManager] 达到最大并发数，等待中...`);
      // 等待直到有空闲槽位
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
      const assistant = this.getAssistant(request.assistant_type);
      if (!assistant) {
        throw new Error(`Assistant not found: ${request.assistant_type}`);
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
        result = await this.executeAssistant(assistant, request.input, {
          requestId,
          workdir: request.input?.workspace?.workdir,  // 传递工作目录
          topicId: request.topic_id,
          expertId: request.expert_id,
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
      request.completed_at = new Date();
      this.requests.set(requestId, request);

      logger.info(
        `[AssistantManager] 请求完成: ${requestId}, 状态: ${finalStatus}, 耗时: ${latencyMs}ms`
      );
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
    } finally {
      this.runningCount--;
    }
  }

  /**
   * 执行助理逻辑
   * @param {object} assistant - 助理配置
   * @param {object} input - 输入参数（新版结构，包含 task, background, input, expected_output, inherited_tools）
   * @param {object} context - 上下文
   * @returns {Promise<object>} 执行结果
   */
  async executeAssistant(assistant, input, context) {
    const { execution_mode } = assistant;

    // 提取新版输入结构
    const task = input.task || '执行任务';
    const background = input.background;
    const actualInput = input.input || input; // 兼容旧版
    const expectedOutput = input.expected_output;
    const inheritedTools = input.inherited_tools;

    // 构建增强上下文
    const enhancedContext = {
      ...context,
      task,
      background,
      expectedOutput,
      inheritedTools,
    };

    switch (execution_mode) {
      case 'direct':
        return this.executeDirect(assistant, actualInput, enhancedContext);
      case 'llm':
        return this.executeLLM(assistant, actualInput, enhancedContext);
      case 'hybrid':
        return this.executeHybrid(assistant, actualInput, enhancedContext);
      default:
        throw new Error(`Unknown execution mode: ${execution_mode}`);
    }
  }

  /**
   * 直接模式：直接调用 API，无 LLM 推理
   * @param {object} assistant
   * @param {object} input
   * @param {object} context
   */
  async executeDirect(assistant, input, context) {
    logger.info(`[AssistantManager] 直接模式执行: ${assistant.assistant_type}`, input);

    // 如果配置了 tool_name，尝试通过 ToolManager 执行
    if (assistant.tool_name) {
      // 写入工具调用消息
      const toolCallId = `call_${Date.now()}`;
      await this.messageService.appendToolCallMessage(
        context.requestId,
        assistant.tool_name,
        input,
        toolCallId
      );

      try {
        // 动态导入 ToolManager 避免循环依赖
        const ToolManager = (await import('../../lib/tool-manager.js')).default;
        const toolManager = new ToolManager(this.db, context.expertId || 'system');

        const toolId = assistant.tool_name;

        const result = await toolManager.executeTool(toolId, input, {
          userId: context.userId,
          expertId: context.expertId,
          is_admin: true, // 助理作为内部服务，具有较高权限
        });

        // 写入工具结果消息
        const resultSummary = result
          ? (typeof result === 'string' ? result.substring(0, 200) : '执行成功')
          : '执行成功';
        await this.messageService.appendToolResultMessage(
          context.requestId,
          assistant.tool_name,
          resultSummary,
          toolCallId
        );

        return result;
      } catch (toolError) {
        logger.error(`[AssistantManager] 工具执行失败: ${assistant.tool_name}`, toolError.message);

        // 写入工具结果消息（失败）
        await this.messageService.appendToolResultMessage(
          context.requestId,
          assistant.tool_name,
          `执行失败: ${toolError.message}`,
          toolCallId
        );

        return {
          success: false,
          error: `工具执行失败: ${toolError.message}`,
        };
      }
    }

    // 没有配置工具，返回错误
    return {
      success: false,
      error: '直接模式需要配置 tool_name',
    };
  }

  /**
   * LLM 模式：调用 LLM 进行推理
   * @param {object} assistant
   * @param {object} input
   * @param {object} context
   */
  async executeLLM(assistant, input, context) {
    logger.info(`[AssistantManager] LLM 模式执行: ${assistant.assistant_type}`, input);

    // 获取模型配置
    if (!assistant.model_id) {
      return {
        success: false,
        error: 'LLM 模式需要配置 model_id',
      };
    }

    const modelConfig = await this.db.getModelConfig(assistant.model_id);
    if (!modelConfig) {
      return {
        success: false,
        error: `模型配置不存在: ${assistant.model_id}`,
      };
    }

    // 获取继承的工具定义（如果有）
    let toolDefinitions = [];
    if (context.inheritedTools && context.inheritedTools.length > 0) {
      toolDefinitions = await this.getInheritedToolDefinitions(
        context.inheritedTools,
        context.expertId
      );

      if (toolDefinitions.length > 0) {
        logger.info(`[AssistantManager] 加载了 ${toolDefinitions.length} 个继承工具`);
      }
    }

    // 构建消息
    const messages = [];

    // 添加系统提示词
    if (assistant.prompt_template) {
      messages.push({
        role: 'system',
        content: assistant.prompt_template,
      });
    }

    // 构建用户消息（包含任务描述和背景）
    let userContent = '';

    // 添加任务描述
    if (context.task) {
      userContent += `**任务**: ${context.task}\n\n`;
    }

    // 添加任务背景
    if (context.background) {
      userContent += `**背景**: ${context.background}\n\n`;
    }

    // 添加具体输入数据
    userContent += `**输入数据**:\n${typeof input === 'string' ? input : JSON.stringify(input, null, 2)}`;

    // 添加期望输出格式
    if (context.expectedOutput) {
      userContent += '\n\n**期望输出格式**:';
      if (context.expectedOutput.format) {
        userContent += `\n格式: ${context.expectedOutput.format}`;
      }
      if (context.expectedOutput.focus && context.expectedOutput.focus.length > 0) {
        userContent += `\n关注点: ${context.expectedOutput.focus.join(', ')}`;
      }
      if (context.expectedOutput.max_length) {
        userContent += `\n最大长度: ${context.expectedOutput.max_length} 字符`;
      }
    }

    messages.push({
      role: 'user',
      content: userContent,
    });

    // 工具执行上下文
    const toolExecutionContext = {
      requestId: context.requestId,
      expertId: context.expertId,
      userId: context.userId,
    };

    try {
      // 从系统设置获取最大工具调用轮数
      const systemSettingService = getSystemSettingService(this.db);
      const maxToolRounds = await systemSettingService.getMaxToolRounds();
      
      // 调用 LLM（支持多轮工具调用）
      return await this.executeLLMWithTools(
        modelConfig,
        messages,
        toolDefinitions,
        toolExecutionContext,
        {
          temperature: parseFloat(assistant.temperature) || 0.7,
          max_tokens: assistant.max_tokens || 4096,
          timeout: (assistant.timeout || 120) * 1000,
          maxToolRounds,
        }
      );
    } catch (llmError) {
      logger.error(`[AssistantManager] LLM 调用失败:`, llmError.message);
      return {
        success: false,
        error: `LLM 调用失败: ${llmError.message}`,
      };
    }
  }

  /**
   * 执行 LLM 并处理工具调用（支持多轮）
   * @param {object} modelConfig - 模型配置
   * @param {Array} messages - 消息数组
   * @param {Array} tools - 工具定义
   * @param {object} toolContext - 工具执行上下文
   * @param {object} options - 配置选项
   * @returns {Promise<object>}
   */
  async executeLLMWithTools(modelConfig, messages, tools, toolContext, options = {}) {
    const { maxToolRounds = 5 } = options;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCallMessages = []; // 记录工具调用消息

    for (let round = 0; round <= maxToolRounds; round++) {
      // 调用 LLM
      const response = await this.callLLM(modelConfig, messages, {
        ...options,
        tools: tools.length > 0 ? tools : undefined,
      });

      // 累计 token 使用
      totalInputTokens += response.usage?.prompt_tokens || 0;
      totalOutputTokens += response.usage?.completion_tokens || 0;

      // 检查是否有工具调用
      if (!response.tool_calls || response.tool_calls.length === 0) {
        // 没有工具调用，返回最终结果
        return {
          success: true,
          result: response.content,
          tokens_input: totalInputTokens,
          tokens_output: totalOutputTokens,
          model_used: modelConfig.model_name,
          tool_calls: toolCallMessages.length > 0 ? toolCallMessages : undefined,
        };
      }

      logger.info(`[AssistantManager] LLM 请求工具调用 (轮次 ${round + 1}):`,
        response.tool_calls.map(t => t.function?.name));

      // 将 assistant 消息添加到对话历史
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      });

      // 执行每个工具调用
      for (const toolCall of response.tool_calls) {
        const toolId = toolCall.function?.name;
        const callId = toolCall.id;

        if (!toolId) continue;

        // 解析工具参数
        let toolParams = {};
        try {
          toolParams = JSON.parse(toolCall.function.arguments || '{}');
        } catch (e) {
          logger.warn(`[AssistantManager] 工具参数解析失败: ${toolId}`, e.message);
        }

        // 写入工具调用消息
        if (toolContext.requestId) {
          await this.messageService.appendToolCallMessage(
            toolContext.requestId,
            toolId,
            toolParams,
            callId
          );
        }

        // 执行工具
        logger.info(`[AssistantManager] 执行继承工具: ${toolId}`);
        const toolResult = await this.executeInheritedTool(toolId, toolParams, toolContext);

        // 记录工具调用
        toolCallMessages.push({
          tool_id: toolId,
          params: toolParams,
          result: toolResult,
        });

        // 写入工具结果消息
        if (toolContext.requestId) {
          const resultSummary = toolResult
            ? (typeof toolResult === 'string'
                ? toolResult.substring(0, 200)
                : JSON.stringify(toolResult).substring(0, 200))
            : '执行成功';
          await this.messageService.appendToolResultMessage(
            toolContext.requestId,
            toolId,
            resultSummary,
            callId
          );
        }

        // 将工具结果添加到对话历史
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
        });
      }
    }

    // 达到最大轮次，返回最后的结果
    logger.warn(`[AssistantManager] 达到最大工具调用轮次: ${maxToolRounds}`);
    return {
      success: true,
      result: '工具调用达到最大轮次限制，请简化任务或减少工具依赖。',
      tokens_input: totalInputTokens,
      tokens_output: totalOutputTokens,
      model_used: modelConfig.model_name,
      tool_calls: toolCallMessages,
    };
  }

  /**
   * 混合模式：先 LLM 推理，再调用工具
   * @param {object} assistant
   * @param {object} input
   * @param {object} context
   */
  async executeHybrid(assistant, input, context) {
    logger.info(`[AssistantManager] 混合模式执行: ${assistant.assistant_type}`, input);

    // 特殊处理：doc_image_analyzer 需要先读取图片再调用视觉模型
    if (assistant.assistant_type === 'doc_image_analyzer') {
      return this.executeHybridVision(assistant, input, context);
    }

    // 第一步：LLM 推理
    const llmResult = await this.executeLLM(assistant, input, context);

    if (!llmResult.success) {
      return llmResult;
    }

    // 第二步：如果有配置工具，调用工具
    if (assistant.tool_name) {
      // 写入工具调用消息
      const toolCallId = `call_${Date.now()}`;
      await this.messageService.appendToolCallMessage(
        context.requestId,
        assistant.tool_name,
        { llm_analysis: llmResult.result?.substring(0, 100) + '...' },
        toolCallId
      );

      try {
        const ToolManager = (await import('../../lib/tool-manager.js')).default;
        const toolManager = new ToolManager(this.db, context.expertId || 'system');

        // 将 LLM 输出作为工具输入
        const toolInput = {
          llm_analysis: llmResult.result,
          original_input: input,
        };

        const toolResult = await toolManager.executeTool(assistant.tool_name, toolInput, {
          userId: context.userId,
          expertId: context.expertId,
          is_admin: true,
        });

        // 写入工具结果消息
        const resultSummary = toolResult
          ? (typeof toolResult === 'string' ? toolResult.substring(0, 200) : '执行成功')
          : '执行成功';
        await this.messageService.appendToolResultMessage(
          context.requestId,
          assistant.tool_name,
          resultSummary,
          toolCallId
        );

        return {
          success: true,
          result: toolResult,
          llm_analysis: llmResult.result,
          tokens_input: llmResult.tokens_input,
          tokens_output: llmResult.tokens_output,
          model_used: llmResult.model_used,
        };
      } catch (toolError) {
        logger.error(`[AssistantManager] 混合模式工具执行失败:`, toolError.message);

        // 写入工具结果消息（失败）
        await this.messageService.appendToolResultMessage(
          context.requestId,
          assistant.tool_name,
          `执行失败: ${toolError.message}`,
          toolCallId
        );

        // 工具失败时，返回 LLM 结果
        return {
          success: true,
          result: llmResult.result,
          warning: `工具执行失败: ${toolError.message}`,
          tokens_input: llmResult.tokens_input,
          tokens_output: llmResult.tokens_output,
          model_used: llmResult.model_used,
        };
      }
    }

    // 没有配置工具，直接返回 LLM 结果
    return llmResult;
  }

  /**
   * 视觉混合模式：先读取图片，再调用视觉模型分析
   * @param {object} assistant
   * @param {object} input
   * @param {object} context
   */
  async executeHybridVision(assistant, input, context) {
    logger.info(`[AssistantManager] 视觉混合模式执行: ${assistant.assistant_type}`);

    // 验证输入包含 file_path
    const filePath = input.file_path;
    if (!filePath) {
      return {
        success: false,
        error: '缺少必需参数: file_path',
      };
    }

    // 第一步：读取图片文件（内置实现，不需要 skill）
    const toolCallId = `call_${Date.now()}`;
    const toolName = 'read_image_for_vision';

    // 写入工具调用消息
    await this.messageService.appendToolCallMessage(
      context.requestId,
      toolName,
      { file_path: filePath },
      toolCallId
    );

    let imageAsset;
    try {
      // 直接调用内置的图片读取方法
      imageAsset = await this.readImageFile(filePath, {
        topicId: context.topicId,
        workdir: context.workdir,  // 传递工作目录
      });

      logger.info(`[AssistantManager] 图片读取成功: ${imageAsset.file_name}, ${imageAsset.size_bytes} bytes`);

      // 写入工具结果消息
      await this.messageService.appendToolResultMessage(
        context.requestId,
        toolName,
        `读取成功: ${imageAsset.file_name} (${(imageAsset.size_bytes / 1024).toFixed(1)}KB)`,
        toolCallId
      );
    } catch (readError) {
      logger.error(`[AssistantManager] 图片读取失败:`, readError.message);

      // 写入工具结果消息（失败）
      await this.messageService.appendToolResultMessage(
        context.requestId,
        toolName,
        `读取失败: ${readError.message}`,
        toolCallId
      );

      return {
        success: false,
        error: `图片读取失败: ${readError.message}`,
      };
    }

    // 第二步：获取模型配置
    if (!assistant.model_id) {
      return {
        success: false,
        error: '视觉模式需要配置 model_id',
      };
    }

    const modelConfig = await this.db.getModelConfig(assistant.model_id);
    if (!modelConfig) {
      return {
        success: false,
        error: `模型配置不存在: ${assistant.model_id}`,
      };
    }

    // 第三步：构建多模态消息
    const messages = [];

    // 添加系统提示词
    if (assistant.prompt_template) {
      messages.push({
        role: 'system',
        content: assistant.prompt_template,
      });
    }

    // 构建用户消息（包含图片和文本）
    const userContent = [];

    // 添加图片
    userContent.push({
      type: 'image_url',
      image_url: {
        url: imageAsset.data_url,
      },
    });

    // 构建文本内容
    let textContent = '';
    if (context.task) {
      textContent += `**任务**: ${context.task}\n\n`;
    }
    if (context.background) {
      textContent += `**背景**: ${context.background}\n\n`;
    }
    if (input.analysis_hint) {
      textContent += `**分析提示**: ${input.analysis_hint}\n\n`;
    }
    if (input.expected_output) {
      textContent += `**期望输出**: ${typeof input.expected_output === 'string' ? input.expected_output : JSON.stringify(input.expected_output)}\n\n`;
    }
    if (!textContent) {
      textContent = '请分析这张图片的内容。';
    }

    userContent.push({
      type: 'text',
      text: textContent,
    });

    messages.push({
      role: 'user',
      content: userContent,
    });

    // 第四步：调用视觉模型
    const startTime = Date.now();
    try {
      const response = await this.callVisionLLM(modelConfig, messages, {
        temperature: parseFloat(assistant.temperature) || 0.7,
        max_tokens: assistant.max_tokens || 4096,
        timeout: (assistant.timeout || 120) * 1000,
      });

      const latencyMs = Date.now() - startTime;

      logger.info(`[AssistantManager] 视觉模型调用完成, 耗时: ${latencyMs}ms`);

      return {
        success: true,
        result: response.content,
        tokens_input: response.usage?.prompt_tokens || 0,
        tokens_output: response.usage?.completion_tokens || 0,
        model_used: modelConfig.model_name,
        image_asset: {
          file_name: imageAsset.file_name,
          mime_type: imageAsset.mime_type,
          size_bytes: imageAsset.size_bytes,
        },
      };
    } catch (llmError) {
      logger.error(`[AssistantManager] 视觉模型调用失败:`, llmError.message);
      return {
        success: false,
        error: `视觉模型调用失败: ${llmError.message}`,
      };
    }
  }

  /**
   * 调用视觉 LLM API（支持多模态消息）
   * @param {object} model - 模型配置
   * @param {Array} messages - 消息数组（可能包含图片）
   * @param {object} options - 可选参数
   * @returns {Promise<object>}
   */
  async callVisionLLM(model, messages, options = {}) {
    // 构建请求体
    const requestObj = {
      model: model.model_name,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
    };

    const requestBody = JSON.stringify(requestObj);

    const url = new URL(model.base_url);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}/chat/completions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.api_key}`,
        'Content-Length': Buffer.byteLength(requestBody),
        'User-Agent': 'Version: 5.10.0 (c3d4709c)',
      },
      timeout: options.timeout || 120000,
    };

    logger.info(`[AssistantManager] 视觉 LLM 调用:`, {
      model: model.model_name,
      url: `${requestOptions.hostname}${requestOptions.path}`,
      messages_count: messages.length,
    });

    return new Promise((resolve, reject) => {
      const req = httpModule.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
              return;
            }

            const response = JSON.parse(data);
            const message = response.choices?.[0]?.message;

            resolve({
              content: message?.content,
              usage: response.usage,
            });
          } catch (parseError) {
            reject(new Error(`解析响应失败: ${parseError.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * 读取图片文件并转换为 data URL
   * @param {string} filePath - 图片文件路径
   * @param {object} context - 上下文（包含 topicId 等）
   * @returns {Promise<object>} image_asset 对象
   */
  async readImageFile(filePath, context = {}) {
    // 获取白名单目录
    const allowedPaths = this.getAllowedImagePaths(context);

    // 验证路径
    const resolvedPath = this.validateImagePath(filePath, allowedPaths);

    // 检查文件扩展名
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!IMAGE_EXTENSIONS[ext]) {
      throw new Error(`不支持的图片格式: ${ext}。支持: ${Object.keys(IMAGE_EXTENSIONS).join(', ')}`);
    }

    // 读取文件
    let stats;
    try {
      stats = await fs.stat(resolvedPath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new Error(`文件不存在: ${filePath}`);
      }
      throw new Error(`无法访问文件: ${err.message}`);
    }

    // 检查文件大小（默认最大 10MB）
    const maxBytes = 10 * 1024 * 1024;
    if (stats.size > maxBytes) {
      throw new Error(`文件大小超过限制: ${(stats.size / 1024 / 1024).toFixed(2)}MB > 10MB`);
    }

    // 读取并转换为 base64
    const buffer = await fs.readFile(resolvedPath);
    const base64 = buffer.toString('base64');
    const mimeType = IMAGE_EXTENSIONS[ext];
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      kind: 'image_asset',
      source: 'local_file',
      file_path: resolvedPath,
      file_name: path.basename(resolvedPath),
      mime_type: mimeType,
      data_url: dataUrl,
      size_bytes: stats.size,
    };
  }

  /**
   * 获取允许读取图片的白名单目录
   * @param {object} context - 上下文
   * @returns {string[]}
   */
  getAllowedImagePaths(context) {
    const paths = [];

    // 数据目录（主要路径，优先级最高）
    const dataPath = process.env.DATA_BASE_PATH || './data';
    paths.push(path.resolve(dataPath));

    // work 目录（AI 工作空间）
    paths.push(path.resolve(dataPath, 'work'));

    // 工作区根目录
    if (process.env.WORKSPACE_ROOT) {
      paths.push(path.resolve(process.env.WORKSPACE_ROOT));
    }

    // 上传目录
    if (process.env.UPLOAD_DIR) {
      paths.push(path.resolve(process.env.UPLOAD_DIR));
    }

    // 临时目录
    paths.push(path.resolve('/tmp'));

    // 从 context 获取工作目录
    if (context?.workdir) {
      // workdir 可能是相对路径（work/...），需要加上 data 前缀
      const workdir = context.workdir;
      if (workdir.startsWith('work/')) {
        paths.push(path.resolve(dataPath, workdir));
      } else {
        paths.push(path.resolve(workdir));
      }
    }

    if (context?.topicId) {
      paths.push(path.resolve(dataPath, 'work', context.topicId));
    }

    return paths;
  }

  /**
   * 验证图片路径是否在白名单内
   * @param {string} filePath - 文件路径
   * @param {string[]} allowedPaths - 白名单目录
   * @returns {string} 解析后的绝对路径
   */
  validateImagePath(filePath, allowedPaths) {
    const dataPath = process.env.DATA_BASE_PATH || './data';

    // 尝试多种路径解析方式
    const candidatePaths = [
      path.resolve(filePath),                           // 直接解析
      path.resolve(dataPath, filePath),                 // 相对于 data 目录
    ];

    // 如果路径以 work/ 开头，额外尝试
    if (filePath.startsWith('work/')) {
      candidatePaths.push(path.resolve(dataPath, filePath));
    }

    // 找到第一个存在的路径
    for (const resolved of candidatePaths) {
      const isAllowed = allowedPaths.some(allowedPath =>
        resolved.startsWith(allowedPath + path.sep) || resolved === allowedPath
      );

      if (isAllowed) {
        return resolved;
      }
    }

    // 如果都不在白名单内，抛出错误
    throw new Error(`路径不在允许的目录范围内: ${filePath}`);
  }

  /**
   * 调用 LLM API（内部方法）
   * @param {object} model - 模型配置
   * @param {Array} messages - 消息数组
   * @param {object} options - 可选参数
   * @param {Array} [options.tools] - 工具定义（可选）
   * @param {object} [options.toolContext] - 工具执行上下文（可选）
   * @returns {Promise<object>}
   */
  async callLLM(model, messages, options = {}) {
    // 构建请求体
    const requestObj = {
      model: model.model_name,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
    };

    // 如果有工具定义，添加到请求中
    if (options.tools && options.tools.length > 0) {
      requestObj.tools = options.tools;
      // 不强制工具调用，让 LLM 自行决定
    }

    const requestBody = JSON.stringify(requestObj);

    const url = new URL(model.base_url);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}/chat/completions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.api_key}`,
        'Content-Length': Buffer.byteLength(requestBody),
        'User-Agent': 'Version: 5.10.0 (c3d4709c)',
      },
      timeout: options.timeout || 120000,
    };

    logger.info(`[AssistantManager] LLM 调用:`, {
      model: model.model_name,
      url: `${requestOptions.hostname}${requestOptions.path}`,
      messages_count: messages.length,
      tools_count: options.tools?.length || 0,
    });

    return new Promise((resolve, reject) => {
      const req = httpModule.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
              return;
            }

            const response = JSON.parse(data);
            const message = response.choices?.[0]?.message;

            // 检查是否有工具调用
            if (message?.tool_calls && message.tool_calls.length > 0) {
              resolve({
                content: message.content,
                tool_calls: message.tool_calls,
                usage: response.usage,
              });
            } else {
              resolve({
                content: message?.content,
                usage: response.usage,
              });
            }
          } catch (parseError) {
            reject(new Error(`解析响应失败: ${parseError.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * 生成工具定义（供 Expert 使用）
   * @returns {Array}
   */
  getToolDefinitions() {
    return [
      {
        type: 'function',
        function: {
          name: 'assistant_summon',
          description: '召唤助理来处理特定任务。助理是异步执行的，会立即返回委托ID。【重要规则】召唤成功后必须立即回复用户：任务已提交，请稍后查看结果，然后继续与用户对话。不要轮询等待结果。',
          parameters: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: '助理类型，如 ocr, drawing, coding, vision 等',
              },
              task: {
                type: 'string',
                description: '任务描述（一句话说明要做什么）',
              },
              background: {
                type: 'string',
                description: '任务背景（为什么需要这个任务）',
              },
              input: {
                type: 'object',
                description: '输入参数，根据助理类型不同而不同',
              },
              expected_output: {
                type: 'object',
                properties: {
                  format: { type: 'string', description: '输出格式：markdown/json/text' },
                  focus: { type: 'array', items: { type: 'string' }, description: '关注点列表' },
                  max_length: { type: 'number', description: '最大输出长度' },
                },
                description: '期望的输出格式',
              },
              inherited_tools: {
                type: 'array',
                items: { type: 'string' },
                description: '要继承的工具ID列表，助理可以调用这些工具',
              },
            },
            required: ['type', 'input'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'assistant_status',
          description: '查询助理委托的状态和结果。【限制使用】此工具仅供用户明确要求查询某个特定委托状态时使用。禁止用于轮询检查刚提交的任务。用户可以在右侧助理面板实时查看所有委托的进度和结果，无需 Expert 代为查询。',
          parameters: {
            type: 'object',
            properties: {
              request_id: {
                type: 'string',
                description: '委托ID（从 assistant_summon 返回）',
              },
            },
            required: ['request_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'assistant_roster',
          description: '列出所有可用的助理类型',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
    ];
  }

  /**
   * 根据工具ID列表获取工具定义
   * @param {string[]} toolIds - 工具ID列表
   * @param {string} expertId - 专家ID（用于加载专家的工具配置）
   * @returns {Promise<Array>} 工具定义数组
   */
  async getInheritedToolDefinitions(toolIds, expertId) {
    if (!toolIds || toolIds.length === 0) {
      return [];
    }

    logger.info(`[AssistantManager] 获取继承工具定义:`, toolIds);

    try {
      // 动态导入 ToolManager 避免循环依赖
      const ToolManager = (await import('../../lib/tool-manager.js')).default;
      const toolManager = new ToolManager(this.db, expertId || 'system');
      await toolManager.initialize();

      // 获取所有工具定义
      const allTools = toolManager.getToolDefinitions();

      // 过滤出需要的工具
      const inheritedTools = allTools.filter(tool => {
        const toolName = tool.function?.name || tool.name;
        return toolIds.includes(toolName);
      });

      logger.info(`[AssistantManager] 找到 ${inheritedTools.length}/${toolIds.length} 个继承工具`);

      return inheritedTools;
    } catch (error) {
      logger.error('[AssistantManager] 获取继承工具定义失败:', error.message);
      return [];
    }
  }

  /**
   * 执行继承的工具调用
   * @param {string} toolId - 工具ID
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文
   * @returns {Promise<object>} 工具执行结果
   */
  async executeInheritedTool(toolId, params, context) {
    logger.info(`[AssistantManager] 执行继承工具: ${toolId}`, params);

    try {
      const ToolManager = (await import('../../lib/tool-manager.js')).default;
      const toolManager = new ToolManager(this.db, context.expertId || 'system');
      await toolManager.initialize();

      const result = await toolManager.executeTool(toolId, params, {
        userId: context.userId,
        expertId: context.expertId,
        is_admin: true, // 助理执行继承工具具有较高权限
        requestId: context.requestId,
      });

      return result;
    } catch (error) {
      logger.error(`[AssistantManager] 执行继承工具失败: ${toolId}`, error.message);
      return { error: error.message };
    }
  }

  /**
   * 执行工具调用
   * @param {string} toolName - 工具名称
   * @param {object} params - 参数
   * @param {object} context - 上下文
   * @returns {Promise<object>}
   */
  async executeTool(toolName, params, context = {}) {
    switch (toolName) {
      case 'assistant_summon':
        // 支持新版和旧版参数
        return this.summon({
          assistant_type: params.type,
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
            // 从 taskContext 提取工作空间路径
            workdir: context.taskContext?.fullWorkspacePath || context.taskContext?.workspacePath,
          },
        });

      case 'assistant_status':
        return this.status(params.request_id);

      case 'assistant_roster':
        return this.roster();

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}

// 单例实例
let instance = null;

/**
 * 获取 AssistantManager 单例
 * @param {object} db - 数据库实例
 * @param {object} options - 配置选项
 * @returns {AssistantManager}
 */
export function getAssistantManager(db, options = {}) {
  if (!instance && db) {
    instance = new AssistantManager(db, options);
  }
  return instance;
}

/**
 * 设置 AssistantManager 实例（用于测试或外部注入）
 * @param {AssistantManager} manager
 */
export function setAssistantManager(manager) {
  instance = manager;
}

export default AssistantManager;
