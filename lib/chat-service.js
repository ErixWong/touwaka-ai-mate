/**
 * Chat Service - 对话服务（V1 UI 版）
 * 将 ExpertInstance 的核心逻辑重构为可复用的服务类
 * 
 * 适配 V1 UI 架构：
 * - 支持 Topic-based 对话组织
 * - 支持 SSE 流式响应
 * - 集成现有 lib/ 工具库
 * 
 * 使用 Sequelize ORM 进行数据库操作
 */

import ConfigLoader from './config-loader.js';
import LLMClient from './llm-client.js';
import MemorySystem from './memory-system.js';
import ContextManager from './context-manager.js';
import ReflectiveMind from './reflective-mind.js';
import ToolManager from './tool-manager.js';
import TopicDetector from './topic-detector.js';
import RAGService from './rag-service.js';
import InternalLLMService from './internal-llm-service.js';
import { MinimalContextOrganizer } from './context-organizer/minimal-organizer.js';
import logger from './logger.js';
import Utils from './utils.js';
import { getSystemSettingService } from '../server/services/system-setting.service.js';

class ChatService {
  /**
   * @param {Database} db - 数据库实例
   * @param {object} options - 可选参数
   * @param {object} options.assistantManager - AssistantManager 实例
   */
  constructor(db, options = {}) {
    this.db = db;
    this.assistantManager = options.assistantManager || null;
    this.Message = db.getModel('message');
    this.Topic = db.getModel('topic');
    this.AiModel = db.getModel('ai_model');
    this.Provider = db.getModel('provider');
    this.Task = db.getModel('task');
    
    // 服务实例缓存（按 expertId）
    this.expertServices = new Map();
    
    // 活跃对话缓存（按 topicId）
    this.activeChats = new Map();
    
    // LLM Payload 缓存（按 user_id:expert_id 存储，仅用于用户对话调试）
    // 不存入数据库，服务重启后丢失
    this.llmPayloadCache = new Map();
  }

  /**
   * 保存 LLM Payload 到缓存
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @param {Object} payload - LLM 请求 payload
   */
  saveLLMPayload(user_id, expert_id, payload) {
    const cacheKey = `${user_id}:${expert_id}`;
    this.llmPayloadCache.set(cacheKey, {
      ...payload,
      cached_at: new Date().toISOString(),
    });
    logger.debug(`[ChatService] LLM Payload 已缓存: ${cacheKey}`);
  }

  /**
   * 获取最近一次 LLM Payload
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @returns {Object|null} LLM Payload 或 null
   */
  getLLMPayload(user_id, expert_id) {
    const cacheKey = `${user_id}:${expert_id}`;
    return this.llmPayloadCache.get(cacheKey) || null;
  }

  /**
   * 清除专家服务缓存
   * 当专家配置更新时调用，确保下次对话使用最新配置
   * @param {string} expertId - 专家ID（可选，不传则清除所有）
   */
  clearExpertCache(expertId = null) {
    if (expertId) {
      const service = this.expertServices.get(expertId);
      if (service && service.configLoader) {
        service.configLoader.clearCache(expertId);
      }
      this.expertServices.delete(expertId);
      logger.info(`[ChatService] 专家服务缓存已清除: ${expertId}`);
    } else {
      // 清除所有
      for (const [id, service] of this.expertServices) {
        if (service && service.configLoader) {
          service.configLoader.clearCache(id);
        }
      }
      this.expertServices.clear();
      logger.info('[ChatService] 所有专家服务缓存已清除');
    }
  }

  /**
   * 获取或创建专家服务实例
   * @param {string} expertId - 专家ID
   * @returns {Promise<ExpertChatService>}
   */
  async getExpertService(expertId) {
    if (this.expertServices.has(expertId)) {
      logger.debug(`[ChatService] 使用缓存的专家服务: ${expertId}`);
      return this.expertServices.get(expertId);
    }

    logger.info(`[ChatService] 创建新的专家服务实例: ${expertId}`);
    const service = new ExpertChatService(this.db, expertId, { assistantManager: this.assistantManager });
    await service.initialize();

    this.expertServices.set(expertId, service);
    logger.info(`[ChatService] 专家服务实例已缓存: ${expertId}, 技能数: ${service.toolManager?.skills?.size || 0}`);
    return service;
  }

  /**
   * 准备任务上下文（私有方法）
   * 根据不同的模式（任务模式、技能模式、对话模式）构建相应的任务上下文
   * @param {object} params - 参数
   * @returns {Promise<object|null>} 任务上下文对象
   */
  async _prepareTaskContext({ task_id, user_id, working_path, session }) {
    if (task_id) {
      // 任务模式：根据 task_id 获取任务工作目录
      const taskContext = await this.getTaskContext(task_id, user_id, working_path, session);
      if (taskContext) {
        logger.info('[ChatService] 任务上下文已加载:', taskContext.title, '路径:', working_path || '根目录');
      }
      return taskContext;
    } else if (working_path) {
      // 技能模式：没有 task_id 但有 working_path（技能目录路径）
      logger.info('[ChatService] 技能模式工作目录:', working_path);
      return {
        fullWorkspacePath: working_path,
        currentPath: '',
        isAdmin: session?.isAdmin || false,
        isSkillCreator: session?.roles?.includes('creator') || false,
      };
    } else {
      // 对话模式：使用用户临时目录作为工作目录
      logger.info('[ChatService] 对话模式工作目录: work/' + user_id + '/temp');
      return {
        fullWorkspacePath: `work/${user_id}/temp`,
        currentPath: '',
        isAdmin: session?.isAdmin || false,
        isSkillCreator: session?.roles?.includes('creator') || false,
      };
    }
  }

  /**
   * 执行多轮 LLM 调用（私有方法）
   * 支持流式响应和多轮工具调用
   * @returns {Promise<object>} LLM 调用结果
   */
  async _executeLLMRounds(expertService, { modelConfig, thinkingConfig, tools, currentMessages, llmPayload, user_id, expert_id, taskContext, topic_id, task_id, session, onDelta }) {
    const systemSettingService = getSystemSettingService(this.db);
    const MAX_TOOL_ROUNDS = expertService.expertConfig?.expert?.max_tool_rounds
      || await systemSettingService.getMaxToolRounds();

    let fullContent = '';
    let fullReasoningContent = '';
    let tokenUsage = null;
    let allToolCalls = [];
    let messages = [...currentMessages];

    // 更新 payload 基础信息
    llmPayload.model = modelConfig.model_name;
    llmPayload.temperature = expertService.llmClient.getExpertLLMParams().temperature;
    llmPayload.top_p = expertService.llmClient.getExpertLLMParams().top_p;
    llmPayload.frequency_penalty = expertService.llmClient.getExpertLLMParams().frequency_penalty;
    llmPayload.presence_penalty = expertService.llmClient.getExpertLLMParams().presence_penalty;
    llmPayload.max_tokens = modelConfig.max_output_tokens || 32768;
    if (tools.length > 0) llmPayload.tools = tools;

    logger.info('[ChatService] 开始调用 LLM，当前消息数:', messages.length);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let collectedToolCalls = [];
      let roundContent = '';

      logger.info('[ChatService] 第', round + 1, '轮调用 LLM...');

      // 流式调用
      await expertService.llmClient.callStream(modelConfig, messages, {
        tools,
        thinking: thinkingConfig.thinking,
        reasoning: thinkingConfig.reasoning,
        onDelta: (delta) => {
          roundContent += delta;
          fullContent += delta;
          onDelta?.({ type: 'delta', content: delta });
        },
        onReasoningDelta: (reasoningDelta) => {
          fullReasoningContent += reasoningDelta;
          onDelta?.({ type: 'reasoning_delta', content: reasoningDelta });
        },
        onToolCall: (toolCalls) => {
          const toolCallsForLog = Array.isArray(toolCalls) ? toolCalls : [toolCalls];
          const displayNames = toolCallsForLog.map(call => {
            const toolId = call.function?.name || call.name;
            return expertService.toolManager.formatToolDisplay(toolId);
          });
          logger.info(`[ChatService] 第${round + 1}轮收到工具调用:`, displayNames);

          if (Array.isArray(toolCalls)) {
            collectedToolCalls.push(...toolCalls);
          } else {
            collectedToolCalls.push(toolCalls);
          }

          const toolCallsWithDisplayNames = toolCallsForLog.map(call => {
            const toolId = call.function?.name || call.name;
            return { ...call, displayName: expertService.toolManager.formatToolDisplay(toolId) };
          });
          onDelta?.({ type: 'tool_call', toolCalls: toolCallsWithDisplayNames });
        },
        onUsage: (usage) => {
          if (usage) {
            if (!tokenUsage) {
              tokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
            }
            tokenUsage.prompt_tokens += usage.prompt_tokens || 0;
            tokenUsage.completion_tokens += usage.completion_tokens || 0;
            tokenUsage.total_tokens += usage.total_tokens || 0;
            logger.info(`[ChatService] 第${round + 1}轮 token 使用:`, {
              prompt: usage.prompt_tokens,
              completion: usage.completion_tokens,
              total: usage.total_tokens,
            });
          }
        },
      });

      // 如果没有工具调用，退出循环
      if (collectedToolCalls.length === 0) {
        logger.info(`[ChatService] 第${round + 1}轮无工具调用，完成`);
        if (roundContent) {
          messages = [...messages, { role: 'assistant', content: roundContent }];
          llmPayload.messages = messages;
          llmPayload._debug.context_messages_count = messages.length;
          llmPayload.cached_at = new Date().toISOString();
          this.saveLLMPayload(user_id, expert_id, llmPayload);
        }
        break;
      }

      logger.info(`[ChatService] 第${round + 1}轮开始执行工具调用:`, collectedToolCalls.length);

      // 执行工具
      const toolResults = await this._executeTools(expertService, {
        collectedToolCalls,
        user_id,
        taskContext,
        topic_id,
        task_id,
        session,
        expert_id,
        onDelta
      });

      // 合并工具调用和执行结果
      const toolCallsWithResults = collectedToolCalls.map((call, index) => {
        const result = toolResults[index];
        return {
          ...call,
          result: result ? { success: result.success, data: result.data, error: result.error } : null,
          duration: result?.duration || 0,
          timestamp: new Date().toISOString(),
        };
      });
      allToolCalls.push(...toolCallsWithResults);

      // 更新消息历史
      messages = [
        ...messages,
        { role: 'assistant', content: roundContent || null, tool_calls: collectedToolCalls },
        ...expertService.toolManager.formatToolResultsForLLM(toolResults),
      ];

      // 同步更新 LLM Payload 缓存
      llmPayload.messages = messages;
      llmPayload._debug.context_messages_count = messages.length;
      llmPayload.cached_at = new Date().toISOString();
      this.saveLLMPayload(user_id, expert_id, llmPayload);

      if (round + 1 >= MAX_TOOL_ROUNDS) {
        logger.warn('[ChatService] 达到最大工具调用轮数，下一轮将强制返回文本');
      }
    }

