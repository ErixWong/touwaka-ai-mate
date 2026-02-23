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
import logger from './logger.js';
import Utils from './utils.js';

class ChatService {
  /**
   * @param {Database} db - 数据库实例
   */
  constructor(db) {
    this.db = db;
    this.Message = db.getModel('message');
    this.Topic = db.getModel('topic');
    this.AiModel = db.getModel('ai_model');
    this.Provider = db.getModel('provider');
    
    // 服务实例缓存（按 expertId）
    this.expertServices = new Map();
    
    // 活跃对话缓存（按 topicId）
    this.activeChats = new Map();
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
      return this.expertServices.get(expertId);
    }

    const service = new ExpertChatService(this.db, expertId);
    await service.initialize();
    
    this.expertServices.set(expertId, service);
    return service;
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
   * @param {Function} onDelta - 流式数据回调 (delta: string) => void
   * @param {Function} onComplete - 完成回调 (result: object) => void
   * @param {Function} onError - 错误回调 (error: Error) => void
   */
  async streamChat(params, onDelta, onComplete, onError) {
    const { topic_id: providedTopicId, user_id, expert_id, content, model_id } = params;

    try {
      logger.info('[ChatService] 开始流式聊天:', { expert_id, user_id, topic_id: providedTopicId });

      // 1. 获取专家服务
      const expertService = await this.getExpertService(expert_id);
      logger.debug('[ChatService] 专家服务获取完成');

      // 2. 获取或创建活跃对话（用于前端展示，消息不再关联 topic_id）
      let topic_id = providedTopicId;
      let isNewTopic = false;

      if (!topic_id) {
        // 获取或创建活跃话题（仅用于前端展示）
        topic_id = await this.getOrCreateActiveTopic(user_id, expert_id);
        isNewTopic = true;
      }

      logger.debug('[ChatService] Topic ID:', topic_id, isNewTopic ? '(新话题)' : '(继续当前话题)');

      // 3. 发送开始事件
      onDelta?.({ type: 'start', message_id: `msg_${Utils.newID(10)}`, topic_id, is_new_topic: isNewTopic });

      // 4. 保存用户消息（topic_id = NULL，未归档状态）
      const userMessageId = await this.saveUserMessage(topic_id, user_id, content, expert_id);
      logger.debug('[ChatService] 用户消息已保存:', userMessageId);

      // 5. 检查是否需要压缩上下文（新设计）
      const compressionCheck = await expertService.memorySystem.shouldCompressContext(
        user_id,
        expertService.getDefaultModelConfig().context_size || 128000,
        expertService.expertConfig?.expert?.context_threshold || 0.7,
        20  // 最小消息数
      );

      if (compressionCheck.needCompress) {
        logger.info(`[ChatService] 触发上下文压缩: ${compressionCheck.reason}`);
        // 同步执行压缩（阻塞，但必要）
        await expertService.memorySystem.compressContext(user_id, {
          contextSize: expertService.getDefaultModelConfig().context_size || 128000,
          threshold: expertService.expertConfig?.expert?.context_threshold || 0.7,
          minMessages: 20,
        });
      }

      // 6. 构建上下文（新设计：Topic 总结 + 未归档消息）
      logger.debug('[ChatService] 开始构建上下文...');
      const context = await expertService.buildContext(user_id, content, topic_id);
      logger.debug('[ChatService] 上下文构建完成, 消息数:', context.messages?.length);

      // 6. 调用 LLM（流式），支持多轮工具调用
      const startTime = Date.now();
      const MAX_TOOL_ROUNDS = 20;  // 最大工具调用轮数，防止无限循环
      
      let fullContent = '';
      let tokenUsage = null;  // 存储真实的 token 使用信息
      let allToolCalls = [];  // 收集所有轮次的工具调用
      let currentMessages = [...context.messages];  // 当前对话消息

      // 获取模型配置
      const modelConfig = model_id
        ? await this.getModelConfig(model_id)
        : expertService.getDefaultModelConfig();
      
      logger.info('[ChatService] 使用模型:', {
        model_name: modelConfig.model_name,
        base_url: modelConfig.base_url,
        has_api_key: !!modelConfig.api_key,
      });

      // 获取工具定义
      const tools = expertService.toolManager.getToolDefinitions();
      logger.info('[ChatService] 工具定义:', {
        tools_count: tools.length,
        has_tools: tools.length > 0
      });

      // 多轮工具调用循环
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let collectedToolCalls = [];  // 本轮收集的工具调用
        let roundContent = '';  // 本轮 LLM 返回的内容

        // 流式调用
        await expertService.llmClient.callStream(
          modelConfig,
          currentMessages,
          {
            tools,
            onDelta: (delta) => {
              roundContent += delta;
              fullContent += delta;
              onDelta?.({ type: 'delta', content: delta });
            },
            onToolCall: (toolCalls) => {
              // 收集工具调用（llm-client 返回的是数组）
              logger.info(`[ChatService] 第${round + 1}轮收到工具调用:`, toolCalls);
              if (Array.isArray(toolCalls)) {
                collectedToolCalls.push(...toolCalls);
              } else {
                collectedToolCalls.push(toolCalls);
              }
              onDelta?.({ type: 'tool_call', toolCalls });
            },
            onUsage: (usage) => {
              // 累加 token 使用信息（多轮调用时累加）
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
          }
        );

        // 如果没有工具调用，退出循环
        if (collectedToolCalls.length === 0) {
          logger.info(`[ChatService] 第${round + 1}轮无工具调用，完成`);
          break;
        }

        logger.info(`[ChatService] 第${round + 1}轮开始执行工具调用:`, collectedToolCalls.length);
        
        // 执行工具
        const toolResults = await expertService.handleToolCalls(collectedToolCalls, user_id);
        
        // 合并工具调用和执行结果（用于保存到数据库）
        const toolCallsWithResults = collectedToolCalls.map((call, index) => {
          const result = toolResults[index];
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
        allToolCalls.push(...toolCallsWithResults);
        
        // 通知前端工具执行结果
        onDelta?.({ type: 'tool_results', results: toolResults });

        // 更新消息历史，加入助手消息和工具结果
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: roundContent || null, tool_calls: collectedToolCalls },
          ...expertService.toolManager.formatToolResultsForLLM(toolResults),
        ];

        // 如果达到最大轮数，下一轮不传递 tools，强制返回文本
        if (round + 1 >= MAX_TOOL_ROUNDS) {
          logger.warn('[ChatService] 达到最大工具调用轮数，下一轮将强制返回文本');
        }
      }

      // 如果 LLM 没有返回任何内容，生成默认回复
      if (!fullContent || fullContent.trim() === '') {
        logger.warn('[ChatService] LLM 未返回内容，生成默认回复');
        fullContent = '我已处理您的请求，但没有生成具体的回复内容。';
      }

      const latency = Date.now() - startTime;

      // 7. 保存助手消息
      const messageOptions = {
        tokens: tokenUsage?.total_tokens || 0,  // 使用真实的 token 数
        latency_ms: latency,
        model_name: modelConfig.model_name,
        provider_name: modelConfig.provider_name,
        expert_id,
      };
      
      // 如果有工具调用，保存到数据库
      if (allToolCalls.length > 0) {
        messageOptions.tool_calls = JSON.stringify(allToolCalls);
      }
      
      const assistantMessageId = await this.saveAssistantMessage(
        topic_id,
        user_id,
        fullContent,
        messageOptions
      );

      // 7. 异步执行反思（不阻塞响应）
      expertService.performReflection(user_id, content, fullContent, topic_id).catch(err => {
        logger.error('[ChatService] 反思失败:', err.message);
      });

      // 8. 异步检查并处理历史归档（不阻塞响应）
      // 当消息积累到一定数量后，由 MemorySystem 自动总结并更新 Topic 标题
      expertService.processHistoryIfNeeded(user_id, topic_id).catch(err => {
        logger.error('[ChatService] 历史归档失败:', err.message);
      });

      // 9. 更新话题时间
      await this.updateTopicTimestamp(topic_id);

      // 9. 发送完成事件
      onComplete?.({
        type: 'complete',
        message_id: assistantMessageId,
        content: fullContent,
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
    const { topic_id, user_id, expert_id, content, model_id } = params;

    try {
      // 1. 获取专家服务
      const expertService = await this.getExpertService(expert_id);

      // 2. 保存用户消息
      await this.saveUserMessage(topic_id, user_id, content, expert_id);

      // 3. 构建上下文
      const context = await expertService.buildContext(user_id, content, topic_id);

      // 4. 获取工具定义
      const tools = expertService.toolManager.getToolDefinitions();

      // 5. 调用 LLM
      const startTime = Date.now();
      const modelConfig = model_id
        ? await this.getModelConfig(model_id)
        : expertService.getDefaultModelConfig();

      let response;
      let toolCalls = null;

      if (tools.length > 0) {
        // 支持工具调用
        const llmResponse = await expertService.llmClient.call(modelConfig, context.messages, { tools });

        if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
          toolCalls = await expertService.handleToolCalls(llmResponse.toolCalls, user_id);

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

      // 6. 保存助手消息
      const messageOptions = {
        tokens: Math.ceil(response.length / 4),
        latency_ms: latency,
        model_name: modelConfig.model_name,
        provider_name: modelConfig.provider_name,
        expert_id,
      };
      if (toolCalls) {
        messageOptions.tool_calls = JSON.stringify(toolCalls);
      }

      const assistantMessageId = await this.saveAssistantMessage(
        topic_id,
        user_id,
        response,
        messageOptions
      );

      // 7. 异步执行反思
      expertService.performReflection(user_id, content, response, topic_id).catch(err => {
        logger.error('[ChatService] 反思失败:', err.message);
      });

      // 8. 更新话题时间
      await this.updateTopicTimestamp(topic_id);

      return {
        success: true,
        message_id: assistantMessageId,
        content: response,
        latency,
        model: modelConfig.model_name,
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
   */
  async saveUserMessage(topic_id, user_id, content, expert_id = null) {
    const message_id = Utils.newID(20);
    
    await this.Message.create({
      id: message_id,
      topic_id: null,  // 新消息不分配 topic_id，压缩时再分配
      user_id,
      expert_id,
      role: 'user',
      content,
    });

    // 注意：不再更新 Topic 消息计数，因为消息尚未归档到任何 Topic

    return message_id;
  }

  /**
   * 保存助手消息
   * 新消息的 topic_id 为 NULL（未归档状态），压缩时再分配 topic_id
   */
  async saveAssistantMessage(topic_id, user_id, content, options = {}) {
    const message_id = Utils.newID(20);
    const { tokens = 0, latency_ms = 0, model_name = '', provider_name = '', tool_calls = null, expert_id = null } = options;

    await this.Message.create({
      id: message_id,
      topic_id: null,  // 新消息不分配 topic_id，压缩时再分配
      user_id,
      expert_id,
      role: 'assistant',
      content,
      tokens,
      latency_ms,
      model_name,
      provider_name,
      tool_calls,
    });

    // 注意：不再更新 Topic 消息计数，因为消息尚未归档到任何 Topic

    return message_id;
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
   * @returns {Promise<string>} topic_id
   */
  async getOrCreateActiveTopic(user_id, expert_id) {
    // 1. 查找用户与该专家的最近活跃对话
    const recentTopic = await this.Topic.findOne({
      where: {
        user_id,
        expert_id,
        status: 'active',
      },
      order: [['updated_at', 'DESC']],
      raw: true,
    });

    if (recentTopic) {
      logger.debug(`[ChatService] 使用现有对话: ${recentTopic.id}`);
      return recentTopic.id;
    }

    // 2. 创建新对话（给一个默认标题，后续由反思总结更新）
    return await this.createNewTopic(user_id, expert_id);
  }

  /**
   * 创建新话题
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @param {string} title - 话题标题（可选，默认使用时间戳）
   * @returns {Promise<string>} topic_id
   */
  async createNewTopic(user_id, expert_id, title = null) {
    const topic_id = Utils.newID(20);
    const defaultTitle = title || `新对话 ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

    await this.Topic.create({
      id: topic_id,
      user_id,
      expert_id,
      title: defaultTitle,
      status: 'active',
      message_count: 0,
    });

    logger.info(`[ChatService] 创建新对话: ${topic_id}, 标题: ${defaultTitle}`);
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
    const topicDetector = new TopicDetector(expertService.llmClient);
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
      context_size: model.context_size || 128000,
    };
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
              tokens: Math.ceil(llmResponse.content.length / 4),
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
  constructor(db, expertId) {
    this.db = db;
    this.expertId = expertId;
    this.expertName = '';  // 专家名称，用于日志
    this.Message = db.getModel('message');
    
    this.configLoader = null;
    this.llmClient = null;
    this.memorySystem = null;
    this.contextManager = null;
    this.reflectiveMind = null;
    this.toolManager = null;
    
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

    // 5. 初始化反思心智
    const soul = this.extractSoul(this.expertConfig.expert);
    this.reflectiveMind = new ReflectiveMind(soul, this.llmClient);

    // 6. 初始化工具管理器
    this.toolManager = new ToolManager(this.db, this.expertId);
    await this.toolManager.initialize();

    this.initialized = true;
    logger.info(`[ExpertChatService] 专家服务初始化完成: ${this.expertName} (${this.expertId})`);
  }

  /**
   * 构建对话上下文
   */
  async buildContext(user_id, currentMessage, topic_id) {
    // 获取话题历史消息作为上下文
    const topicMessages = await this.getTopicMessages(topic_id);
    
    // 使用 ContextManager 构建完整上下文
    const context = await this.contextManager.buildContext(
      this.memorySystem,
      user_id,
      { currentMessage }
    );

    // 注入话题上下文
    if (topicMessages.length > 0) {
      context.topicHistory = topicMessages;
    }

    return context;
  }

  /**
   * 获取话题历史消息
   */
  async getTopicMessages(topic_id, limit = 20) {
    const messages = await this.Message.findAll({
      where: { topic_id },
      attributes: ['role', 'content', 'inner_voice', 'tool_calls', 'created_at'],
      order: [['created_at', 'DESC']],
      limit,
      raw: true,
    });

    return messages.reverse().map(m => ({
      role: m.role,
      content: m.content,
      innerVoice: m.inner_voice ? JSON.parse(m.inner_voice) : null,
      toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
    }));
  }

  /**
   * 处理工具调用
   */
  async handleToolCalls(toolCalls, user_id) {
    const context = {
      expert_id: this.expertId,
      user_id,
      memorySystem: this.memorySystem,
    };

    return await this.toolManager.executeToolCalls(toolCalls, context);
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
          topicInfo = {
            title: topic.title,
            description: topic.description,
          };
        }
      }

      const reflection = await this.reflectiveMind.reflect({
        triggerMessage: { content: triggerMessage },
        myResponse: { content: myResponse },
        context: recentMessages,
        topicInfo,
      });

      // 更新最后一条消息的 inner_voice
      await this.updateLastMessageInnerVoice(user_id, reflection);

      logger.debug('[ExpertChatService] 反思完成:', {
        score: reflection.selfEvaluation?.score,
        topicAnalysis: reflection.topicAnalysis,
      });

      return reflection;
    } catch (error) {
      logger.error('[ExpertChatService] 反思失败:', error.message);
      throw error;
    }
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
      const contextSize = this.getDefaultModelConfig().context_size || 128000;
      const threshold = this.expertConfig?.expert?.context_threshold || 0.7;

      const compressionCheck = await this.memorySystem.shouldCompressContext(
        user_id,
        contextSize,
        threshold,
        20  // 最小消息数
      );

      if (compressionCheck.needCompress) {
        logger.info(`[ExpertChatService] [${this.expertName}] 开始上下文压缩: user=${user_id}, reason=${compressionCheck.reason}`);
        
        const result = await this.memorySystem.compressContext(user_id, {
          contextSize,
          threshold,
          minMessages: 20,
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
   * 从专家配置中提取 Soul
   */
  extractSoul(expert) {
    return {
      coreValues: this.parseJson(expert.core_values),
      taboos: this.parseJson(expert.taboos),
      emotionalTone: expert.emotional_tone || '温和、真诚',
      behavioralGuidelines: this.parseJson(expert.behavioral_guidelines),
      speakingStyle: expert.speaking_style || '',  // 添加说话风格
    };
  }

  /**
   * 解析 JSON 字段
   */
  parseJson(field) {
    if (!field) return [];
    if (typeof field === 'object') return field;
    try {
      return JSON.parse(field);
    } catch {
      return [];
    }
  }
}

export default ChatService;
