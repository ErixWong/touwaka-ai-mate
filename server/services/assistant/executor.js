/**
 * Executor - 助理执行引擎模块
 * 
 * 负责：
 * - 多模式执行逻辑（direct, llm）
 * - LLM 调用和工具调用
 * - 执行结果处理
 */

import logger from '../../../lib/logger.js';
import { getSystemSettingService } from '../system-setting.service.js';
import { executeWithToolLoop } from '../../../lib/tool-calling-executor.js';
import { getInheritedToolDefinitions, executeInheritedTool } from './tool-integration.js';
import { extractImageInput, executeVisionWithInput } from './vision-processor.js';

// 动态导入缓存
let ToolManagerClass = null;

async function getToolManagerClass() {
  if (!ToolManagerClass) {
    ToolManagerClass = (await import('../../../lib/tool-manager.js')).default;
  }
  return ToolManagerClass;
}

/**
 * 执行助理逻辑
 * @param {Database} db - 数据库实例
 * @param {object} assistant - 助理配置
 * @param {object} input - 输入参数
 * @param {object} context - 上下文
 * @param {object} messageService - 消息服务
 * @returns {Promise<object>} 执行结果
 */
export async function executeAssistant(db, assistant, input, context, messageService) {
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
      return executeDirect(db, assistant, actualInput, enhancedContext, messageService);
    case 'llm':
      return executeLLM(db, assistant, actualInput, enhancedContext, messageService);
    default:
      throw new Error(`Unknown execution mode: ${execution_mode}`);
  }
}

/**
 * 直接模式：直接调用 API，无 LLM 推理
 * @param {Database} db - 数据库实例
 * @param {object} assistant - 助理配置
 * @param {object} input - 输入参数
 * @param {object} context - 上下文
 * @param {object} messageService - 消息服务
 * @returns {Promise<object>}
 */