    // 如果 LLM 没有返回任何内容，生成默认回复
    if (!fullContent || fullContent.trim() === '') {
      logger.warn('[ChatService] LLM 未返回内容，生成默认回复');
      fullContent = '我已处理您的请求，但没有生成具体的回复内容。';
    }

    return { fullContent, fullReasoningContent, tokenUsage, allToolCalls, finalMessages: messages };
  }

  /**
   * 执行工具调用（私有方法）
   * @returns {Promise<Array>} 工具执行结果数组
   */
  async _executeTools(expertService, { collectedToolCalls, user_id, taskContext, topic_id, task_id, session, expert_id, onDelta }) {
    return await expertService.handleToolCalls(
      collectedToolCalls,
      user_id,
      session?.accessToken,
      taskContext,
      topic_id,
      async (toolResult) => {
        logger.info(`[ChatService] 工具执行完成: ${toolResult.toolName}, 成功: ${toolResult.success}`);
        const originalCall = collectedToolCalls.find(c => c.id === toolResult.toolCallId);
        if (originalCall?.context) {
          toolResult.context = originalCall.context;
        }
        await this.saveToolMessage(topic_id, user_id, toolResult, expert_id, task_id);
        onDelta?.({ type: 'tool_result', result: toolResult });
      },
      session
    );
  }

  /**
   * 处理流式聊天请求（SSE）
   * topic_id 可选，如果不提供则自动获取或创建活跃对话
   * @param {object} params - 参数
   * @param {string} params.topic_id - 话题ID（可选）
   * @param {string} params.user_id - 用户ID
   * @param {string} params.expert_id - 专家ID
   * @param {string} params.content - 用户消息内容
   * @param {string} params.model_id - 模型ID（可选，覆盖专家默认配置）
   * @param {string} params.task_id - 任务ID（可选，任务工作空间模式）
   * @param {string} params.working_path - 当前工作目录路径（可选，任务模式下的浏览路径或技能目录路径）
   * @param {Function} onDelta - 流式数据回调 (delta: string) => void
   * @param {Function} onComplete - 完成回调 (result: object) => void
   * @param {Function} onError - 错误回调 (error: Error) => void
   */
  async streamChat(params, onDelta, onComplete, onError) {
    const { topic_id: providedTopicId, user_id, expert_id, content, model_id, task_id, working_path, session } = params;

    try {
      logger.info('[ChatService] 开始流式聊天:', { expert_id, user_id, topic_id: providedTopicId, task_id, working_path });

      // 1. 获取专家服务
      const expertService = await this.getExpertService(expert_id);
      logger.debug('[ChatService] 专家服务获取完成');

      // 2. 准备任务上下文
      const taskContext = await this._prepareTaskContext({ task_id, user_id, working_path, session });

      // 3. 获取或创建活跃对话
      let topic_id = providedTopicId;
      let isNewTopic = false;
      if (!topic_id) {
        topic_id = await this.getOrCreateActiveTopic(user_id, expert_id, task_id);
        isNewTopic = true;
      }
      logger.debug('[ChatService] Topic ID:', topic_id, isNewTopic ? '(新话题)' : '(继续当前话题)');

      // 4. 发送开始事件
      onDelta?.({ type: 'start', message_id: `msg_${Utils.newID(10)}`, topic_id, is_new_topic: isNewTopic });

      // 5. 保存用户消息
      const userMessageId = await this.saveUserMessage(topic_id, user_id, content, expert_id, task_id);
      logger.debug('[ChatService] 用户消息已保存:', userMessageId);

      // 6. 检查是否需要压缩上下文
      const compressionCheck = await expertService.memorySystem.shouldCompressContext(
        user_id,
        expertService.getDefaultModelConfig().max_tokens || 128000,
        expertService.expertConfig?.expert?.context_threshold || 0.7,
        5,
        50
      );

      if (compressionCheck.needCompress) {
        logger.info(`[ChatService] 触发上下文压缩: ${compressionCheck.reason}`);
        const compressResult = await expertService.memorySystem.compressContext(user_id, {
          contextSize: expertService.getDefaultModelConfig().max_tokens || 128000,
          threshold: expertService.expertConfig?.expert?.context_threshold || 0.7,
          minMessages: 5,
        });
        if (compressResult.success && compressResult.topicsCreated > 0) {
          onDelta?.({ type: 'topic_updated', topicsCreated: compressResult.topicsCreated });
        }
      }

      // 7. 构建上下文
      logger.debug('[ChatService] 开始构建上下文...');
      const context = await expertService.buildContext(user_id, content, topic_id, taskContext);
      logger.debug('[ChatService] 上下文构建完成, 消息数:', context.messages?.length);

      // 8. 准备 LLM 调用配置
      const startTime = Date.now();
      const modelConfig = model_id
        ? await this.getModelConfig(model_id)
        : expertService.getDefaultModelConfig();

      logger.info('[ChatService] 使用模型:', {
        model_name: modelConfig.model_name,
        base_url: modelConfig.base_url,
        has_api_key: !!modelConfig.api_key,
      });

      const thinkingConfig = expertService.getThinkingConfig(modelConfig);
      if (thinkingConfig.thinking || thinkingConfig.reasoning) {
        logger.info('[ChatService] 思考模式配置:', thinkingConfig);
      }

      const tools = expertService.toolManager.getToolDefinitions();
      logger.info('[ChatService] 工具定义:', { tools_count: tools.length, has_tools: tools.length > 0 });

      // 构建 LLM Payload
      const llmPayload = {
        model: modelConfig.model_name,
        messages: context.messages,
        stream: true,
        stream_options: { include_usage: true },
        _debug: {
          model_config: {
            provider_name: modelConfig.provider_name,
            base_url: modelConfig.base_url,
            max_tokens: modelConfig.max_tokens,
            max_output_tokens: modelConfig.max_output_tokens,
          },
          context_messages_count: context.messages.length,
          tools_count: tools.length,
        },
      };
      this.saveLLMPayload(user_id, expert_id, llmPayload);

      // 9. 执行多轮 LLM 调用
      const llmResult = await this._executeLLMRounds(expertService, {
        modelConfig,
        thinkingConfig,
        tools,
        currentMessages: context.messages,
        llmPayload,
        user_id,
        expert_id,
        taskContext,
        topic_id,
        task_id,
        session,
        onDelta
      });

      const { fullContent, fullReasoningContent, tokenUsage } = llmResult;
      const latency = Date.now() - startTime;

      // 10. 保存助手消息
      const messageOptions = {
        prompt_tokens: tokenUsage?.prompt_tokens || 0,
        completion_tokens: tokenUsage?.completion_tokens || 0,
        latency_ms: latency,
        model_name: modelConfig.model_name,
        provider_name: modelConfig.provider_name,
        expert_id,
        reasoning_content: fullReasoningContent || null,
        task_id,
      };

      const assistantMessageId = await this.saveAssistantMessage(topic_id, user_id, fullContent, messageOptions);

      // 11. 异步执行反思和历史归档
      expertService.performReflection(user_id, content, fullContent, topic_id).catch(err => {
        logger.error('[ChatService] 反思失败:', err.message);
      });

      expertService.processHistoryIfNeeded(user_id, topic_id).catch(err => {
        logger.error('[ChatService] 历史归档失败:', err.message);
      });

      // 12. 更新话题时间
      await this.updateTopicTimestamp(topic_id);

      // 13. 发送完成事件
      onComplete?.({
        type: 'complete',
        message_id: assistantMessageId,
        content: fullContent,
        reasoning_content: fullReasoningContent || null,
        usage: tokenUsage ? {
          prompt_tokens: tokenUsage.prompt_tokens,
          completion_tokens: tokenUsage.completion_tokens,
          total_tokens: tokenUsage.total_tokens,
        } : null,
        latency,
        model: modelConfig.model_name,
      });

    } catch (error) {
      logger.error('[ChatService] 流式聊天失败:', error.message);
      onError?.(error);
    }
  }

  /**
   * 处理非流式聊天请求
   * @param {object} params - 参数
   * @returns {Promise<object>} 响应结果
   */
  async chat(params) {
    const { topic_id, user_id, expert_id, content, model_id, task_id, working_path, session } = params;

    try {
      // 1. 获取专家服务
      const expertService = await this.getExpertService(expert_id);

      // 2. 获取任务上下文（如果在任务工作空间模式下）
      let taskContext = null;
      if (task_id) {
        taskContext = await this.getTaskContext(task_id, user_id, working_path, session);
      }

      // 3. 保存用户消息（topic_id = NULL，未归档状态）
      await this.saveUserMessage(topic_id, user_id, content, expert_id);

      // 4. 构建上下文
      const context = await expertService.buildContext(user_id, content, topic_id, taskContext);

      // 5. 获取工具定义
      const tools = expertService.toolManager.getToolDefinitions();

      // 6. 调用 LLM
      const startTime = Date.now();
      const modelConfig = model_id
        ? await this.getModelConfig(model_id)
        : expertService.getDefaultModelConfig();

      let response;
      let toolCalls = null;
      let allToolCalls = [];  // 收集所有工具调用信息

      if (tools.length > 0) {
        // 支持工具调用
        const llmResponse = await expertService.llmClient.call(modelConfig, context.messages, { tools });

        if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
          // 执行工具调用，并保存每条工具消息
          toolCalls = await expertService.handleToolCalls(
            llmResponse.toolCalls,
            user_id,
            session?.accessToken,  // 从 session 中获取 accessToken
            taskContext,
            null,  // topic_id（非流式不需要）
            // 实时回调：每执行完一个工具就保存消息
            async (toolResult) => {
              logger.info(`[ChatService.chat] 工具执行完成: ${toolResult.toolName}, 成功: ${toolResult.success}`);
              // 关联 context（从原始 toolCall 中获取）
              const originalCall = llmResponse.toolCalls.find(c => c.id === toolResult.toolCallId);
              if (originalCall?.context) {
                toolResult.context = originalCall.context;
              }
              // 保存工具消息到数据库
              await this.saveToolMessage(topic_id, user_id, toolResult, expert_id);
            },
            session  // 直接传递 session 对象
          );

          // 构建工具调用信息（用于存储）
          const toolCallsWithResults = llmResponse.toolCalls.map((call, index) => {
            const result = toolCalls[index];
            return {
              ...call,
              result: result ? {
                success: result.success,
                data: result.data,
                error: result.error,
              } : null,
              duration: result?.duration || 0,
              timestamp: new Date().toISOString(),
            };
          });
          allToolCalls = toolCallsWithResults;

          // 将工具结果发回 LLM 生成最终回复
          const followUpMessages = [
            ...context.messages,
            { role: 'assistant', content: llmResponse.content, tool_calls: llmResponse.toolCalls },
            ...expertService.toolManager.formatToolResultsForLLM(toolCalls),
          ];

          const finalResponse = await expertService.llmClient.call(modelConfig, followUpMessages);
          response = finalResponse.content;
        } else {
          response = llmResponse.content;
        }
      } else {
        // 不支持工具调用
        const llmResponse = await expertService.llmClient.call(modelConfig, context.messages);
        response = llmResponse.content;
      }

      const latency = Date.now() - startTime;

      // 7. 保存助手消息
      // 注意：工具调用信息不再存储在 assistant 消息中，而是存储在独立的 tool 消息中
      const messageOptions = {
        prompt_tokens: 0,  // 非流式调用无法获取精确值
        completion_tokens: Math.ceil(response.length / 4),  // 估算值
        latency_ms: latency,
        model_name: modelConfig.model_name,
        provider_name: modelConfig.provider_name,
        expert_id,
      };

      const assistantMessageId = await this.saveAssistantMessage(
        topic_id,
        user_id,
        response,
        messageOptions
      );

      // 8. 异步执行反思
      expertService.performReflection(user_id, content, response, topic_id).catch(err => {
        logger.error('[ChatService] 反思失败:', err.message);
      });

      // 9. 更新话题时间
      await this.updateTopicTimestamp(topic_id);

      return {
        success: true,
        message_id: assistantMessageId,
        content: response,
        latency,
        model: modelConfig.model_name,
        tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };

    } catch (error) {
      logger.error('[ChatService] 聊天失败:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 保存用户消息
   * 新消息的 topic_id 为 NULL（未归档状态），压缩时再分配 topic_id
   * @param {string} topic_id - 话题ID
   * @param {string} user_id - 用户ID
   * @param {string} content - 消息内容
   * @param {string} expert_id - 专家ID（可选）
   */
  async saveUserMessage(topic_id, user_id, content, expert_id = null) {
    const message_id = Utils.newID(20);

    // 处理多模态内容，过滤无效的图片 URL
    let contentToStore = content;
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content);
        if (parsed.type === 'multimodal' && Array.isArray(parsed.content)) {
          // 过滤无效的图片 URL
          const validContent = parsed.content.filter(item => {
            if (item.type === 'image_url' && item.image_url?.url) {
              const url = item.image_url.url;
              // 跳过 base64 和占位符
              if (url.startsWith('data:') || url === '[图片]') {
                return false;
              }
            }
            return true;
          });
          contentToStore = JSON.stringify({ type: 'multimodal', content: validContent });
        }
      } catch (e) {
        // 不是 JSON 格式，保持原样
      }
    }

    await this.Message.create({
      id: message_id,
      topic_id: null,  // 新消息不分配 topic_id，压缩时再分配
      user_id,
      expert_id,
      role: 'user',
      content: contentToStore,
    });

    // 通过 topic_id 检查是否有关联的任务，自动更新 last_executed_at
    await this.updateTaskLastExecutedByTopic(topic_id);

    // 注意：不再更新 Topic 消息计数，因为消息尚未归档到任何 Topic

    return message_id;
  }

  /**
   * 保存助手消息
   * 新消息的 topic_id 为 NULL（未归档状态），压缩时再分配 topic_id
   * @param {string} topic_id - 话题ID
   * @param {string} user_id - 用户ID
   * @param {string} content - 消息内容
   * @param {object} options - 可选参数
   * @param {string} options.task_id - 任务ID（可选，用于更新任务的 last_executed_at）
   */
  async saveAssistantMessage(topic_id, user_id, content, options = {}) {
    const message_id = Utils.newID(20);
    const {
      prompt_tokens = 0,
      completion_tokens = 0,
      latency_ms = 0,
      model_name = '',
      provider_name = '',
      tool_calls = null,
      expert_id = null,
      reasoning_content = null,  // 思考过程内容（DeepSeek）
      task_id = null,  // 任务ID
    } = options;

    await this.Message.create({
      id: message_id,
      topic_id: null,  // 新消息不分配 topic_id，压缩时再分配
      user_id,
      expert_id,
      role: 'assistant',
      content,
      reasoning_content,  // 保存思考过程
      prompt_tokens,
      completion_tokens,
      latency_ms,
      model_name,
      provider_name,
      tool_calls,
    });

    // 如果有关联的任务，更新任务的 last_executed_at
    if (task_id) {
      await this.updateTaskLastExecuted(task_id);
    }

    // 注意：不再更新 Topic 消息计数，因为消息尚未归档到任何 Topic

    return message_id;
  }

  /**
   * 保存工具消息
   * 每个工具调用完成后立即保存，实现增量持久化
   *
   * 设计原则（Issue #325 优化）：
   * - 当结果超过阈值时：content 存摘要，tool_calls.result 存完整结果
   * - 当结果不超过阈值时：content 直接存完整结果
   * - 上下文构建时使用摘要，减少 token 消耗
   * - 通过 message-reader 技能可召回完整结果
   *
   * @param {string} topic_id - 话题ID（用于关联，但消息 topic_id 为 NULL）
   * @param {string} user_id - 用户ID
   * @param {object} toolResult - 工具执行结果
   * @param {string} expert_id - 专家ID（可选）
   * @param {string} task_id - 任务ID（可选，用于更新任务的 last_executed_at）
   * @returns {Promise<string>} 消息ID
   */
  async saveToolMessage(topic_id, user_id, toolResult, expert_id = null, task_id = null) {
    const message_id = Utils.newID(20);

    // 工具结果摘要阈值（字符数）
    // 超过此阈值时，content 存摘要，完整结果存 tool_calls.result
    const SUMMARY_THRESHOLD = 500;

    // 获取完整结果
    let fullResult = '';
    if (toolResult.data !== undefined) {
      fullResult = typeof toolResult.data === 'string'
        ? toolResult.data
        : JSON.stringify(toolResult.data);
    } else if (toolResult.error) {
      fullResult = toolResult.error;
    }

    const resultLength = fullResult.length;
    const isSuccess = toolResult.success;

    // 构建 tool_calls 字段内容
    // 格式: { tool_call_id, name, arguments, success, duration, timestamp, context, result_length, result? }
    const toolCallsData = {
      tool_call_id: toolResult.toolCallId,
      name: toolResult.toolName,
      arguments: toolResult.arguments || null,
      success: isSuccess,
      duration: toolResult.duration || 0,
      timestamp: new Date().toISOString(),
      context: toolResult.context || null,
      result_length: resultLength,  // 新增：结果长度
    };

    // 根据阈值决定存储策略
    let content;
    if (resultLength > SUMMARY_THRESHOLD) {
      // 超过阈值：content 存摘要，完整结果存 tool_calls.result
      content = this.buildToolResultSummary(message_id, toolResult.toolName, resultLength, isSuccess);
      toolCallsData.result = fullResult;  // 完整结果存入 tool_calls
      logger.info(`[ChatService] 工具结果超过阈值(${SUMMARY_THRESHOLD})，使用摘要模式: ${toolResult.toolName}, result_length: ${resultLength}`);
    } else {
      // 不超过阈值：content 直接存完整结果
      content = fullResult;
      logger.debug(`[ChatService] 工具结果未超过阈值，直接存储: ${toolResult.toolName}, result_length: ${resultLength}`);
    }

    await this.Message.create({
      id: message_id,
      topic_id: null,  // 新消息不分配 topic_id，压缩时再分配
      user_id,
      expert_id,
      role: 'tool',
      content,  // 摘要或完整结果
      tool_calls: JSON.stringify(toolCallsData),  // 工具元数据（含完整 result）
    });

    // 如果有关联的任务，更新任务的 last_executed_at
    if (task_id) {
      await this.updateTaskLastExecuted(task_id);
    }

    logger.debug(`[ChatService] 工具消息已保存: ${toolResult.toolName}, message_id: ${message_id}, content_length: ${content.length}, is_summary: ${resultLength > SUMMARY_THRESHOLD}`);
    return message_id;
  }

  /**
   * 构建工具结果摘要
   * @param {string} messageId - 消息ID（用于召回）
   * @param {string} toolName - 工具名称
   * @param {number} resultLength - 结果长度
   * @param {boolean} isSuccess - 是否成功
   * @returns {string} 摘要文本
   */
  buildToolResultSummary(messageId, toolName, resultLength, isSuccess) {
    const status = isSuccess ? '成功' : '失败';
    return `工具: ${toolName}
结果: ${resultLength} 字符 | ${status}
→ 调用 recall({ message_id: "${messageId}" }) 获取完整结果`;
  }

  /**
   * 更新话题时间戳
   */
  async updateTopicTimestamp(topic_id) {
    await this.Topic.update(
      { updated_at: new Date() },
      { where: { id: topic_id } }
    );
  }

  /**
   * 更新任务的 last_executed_at 并设置状态为 autonomous_wait
   * 当任务有关的消息（用户消息、助手消息、工具消息）保存时调用
   *
   * 状态转换说明：
   * - 只有在自主运行状态（autonomous/autonomous_wait/autonomous_working）时才更新为 autonomous_wait
   * - active 状态的任务保持 active，只更新 last_executed_at
   * - autonomous_wait 表示 LLM 处理完毕，等待中，可以响应新消息
   * - 自主任务执行器会在开始执行时将状态设为 autonomous_working
   *
   * @param {string} task_id - 任务ID
   */
  async updateTaskLastExecuted(task_id) {
    if (!task_id) return;
    
    try {
      if (!this.Task) {
        this.Task = this.db.getModel('task');
      }
      
      // 先获取当前任务状态
      const task = await this.Task.findByPk(task_id, { raw: true });
      if (!task) {
        logger.warn(`[ChatService] 任务不存在: ${task_id}`);
        return;
      }
      
      // 只有在自主运行相关状态时才更新为 autonomous_wait
      const autonomousStatuses = ['autonomous_wait', 'autonomous_working'];
      if (!autonomousStatuses.includes(task.status)) {
        // 非自主运行状态（如 active），只更新 last_executed_at，不改变状态
        await this.Task.update(
          { last_executed_at: new Date() },
          { where: { id: task_id } }
        );
        logger.debug(`[ChatService] 任务 last_executed_at 已更新（状态保持 ${task.status}）: ${task_id}`);
        return;
      }
      
      // 自主运行状态，更新 last_executed_at 并设为 autonomous_wait
      // 这样自主任务执行器就知道 LLM 已处理完毕，可以响应新消息
      await this.Task.update(
        {
          last_executed_at: new Date(),
          status: 'autonomous_wait',  // EOF 时设为等待状态
        },
        { where: { id: task_id } }
      );
      logger.debug(`[ChatService] 任务状态已更新为 autonomous_wait: ${task_id}`);
    } catch (error) {
      logger.warn(`[ChatService] 更新任务状态失败: ${error.message}`);
    }
  }

  /**
   * 通过 topic_id 更新关联任务的 last_executed_at
   * 当话题关联了任务时，自动更新任务状态
   * @param {string} topic_id - 话题ID
   */
  async updateTaskLastExecutedByTopic(topic_id) {
    if (!topic_id) return;
    
    try {
      // 查找话题关联的任务
      const topic = await this.Topic.findByPk(topic_id, { raw: true });
      if (topic?.task_id) {
        // 复用 updateTaskLastExecuted 方法，避免代码重复
        await this.updateTaskLastExecuted(topic.task_id);
        logger.debug(`[ChatService] 通过话题更新任务状态: topic=${topic_id}, task=${topic.task_id}`);
      }
    } catch (error) {
      logger.warn(`[ChatService] 通过话题更新任务状态失败: ${error.message}`);
    }
  }

  /**
   * 增加话题消息计数
   */
  async incrementTopicMessageCount(topic_id) {
    try {
      // 使用 SQL 原子操作增加计数
      await this.Topic.increment('message_count', { by: 1, where: { id: topic_id } });
    } catch (error) {
      // 计数更新失败不应影响主流程，仅记录日志
      logger.warn(`[ChatService] 更新话题消息计数失败: topic=${topic_id}, error=${error.message}`);
    }
  }

  /**
   * 获取或创建活跃对话
   * Topic 完全由后端管理，前端不需要关心 topic_id
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @param {string} task_id - 任务ID（可选，任务工作空间模式）
   * @returns {Promise<string>} topic_id
   */
  async getOrCreateActiveTopic(user_id, expert_id, task_id = null) {
    // 1. 查找用户与该专家的最近活跃对话
    // 如果在任务模式下，只查找同一任务的对话
    const whereClause = {
      user_id,
      expert_id,
      status: 'active',
    };
    
    // 如果有 task_id，则只查找同一任务的对话
    if (task_id) {
      whereClause.task_id = task_id;
    }

    const recentTopic = await this.Topic.findOne({
      where: whereClause,
      order: [['updated_at', 'DESC']],
      raw: true,
    });

    if (recentTopic) {
      logger.debug(`[ChatService] 使用现有对话: ${recentTopic.id}`);
      return recentTopic.id;
    }

    // 2. 创建新对话（给一个默认标题，后续由反思总结更新）
    return await this.createNewTopic(user_id, expert_id, null, task_id);
  }

  /**
   * 创建新话题
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @param {string} title - 话题标题（可选，默认使用时间戳）
   * @param {string} task_id - 任务ID（可选，任务工作空间模式）
   * @returns {Promise<string>} topic_id
   */
  async createNewTopic(user_id, expert_id, title = null, task_id = null) {
    const topic_id = Utils.newID(20);
    const defaultTitle = title || `新对话 ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

    await this.Topic.create({
      id: topic_id,
      user_id,
      expert_id,
      title: defaultTitle,
      status: 'active',
      message_count: 0,
      task_id,  // 关联任务ID（如果有）
    });

    logger.info(`[ChatService] 创建新对话: ${topic_id}, 标题: ${defaultTitle}${task_id ? `, 任务: ${task_id}` : ''}`);
    return topic_id;
  }

  /**
   * 结束当前话题（将状态改为 archived）
   * @param {string} topic_id - 话题ID
   */
  async endTopic(topic_id) {
    await this.Topic.update(
      { status: 'archived' },
      { where: { id: topic_id } }
    );
    logger.info(`[ChatService] 话题已结束: ${topic_id}`);
  }

  /**
   * 检测并处理话题切换
   * 如果检测到话题切换，将当前话题归档并创建新话题
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @param {string} newMessage - 用户新消息
   * @param {ExpertChatService} expertService - 专家服务实例
   * @returns {Promise<{topic_id: string, isNewTopic: boolean}>}
   */
  async checkAndHandleTopicShift(user_id, expert_id, newMessage, expertService) {
    // 1. 获取当前活跃话题
    const currentTopic = await this.Topic.findOne({
      where: {
        user_id,
        expert_id,
        status: 'active',
      },
      order: [['updated_at', 'DESC']],
      raw: true,
    });

    // 如果没有活跃话题，创建新话题
    if (!currentTopic) {
      logger.info('[ChatService] 没有活跃话题，创建新话题');
      const topic_id = await this.createNewTopic(user_id, expert_id);
      return { topic_id, isNewTopic: true };
    }

    // 2. 获取当前话题的最近消息
    const recentMessages = await this.Message.findAll({
      where: { topic_id: currentTopic.id },
      attributes: ['role', 'content'],
      order: [['created_at', 'DESC']],
      limit: 10,
      raw: true,
    });

    // 消息数不足，直接继续使用当前话题
    if (recentMessages.length < 6) {
      logger.debug('[ChatService] 消息数不足，继续使用当前话题');
      return { topic_id: currentTopic.id, isNewTopic: false };
    }

    // 3. 使用 TopicDetector 检测是否需要切换话题
    // 使用 InternalLLMService 进行检测（不依赖专家人设）
    const internalLLM = new InternalLLMService(this.db);
    const topicDetector = new TopicDetector(internalLLM, { expertId: expert_id });
    const detectionResult = await topicDetector.detectTopicShift({
      currentTopicTitle: currentTopic.title,
      currentTopicDescription: currentTopic.description,
      recentMessages: recentMessages.reverse(), // 转为正序
      newMessage,
    });

    // 4. 根据检测结果处理
    if (detectionResult.shouldSwitch) {
      logger.info('[ChatService] 检测到话题切换:', {
        confidence: detectionResult.confidence,
        reason: detectionResult.reason,
        suggestedTitle: detectionResult.suggestedTitle,
      });

      // 4.1 将当前话题归档
      await this.endTopic(currentTopic.id);

      // 4.2 创建新话题（使用建议的标题）
      const newTopicTitle = detectionResult.suggestedTitle ||
        `新对话 ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
      const newTopicId = await this.createNewTopic(user_id, expert_id, newTopicTitle);

      return { topic_id: newTopicId, isNewTopic: true };
    }

    // 5. 继续当前话题
    logger.debug('[ChatService] 继续当前话题:', detectionResult.reason);
    return { topic_id: currentTopic.id, isNewTopic: false };
  }

  /**
   * 获取模型配置
   */
  async getModelConfig(model_id) {
    const model = await this.AiModel.findOne({
      where: {
        id: model_id,
        is_active: true,
      },
      include: [{
        model: this.Provider,
        as: 'provider',
        attributes: ['id', 'name', 'base_url', 'api_key'],
      }],
      raw: true,
      nest: true,
    });

    if (!model) {
      throw new Error(`模型不存在或未激活: ${model_id}`);
    }

    return {
      model_name: model.model_name,
      provider_name: model.provider?.name,
      base_url: model.provider?.base_url,
      api_key: model.provider?.api_key,
      max_tokens: model.max_tokens,
      max_output_tokens: model.max_output_tokens || 32768,
      // 思考模式配置（Issue #181）
      supports_reasoning: model.supports_reasoning || false,
      thinking_format: model.thinking_format || 'none',
    };
  }

  /**
   * 获取任务上下文
   * 用于任务工作空间模式，注入任务信息到 LLM 上下文
   * @param {string} task_id - 任务ID（数据库主键 id）
   * @param {string} user_id - 用户ID（用于权限验证）
   * @param {string} working_path - 当前工作目录路径（可选，任务模式下的浏览路径）
   * @param {object} session - 用户会话对象（包含 isAdmin, roles 等）
   * @returns {Promise<object|null>} 任务上下文对象
   */
  async getTaskContext(task_id, user_id, working_path = '', session = null) {
    try {
      if (!this.Task) {
        this.Task = this.db.getModel('task');
      }

      const task = await this.Task.findOne({
        where: {
          id: task_id,  // 使用数据库主键 id 查询
          created_by: user_id,
        },
        raw: true,
      });

      if (!task) {
        logger.warn(`[ChatService] 任务不存在或无权访问: ${task_id}`);
        return null;
      }

      // 获取文件列表（根据当前浏览路径）
      const fs = await import('fs/promises');
      const path = await import('path');

      // 数据基础目录（技能目录等）
      const DATA_BASE_PATH = process.env.DATA_BASE_PATH || '/app/data';
      // 工作空间根目录（基于 DATA_BASE_PATH 派生，保持与技能系统一致）
      const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(DATA_BASE_PATH, 'work');
      // AI 工作目录基准路径（AI 的 cwd 是 data/，所以不需要 data/ 前缀）
      const AI_BASE_PATH = 'work';

      // 构建任务上下文（包含完整路径信息）
      const taskContext = {
        id: task.task_id,
        title: task.title,
        description: task.description,
        workspacePath: task.workspace_path,
        // AI 使用的路径（不含 data/ 前缀，因为 AI 的 cwd 已经是 data/）
        fullWorkspacePath: path.join(AI_BASE_PATH, task.workspace_path),
        systemRoot: AI_BASE_PATH,
        userId: user_id,
        currentPath: working_path || '',  // 当前浏览的目录路径
        status: task.status,
        // 用户角色信息
        isAdmin: session?.isAdmin || false,
        isSkillCreator: session?.roles?.includes('creator') || false,
      };

      // 工作空间根目录路径
      const workspaceRootPath = path.join(WORKSPACE_ROOT, task.workspace_path);

      // 读取 README.md（如果存在）
      try {
        const readmePath = path.join(workspaceRootPath, 'README.md');
        const readmeContent = await fs.readFile(readmePath, 'utf-8');
        if (readmeContent && readmeContent.trim()) {
          taskContext.readme = readmeContent;
          logger.debug(`[ChatService] 已读取 README.md: ${readmeContent.length} 字符`);
        }
      } catch (error) {
        // README.md 不存在或读取失败，忽略
        logger.debug(`[ChatService] README.md 不存在或读取失败: ${error.message}`);
      }

      // 读取 TODO.md（如果存在）
      try {
        const todoPath = path.join(workspaceRootPath, 'TODO.md');
        const todoContent = await fs.readFile(todoPath, 'utf-8');
        if (todoContent && todoContent.trim()) {
          taskContext.todo = todoContent;
          logger.debug(`[ChatService] 已读取 TODO.md: ${todoContent.length} 字符`);
        }
      } catch (error) {
        // TODO.md 不存在或读取失败，忽略
        logger.debug(`[ChatService] TODO.md 不存在或读取失败: ${error.message}`);
      }

      // 确定要读取的目录（后端使用完整路径）
      const targetDir = working_path
        ? path.join(WORKSPACE_ROOT, task.workspace_path, working_path)
        : path.join(WORKSPACE_ROOT, task.workspace_path, 'input');
      
      try {
        const files = await fs.readdir(targetDir);
        
        // 获取文件详情
        const fileDetails = await Promise.all(
          files.map(async (filename) => {
            try {
              const filePath = path.join(targetDir, filename);
              const stats = await fs.stat(filePath);
              return {
                name: filename,
                size: stats.size,
                isDirectory: stats.isDirectory(),
                path: working_path ? `${working_path}/${filename}` : filename,
              };
            } catch {
              return null;
            }
          })
        );
        
        taskContext.inputFiles = fileDetails.filter(f => f !== null);
      } catch (error) {
        // 目录可能不存在或为空
        taskContext.inputFiles = [];
      }

      return taskContext;
    } catch (error) {
      logger.error('[ChatService] 获取任务上下文失败:', error.message);
      return null;
    }
  }

  /**
   * 扫描并处理未回复的消息
   * 在服务启动时调用，处理之前失败的用户消息
   *
   * 注意：新设计中消息的 topic_id 为 NULL（未归档状态），
   * 所以使用 expert_id + user_id 来判断是否有回复
   */
  async processUnrepliedMessages() {
    try {
      logger.info('[ChatService] 开始扫描未回复的消息...');

      // 使用 expert_id + user_id 来判断未回复的消息
      // 查找那些在某个用户消息之后没有助手回复的情况
      const unrepliedMessages = await this.db.query(
        `SELECT m.* FROM messages m
         WHERE m.role = 'user'
         AND NOT EXISTS (
           SELECT 1 FROM messages m2
           WHERE m2.expert_id = m.expert_id
           AND m2.user_id = m.user_id
           AND m2.role = 'assistant'
           AND m2.created_at > m.created_at
         )
         ORDER BY m.created_at ASC`
      );

      if (unrepliedMessages.length === 0) {
        logger.info('[ChatService] 没有未回复的消息');
        return;
      }

      logger.info(`[ChatService] 发现 ${unrepliedMessages.length} 条未回复的消息`);

      // 处理每条未回复的消息
      for (const msg of unrepliedMessages) {
        try {
          logger.info(`[ChatService] 处理未回复消息: ${msg.id}, expert: ${msg.expert_id}, user: ${msg.user_id}`);

          // 获取专家服务
          const expertService = await this.getExpertService(msg.expert_id);

          // 构建上下文
          const context = await expertService.buildContext(msg.user_id, msg.content, msg.topic_id);

          // 获取模型配置
          const modelConfig = expertService.getDefaultModelConfig();

          // 调用 LLM（非流式）
          const startTime = Date.now();
          const llmResponse = await expertService.llmClient.call(modelConfig, context.messages);
          const latency = Date.now() - startTime;

          // 保存助手消息
          await this.saveAssistantMessage(
            msg.topic_id,
            msg.user_id,
            llmResponse.content,
            {
              prompt_tokens: 0,  // 非流式调用无法获取精确值
              completion_tokens: Math.ceil(llmResponse.content.length / 4),  // 估算值
              latency_ms: latency,
              model_name: modelConfig.model_name,
              provider_name: modelConfig.provider_name,
              expert_id: msg.expert_id,
            }
          );

          // 更新话题时间（如果有 topic_id）
          if (msg.topic_id) {
            await this.updateTopicTimestamp(msg.topic_id);
          }

          logger.info(`[ChatService] 未回复消息处理完成: ${msg.id}`);

        } catch (error) {
          logger.error(`[ChatService] 处理未回复消息失败: ${msg.id}, 错误: ${error.message}`);
          // 继续处理下一条消息
        }
      }

      logger.info('[ChatService] 未回复消息处理完成');

    } catch (error) {
      logger.error('[ChatService] 扫描未回复消息失败:', error.message);
    }
  }
}

