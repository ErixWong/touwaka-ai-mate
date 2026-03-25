/**
 * ToolCallingExecutor - 多轮工具调用执行器
 *
 * 提供多轮工具调用的公共逻辑，支持：
 * - 非流式调用（返回结果对象）
 * - 流式调用（通过回调处理增量内容）
 *
 * 核心流程：
 * 1. 循环调用 LLM
 * 2. 检测工具调用
 * 3. 执行工具
 * 4. 将结果添加到消息历史
 * 5. 重复直到无工具调用或达到最大轮次
 */

import logger from './logger.js';
import { callLLMWithRetry } from './simple-llm-client.js';

/**
 * 执行多轮工具调用（非流式）
 *
 * @param {object} modelConfig - 模型配置
 * @param {Array} messages - 消息数组（会被修改）
 * @param {Array} tools - 工具定义
 * @param {object} options - 配置选项
 * @param {number} options.maxToolRounds - 最大工具调用轮次
 * @param {function} options.executeTool - 工具执行函数 (toolId, params, context) => result
 * @param {object} options.toolContext - 工具执行上下文
 * @param {object} options.llmOptions - LLM 调用选项（temperature, max_tokens 等）
 * @param {function} [options.onToolCall] - 工具调用回调 (toolId, params, callId) => void
 * @param {function} [options.onToolResult] - 工具结果回调 (toolId, result, callId) => void
 * @returns {Promise<object>} 执行结果
 */
export async function executeWithToolLoop(modelConfig, messages, tools, options = {}) {
  const {
    maxToolRounds = 5,
    executeTool,
    toolContext = {},
    llmOptions = {},
    onToolCall,
    onToolResult,
  } = options;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const toolCallRecords = []; // 记录工具调用

  for (let round = 0; round <= maxToolRounds; round++) {
    // 调用 LLM
    const response = await callLLMWithRetry(modelConfig, messages, {
      ...llmOptions,
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
        tool_calls: toolCallRecords.length > 0 ? toolCallRecords : undefined,
      };
    }

    logger.info(`[ToolCallingExecutor] LLM 请求工具调用 (轮次 ${round + 1}):`,
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
        logger.warn(`[ToolCallingExecutor] 工具参数解析失败: ${toolId}`, e.message);
      }

      // 调用回调
      if (onToolCall) {
        onToolCall(toolId, toolParams, callId);
      }

      // 执行工具
      let toolResult;
      if (executeTool) {
        try {
          toolResult = await executeTool(toolId, toolParams, toolContext);
        } catch (execError) {
          logger.error(`[ToolCallingExecutor] 工具执行失败: ${toolId}`, execError.message);
          toolResult = { error: execError.message };
        }
      } else {
        toolResult = { error: 'No executeTool function provided' };
      }

      // 记录工具调用
      toolCallRecords.push({
        tool_id: toolId,
        params: toolParams,
        result: toolResult,
      });

      // 调用回调
      if (onToolResult) {
        onToolResult(toolId, toolResult, callId);
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
  logger.warn(`[ToolCallingExecutor] 达到最大工具调用轮次: ${maxToolRounds}`);
  return {
    success: true,
    result: '工具调用达到最大轮次限制，请简化任务或减少工具依赖。',
    tokens_input: totalInputTokens,
    tokens_output: totalOutputTokens,
    model_used: modelConfig.model_name,
    tool_calls: toolCallRecords,
  };
}

/**
 * 执行多轮工具调用（流式）
 *
 * @param {object} llmClient - LLM 客户端实例（需要有 callStream 方法）
 * @param {object} modelConfig - 模型配置
 * @param {Array} messages - 消息数组（会被修改）
 * @param {Array} tools - 工具定义
 * @param {object} options - 配置选项
 * @param {number} options.maxToolRounds - 最大工具调用轮次
 * @param {function} options.executeTool - 工具执行函数 (toolId, params, context) => result
 * @param {object} options.toolContext - 工具执行上下文
 * @param {function} options.onDelta - 增量内容回调 (delta) => void
 * @param {function} options.onToolCall - 工具调用回调 (toolCalls) => void
 * @param {function} options.onToolResult - 工具结果回调 (toolResult) => void
 * @param {function} [options.onUsage] - Token 使用回调 (usage) => void
 * @returns {Promise<object>} 执行结果 { content, toolCalls }
 */
export async function executeStreamWithToolLoop(llmClient, modelConfig, messages, tools, options = {}) {
  const {
    maxToolRounds = 5,
    executeTool,
    toolContext = {},
    onDelta,
    onToolCall,
    onToolResult,
    onUsage,
  } = options;

  let fullContent = '';
  const allToolCalls = [];

  for (let round = 0; round < maxToolRounds; round++) {
    let collectedToolCalls = [];
    let roundContent = '';

    logger.info(`[ToolCallingExecutor] 第${round + 1}轮流式调用 LLM...`);

    // 流式调用 LLM
    await llmClient.callStream(
      modelConfig,
      messages,
      {
        tools,
        onDelta: (delta) => {
          roundContent += delta;
          fullContent += delta;
          if (onDelta) {
            onDelta(delta);
          }
        },
        onToolCall: (toolCalls) => {
          logger.info(`[ToolCallingExecutor] 工具调用:`, toolCalls?.length || 0);
          collectedToolCalls.push(...(Array.isArray(toolCalls) ? toolCalls : [toolCalls]));

          if (onToolCall) {
            onToolCall(toolCalls);
          }
        },
        onUsage: (usage) => {
          if (onUsage) {
            onUsage(usage);
          }
        },
      }
    );

    // 如果没有工具调用，退出循环
    if (collectedToolCalls.length === 0) {
      logger.info(`[ToolCallingExecutor] 第${round + 1}轮无工具调用，完成`);
      break;
    }

    logger.info(`[ToolCallingExecutor] 第${round + 1}轮开始执行工具调用:`, collectedToolCalls.length);

    // 执行工具调用
    const toolResults = await executeTool(collectedToolCalls, toolContext);

    // 发送工具结果
    for (const toolResult of toolResults) {
      if (onToolResult) {
        onToolResult(toolResult);
      }
    }

    // 将工具调用和结果添加到消息历史
    for (let i = 0; i < collectedToolCalls.length; i++) {
      const toolCall = collectedToolCalls[i];
      const toolResult = toolResults[i];

      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [toolCall],
      });

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.function?.name || toolCall.name,
        content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
      });

      allToolCalls.push({
        tool_id: toolCall.function?.name || toolCall.name,
        result: toolResult,
      });
    }
  }

  return {
    content: fullContent,
    toolCalls: allToolCalls,
  };
}

export default {
  executeWithToolLoop,
  executeStreamWithToolLoop,
};