export async function executeDirect(db, assistant, input, context, messageService) {
  logger.info(`[Executor] 直接模式执行: ${assistant.id}`, input);

  // 如果配置了 tool_name，尝试通过 ToolManager 执行
  if (assistant.tool_name) {
    // 写入工具调用消息
    const toolCallId = `call_${Date.now()}`;
    await messageService.appendToolCallMessage(
      context.requestId,
      assistant.tool_name,
      input,
      toolCallId
    );

    try {
      const ToolManager = await getToolManagerClass();
      const toolManager = new ToolManager(db, context.expertId || 'system');

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
      await messageService.appendToolResultMessage(
        context.requestId,
        assistant.tool_name,
        resultSummary,
        toolCallId
      );

      return result;
    } catch (toolError) {
      logger.error(`[Executor] 工具执行失败: ${assistant.tool_name}`, toolError.message);

      // 写入工具结果消息（失败）
      await messageService.appendToolResultMessage(
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
 * @param {Database} db - 数据库实例
 * @param {object} assistant - 助理配置
 * @param {object} input - 输入参数
 * @param {object} context - 上下文
 * @param {object} messageService - 消息服务
 * @returns {Promise<object>}
 */
export async function executeLLM(db, assistant, input, context, messageService) {
  logger.info(`[Executor] LLM 模式执行: ${assistant.id}`, input);

  // 获取模型配置
  if (!assistant.model_id) {
    return {
      success: false,
      error: 'LLM 模式需要配置 model_id',
    };
  }

  const modelConfig = await db.getModelConfig(assistant.model_id);
  if (!modelConfig) {
    return {
      success: false,
      error: `模型配置不存在: ${assistant.model_id}`,
    };
  }

  // 检查是否是图片类型的输入参数（用于多模态模型）
  const imageInput = extractImageInput(input);
  const isMultimodalModel = modelConfig.model_type === 'multimodal';

  logger.info(`[Executor] LLM模式检查: assistant=${assistant.id}, model_type=${modelConfig.model_type}, hasImage=${imageInput.hasImage}`);

  // 如果是多模态模型且有图片输入，自动走视觉模式
  if (isMultimodalModel && imageInput.hasImage) {
    logger.info(`[Executor] 检测到多模态模型 + 图片输入，自动调用视觉处理`);
    return executeVisionWithInput(assistant, input, context, modelConfig, imageInput);
  }

  // 获取继承的工具定义（如果有）
  let toolDefinitions = [];
  if (context.inheritedTools && context.inheritedTools.length > 0) {
    toolDefinitions = await getInheritedToolDefinitions(
      db,
      context.inheritedTools,
      context.expertId
    );

    if (toolDefinitions.length > 0) {
      logger.info(`[Executor] 加载了 ${toolDefinitions.length} 个继承工具`);
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
    // 获取最大工具调用轮数：优先使用专家配置，否则使用系统默认
    const systemSettingService = getSystemSettingService(db);
    let maxToolRounds = await systemSettingService.getMaxToolRounds();
    
    // 如果有专家ID，尝试获取专家的 max_tool_rounds 配置
    if (context.expertId) {
      const expert = await db.getModel('expert').findByPk(context.expertId, {
        attributes: ['max_tool_rounds'],
        raw: true,
      });
      if (expert?.max_tool_rounds !== null && expert?.max_tool_rounds !== undefined) {
        maxToolRounds = expert.max_tool_rounds;
        logger.info(`[Executor] 使用专家级别的 max_tool_rounds: ${maxToolRounds}`);
      }
    }
    
    // 调用 LLM（支持多轮工具调用）
    return await executeLLMWithTools(
      db,
      modelConfig,
      messages,
      toolDefinitions,
      toolExecutionContext,
      {
        temperature: parseFloat(assistant.temperature) || 0.7,
        // 优先使用助手的 max_tokens，但不能超过模型的 max_output_tokens
        max_output_tokens: Math.min(
          assistant.max_tokens || modelConfig.max_output_tokens || 32768,
          modelConfig.max_output_tokens || 98304
        ),
        timeout: (assistant.timeout || 120) * 1000,
        maxToolRounds,
      },
      messageService
    );
  } catch (llmError) {
    logger.error(`[Executor] LLM 调用失败:`, llmError.message);
    return {
      success: false,
      error: `LLM 调用失败: ${llmError.message}`,
    };
  }
}

/**
 * 执行 LLM 并处理工具调用（支持多轮）
 * @param {Database} db - 数据库实例
 * @param {object} modelConfig - 模型配置
 * @param {Array} messages - 消息数组
 * @param {Array} tools - 工具定义
 * @param {object} toolContext - 工具执行上下文
 * @param {object} options - 配置选项
 * @param {object} messageService - 消息服务
 * @returns {Promise<object>}
 */
export async function executeLLMWithTools(db, modelConfig, messages, tools, toolContext, options = {}, messageService) {
  const { maxToolRounds = 5 } = options;

  // 使用 ToolCallingExecutor 执行多轮工具调用
  return await executeWithToolLoop(modelConfig, messages, tools, {
    maxToolRounds,
    toolContext,
    llmOptions: {
      temperature: options.temperature,
      max_tokens: options.max_output_tokens,
      timeout: options.timeout,
    },
    // 工具执行函数
    executeTool: async (toolId, params, context) => {
      logger.info(`[Executor] 执行继承工具: ${toolId}`);
      return await executeInheritedTool(db, toolId, params, context);
    },
    // 工具调用回调：写入消息记录
    onToolCall: async (toolId, params, callId) => {
      if (toolContext.requestId && messageService) {
        await messageService.appendToolCallMessage(
          toolContext.requestId,
          toolId,
          params,
          callId
        );
      }
    },
    // 工具结果回调：写入消息记录
    onToolResult: async (toolId, result, callId) => {
      if (toolContext.requestId && messageService) {
        const resultSummary = result
          ? (typeof result === 'string'
              ? result.substring(0, 200)
              : JSON.stringify(result).substring(0, 200))
          : '执行成功';
        await messageService.appendToolResultMessage(
          toolContext.requestId,
          toolId,
          resultSummary,
          callId
        );
      }
    },
  });
}

/**
 * 混合模式：先 LLM 推理，再调用工具
 * @param {Database} db - 数据库实例
 * @param {object} assistant - 助理配置
 * @param {object} input - 输入参数
 * @param {object} context - 上下文
 * @param {object} messageService - 消息服务
 * @returns {Promise<object>}
 */
export async function executeHybrid(db, assistant, input, context, messageService) {
  logger.info(`[Executor] 混合模式执行: ${assistant.id}`, input);

  // 第一步：LLM 推理（executeLLM 内部会自动检测多模态模型+图片输入）
  const llmResult = await executeLLM(db, assistant, input, context, messageService);

  if (!llmResult.success) {
    return llmResult;
  }

  // 第二步：如果有配置工具，调用工具
  if (assistant.tool_name) {
    // 写入工具调用消息
    const toolCallId = `call_${Date.now()}`;
    await messageService.appendToolCallMessage(
      context.requestId,
      assistant.tool_name,
      { llm_analysis: llmResult.result?.substring(0, 100) + '...' },
      toolCallId
    );

    try {
      const ToolManager = await getToolManagerClass();
      const toolManager = new ToolManager(db, context.expertId || 'system');

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
      await messageService.appendToolResultMessage(
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
      logger.error(`[Executor] 混合模式工具执行失败:`, toolError.message);

      // 写入工具结果消息（失败）
      await messageService.appendToolResultMessage(
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

export default {
  executeAssistant,
  executeDirect,
  executeLLM,
  executeLLMWithTools,
  executeHybrid,
};