/**
 * 专家对话服务（单个专家实例）
 */
class ExpertChatService {
  constructor(db, expertId, options = {}) {
    this.db = db;
    this.expertId = expertId;
    this.expertName = '';  // 专家名称，用于日志
    this.assistantManager = options.assistantManager || null;
    this.Message = db.getModel('message');
    this.Topic = db.getModel('topic');

    this.configLoader = null;
    this.llmClient = null;
    this.memorySystem = null;
    this.contextManager = null;
    this.reflectiveMind = null;
    this.toolManager = null;
    this.ragService = null;  // RAG 服务

    this.expertConfig = null;
    this.initialized = false;
  }

  /**
   * 初始化专家服务
   */
  async initialize() {
    if (this.initialized) return;

    // 1. 加载专家配置
    this.configLoader = new ConfigLoader(this.db);
    this.expertConfig = await this.configLoader.loadExpertConfig(this.expertId);

    // 保存专家名称用于日志
    this.expertName = this.expertConfig.expert?.name || this.expertId;

    // 2. 初始化 LLM Client
    this.llmClient = new LLMClient(this.configLoader, this.expertId);
    await this.llmClient.loadConfig();

    // 3. 初始化记忆系统
    this.memorySystem = new MemorySystem(this.db, this.expertId, this.llmClient);

    // 4. 初始化上下文管理器
    this.contextManager = new ContextManager(this.expertConfig);

    // 4.1 如果使用 minimal 策略，初始化 MinimalContextOrganizer
    if (this.expertConfig.expert?.context_strategy === 'minimal') {
      this.minimalOrganizer = new MinimalContextOrganizer(this.expertConfig, {
        // 可以在这里覆盖默认配置
        lookbackRounds: this.expertConfig.expert?.psyche_lookback_rounds || 4,
        maxTokensRatio: this.expertConfig.expert?.psyche_max_tokens_ratio || 0.3,
      });
      logger.info(`[ExpertChatService] 启用 Minimal 上下文策略 (Psyche 机制)，反思模型: ${this.expertConfig.reflectiveModel?.model_name || 'default'}, 上下文大小: ${this.expertConfig.reflectiveModel?.max_tokens || 128000}`);
    }

    // 5. 初始化反思心智
    const soul = this.extractSoul(this.expertConfig.expert);
    this.reflectiveMind = new ReflectiveMind(soul, this.llmClient);

    // 6. 初始化工具管理器
    this.toolManager = new ToolManager(this.db, this.expertId);
    await this.toolManager.initialize();

    // 7. 初始化 RAG 服务
    this.ragService = new RAGService(this.db, this.configLoader);

    this.initialized = true;
    logger.info(`[ExpertChatService] 专家服务初始化完成: ${this.expertName} (${this.expertId})`);
  }

