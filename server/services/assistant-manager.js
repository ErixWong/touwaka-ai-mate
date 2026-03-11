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
import https from 'https';
import http from 'http';
import logger from '../../lib/logger.js';

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
    const assistants = await this.Assistant.findAll({
      where: { is_active: true },
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
      estimated_time: a.estimated_time,
      execution_mode: a.execution_mode,
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
    }));
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

      request.status = 'running';
      request.started_at = new Date();
      this.requests.set(requestId, request);

      const startTime = Date.now();

      // 执行请求
      let result;
      try {
        result = await this.executeAssistant(assistant, request.input, {
          requestId,
        });
      } catch (execError) {
        result = { error: execError.message };
      }

      const latencyMs = Date.now() - startTime;

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

        return result;
      } catch (toolError) {
        logger.error(`[AssistantManager] 工具执行失败: ${assistant.tool_name}`, toolError.message);
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

    try {
      // 调用 LLM
      const response = await this.callLLM(modelConfig, messages, {
        temperature: parseFloat(assistant.temperature) || 0.7,
        max_tokens: assistant.max_tokens || 4096,
        timeout: (assistant.timeout || 120) * 1000,
        // 传递继承的工具（如果有）
        tools: context.inheritedTools,
      });

      return {
        success: true,
        result: response.content,
        tokens_input: response.usage?.prompt_tokens,
        tokens_output: response.usage?.completion_tokens,
        model_used: modelConfig.model_name,
      };
    } catch (llmError) {
      logger.error(`[AssistantManager] LLM 调用失败:`, llmError.message);
      return {
        success: false,
        error: `LLM 调用失败: ${llmError.message}`,
      };
    }
  }

  /**
   * 混合模式：先 LLM 推理，再调用工具
   * @param {object} assistant
   * @param {object} input
   * @param {object} context
   */
  async executeHybrid(assistant, input, context) {
    logger.info(`[AssistantManager] 混合模式执行: ${assistant.assistant_type}`, input);

    // 第一步：LLM 推理
    const llmResult = await this.executeLLM(assistant, input, context);

    if (!llmResult.success) {
      return llmResult;
    }

    // 第二步：如果有配置工具，调用工具
    if (assistant.tool_name) {
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
   * 调用 LLM API（内部方法）
   * @param {object} model - 模型配置
   * @param {Array} messages - 消息数组
   * @param {object} options - 可选参数
   * @returns {Promise<object>}
   */
  async callLLM(model, messages, options = {}) {
    const requestBody = JSON.stringify({
      model: model.model_name,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
    });

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
            resolve({
              content: response.choices?.[0]?.message?.content,
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
   * 生成工具定义（供 Expert 使用）
   * @returns {Array}
   */
  getToolDefinitions() {
    return [
      {
        type: 'function',
        function: {
          name: 'assistant_summon',
          description: '召唤助理来处理特定任务。助理是异步执行的，返回委托ID后需要通过 assistant_status 查询结果。',
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
          description: '查询助理委托的状态和结果',
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
