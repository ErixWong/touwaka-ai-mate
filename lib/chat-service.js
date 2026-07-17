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
 *
 * ============================================================
 * 架构分层说明：
 * ============================================================
 * 本文件承担了多层职责，为未来重构做准备，按以下层次组织：
 *
 * 【INFRASTRUCTURE LAYER - 基础设施层】
 *   - LLM Payload 缓存管理
 *   - ExpertService 生命周期管理
 *   - 内部工具调用编排 (_executeLLMRounds, _executeTools)
 *
 * 【APPLICATION LAYER - 应用层】
 *   - 对话流程编排 (streamChat, chat)
 *   - 任务上下文准备
 *
 * 【DOMAIN LAYER - 领域层】
 *   - Message 领域：消息持久化 (saveUserMessage, saveAssistantMessage, saveToolMessage)
 *   - Topic 领域：话题生命周期 (getOrCreateActiveTopic, createNewTopic, endTopic, checkAndHandleTopicShift)
 *   - Task 领域：任务状态管理 (updateTaskLastExecuted, getTaskContext)
 *   - Context 领域：上下文构建 (buildContext, buildMinimalContext)
 *
 * 未来拆分计划：
 *   - lib/chat/orchestrator.js: 应用层
 *   - lib/chat/message-service.js: 消息领域
 *   - lib/chat/topic-service.js: 话题领域
 *   - lib/infrastructure/message-repository.js: 消息持久化
 * ============================================================
 */