  /**
   * 构建对话上下文
   * @param {string} user_id - 用户ID
   * @param {string} currentMessage - 当前消息
   * @param {string} topic_id - 话题ID
   * @param {object} taskContext - 任务上下文（可选，任务工作空间模式）
   */
  async buildContext(user_id, currentMessage, topic_id, taskContext = null) {
    // 如果使用 minimal 策略，使用 MinimalContextOrganizer
    if (this.minimalOrganizer) {
      return await this.buildMinimalContext(user_id, currentMessage, topic_id, taskContext);
    }

    // 获取话题历史消息作为上下文
    const topicMessages = await this.getTopicMessages(topic_id);

    // 获取可用技能列表（用于注入技能描述到 System Prompt）
    const skills = this.toolManager.getSkillList();

    // 获取可用助理列表（用于注入助理信息到 System Prompt）
    let assistants = [];
    if (this.assistantManager) {
      try {
        assistants = await this.assistantManager.roster();
      } catch (error) {
        logger.warn('[ExpertChatService] 获取助理列表失败:', error.message);
      }
    }

    // RAG 检索知识库内容
    let ragContext = null;
    const knowledgeConfig = this.expertConfig.expert?.knowledge_config;
    if (knowledgeConfig?.enabled && this.ragService) {
      try {
        const ragResult = await this.ragService.retrieve(currentMessage, {
          expertId: this.expertId,
          kbId: knowledgeConfig.kb_id,
          topK: knowledgeConfig.top_k || 5,
          threshold: knowledgeConfig.threshold || 0.7,
          userId: user_id,
        });

        if (ragResult.success && ragResult.results.length > 0) {
          ragContext = this.ragService.buildContextMessage(ragResult.results, {
            maxTokens: knowledgeConfig.max_tokens || 2000,
            style: knowledgeConfig.style || 'default',
          });
          logger.info(`[ExpertChatService] RAG 检索到 ${ragResult.results.length} 条相关知识`);
        }
      } catch (error) {
        logger.warn('[ExpertChatService] RAG 检索失败:', error.message);
      }
    }

    // 使用 ContextManager 构建完整上下文
    const context = await this.contextManager.buildContext(
      this.memorySystem,
      user_id,
      { currentMessage, skills, taskContext, ragContext, assistants }
    );

    // 注入话题上下文（用于调试和后续处理）
    if (topicMessages.length > 0) {
      context.topicHistory = topicMessages;
    }

    return context;
  }

  /**
   * 使用 Minimal 策略构建上下文（Psyche 机制）
   * @param {string} user_id - 用户ID
   * @param {string} currentMessage - 当前消息
   * @param {string} topic_id - 话题ID
   * @param {object} taskContext - 任务上下文（可选）
   */
  async buildMinimalContext(user_id, currentMessage, topic_id, taskContext = null) {
    // 获取基础 System Prompt
    const skills = this.toolManager.getSkillList();
    let baseSystemPrompt = this.expertConfig.expert?.system_prompt || '';
    
    // 注入技能信息到 System Prompt
    if (skills.length > 0) {
      const skillsDesc = skills.map(s => `- ${s.name}: ${s.description}`).join('\n');
      baseSystemPrompt += `\n\n【可用技能】\n${skillsDesc}`;
    }

    // 使用 MinimalContextOrganizer 组织上下文
    const contextResult = await this.minimalOrganizer.organize(
      this.memorySystem,
      user_id,
      {
        expertId: this.expertId,
        currentMessage,
        systemPrompt: baseSystemPrompt,
        llmClient: this.llmClient,
        maxTokens: this.getDefaultModelConfig().max_tokens || 128000,
        taskContext
      }
    );

    // 构建返回格式（兼容原有接口）
    const messages = [];
    
    // 添加 System Prompt
    if (contextResult.systemPrompt) {
      messages.push({ role: 'system', content: contextResult.systemPrompt });
    }
    
    // 添加用户消息（currentMessage 可能已经在 contextResult.messages 中）
    // 检查 contextResult.messages 是否已包含用户消息
    const hasUserMessage = contextResult.messages?.some(m => m.role === 'user');
    
    if (!hasUserMessage && currentMessage) {
      messages.push({ role: 'user', content: currentMessage });
    } else if (contextResult.messages?.length > 0) {
      // 使用 contextResult 中的消息
      messages.push(...contextResult.messages);
    }

    logger.info(`[ExpertChatService] Minimal 上下文构建完成: ${messages.length} 条消息, Psyche tokens: ${contextResult.hiddenContext?.stats?.tokens || 'N/A'}`);
    logger.debug(`[ExpertChatService] 消息详情:`, messages.map(m => ({ role: m.role, content: m.content?.substring(0, 50) })));

    return {
      messages,
      hiddenContext: contextResult.hiddenContext,
      isMinimal: true
    };
  }