import ConfigLoader from './config-loader.js';
import LLMClient from './llm-client.js';
import MemorySystem from './memory-system.js';
import ContextManager from './context-manager.js';
import ReflectiveMind from './reflective-mind.js';
import ToolManager from './tool-manager.js';
import TopicDetector from './topic-detector.js';
import InternalLLMService from './internal-llm-service.js';
import RecallStrategy from './recall-strategy.js';
import { buildEvidenceContextMessage } from './evidence-formatter.js';
import { MinimalContextOrganizer } from './context-organizer/minimal-organizer.js';
import LLMPayloadCache from './chat/llm-payload-cache.js';
import { ConversationOrchestrator } from './chat/conversation-orchestrator.js';
import { TopicLifecycleManager } from './topic/topic-lifecycle-manager.js';
import logger from './logger.js';
import { resolveThinkingRequestConfig } from './llm-thinking-config.js';
import Utils from './utils.js';
import path from 'path';
import { getSystemSettingService } from '../server/services/system-setting.service.js';
import { getWorkspaceRoot, getSkillsPath, getTaskWorkspaceAbsolutePath, getDefaultWorkspaceAbsolutePath, toLogicalWorkspacePath } from './paths.js';

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
    this.ChatRequest = db.getModel('chat_request');
    this.AiModel = db.getModel('ai_model');
    this.Provider = db.getModel('provider');
    this.Task = db.getModel('task');
    
    // 服务实例缓存（按 expertId）
    this.expertServices = new Map();
    
    // 活跃对话缓存（按 topicId）
    this.activeChats = new Map();
    
    // LLM Payload 缓存 - 委托给独立模块
    // 仅用于用户对话调试，服务重启后丢失
    this.llmPayloadCache = new LLMPayloadCache();

    // Phase 4: 编排器 + 上下文组装器
    this.orchestrator = new ConversationOrchestrator();
  }

  // ============================================================
  // INFRASTRUCTURE LAYER - 基础设施层
  // LLM Payload 缓存、ExpertService 生命周期管理
  // ============================================================

  /**
   * 保存 LLM Payload 到缓存
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @param {Object} payload - LLM 请求 payload
   */
  saveLLMPayload(user_id, expert_id, payload) {
    this.llmPayloadCache.save(user_id, expert_id, payload);
  }

  /**
   * 获取最近一次 LLM Payload
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @returns {Object|null} LLM Payload 或 null
   */
  getLLMPayload(user_id, expert_id) {
    return this.llmPayloadCache.get(user_id, expert_id);
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
 *
 * ============================================================
 * 路径协议设计说明（重要）：
 * ============================================================
 * 返回的 taskContext 包含两个路径字段：
 *
 * 1. absolute_workspace_path（执行真值）：
 *    - 必须是绝对路径
 *    - 所有执行层必须使用此字段进行文件系统操作
 *
 * 2. logical_workspace_path（展示投影）：
 *    - 仅用于展示，不参与执行
 *    - 格式：task 模式为 userId/taskId，skill 模式为 skills/xxx
 *
 * 重要：禁止将 logical_workspace_path 用于任何执行层操作
 */
  async _prepareTaskContext({ task_id, user_id, working_path, session }) {
    if (task_id) {
      const taskContext = await this.getTaskContext(task_id, user_id, working_path, session);
      if (taskContext) {
        logger.info('[ChatService] 任务上下文已加载:', taskContext.title, '路径:', working_path || '根目录');
      }
      return taskContext;
    } else if (working_path) {
      logger.info('[ChatService] 技能模式工作目录:', working_path);
      const normalizedPath = working_path.replace(/\\/g, '/').replace(/^\.\//, '');
      let absolutePath;
      let logicalPath;
      if (normalizedPath.startsWith('skills/')) {
        absolutePath = path.join(getSkillsPath(), normalizedPath.slice('skills/'.length));
        logicalPath = normalizedPath;
      } else {
        absolutePath = path.join(getSkillsPath(), normalizedPath);
        logicalPath = 'skills/' + normalizedPath;
      }
      return {
        workspace_mode: 'skill',
        absolute_workspace_path: absolutePath,
        logical_workspace_path: logicalPath,
        user_id,
        current_path: '',
        is_admin: session?.isAdmin || false,
        is_skill_creator: session?.roles?.includes('creator') || false,
      };
    } else {
      logger.info('[ChatService] 对话模式工作目录: work/' + user_id + '/temp');
      const absolutePath = getDefaultWorkspaceAbsolutePath(user_id);
      return {
        workspace_mode: 'chat',
        absolute_workspace_path: absolutePath,
        logical_workspace_path: toLogicalWorkspacePath(absolutePath),
        user_id,
        current_path: '',
        is_admin: session?.isAdmin || false,
        is_skill_creator: session?.roles?.includes('creator') || false,
      };
    }
  }

  /**
   * 执行多轮 LLM 调用（私有方法）
   * 支持流式响应和多轮工具调用
   * @returns {Promise<object>} LLM 调用结果
   */
  async _executeLLMRounds(expertService, { modelConfig, thinkingConfig, tools, currentMessages, llmPayload, user_id, expert_id, taskContext, topic_id, task_id, session, request_id, onDelta }) {
    const systemSettingService = getSystemSettingService(this.db);
    const MAX_TOOL_ROUNDS = expertService.expertConfig?.expert?.max_tool_rounds
      || await systemSettingService.getMaxToolRounds();

    let fullContent = '';
    let fullReasoningContent = '';
    let tokenUsage = null;
    let allToolCalls = [];
    let messages = [...currentMessages];
    let llmCallsCount = 0;  // P0 观测：记录 LLM 调用次数

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
      llmCallsCount++;  // P0 观测：每轮调用计数
      let collectedToolCalls = [];
      let roundContent = '';

      logger.info('[ChatService] 第', round + 1, '轮调用 LLM...');

      // 回收旧图片（compaction 后，旧 base64 替换为文本占位符）
      if (round > 0) {
        messages = LLMClient.stripHistoricalImages(messages);
      }

      // 流式调用
      await expertService.llmClient.callStream(modelConfig, messages, {
        tools,
        thinking: thinkingConfig.thinking,
        reasoning: thinkingConfig.reasoning,
        reasoning_effort: thinkingConfig.reasoning_effort,
        enable_thinking: thinkingConfig.enable_thinking,
        chat_template_kwargs: thinkingConfig.chat_template_kwargs,
        user_id,  // 添加 user_id 用于 abort 机制
        request_id,
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

      // P0-2: 统一回答模式决策（流式与非流式共用入口）
      // 通过 _consumeDocRetrievalResult 统一查找 → 决策 → 日志，不再写死 tool 名称
      const consumption = expertService._consumeDocRetrievalResult(toolResults, {
        caller: '_executeLLMRounds',
        extra: { round: round + 1 },
      });

      if (consumption.found) {
        const { docRetrievalResult, modeDecision } = consumption;

        if (modeDecision.isShortCircuit) {
          // candidate_list：短路 LLM，直接推送格式化回复
          logger.info('[ChatService._executeLLMRounds] response mode 显式编排（短路 LLM，流式）:', {
            mode: modeDecision.mode,
            round: round + 1,
            maxRounds: MAX_TOOL_ROUNDS,
          });
          onDelta?.({ type: 'delta', content: modeDecision.directResponse });
          fullContent = modeDecision.directResponse;
          // 记录此次 tool call 以供快照
          const toolCallsWithResults = collectedToolCalls.map((call, index) => {
            const result = toolResults[index];
            return {
              ...call,
              result: result ? { success: result.success, data: result.data, error: result.error } : null,
              duration: result?.duration || 0,
              tool_message_id: result?.toolMessageId || null,
              timestamp: new Date().toISOString(),
            };
          });
          allToolCalls.push(...toolCallsWithResults);
          break;  // 短路：不继续下一轮 LLM 调用
        }

        if (modeDecision.evidenceInjection) {
          // clarify / conservative_answer / answer_with_citation / direct_answer：
          // 将证据约束注入到消息历史头部，下一轮 LLM 将看到
          messages.unshift({
            role: 'system',
            content: modeDecision.evidenceInjection,
          });
          logger.info('[ChatService._executeLLMRounds] 已注入文档检索证据指引（流式路径）:', {
            mode: modeDecision.mode,
            round: round + 1,
          });
        }
      }

      // 合并工具调用和执行结果
      const toolCallsWithResults = collectedToolCalls.map((call, index) => {
        const result = toolResults[index];
        return {
          ...call,
          result: result ? { success: result.success, data: result.data, error: result.error } : null,
          duration: result?.duration || 0,
          tool_message_id: result?.toolMessageId || null,
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

      // 注入合成 user 消息（多模态图片识别）
      LLMClient.injectImageUserMessages(messages, modelConfig, toolResults);

      // 同步更新 LLM Payload 缓存
      llmPayload.messages = messages;
      llmPayload._debug.context_messages_count = messages.length;
      llmPayload.cached_at = new Date().toISOString();
      this.saveLLMPayload(user_id, expert_id, llmPayload);

      // 检测工具调用轮数阈值，推送 SSE 事件通知用户
      const currentRound = round + 1;
      const isLastRound = currentRound >= MAX_TOOL_ROUNDS;
      const threshold = currentRound / MAX_TOOL_ROUNDS;

      if (isLastRound) {
        // 达到 100% 上限：生成总结并通知用户
        const summary = this._generateToolCallSummary(allToolCalls);
        onDelta?.({
          type: 'tool_limit_reached',
          totalRounds: MAX_TOOL_ROUNDS,
          executedRounds: currentRound,
          summary,
          message: `已达到最大工具调用次数（${currentRound}轮），AI 正在生成总结`
        });
        logger.info(`[ChatService] 工具调用达上限，生成总结: ${summary.substring(0, 100)}...`);
      } else if (threshold >= 0.8) {
        // 达到 80% 阈值：发送警告提示
        onDelta?.({
          type: 'tool_limit_warning',
          currentRound,
          maxRounds: MAX_TOOL_ROUNDS,
          remainingRounds: MAX_TOOL_ROUNDS - currentRound,
          message: `已调用 ${currentRound}/${MAX_TOOL_ROUNDS} 轮（${Math.round(threshold * 100)}%），即将达到上限`
        });
        logger.info(`[ChatService] 工具调用警告: ${currentRound}/${MAX_TOOL_ROUNDS} 轮`);
      }
    }

    // 如果 LLM 没有返回任何内容，生成默认回复
    if (!fullContent || fullContent.trim() === '') {
      logger.warn('[ChatService] LLM 未返回内容，生成默认回复');
      fullContent = '我已处理您的请求，但没有生成具体的回复内容。';
    }

    // P0 观测：记录本轮 LLM 调用次数
    logger.info(`[ChatService] 本轮 LLM 调用次数: ${llmCallsCount}, 专家: ${expert_id}, 策略: ${expertService.expertConfig?.expert?.context_strategy || 'full'}`);

    return { fullContent, fullReasoningContent, tokenUsage, allToolCalls, finalMessages: messages, llmCallsCount };
  }

  /**
   * 生成工具调用总结（用于工具调用达上限时展示给用户）
   * @param {Array} toolCallsWithResults - 工具调用及结果数组
   * @returns {string} 总结文本
   */
  _generateToolCallSummary(toolCallsWithResults) {
    if (!toolCallsWithResults || toolCallsWithResults.length === 0) {
      return '无工具调用记录';
    }

    const summaryParts = [];
    let successCount = 0;
    let failCount = 0;

    toolCallsWithResults.forEach((call, index) => {
      const toolName = call.function?.name || call.name || '未知工具';
      const success = call.result?.success !== false;
      if (success) successCount++;
      else failCount++;

      const status = success ? '✅ 成功' : '❌ 失败';
      const duration = call.duration ? `${Math.round(call.duration)}ms` : '';
      summaryParts.push(`${index + 1}. ${toolName}: ${status} ${duration}`);
    });

    const header = `【工具调用总结】共 ${toolCallsWithResults.length} 次调用（成功 ${successCount}，失败 ${failCount}）\n`;
    return header + summaryParts.join('\n');
  }

  /**
   * 构建 assistant 完成态使用的工具调用快照
   * 返回前端可直接渲染的摘要结构，而不是完整工具结果真相源。
   * 完整结果仍以独立 tool message 为准。
   * @param {Array} toolCallsWithResults - 工具调用及结果数组
   * @returns {Array}
   */
  buildToolCallSnapshot(toolCallsWithResults = []) {
    if (!Array.isArray(toolCallsWithResults) || toolCallsWithResults.length === 0) {
      return [];
    }

    return toolCallsWithResults.map(call => {
      const rawResult = call.result?.data;
      let resultPreview = null;

      if (typeof rawResult === 'string') {
        resultPreview = rawResult.slice(0, 200);
      } else if (rawResult !== undefined) {
        try {
          resultPreview = JSON.stringify(rawResult).slice(0, 200);
        } catch (error) {
          resultPreview = '[unserializable result]';
        }
      } else if (call.result?.error) {
        resultPreview = String(call.result.error).slice(0, 200);
      }

      return {
        tool_call_id: call.id || call.tool_call_id || null,
        name: call.function?.name || call.name || 'unknown',
        display_name: call.displayName || call.function?.name || call.name || 'unknown',
        arguments: call.function?.arguments || call.arguments || null,
        success: call.result?.success !== false,
        duration: call.duration || 0,
        result_preview: resultPreview,
        tool_message_id: call.tool_message_id || null,
        timestamp: call.timestamp || new Date().toISOString(),
      };
    });
  }

  /**
   * 执行工具调用（私有方法）
   * @returns {Promise<Array>} 工具执行结果数组
   */
  async _executeTools(expertService, { collectedToolCalls, user_id, taskContext, topic_id, task_id, session, expert_id, request_id, onDelta }) {
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
        await this.saveToolMessage(topic_id, user_id, toolResult, expert_id, task_id, request_id);
        onDelta?.({ type: 'tool_result', result: toolResult });
      },
      session
    );
  }

  // ============================================================
  // APPLICATION LAYER - 应用层
  // 对话流程编排、任务上下文准备
  // ============================================================

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
    const {
      topic_id: providedTopicId,
      user_id,
      expert_id,
      content,
      model_id,
      task_id,
      working_path,
      session,
      request_id,
      skip_user_message_persist = false,
      existing_user_message_id = null,
    } = params;

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
        try {
          const result = await this.checkAndHandleTopicShift(user_id, expert_id, content, expertService, task_id);
          topic_id = result.topic_id;
          isNewTopic = result.isNewTopic;
        } catch (error) {
          logger.error('[ChatService] Topic 切换检测失败，降级为简单策略:', error.message);
          topic_id = await this.getOrCreateActiveTopic(user_id, expert_id, task_id);
          isNewTopic = true;
        }
      }
      logger.debug('[ChatService] Topic ID:', topic_id, isNewTopic ? '(新话题)' : '(继续当前话题)');

      // 4. 发送开始事件
      onDelta?.({ type: 'start', request_id, message_id: `msg_${Utils.newID(10)}`, topic_id, is_new_topic: isNewTopic });

      // 5. 保存用户消息（request 级重试时复用已有 user message）
      let userMessageId = existing_user_message_id;
      if (!skip_user_message_persist) {
        userMessageId = await this.saveUserMessageAndBindRequest(topic_id, user_id, content, expert_id, task_id, request_id);
        logger.debug('[ChatService] 用户消息已保存:', userMessageId);
      } else {
        logger.info('[ChatService] 跳过用户消息持久化，复用已有 user message:', existing_user_message_id);
      }
      onDelta?.({ type: 'user_message_saved', message_id: userMessageId });

      // 6. 检查是否需要压缩上下文
      const compressionCheck = await expertService.memorySystem.shouldCompressContext(
        user_id,
        expertService.getDefaultModelConfig().max_tokens || 128000,
        expertService.expertConfig?.expert?.context_threshold || 0.7,
        5, 50
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
      const context = await expertService.buildContext(user_id, content, topic_id, taskContext);
      logger.debug('[ChatService] 上下文构建完成, 消息数:', context.messages?.length);

      // Phase 4: Recall 策略 Pre-check + Evidence 注入（通过 Orchestrator → ContextComposer）
      let recallResult = null;
      if (expertService.recallStrategy) {
        recallResult = await this.orchestrator.handleRecall(expertService, content, user_id, expert_id);
        if (recallResult && context.messages) {
          this.orchestrator.applyEvidence(context.messages, recallResult);
        }
      }

      // 8. 准备 LLM 调用配置
      const startTime = Date.now();
      const modelConfig = model_id ? await this.getModelConfig(model_id) : expertService.getDefaultModelConfig();
      const thinkingConfig = expertService.getThinkingConfig(modelConfig);
      const toolContext = { user_id, expert_id, session };
      const tools = await expertService.toolManager.getToolDefinitions(toolContext);

      const llmPayload = {
        model: modelConfig.model_name,
        messages: context.messages,
        stream: true,
        stream_options: { include_usage: true },
        _debug: { model_config: { provider_name: modelConfig.provider_name, base_url: modelConfig.base_url, max_tokens: modelConfig.max_tokens, max_output_tokens: modelConfig.max_output_tokens }, context_messages_count: context.messages.length, tools_count: tools.length },
      };
      this.saveLLMPayload(user_id, expert_id, llmPayload);

      // 9. 执行多轮 LLM 调用
      const llmResult = await this._executeLLMRounds(expertService, { modelConfig, thinkingConfig, tools, currentMessages: context.messages, llmPayload, user_id, expert_id, taskContext, topic_id, task_id, session, request_id, onDelta });
      const { fullContent, fullReasoningContent, tokenUsage } = llmResult;
      let finalContent = fullContent;
      const latency = Date.now() - startTime;

      // Phase 4: Post-check（通过 Orchestrator）
      if (expertService.recallStrategy && recallResult?.meta) {
        const postCheck = this.orchestrator.handlePostCheck(expertService, fullContent, recallResult);
        if (postCheck?.need_retry) {
          const retryResult = await expertService.recallStrategy.executePolicy(
            { decision: 'force', reason_codes: ['postcheck'], confidence: 0.8, trace_id: postCheck.trace_id, query_keyword: '' },
            expertService.toolManager, user_id, expert_id
          );
          if (retryResult.items?.length > 0) {
            recallResult.items.push(...retryResult.items);
            recallResult.meta.calls += retryResult.meta.calls;

            const retrySnippets = retryResult.items
              .filter(e => e.source === 'message' && e.snippet)
              .slice(0, 2)
              .map(e => `- [${e.role || 'unknown'}] ${e.snippet.slice(0, 120)}`);

            let correction = '';
            if (retrySnippets.length > 0) {
              correction = `\n\n【补充修正】\n基于补充回忆到的历史信息，我对上文结论做修正：\n${retrySnippets.join('\n')}\n请以上述补充证据为准。`;
            } else {
              correction = '\n\n【补充修正】已触发补充回忆并更新证据链，请以上下文补充信息为准。';
            }

            finalContent += correction;
            onDelta?.({ type: 'delta', content: correction });
          }
        }
      }

      // 10. 保存助手消息
      const assistantCreatedAt = new Date().toISOString();
      const assistantMessageId = await this.saveAssistantMessageAndCompleteRequest(topic_id, user_id, finalContent, {
        request_id,
        prompt_tokens: tokenUsage?.prompt_tokens || 0,
        completion_tokens: tokenUsage?.completion_tokens || 0,
        latency_ms: latency,
        model_name: modelConfig.model_name,
        provider_name: modelConfig.provider_name,
        expert_id,
        reasoning_content: fullReasoningContent || null,
        task_id,
        created_at: assistantCreatedAt,
      });

      // 11. 异步反思和历史归档
      expertService.performReflection(user_id, content, finalContent, topic_id).catch(err => logger.error('[ChatService] 反思失败:', err.message));
      expertService.processHistoryIfNeeded(user_id, topic_id).catch(err => logger.error('[ChatService] 历史归档失败:', err.message));
      await this.updateTopicTimestamp(topic_id);

      const toolCallSnapshot = this.buildToolCallSnapshot(llmResult.allToolCalls || []);

      // 12. 发送完成事件
      onComplete?.({
        type: 'complete',
        request_id,
        user_message_id: userMessageId,
        message: {
          id: assistantMessageId,
          request_id,
          topic_id,
          role: 'assistant',
          content: finalContent,
          reasoning_content: fullReasoningContent || null,
          tool_calls: toolCallSnapshot,
          metadata: {
            tokens: tokenUsage ? {
              prompt_tokens: tokenUsage.prompt_tokens || 0,
              completion_tokens: tokenUsage.completion_tokens || 0,
              total_tokens: tokenUsage.total_tokens || 0,
            } : null,
            latency,
            model: modelConfig.model_name,
            provider: modelConfig.provider_name,
          },
          created_at: assistantCreatedAt,
        },
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

      // 3. 保存用户消息
      await this.saveUserMessageAndBindRequest(topic_id, user_id, content, expert_id, task_id, request_id);

      // 4. 构建上下文
      const context = await expertService.buildContext(user_id, content, topic_id, taskContext);

      // Phase 4: Recall 策略 Pre-check（非流式路径，通过 Orchestrator → ContextComposer）
      let recallResult = null;
      if (expertService.recallStrategy && !topic_id) {
        recallResult = await this.orchestrator.handleRecall(expertService, content, user_id, expert_id);
        if (recallResult && context.messages) {
          this.orchestrator.applyEvidence(context.messages, recallResult);
        }
      }

      // 5. 获取工具定义（包含 MCP 工具）
      const toolContext = { user_id, expert_id, session };
      const tools = await expertService.toolManager.getToolDefinitions(toolContext);

      // 6. 调用 LLM
      const startTime = Date.now();
      const modelConfig = model_id
        ? await this.getModelConfig(model_id)
        : expertService.getDefaultModelConfig();

      let response;
      let toolResults = null;
      let allToolCalls = [];  // 收集所有工具调用信息

      if (tools.length > 0) {
        // 支持工具调用
        const llmResponse = await expertService.llmClient.call(modelConfig, context.messages, { tools });

        if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
          // 执行工具调用，并保存每条工具消息
          toolResults = await expertService.handleToolCalls(
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
              await this.saveToolMessage(topic_id, user_id, toolResult, expert_id, task_id, request_id);
            },
            session  // 直接传递 session 对象
          );

          // 构建工具调用信息（用于存储）
          const toolCallsWithResults = llmResponse.toolCalls.map((call, index) => {
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
          allToolCalls = toolCallsWithResults;

          // 将工具结果发回 LLM 生成最终回复
          const followUpMessages = [
            ...context.messages,
            { role: 'assistant', content: llmResponse.content, tool_calls: llmResponse.toolCalls },
            ...expertService.toolManager.formatToolResultsForLLM(toolResults),
          ];

          // P0-2: 文档检索工具结果 → 统一回答模式决策
          // _consumeDocRetrievalResult 统一查找 → 决策 → 日志，不再写死 tool 名称
          const consumption = expertService._consumeDocRetrievalResult(toolResults, { caller: 'chat' });

          if (consumption.found) {
            const { docRetrievalResult, modeDecision } = consumption;

            if (modeDecision.isShortCircuit) {
              // 候选列表模式：不调用 LLM，直接使用格式化回复
              response = modeDecision.directResponse;
              logger.info('[ChatService.chat] response mode 显式编排（短路 LLM）:', {
                mode: modeDecision.mode,
                doc_count: docRetrievalResult?.documents?.length || docRetrievalResult?.candidates?.length || 0,
                tool_name: docRetrievalResult?.tool_name || docRetrievalResult?.toolName || 'document_retrieval',
                duration_ms: docRetrievalResult?.duration,
              });
              // 跳过 LLM 调用，直接进入保存/后处理阶段
            } else {
              if (modeDecision.evidenceInjection) {
                followUpMessages.unshift({
                  role: 'system',
                  content: modeDecision.evidenceInjection,
                });
                logger.info('[ChatService.chat] 已注入文档检索证据指引到 System Prompt:', {
                  sufficiency: docRetrievalResult?.evidence_sufficiency,
                  workflow_action: docRetrievalResult?.workflow_action,
                  doc_count: docRetrievalResult?.documents?.length || docRetrievalResult?.candidates?.length || 0,
                });
              }

              // 注入合成 user 消息（多模态图片识别）
              LLMClient.injectImageUserMessages(followUpMessages, modelConfig, toolResults);

              const finalResponse = await expertService.llmClient.call(modelConfig, followUpMessages);
              response = finalResponse.content;
            }
          }
        } else {
          response = llmResponse.content;
        }
      } else {
        // 不支持工具调用
        const llmResponse = await expertService.llmClient.call(modelConfig, context.messages);
        response = llmResponse.content;
      }

      const latency = Date.now() - startTime;

      // Phase 4: Recall 策略 Post-check（非流式路径，通过 Orchestrator）
      if (expertService.recallStrategy && recallResult?.meta) {
        const postCheck = this.orchestrator.handlePostCheck(expertService, response, recallResult);
        if (postCheck?.need_retry) {
          logger.info(`[ChatService] Recall post-check (chat) 检测到缺失证据`);
          response = expertService.recallStrategy.getDegradeResponse(response);
        }
      }

      // 7. 保存助手消息
      // 注意：工具调用信息不再存储在 assistant 消息中，而是存储在独立的 tool 消息中
      const messageOptions = {
        request_id,
        prompt_tokens: 0,  // 非流式调用无法获取精确值
        completion_tokens: Math.ceil(response.length / 4),  // 估算值
        latency_ms: latency,
        model_name: modelConfig.model_name,
        provider_name: modelConfig.provider_name,
        expert_id,
      };

      const assistantMessageId = await this.saveAssistantMessageAndCompleteRequest(
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

  // ============================================================
  // DOMAIN LAYER - 领域层
  // Message 领域、Topic 领域、Task 领域、Context 领域
  // ============================================================

  /**
   * 保存用户消息
   * 新消息的 topic_id 为 NULL（未归档状态），压缩时再分配 topic_id
   * @param {string} topic_id - 话题ID
   * @param {string} user_id - 用户ID
   * @param {string} content - 消息内容
   * @param {string} expert_id - 专家ID（可选）
   */
  async saveUserMessage(topic_id, user_id, content, expert_id = null, task_id = null, request_id = null, transaction = null) {
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
      request_id,
      topic_id: topic_id || null,  // WP-3: 在线绑定当前 topic
      user_id,
      expert_id,
      role: 'user',
      content: contentToStore,
    }, transaction ? { transaction } : undefined);

    if (!transaction) {
      if (topic_id) {
        await this.Topic.increment('message_count', { where: { id: topic_id } });
      }

      await this.updateTaskLastExecutedByTopic(topic_id);
    }

    return message_id;
  }

  async saveUserMessageAndBindRequest(topic_id, user_id, content, expert_id = null, task_id = null, request_id = null) {
    const transaction = await this.db.sequelize.transaction();
    try {
      const messageId = await this.saveUserMessage(topic_id, user_id, content, expert_id, task_id, request_id, transaction);
      if (request_id) {
        await this.ChatRequest.update({
          user_message_id: messageId,
          updated_at: new Date(),
        }, {
          where: { request_id },
          transaction,
        });
      }
      await transaction.commit();

      if (topic_id) {
        await this.Topic.increment('message_count', { where: { id: topic_id } });
      }
      await this.updateTaskLastExecutedByTopic(topic_id);

      return messageId;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
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
  async saveAssistantMessage(topic_id, user_id, content, options = {}, transaction = null) {
    const message_id = Utils.newID(20);
    const {
      prompt_tokens = 0,
      completion_tokens = 0,
      latency_ms = 0,
      model_name = '',
      provider_name = '',
      tool_calls = null,
      expert_id = null,
      request_id = null,
      reasoning_content = null,  // 思考过程内容（DeepSeek）
      task_id = null,  // 任务ID
      created_at = new Date().toISOString(),
    } = options;

    await this.Message.create({
      id: message_id,
      request_id,
      topic_id: topic_id || null,  // WP-3: 在线绑定当前 topic
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
      created_at,
    }, transaction ? { transaction } : undefined);

    if (!transaction) {
      if (task_id) {
        await this.updateTaskLastExecuted(task_id);
      }

      if (topic_id) {
        await this.Topic.increment('message_count', { where: { id: topic_id } });
      }
    }

    return message_id;
  }

  async saveAssistantMessageAndCompleteRequest(topic_id, user_id, content, options = {}) {
    const transaction = await this.db.sequelize.transaction();
    try {
      const messageId = await this.saveAssistantMessage(topic_id, user_id, content, options, transaction);
      if (options.request_id) {
        await this.ChatRequest.update({
          topic_id: topic_id || null,
          assistant_message_id: messageId,
          status: 'completed',
          error_message: null,
          completed_at: new Date(),
          updated_at: new Date(),
        }, {
          where: { request_id: options.request_id },
          transaction,
        });
      }
      await transaction.commit();

      if (options.task_id) {
        await this.updateTaskLastExecuted(options.task_id);
      }
      if (topic_id) {
        await this.Topic.increment('message_count', { where: { id: topic_id } });
      }

      return messageId;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
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
  async saveToolMessage(topic_id, user_id, toolResult, expert_id = null, task_id = null, request_id = null) {
    const message_id = Utils.newID(20);

    // 工具结果摘要阈值（字符数）
    // 超过此阈值时，content 存摘要，完整结果存 tool_calls.result
    const SUMMARY_THRESHOLD = 500;

    // 检测是否包含 base64 图片（清理以节省 DB 存储）
    // 主要处理 fs.read_file(mode='data_url') 返回的 { data: { dataUrl } }
    // 也兼容其他技能直接返回 base64 的情况
    const dataUrl = toolResult.data?.dataUrl || toolResult.dataUrl;
    const dataIsDirectBase64 = !dataUrl && typeof toolResult.data === 'string' && toolResult.data.startsWith('data:image/');
    const hasBase64Image = (dataUrl && dataUrl.startsWith('data:image/')) || dataIsDirectBase64;
    const imageDataUrl = dataUrl || (dataIsDirectBase64 ? toolResult.data : null);

    let fullResult = '';
    if (hasBase64Image && imageDataUrl) {
      const imageMeta = {
        success: true,
        image_recognized: true,
        mime_type: toolResult.data?.mimeType || imageDataUrl.match(/data:(image\/[^;]+);/)?.[1] || 'image/png',
        filename: toolResult.data?.filename || this._extractFilename(toolResult.data?.path) || 'image',
        original_size: imageDataUrl.length,
        tool: toolResult.toolName,
        note: '图片已识别，base64 已清理'
      };
      fullResult = JSON.stringify(imageMeta);
      logger.info(`[ChatService] 工具返回图片，清理 base64: ${toolResult.toolName}, 大小: ${imageDataUrl.length}`);
    } else if (toolResult.data !== undefined) {
      fullResult = typeof toolResult.data === 'string'
        ? toolResult.data
        : JSON.stringify(toolResult.data);
    } else if (toolResult.error) {
      fullResult = toolResult.error;
    }

    const resultLength = fullResult.length;
    const isSuccess = toolResult.success;

    // 构建 tool_calls 字段内容
    // audit-round06 变更项 C：持久化 atomic_steps 供前端展示原子工具轨迹
    const toolCallsData = {
      tool_call_id: toolResult.toolCallId,
      name: toolResult.toolName,
      arguments: toolResult.arguments || null,
      success: isSuccess,
      duration: toolResult.duration || 0,
      timestamp: new Date().toISOString(),
      context: toolResult.context || null,
      result_length: resultLength,
      // 图片标记（用于上下文加载时识别）
      has_image: hasBase64Image || false,
      // 原子工具执行轨迹（仅 document_retrieval skill 返回，展开在结果顶层）
      atomic_steps: toolResult.atomic_steps || null,
    };

    // 根据阈值决定存储策略（图片已被清理，通常不会超阈值）
    let content;
    if (resultLength > SUMMARY_THRESHOLD) {
      content = this.buildToolResultSummary(message_id, toolResult.toolName, resultLength, isSuccess);
      toolCallsData.result = fullResult;
      logger.info(`[ChatService] 工具结果超过阈值(${SUMMARY_THRESHOLD})，使用摘要模式: ${toolResult.toolName}, result_length: ${resultLength}`);
    } else {
      content = fullResult;
      logger.debug(`[ChatService] 工具结果未超过阈值，直接存储: ${toolResult.toolName}, result_length: ${resultLength}`);
    }

    await this.Message.create({
      id: message_id,
      request_id,
      topic_id: topic_id || null,  // WP-3: 在线绑定当前 topic
      user_id,
      expert_id,
      role: 'tool',
      content,
      tool_calls: JSON.stringify(toolCallsData),
    });

    if (task_id) {
      await this.updateTaskLastExecuted(task_id);
    }

    // WP-3: 更新 Topic 消息计数
    if (topic_id) {
      await this.Topic.increment('message_count', { where: { id: topic_id } });
    }

    logger.debug(`[ChatService] 工具消息已保存: ${toolResult.toolName}, message_id: ${message_id}, content_length: ${content.length}, has_image: ${hasBase64Image}`);
    return message_id;
  }

  _extractFilename(path) {
    if (!path) return null;
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || null;
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
→ 调用 recall({ mode: 'messages', action: 'detail', message_id: "${messageId}" }) 获取完整结果`;
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
   * Phase 4 WP-3: 获取或创建 TopicLifecycleManager（按 expertId 缓存）
   */
  _getTopicLifecycleManager(expertId) {
    if (!this._topicLifecycleManagers) {
      this._topicLifecycleManagers = new Map();
    }
    if (!this._topicLifecycleManagers.has(expertId)) {
      this._topicLifecycleManagers.set(expertId, new TopicLifecycleManager(this.db, expertId));
    }
    return this._topicLifecycleManagers.get(expertId);
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
    const tlm = this._getTopicLifecycleManager(expert_id);
    const activeTopic = await tlm.getActiveTopic(user_id, expert_id, task_id);
    if (activeTopic) {
      const traceId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      tlm.reuseTopic(activeTopic.id, '继续当前话题', traceId);
      return activeTopic.id;
    }
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
    const traceId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const tlm = this._getTopicLifecycleManager(expert_id);
    await tlm.createTopic({
      id: topic_id,
      userId: user_id,
      expertId: expert_id,
      title: defaultTitle,
      description: null,
      category: 'general',
      taskId: task_id,
      traceId,
    });
    return topic_id;
  }

  /**
   * 结束当前话题（将状态改为 archived）
   * @param {string} topic_id - 话题ID
   */
  async endTopic(topic_id, expert_id) {
    const tlm = this._getTopicLifecycleManager(expert_id);
    const traceId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await tlm.archiveTopic(topic_id, '手动结束', traceId);
  }

  /**
   * 检测并处理话题切换
   * 如果检测到话题切换，将当前话题归档并创建新话题
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @param {string} newMessage - 用户新消息
   * @param {ExpertChatService} expertService - 专家服务实例
   * @param {string} task_id - 任务ID（可选，用于任务隔离）
   * @returns {Promise<{topic_id: string, isNewTopic: boolean}>}
   */
  async checkAndHandleTopicShift(user_id, expert_id, newMessage, expertService, task_id = null) {
    // P0-2: task 模式时按 task_id 过滤，保证任务隔离
    const topicWhere = {
      user_id,
      expert_id,
      status: 'active',
    };
    if (task_id) {
      topicWhere.task_id = task_id;
    }

    // 1. 获取当前活跃话题
    const currentTopic = await this.Topic.findOne({
      where: topicWhere,
      order: [['updated_at', 'DESC']],
      raw: true,
    });

    // 如果没有活跃话题，创建新话题
    if (!currentTopic) {
      logger.info('[ChatService] 没有活跃话题，创建新话题');
      const topic_id = await this.createNewTopic(user_id, expert_id, null, task_id);
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
      await this.endTopic(currentTopic.id, expert_id);

      // 4.2 创建新话题（使用建议的标题）
      const newTopicTitle = detectionResult.suggestedTitle ||
        `新对话 ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
      const newTopicId = await this.createNewTopic(user_id, expert_id, newTopicTitle, task_id);

      // WP-2: 记录切换决策
      logger.info(`[ChatService] topic_switch_decision: shouldSwitch=${true}, confidence=${detectionResult.confidence}, reason="${detectionResult.reason}", suggestedTitle="${detectionResult.suggestedTitle || ''}"`);

      return { topic_id: newTopicId, isNewTopic: true };
    }

    // 5. 继续当前话题
    logger.debug('[ChatService] 继续当前话题:', detectionResult.reason);
    const result = { topic_id: currentTopic.id, isNewTopic: false };
    // WP-2: 记录切换决策
    logger.info(`[ChatService] topic_switch_decision: shouldSwitch=${false}, confidence=${detectionResult.confidence || 0}, reason="${detectionResult.reason || 'continue'}"`);
    return result;
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
 * @param {string} taskDbId - 任务数据库主键 id（20字符，UUID 风格）
 * @param {string} user_id - 用户ID（用于权限验证）
 * @param {string} working_path - 当前工作目录路径（可选，任务模式下的浏览路径）
 * @param {object} session - 用户会话对象（包含 isAdmin, roles 等）
 * @returns {Promise<object|null>} 任务上下文对象
 *
 * ============================================================
 * 双 ID 设计说明（重要）：
 * ============================================================
 * 数据库 task 表有两个 ID 字段：
 * - id: 数据库主键（20字符，由 Utils.newID() 生成）
 * - task_id: 业务 ID（12字符，由 Utils.newID(12) 生成，用户可见）
 *
 * 本函数设计：
 * - 参数 taskDbId 接收的是数据库主键 id（前端传递的 task.id）
 * - 返回的 taskContext.id 是 task_id（12字符业务 ID，供展示使用）
 * - absolute_workspace_path 使用 task_id 构造目录名（这是目录名的来源）
 *
 * 调用链验证：
 * 前端 taskStore.currentTask.id → stream.controller.js task_id → 
 * ChatService._prepareTaskContext(task_id) → getTaskContext(task_id) → 
 * Task.findOne({ where: { id: task_id } }) ✅ 正确
 *
 * ============================================================
 * 路径协议设计说明（重要）：
 * ============================================================
 * taskContext 中的路径字段设计为双字段模型：
 *
 * 1. absolute_workspace_path（执行真值）：
 *    - 必须是绝对路径
 *    - 所有执行层（tool-manager, skill-loader, skill-runner）必须使用此字段
 *    - 这是驱动文件系统操作的唯一真值
 *
 * 2. logical_workspace_path（展示投影）：
 *    - 相对于 work 目录的逻辑路径（如 userId/taskId）
 *    - 仅用于展示给 LLM 和用户界面
 *    - 禁止用于实际的文件系统操作
 *
 * 数据库字段 workspace_path 存储的是逻辑路径格式。
 * 运行时通过 getTaskWorkspaceAbsolutePath() 转换为绝对路径。
 */
  async getTaskContext(taskDbId, user_id, working_path = '', session = null) {
    try {
      if (!this.Task) {
        this.Task = this.db.getModel('task');
      }

      const task = await this.Task.findOne({
        where: {
          id: taskDbId,  // 使用数据库主键 id 查询
          created_by: user_id,
        },
        raw: true,
      });

      if (!task) {
        logger.warn(`[ChatService] 任务不存在或无权访问: ${taskDbId}`);
        return null;
      }

      // 获取文件列表（根据当前浏览路径）
      const fs = await import('fs/promises');
      const path = await import('path');

      // 工作空间根目录
      const WORKSPACE_ROOT = getWorkspaceRoot();

      // 构建任务上下文（包含完整路径信息）
      // workspace_path 格式：userId/taskId
      const taskWorkspacePath = task.workspace_path;
      const absolutePath = getTaskWorkspaceAbsolutePath(user_id, task.task_id);
      
      const taskContext = {
        id: task.task_id,  // 业务 ID（12字符），供前端和展示使用
        title: task.title,
        description: task.description,
        workspace_mode: 'task',
        absolute_workspace_path: absolutePath,  // 使用 task_id 构造绝对路径（这是目录名）
        logical_workspace_path: taskWorkspacePath,
        user_id,
        current_path: working_path || '',
        is_admin: session?.isAdmin || false,
        is_skill_creator: session?.roles?.includes('creator') || false,
        status: task.status,
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
        
        taskContext.input_files = fileDetails.filter(f => f !== null);
      
      } catch (error) {
        // 目录可能不存在或为空
        taskContext.input_files = [];
      
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
              request_id: msg.request_id || null,
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

  /**
   * 中止指定用户的 LLM 请求
   * @param {string} userId - 用户ID
   * @param {string} expertId - 专家ID
   * @returns {boolean} 是否成功中止
   */
  async abortUserRequest(userId, expertId) {
    const expertService = await this.getExpertService(expertId);
    return expertService.abortUserRequest(userId);
  }

  /**
   * 中止指定 request_id 的请求
   * @param {string} expertId - 专家ID
   * @param {string} requestId - 请求ID
   * @returns {boolean} 是否成功中止
   */
  async abortRequest(expertId, requestId) {
    const expertService = await this.getExpertService(expertId);
    return expertService.abortRequest(requestId);
  }
}

// ============================================================
// INFRASTRUCTURE LAYER (Nested) - 基础设施层（嵌套类）
// ExpertChatService: 专家服务实例管理
// ============================================================

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
    this.recallStrategy = null;  // Phase 3: Recall 策略化

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
      // 从 psyche_config 读取配置（P0 契约：仅认 psyche_config）
      const psycheConfig = this.expertConfig.expert?.psyche_config || {};
      
      // 兼容旧字段读取（告警日志）
      if (this.expertConfig.expert?.psyche_lookback_rounds || this.expertConfig.expert?.psyche_max_tokens_ratio) {
        logger.warn(`[ExpertChatService] 检测到旧 psyche 字段 psyche_lookback_rounds/psyche_max_tokens_ratio，请迁移到 psyche_config`);
      }
      
      this.minimalOrganizer = new MinimalContextOrganizer(this.expertConfig, {
        // P1 修复：不重复硬编码默认值，由 minimal-organizer 内部统一处理
        psycheConfig,
      });
      logger.info(`[ExpertChatService] 启用 Minimal 上下文策略 (Psyche 机制)，反思模型: ${this.expertConfig.reflectiveModel?.model_name || 'default'}, 上下文大小: ${this.expertConfig.reflectiveModel?.max_tokens || 128000}, psyche_config: max_tokens_ratio=${psycheConfig.max_tokens_ratio || 0.3}, reflection_lookback=${psycheConfig.reflection_lookback || 4}`);
    }

    // 5. 初始化反思心智
    const soul = this.extractSoul(this.expertConfig.expert);
    this.reflectiveMind = new ReflectiveMind(soul, this.llmClient);

    // 6. 初始化工具管理器
    this.toolManager = new ToolManager(this.db, this.expertId);
    await this.toolManager.initialize();

    // 8. 初始化 Recall 策略（Phase 3）
    this.recallStrategy = new RecallStrategy({
      recallMaxCallsPerTurn: 2,
      recallTimeoutMs: 2500,
      postcheckMaxRetry: 1,
    });
    logger.info(`[ExpertChatService] Recall 策略已初始化`);

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

    // 使用 ContextManager 构建完整上下文
    const context = await this.contextManager.buildContext(
      this.memorySystem,
      user_id,
      { currentMessage, skills, taskContext, assistants }
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
    const buildStartTime = Date.now();  // P0 观测：记录耗时

    // 获取基础 System Prompt
    const skills = this.toolManager.getSkillList();
    let baseSystemPrompt = this.expertConfig.expert?.system_prompt || '';
    
    // 注入技能信息到 System Prompt
    if (skills.length > 0) {
      const skillsDesc = skills.map(s => `- ${s.name}: ${s.description}`).join('\n');
      baseSystemPrompt += `\n\n【可用技能】\n${skillsDesc}`;
      baseSystemPrompt += `\n\n【文档检索优先规则】\n当用户明确提到“文档库”“知识库”“资料库”“内部文档”“帮我找文档”“帮我看看在哪个文档里”“某企业是否有相关规定”“文档里怎么说”“请根据文档回答”等场景时，应使用文档检索工具。6 个原子工具按意图选择：
- 搜具体文档（按标题/文件名）→ search_documents_by_metadata
- 读取文档内容/章节 → read_document_content
- 在已定位文档内搜段落 → search_chunks_in_document
- 全库内容级搜索（不知道哪个文档）→ search_chunks_globally
- 对结果精排 → rank_chunks_for_question
- 从片段反查所属文档 → resolve_documents_from_chunks

典型调用流：search_documents_by_metadata（找文档）→ search_chunks_in_document（找段落）。
如果第一步无结果，改用 search_chunks_globally → resolve_documents_from_chunks。
一次调用只选一个工具，系统内部会自动完成后续检索编排。

【已知文档ID后的行为约束（关键）】
当文档检索已返回 scoped_identity.confirmed=true 时，说明文档身份已被确认。此时：
- 禁止再发起新的文档检索去"重新搜索"该文档
- 如需更多元信息，直接用已有 document_id 告知用户
- 不要因 document_title 看起来像导入文件名就怀疑结果

优先使用文档检索工具，而非 web_search。`;
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

    // P0 观测：记录耗时
    const buildLatency = Date.now() - buildStartTime;
    logger.info(`[ExpertChatService] Minimal 上下文构建耗时: ${buildLatency}ms, 专家: ${this.expertId}`);

    return {
      messages,
      hiddenContext: contextResult.hiddenContext,
      isMinimal: true,
      buildLatency  // 返回耗时供上层使用
    };
  }

  /**
   * 将文档检索 tool 结果格式化为可注入 System Prompt 的证据上下文
   *
   * 这是"证据约束回答"的基础设施方法。当 LLM 调用了 document_retrieval
   * 文档检索工具后，
   * tool 返回的结构化 evidence 通过此方法转换为 LLM 可理解的上下文文本，
   * 包含证据充分性评估和建议的回答模式。
   *
   * @param {Object} toolResult - 文档检索 tool 的返回结果（统一按 skill_namespace 聚合消费）
   * @param {Object} options - 选项
   * @param {number} [options.maxTokens=4000] - 最大 token 数
   * @returns {string} 格式化的证据上下文文本
   */
  buildEvidenceInjection(toolResult, options = {}) {
    const { maxTokens = 4000 } = options;

    if (!toolResult || !toolResult.success) {
      return '';
    }

    let context = '';

    // audit-round03 变更项 A：优先用 workflow_action 推导约束模式
    const effectiveMode = this._resolveConstraintMode(toolResult);

    // 显式回答模式约束（高优先级，必须放在最前面）
    const modeConstraints = this._buildResponseModeConstraint(effectiveMode);
    if (modeConstraints) {
      context += modeConstraints + '\n\n';
    }

    // 使用 evidence-formatter 格式化证据上下文
    // 兼容 documents / candidates 两种返回结构（历史数据兼容）
    // audit-round04 变更项 A：packet.meta.suggested_response_mode 已删除，
    // mode 完全由 _resolveConstraintMode 根据 workflow_action 推导。
    const packet = {
      strategy: toolResult.strategy,
      meta: {
        evidence_sufficiency: toolResult.evidence_sufficiency,
        reason_codes: toolResult.reason_codes || [],
      },
      documents: toolResult.documents || toolResult.candidates || [],
    };
    context += buildEvidenceContextMessage(packet, { maxTokens });
    return context;
  }

  /**
   * audit-round03 变更项 A：从 workflow_action + evidence_sufficiency 推导约束模式
   *
   * 优先消费 workflow_action 作为主动作信号。
   *
   * audit-round04 变更项 A：suggested_response_mode 已从 tool-manager 输出面物理删除，
   * 此方法不再保留任何兼容 fallback。无 workflow_action 时直接返回 conservative_answer。
   *
   * @param {Object} toolResult
   * @returns {string} 约束模式名（clarify | candidate_list | conservative_answer | answer_with_citation | direct_answer）
   */
  _resolveConstraintMode(toolResult) {
    const action = toolResult?.workflow_action;
    if (!action) {
      // 防御性兜底：仅异常/旧数据路径触发，normal 链路 tool-manager 总是设置 workflow_action
      return 'conservative_answer';
    }

    switch (action) {
      case 'return_document_candidates':
        return 'candidate_list';
      case 'ask_for_clarification':
        return 'clarify';
      case 'decline_due_to_insufficient_evidence':
        return 'conservative_answer';
      case 'answer_with_ranked_chunks': {
        const sufficiency = toolResult?.evidence_sufficiency;
        return (sufficiency === 'strong' || sufficiency === 'medium')
          ? 'answer_with_citation'
          : 'direct_answer';
      }
      default:
        return 'conservative_answer';
    }
  }

  /**
   * 根据 response mode 生成显式回答行为约束
   *
   * audit-round03 变更项 A：由 _resolveConstraintMode() 统一推导模式，
   * 本方法仅负责模式→约束文本的映射，不再关心模式来源。
   *
   * @param {string} mode - 约束模式值（来自 _resolveConstraintMode）
   * @returns {string} 显式行为约束文本，或空字符串
   */
  _buildResponseModeConstraint(mode) {
    switch (mode) {
      case 'clarify':
        return `## ⚠️ 强制回答约束：澄清模式

**你必须遵守以下规则，不得违反：**

1. **禁止直接回答用户问题。** 检索结果显示意图模糊或信息不足，直接回答会制造伪确定性。
2. **只做两件事**：向用户说明当前无法确定其具体需求，并追问 1-2 个关键澄清问题。
3. **禁止编造证据。** 不要在澄清问题中暗示你已知道答案。
4. **保持友好。** 用帮助性的语气引导用户缩小问题范围。

## 输出模板（请严格按照以下结构输出）

**当前无法直接回答：** [一句话说明无法确定的原因]

**请确认以下问题：**
1. [基于检索到的文档内容，提出第一个精准澄清问题]
2. [如需进一步缩小范围，提出第二个问题]`;

      case 'candidate_list':
        // ⚠️ 防御性 fallback：candidate_list 已在 _getResponseModeDecision 中短路 LLM，
        // 此分支仅在非流式/流式路径未正确调用 dispatcher 时兜底，不参与主控制面。
        return `## ⚠️ 强制回答约束：候选列表模式（fallback）

**你必须遵守以下规则，不得违反：**

1. **禁止选择单一文档作为确定性答案。** 检索到多个高置信度候选文档，直接选一个会误导用户。
2. **列出候选文档**（最多 5 个），每个附带：文档标题、文档类型、简短摘要（1 句话）。
3. **引导用户确认**：请用户指出最相关的文档后再给出详细回答。
4. **禁止编造文档内容。** 只列出检索到的真实文档，将未检索到的文档当成候选也是不允许的。`;

      case 'conservative_answer':
        return `## ⚠️ 强制回答约束：保守回答模式

**你必须遵守以下规则，不得违反：**

1. **禁止给确定性的结论。** 证据不足时，不要用"根据文档..."开头来伪装确定性。
2. **明确告知依据有限。** 使用"目前检索到的信息有限""未找到明确依据"等表述。
3. **可以给出参考信息**，但必须注明证据强度较弱，仅供参考。
4. **不要补充超出检索结果的内容。** 如果你不了解某事，直接说"根据当前文档资料，我无法确认这一点"。

## 输出模板（请严格按照以下结构输出）

**⚠️ 依据有限声明：** 目前从文档平台检索到的信息有限，以下回答仅供参考，可能存在不完整之处。

**参考信息：**
[基于检索到的证据片段，整理可提供的参考内容]

**不确定性提示：** [明确指出哪些部分缺乏充分证据支撑，建议用户进一步核实]`;

      default:
        return '';
    }
  }

  /**
   * 生成候选文档列表回复（显式编排，不调用 LLM）
   *
   * @param {Object} docRetrievalResult - 文档检索 tool 的返回结果（来自 document_retrieval）
   * @returns {string} Markdown 格式的候选文档列表
   */
  _buildCandidateListResponse(docRetrievalResult) {
    // 兼容 documents / candidates 两种返回结构（历史数据兼容）
    const documents = docRetrievalResult?.documents || docRetrievalResult?.candidates || [];
    const strategy = docRetrievalResult?.strategy || 'document_first';

    if (documents.length === 0) {
      return '根据您的问题，我在文档平台中进行了检索，但未找到匹配的文档。\n\n请您提供更多信息，或者尝试换一种方式描述您的需求。';
    }

    let response = `根据您的问题，我在文档平台中找到以下可能相关的文档（检索策略：${strategy}）：\n\n`;

    for (let i = 0; i < Math.min(documents.length, 5); i++) {
      const doc = documents[i];
      const title = doc.document_title || '未命名文档';
      const docType = doc.doc_type || 'unknown';
      const collection = doc.collection_name || '未知集合';
      const relevance = Math.round((doc.relevance_score || 0) * 100);
      const confidence = doc.candidate_confidence || 'unknown';

      response += `### ${i + 1}. ${title}\n`;
      response += `- **类型**: ${docType} | **集合**: ${collection}\n`;
      response += `- **相关度**: ${relevance}% | **置信度**: ${confidence}\n`;

      // 从 top evidence 提取一句话摘要
      if (doc.top_evidence && doc.top_evidence.length > 0) {
        const snippet = doc.top_evidence[0].content?.substring(0, 200) || '';
        if (snippet) {
          response += `- **摘要**: "${snippet}..."\n`;
        }
      }
      response += '\n';
    }

    response += '---\n';
    response += '请告诉我您最关心以上哪个文档，我会为您提供详细信息。';

    return response;
  }

  /**
   * 统一回答模式决策入口（流式与非流式共用）
   *
   * audit-round04 变更项 A：suggested_response_mode 兼容字段已物理删除，
   * workflow_action 是唯一主动作信号。无 workflow_action 时仅做防御性兜底。
   *
   * 决策规则（以 workflow_action 为主）：
   * - return_document_candidates → 直接格式化（短路 LLM）
   * - ask_for_clarification → LLM + 澄清约束
   * - decline_due_to_insufficient_evidence → LLM + 保守回答约束
   * - answer_with_ranked_chunks → LLM + 证据注入
   * - 无 workflow_action → 防御性 conservative_answer + 证据注入兜底
   *
   * @param {Object|null} docRetrievalResult - 文档检索 tool 的返回结果
   * @returns {{ mode: string|null, isShortCircuit: boolean, directResponse: string|null, evidenceInjection: string|null }}
   */
  _getResponseModeDecision(docRetrievalResult) {
    const workflowAction = docRetrievalResult?.workflow_action || null;

    const decision = {
      mode: null,
      isShortCircuit: false,
      directResponse: null,
      evidenceInjection: null,
    };

    if (!docRetrievalResult?.success) {
      return decision;
    }

    // audit-round03 变更项 A：优先按 workflow_action 决策
    if (workflowAction === 'return_document_candidates') {
      decision.directResponse = this._buildCandidateListResponse(docRetrievalResult);
      decision.isShortCircuit = true;
      decision.mode = 'candidate_list'; // 兼容旧日志
    } else if (workflowAction === 'ask_for_clarification') {
      decision.evidenceInjection = this._buildResponseModeConstraint('clarify');
      // clarify 也走 LLM 但带强制澄清约束（不短路，让 LLM 生成自然追问）
      decision.mode = 'clarify';
    } else if (workflowAction === 'decline_due_to_insufficient_evidence') {
      decision.evidenceInjection = this._buildResponseModeConstraint('conservative_answer');
      decision.mode = 'conservative_answer';
    } else if (workflowAction === 'answer_with_ranked_chunks') {
      decision.evidenceInjection = this.buildEvidenceInjection(docRetrievalResult, { maxTokens: 4000 });
      // mode 由 evidence_sufficiency 推断，而非固定值
      decision.mode = docRetrievalResult?.evidence_sufficiency === 'strong'
        ? 'answer_with_citation'
        : 'direct_answer';
    } else {
      // 防御性兜底：无 workflow_action（仅异常/旧数据路径触发）。
      // audit-round04 变更项 A：不再读取 suggested_response_mode（已物理删除），
      // 直接以 conservative_answer 作为安全兜底并注入证据。
      decision.evidenceInjection = this.buildEvidenceInjection(docRetrievalResult, { maxTokens: 4000 });
      decision.mode = 'conservative_answer';
    }

    // 统一日志（新增 workflow_action 字段）
    logger.info('[ExpertChatService._getResponseModeDecision] retrieval round result (tool path):', {
      retrieval_source: 'tool_only',
      workflow_action: workflowAction,
      response_mode: decision.mode,
      is_short_circuit: decision.isShortCircuit,
      evidence_sufficiency: docRetrievalResult.evidence_sufficiency,
      doc_count: (docRetrievalResult.documents || docRetrievalResult.candidates || []).length,
      strategy: docRetrievalResult.strategy,
    });

    return decision;
  }

  /**
   * 从 toolResults 中按 skill_namespace 查找 document retrieval 结果
   *
   * audit-round07 变更项 P0-A：LLM 可见 6 个原子 tool，
   * 通过 skill_namespace === 'document_retrieval' 聚合匹配。
   *
   * @param {Array} toolResults - 工具执行结果数组
   * @returns {Object|null} document retrieval skill 的第一个成功结果，或 null
   */
  _findDocRetrievalResult(toolResults) {
    if (!toolResults || toolResults.length === 0) return null;
    return toolResults.find(r =>
      r?.skill_namespace === 'document_retrieval'
    ) || null;
  }

  /**
   * P1-1: 统一的 document retrieval 消费入口
   *
   * 封装"查找结果 → 模式决策 → 统一日志"三步，
   * 消除流式/非流式路径中的重复逻辑。
   *
   * @param {Array} toolResults - 工具执行结果数组
   * @param {Object} logContext - 日志上下文
   * @param {string} logContext.caller - 调用方标识（如 '_executeLLMRounds' | 'chat'）
   * @param {Object} [logContext.extra] - 额外日志字段（如 round）
   * @returns {{ found: boolean, docRetrievalResult: Object|null, modeDecision: Object|null }}
   */
  _consumeDocRetrievalResult(toolResults, logContext = {}) {
    const docRetrievalResult = this._findDocRetrievalResult(toolResults);

    if (!docRetrievalResult?.success) {
      return { found: false, docRetrievalResult: null, modeDecision: null };
    }

    const modeDecision = this._getResponseModeDecision(docRetrievalResult);

    // 统一可观测性日志（audit-round03：新增 workflow_action 字段）
    logger.info(`[ChatService.${logContext.caller}] doc retrieval result consumed:`, {
      retrieval_source: 'tool_only',
      tool_name: docRetrievalResult.tool_name || docRetrievalResult.toolName || 'document_retrieval',
      skill_namespace: docRetrievalResult.skill_namespace || null,
      workflow_action: docRetrievalResult.workflow_action || null,
      response_mode: modeDecision.mode,
      is_short_circuit: modeDecision.isShortCircuit,
      evidence_sufficiency: docRetrievalResult.evidence_sufficiency,
      strategy: docRetrievalResult.strategy,
      document_count: docRetrievalResult.documents?.length || docRetrievalResult.candidates?.length || 0,
      duration_ms: docRetrievalResult.duration,
      reason_codes: docRetrievalResult.reason_codes,
      ...(logContext.extra || {}),
    });

    return { found: true, docRetrievalResult, modeDecision };
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
    // P0: minimal 策略使用 Psyche Reflection，停用通用反思
    if (this.expertConfig?.expert?.context_strategy === 'minimal') {
      logger.debug(`[ExpertChatService] minimal 策略跳过通用反思（已由 Psyche Reflection 处理）`);
      return;
    }

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

      // P0 观测：记录反思来源（general = 通用反思，仅 full/simple 策略）
      logger.info(`[ExpertChatService] 反思完成 (source=general), 专家: ${this.expertId}, 策略: ${this.expertConfig?.expert?.context_strategy || 'full'}`);

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
   * 中止指定用户的 LLM 请求
   * @param {string} userId - 用户ID
   * @returns {boolean} 是否成功中止
   */
  abortUserRequest(userId) {
    if (!this.llmClient) {
      logger.warn(`[ExpertChatService] abortUserRequest: LLMClient not initialized`);
      return false;
    }
    const aborted = this.llmClient.abortUserRequest(userId);
    logger.info(`[ExpertChatService] abortUserRequest: user=${userId}, expert=${this.expertId}, aborted=${aborted}`);
    return aborted;
  }

  /**
   * 中止指定 request_id 的请求
   * @param {string} requestId - 请求ID
   * @returns {boolean} 是否成功中止
   */
  abortRequest(requestId) {
    if (!this.llmClient) {
      logger.warn(`[ExpertChatService] abortRequest: LLMClient not initialized`);
      return false;
    }
    const aborted = this.llmClient.abortRequest(requestId);
    logger.info(`[ExpertChatService] abortRequest: request_id=${requestId}, expert=${this.expertId}, aborted=${aborted}`);
    return aborted;
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
   * @param {Object} modelConfig - 模型配置（可选，用于覆盖默认模型）
   * @returns {Object} { thinking, reasoning, reasoning_effort, enable_thinking, chat_template_kwargs, format, source }
   */
  getThinkingConfig(modelConfig = null) {
    const model = modelConfig || this.expertConfig?.expressiveModel;
    return resolveThinkingRequestConfig(model, {
      enable_reasoning: true,
      logger_prefix: '[ExpertChatService]',
    });
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
// audit-round03 变更项 C：导出 ExpertChatService 用于消费层测试
export { ExpertChatService };