  /**
   * 获取话题历史消息
   */
  async getTopicMessages(topic_id, limit = 50) {
    const messages = await this.Message.findAll({
      where: { topic_id },
      attributes: ['id', 'role', 'content', 'inner_voice', 'tool_calls', 'created_at'],
      order: [['created_at', 'DESC']],
      limit,
      raw: true,
    });

    logger.info(`[ExpertChatService] getTopicMessages: topic_id=${topic_id}, limit=${limit}, found=${messages.length}`);

    // 安全解析 JSON
    const safeParseJSON = (value) => {
      if (!value) return null;
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch (e) {
        return null;
      }
    };

    return messages.reverse().map(m => ({
      role: m.role,
      content: m.content,
      inner_voice: safeParseJSON(m.inner_voice),
      tool_calls: safeParseJSON(m.tool_calls),
    }));
  }

  /**
   * 处理工具调用
   * @param {Array} toolCalls - 工具调用数组
   * @param {string} user_id - 用户ID
   * @param {string} access_token - 用户访问令牌
   * @param {object} taskContext - 任务上下文（包含工作空间路径）
   * @param {string} topic_id - 话题ID
   * @param {Function} onToolComplete - 单个工具执行完成回调 (result) => void
   * @param {object} session - 用户会话对象（包含 accessToken, isAdmin, roles 等）
   */
  async handleToolCalls(toolCalls, user_id, access_token = null, taskContext = null, topic_id = null, onToolComplete = null, session = null) {
    const context = {
      expert_id: this.expertId,
      user_id,
      topicId: topic_id,  // 传递 topic_id，用于助理回调通知
      accessToken: access_token,  // 传递用户 Token
      memorySystem: this.memorySystem,
      taskContext,  // 传递任务上下文（包含工作空间路径）
      session,  // 直接传递 session 对象，toolManager 从中读取权限信息
    };

    return await this.toolManager.executeToolCalls(toolCalls, context, onToolComplete);
  }

  /**
   * 执行反思（异步）
   * @param {string} user_id - 用户ID
   * @param {string} triggerMessage - 触发消息（用户消息）
   * @param {string} myResponse - 我的回复（助手消息）
   * @param {string} topic_id - 话题ID（可选，用于话题分析）
   */
  async performReflection(user_id, triggerMessage, myResponse, topic_id = null) {
    try {
      // 获取最近消息作为上下文
      const recentMessages = await this.memorySystem.getRecentMessages(user_id, 10);

      // 获取话题信息（如果有）
      let topicInfo = null;
      if (topic_id) {
        const topic = await this.db.getModel('topic').findByPk(topic_id, { raw: true });
        if (topic) {
          // 获取当前话题已累积的关键词（优先从缓存，否则从数据库加载）
          let currentKeywords = this.getCurrentTopicKeywords(user_id, topic_id);
          if (currentKeywords.length === 0 && topic.keywords) {
            // 缓存未命中，从数据库加载
            currentKeywords = await this.loadTopicKeywords(user_id, topic_id);
          }
          topicInfo = {
            title: topic.title,
            description: topic.description,
            currentKeywords,
          };
        }
      }

      // 获取最近的话题（用于校验总结是否准确）
      const recentTopics = await this.memorySystem.getTopics(user_id, 3, 'active');

      const reflection = await this.reflectiveMind.reflect({
        triggerMessage: { content: triggerMessage },
        myResponse: { content: myResponse },
        context: recentMessages,
        topicInfo,
        recentTopics,
      });

      // 更新最后一条消息的 inner_voice
      await this.updateLastMessageInnerVoice(user_id, reflection);

      // 处理关键词累积和话题分裂
      if (reflection.keywords && reflection.keywords.length > 0 && topic_id) {
        await this.accumulateKeywords(user_id, topic_id, reflection.keywords);
      }

      // 处理话题分裂建议：触发压缩
      if (reflection.topicSuggestion?.shouldCreateNew) {
        logger.info(`[ExpertChatService] 反思检测到话题偏移，触发压缩: ${reflection.topicSuggestion.reason}`);
        
        // 强制压缩，跳过阈值检查
        const compressResult = await this.memorySystem.compressContext(user_id, {
          contextSize: this.getDefaultModelConfig().max_tokens || 128000,
          threshold: this.expertConfig?.expert?.context_threshold || 0.7,
          minMessages: 5,
          force: true,  // 强制压缩
        });
        
        if (compressResult.success) {
          logger.info(`[ExpertChatService] 反思触发压缩成功: 创建 ${compressResult.topicsCreated} 个话题, 归档 ${compressResult.messagesArchived} 条消息`);
        } else {
          logger.warn(`[ExpertChatService] 反思触发压缩失败: ${compressResult.reason}`);
        }
      }

      // 处理历史话题修正建议
      if (reflection.topicSuggestion?.previousTopicCorrection?.needsCorrection) {
        const correction = reflection.topicSuggestion.previousTopicCorrection;
        const topicIndex = correction.topicIndex || 0;
        
        if (recentTopics && recentTopics.length > topicIndex) {
          const topicToCorrect = recentTopics[topicIndex];
          logger.info(`[ExpertChatService] 反思建议修正话题: ${topicToCorrect.id}, 理由: ${correction.reason}`);
          
          // 构建更新数据
          const updateData = {};
          if (correction.suggestedTitle) {
            updateData.title = correction.suggestedTitle;
          }
          if (correction.suggestedDescription) {
            updateData.description = correction.suggestedDescription;
          }
          
          // 执行更新
          if (Object.keys(updateData).length > 0) {
            try {
              await this.Topic.update(updateData, { where: { id: topicToCorrect.id } });
              logger.info(`[ExpertChatService] 话题已修正: ${topicToCorrect.id}, 更新字段: ${Object.keys(updateData).join(', ')}`);
            } catch (updateError) {
              logger.error(`[ExpertChatService] 话题修正失败: ${updateError.message}`);
            }
          }
        }
      }

      logger.debug('[ExpertChatService] 反思完成:', {
        score: reflection.selfEvaluation?.score,
        topicAnalysis: reflection.topicAnalysis,
        keywords: reflection.keywords,
        topicSuggestion: reflection.topicSuggestion,
      });

      return reflection;
    } catch (error) {
      logger.error('[ExpertChatService] 反思失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取当前话题已累积的关键词
   * @param {string} user_id - 用户ID
   * @param {string} topic_id - 话题ID
   * @returns {Array} 关键词数组
   */
  getCurrentTopicKeywords(user_id, topic_id) {
    const key = `${user_id}:${topic_id}`;
    return this.topicKeywordsCache?.get(key) || [];
  }

  /**
   * 累积关键词到当前话题（持久化到数据库）
   * @param {string} user_id - 用户ID
   * @param {string} topic_id - 话题ID
   * @param {Array} newKeywords - 新关键词
   * @returns {Promise<Array>} 合并后的关键词数组
   */
  async accumulateKeywords(user_id, topic_id, newKeywords) {
    // 初始化缓存
    if (!this.topicKeywordsCache) {
      this.topicKeywordsCache = new Map();
    }

    const key = `${user_id}:${topic_id}`;
    const existingKeywords = this.topicKeywordsCache.get(key) || [];
    
    // 合并关键词（去重）
    const merged = [...new Set([...existingKeywords, ...newKeywords])];
    
    // 更新内存缓存
    this.topicKeywordsCache.set(key, merged);

    // 持久化到数据库
    try {
      await this.Topic.update(
        { keywords: JSON.stringify(merged) },
        { where: { id: topic_id } }
      );
      logger.debug(`[ExpertChatService] 话题关键词已持久化: ${topic_id}, ${merged.length} 个: ${merged.join(', ')}`);
    } catch (error) {
      logger.error(`[ExpertChatService] 关键词持久化失败: ${error.message}`);
    }

    return merged;
  }

  /**
   * 从数据库加载话题关键词到缓存
   * @param {string} user_id - 用户ID
   * @param {string} topic_id - 话题ID
   * @returns {Promise<Array>} 关键词数组
   */
  async loadTopicKeywords(user_id, topic_id) {
    try {
      const topic = await this.Topic.findByPk(topic_id, { raw: true });
      if (topic?.keywords) {
        const keywords = typeof topic.keywords === 'string' 
          ? JSON.parse(topic.keywords) 
          : topic.keywords;
        
        // 更新缓存
        if (!this.topicKeywordsCache) {
          this.topicKeywordsCache = new Map();
        }
        const key = `${user_id}:${topic_id}`;
        this.topicKeywordsCache.set(key, keywords);
        
        return keywords;
      }
    } catch (error) {
      logger.error(`[ExpertChatService] 加载话题关键词失败: ${error.message}`);
    }
    return [];
  }

  /**
   * 重置话题关键词缓存（创建新话题时调用）
   * @param {string} user_id - 用户ID
   * @param {string} topic_id - 话题ID
   */
  resetTopicKeywords(user_id, topic_id) {
    const key = `${user_id}:${topic_id}`;
    this.topicKeywordsCache?.delete(key);
    logger.debug(`[ExpertChatService] 话题关键词缓存已重置: ${topic_id}`);
  }

  /**
   * 更新最后一条消息的 Inner Voice
   */
  async updateLastMessageInnerVoice(user_id, innerVoice) {
    // 获取最近的消息（assistant 角色）
    const message = await this.Message.findOne({
      where: {
        user_id,
        role: 'assistant',
      },
      order: [['created_at', 'DESC']],
      raw: true,
    });

    if (message) {
      await this.Message.update(
        { inner_voice: JSON.stringify(innerVoice) },
        { where: { id: message.id } }
      );
    }
  }

  /**
   * 检查并处理上下文压缩（新设计）
   * 当 Token 数超过阈值时，触发压缩
   * @param {string} user_id - 用户ID
   * @returns {Promise<object>} 压缩结果
   */
  async checkAndCompressContext(user_id) {
    try {
      const contextSize = this.getDefaultModelConfig().max_tokens || 128000;
      const threshold = this.expertConfig?.expert?.context_threshold || 0.7;

      const compressionCheck = await this.memorySystem.shouldCompressContext(
        user_id,
        contextSize,
        threshold,
        20,  // 最小消息数
        50   // 最大未归档消息数
      );

      if (compressionCheck.needCompress) {
        logger.info(`[ExpertChatService] [${this.expertName}] 开始上下文压缩: user=${user_id}, reason=${compressionCheck.reason}`);
        
        const result = await this.memorySystem.compressContext(user_id, {
          contextSize,
          threshold,
          minMessages: 5,
        });

        logger.info(`[ExpertChatService] [${this.expertName}] 上下文压缩完成: user=${user_id}, topics=${result.topicsCreated}`);
        return result;
      }

      return { success: false, reason: compressionCheck.reason };
    } catch (error) {
      logger.error(`[ExpertChatService] [${this.expertName}] 上下文压缩失败:`, error.message);
      throw error;
    }
  }

  /**
   * 检查并处理历史归档（旧版，保留向后兼容）
   * @deprecated 使用 checkAndCompressContext 替代
   * @param {string} user_id - 用户ID
   * @param {string} topic_id - 当前话题ID（可选）
   */
  async processHistoryIfNeeded(user_id, topic_id = null) {
    // 使用新的压缩逻辑
    return await this.checkAndCompressContext(user_id);
  }

  /**
   * 获取默认模型配置
   */
  getDefaultModelConfig() {
    const model = this.expertConfig.expressiveModel;
    if (!model) {
      throw new Error(`专家 ${this.expertName} 未配置表达模型`);
    }
    return model;
  }

  /**
   * 获取思考模式配置
   * 优先从模型配置读取思考模式设置（ai_models 表的 supports_reasoning 和 thinking_format 字段）
   * 如果模型配置中没有这些字段，回退到基于模型名称的自动检测
   *
   * 支持的思考模式格式：
   * - deepseek: thinking: { type: 'enabled' } - DeepSeek R1 系列
   * - qwen: thinking: { type: 'enabled' } - Qwen3/Qwen3.5/QwQ 系列（与 DeepSeek 格式相同）
   * - openai: reasoning: { effort: 'medium' } - OpenAI o1/o3 系列
   * - none: 不启用思考模式
   *
   * @param {Object} modelConfig - 模型配置（可选，用于覆盖默认模型）
   * @returns {Object} { thinking, reasoning }
   */
  getThinkingConfig(modelConfig = null) {
    // 使用传入的模型配置，或默认模型配置
    const model = modelConfig || this.expertConfig?.expressiveModel;
    if (!model?.model_name) {
      return { thinking: null, reasoning: null };
    }

    // 优先从模型配置读取思考模式设置（新设计：由前端配置）
    if (model.supports_reasoning && model.thinking_format && model.thinking_format !== 'none') {
      const format = model.thinking_format;
      logger.info(`[ExpertChatService] 模型 ${model.model_name} 支持思考模式: ${format}（来自配置）`);
      
      switch (format) {
        case 'deepseek':
        case 'qwen':
          // DeepSeek 和 Qwen 都使用 reasoning_content 字段
          // Qwen3/Qwen3.5/QwQ 的思考模式与 DeepSeek R1 格式相同
          return {
            thinking: { type: 'enabled' },
            reasoning: null,
          };
        case 'openai':
          return {
            thinking: null,
            reasoning: { effort: 'medium' },
          };
        default:
          return { thinking: null, reasoning: null };
      }
    }

    // 回退：基于模型名称自动检测（兼容旧数据）
    const modelName = model.model_name.toLowerCase();
    
    // DeepSeek 推理模型：自动启用 thinking
    if (modelName.includes('deepseek-reasoner') || modelName.includes('deepseek-r1')) {
      logger.info(`[ExpertChatService] 检测到 DeepSeek 推理模型: ${model.model_name}, 启用 thinking（自动检测）`);
      return {
        thinking: { type: 'enabled' },
        reasoning: null,
      };
    }

    // OpenAI o1/o3 系列：自动启用 reasoning
    // 注意：o1-mini 和 o1-preview 不支持 reasoning_effort 参数
    if (modelName.startsWith('o1-') && !modelName.includes('mini') && !modelName.includes('preview')) {
      logger.info(`[ExpertChatService] 检测到 OpenAI o1 模型: ${model.model_name}, 启用 reasoning（自动检测）`);
      return {
        thinking: null,
        reasoning: { effort: 'medium' },
      };
    }

    // o3 系列支持 reasoning
    if (modelName.startsWith('o3-') || modelName.startsWith('o4-')) {
      logger.info(`[ExpertChatService] 检测到 OpenAI 推理模型: ${model.model_name}, 启用 reasoning（自动检测）`);
      return {
        thinking: null,
        reasoning: { effort: 'medium' },
      };
    }

    // 其他模型不支持思考模式
    return { thinking: null, reasoning: null };
  }

  /**
   * 从专家配置中提取 Soul
   * 注：字段现在按纯字符串存储，不再需要 JSON 解析
   */
  extractSoul(expert) {
    return {
      coreValues: expert.core_values || '',
      taboos: expert.taboos || '',
      emotionalTone: expert.emotional_tone || '',
      behavioralGuidelines: expert.behavioral_guidelines || '',
      speakingStyle: expert.speaking_style || '',
    };
  }
}

export default ChatService;
