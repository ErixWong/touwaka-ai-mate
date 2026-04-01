/**
 * Reflection Service - 反思服务
 * 调用 LLM 生成新的 Psyche，实现自动反思更新
 */

import logger from '../logger.js';

/**
 * 反思服务类
 * 负责调用 LLM 分析对话并生成 Psyche 更新
 */
export class ReflectionService {
  constructor(llmClient, config = {}) {
    this.llmClient = llmClient;
    this.config = {
      model: config.model || 'gpt-4o-mini',
      temperature: config.temperature || 0.3,
      maxTokens: config.maxTokens || 2000,
      lookbackRounds: config.lookbackRounds || 4,
      // 反思 LLM 的上下文限制（默认 128k，与 gpt-4o-mini 一致）
      reflectionContextSize: config.reflectionContextSize || 128000,
      // 输入占反思 LLM 上下文的比例上限（默认 85%，预留 15% 给输出和系统提示）
      inputTokenRatio: config.inputTokenRatio || 0.85,
      ...config
    };
  }

  /**
   * 应用滑动窗口：基于 token 数限制，从最早的消息开始移除
   * 策略：确保输入 token 数不超过反思 LLM 上下文的 inputTokenRatio（默认 85%）
   * @param {Array} messages - 消息列表
   * @param {Object} currentPsyche - 当前 Psyche（也需要计入 token）
   * @param {Array} topics - Topics（也需要计入 token）
   * @returns {Array} 截断后的消息列表
   */
  _applySlidingWindow(messages, currentPsyche, topics) {
    if (!messages || messages.length === 0) return [];
    
    // 计算最大允许的输入 token 数
    const maxInputTokens = Math.floor(this.config.reflectionContextSize * this.config.inputTokenRatio);
    
    // 估算固定部分（Psyche + Topics + 提示词模板）的 token 数
    const psycheTokens = this._estimateJsonTokens(currentPsyche);
    const topicsTokens = this._estimateTopicsTokens(topics);
    const promptTemplateTokens = 1500; // 提示词模板约 1500 tokens
    const fixedTokens = psycheTokens + topicsTokens + promptTemplateTokens;
    
    // 消息部分可用的 token 预算
    const messagesBudget = maxInputTokens - fixedTokens;
    
    logger.debug(`[ReflectionService] Token 预算: 最大输入=${maxInputTokens}, 固定开销=${fixedTokens}, 消息预算=${messagesBudget}`);
    
    // 估算当前消息的 token 数
    let currentTokens = this._estimateMessagesTokens(messages);
    
    // 如果未超过预算，直接返回
    if (currentTokens <= messagesBudget) {
      logger.debug(`[ReflectionService] 消息 token 数 ${currentTokens} 在预算 ${messagesBudget} 内，无需截断`);
      return messages;
    }
    
    // 创建副本，从最早的消息开始移除
    let result = [...messages];
    let removedCount = 0;
    
    while (result.length > 0 && currentTokens > messagesBudget) {
      // 移除最早的消息（数组开头）
      const removed = result.shift();
      removedCount++;
      
      // 重新计算 token 数
      currentTokens = this._estimateMessagesTokens(result);
      
      // 安全保护：至少保留 4 条消息（2轮对话）
      if (result.length <= 4) {
        logger.warn(`[ReflectionService] 已到达最小消息数限制 (4条)，停止移除。当前 token 数可能超出预算`);
        break;
      }
    }
    
    logger.info(`[ReflectionService] 滑动窗口: 移除了 ${removedCount} 条最早的消息，剩余 ${result.length} 条，消息部分 ${currentTokens}/${messagesBudget} tokens`);
    logger.info(`[ReflectionService] 总输入估算: ${fixedTokens + currentTokens}/${maxInputTokens} tokens (${((fixedTokens + currentTokens) / this.config.reflectionContextSize * 100).toFixed(1)}% of ${this.config.reflectionContextSize})`);
    
    return result;
  }

  /**
   * 估算 JSON 对象的 token 数
   * @param {Object} json - JSON 对象
   * @returns {number} 估算的 token 数
   */
  _estimateJsonTokens(json) {
    if (!json) return 0;
    const str = JSON.stringify(json);
    // JSON 字符串：1 token ≈ 4 字符
    return Math.ceil(str.length / 4);
  }

  /**
   * 估算 Topics 的 token 数
   * @param {Array} topics - Topics 列表
   * @returns {number} 估算的 token 数
   */
  _estimateTopicsTokens(topics) {
    if (!topics || topics.length === 0) return 0;
    let total = 0;
    for (const t of topics) {
      const text = `${t.title || ''} ${t.description || ''}`;
      total += Math.ceil(text.length / 4) + 4; // +4 for formatting
    }
    return total;
  }

  /**
   * 估算消息列表的 token 数
   * @param {Array} messages - 消息列表
   * @returns {number} 估算的 token 数
   */
  _estimateMessagesTokens(messages) {
    if (!messages || messages.length === 0) return 0;
    
    let total = 0;
    for (const msg of messages) {
      // 内容 token：1 token ≈ 4 字符
      const content = msg.content || '';
      total += Math.ceil(content.length / 4);
      
      // 角色和格式开销：约 4 tokens/条
      total += 4;
    }
    
    return total;
  }

  /**
   * 执行反思，生成 Psyche 更新
   * @param {Object} currentPsyche - 当前 Psyche 数据
   * @param {Array} recentMessages - 最近对话消息（包含 tool 消息）
   * @param {Array} topics - 相关 Topics
   * @param {Object} options - 额外选项 { userId, expertId, dialogCount }
   * @returns {Object} 反思结果，用于更新 Psyche
   */
  async reflect(currentPsyche, recentMessages, topics = [], options = {}) {
    // 使用滑动窗口：基于 token 数限制，从最早的消息开始移除，直到符合要求
    // 输入限制为反思 LLM 上下文的 85%，预留 15% 给输出和系统提示
    const messagesToProcess = this._applySlidingWindow(recentMessages, currentPsyche, topics);
    
    if (messagesToProcess.length < recentMessages.length) {
      logger.info(`[ReflectionService] 消息从 ${recentMessages.length} 条截断至 ${messagesToProcess.length} 条`);
    }
    
    const prompt = this._buildReflectionPrompt(currentPsyche, messagesToProcess, topics, {
      ...options,
      originalMessageCount: recentMessages.length
    });
    
    try {
      logger.debug('[ReflectionService] 开始反思...');
      // 使用 llmClient.call 方法，构造模型配置
      const modelConfig = {
        model_name: this.config.model,
        base_url: this.llmClient.config?.expressiveModel?.base_url || 'https://api.openai.com/v1',
        api_key: this.llmClient.config?.expressiveModel?.api_key || '',
        max_output_tokens: this.config.maxTokens,
      };
      
      const response = await this.llmClient.call(
        modelConfig,
        [{ role: 'user', content: prompt }],
        {
          temperature: this.config.temperature,
          max_output_tokens: this.config.maxTokens,
          response_format: { type: 'json_object' }
        }
      );

      // llmClient.call 返回 { content, toolCalls, reasoningContent, usage, model }
      const content = response.content;
      if (!content) {
        throw new Error('LLM 返回空内容');
      }

      logger.debug('[ReflectionService] LLM 原始响应:', content.substring(0, 500));

      // 尝试提取 JSON（LLM 可能返回 markdown 代码块）
      let jsonContent = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonContent = jsonMatch[1].trim();
        logger.debug('[ReflectionService] 从代码块提取 JSON');
      }

      const reflection = JSON.parse(jsonContent);
      logger.info('[ReflectionService] 反思成功生成:', {
        has_session_meta: !!reflection.session_meta,
        has_methodology: !!reflection.methodology,
        has_key_exchange: !!reflection.key_exchange,
        current_topic: reflection.session_meta?.current_topic,
        current_phase: reflection.methodology?.current_phase
      });
      logger.debug('[ReflectionService] 反思完成');
      return reflection;
    } catch (error) {
      logger.error('[ReflectionService] 反思失败:', error.message);
      // 返回最小化的更新，避免中断流程
      return this._createFallbackReflection(currentPsyche, recentMessages, topics);
    }
  }

  /**
   * 构建反思 Prompt
   * @param {Object} currentPsyche - 当前 Psyche 数据
   * @param {Array} recentMessages - 最近对话消息（包含 tool 消息，可能已被截断）
   * @param {Array} topics - 相关 Topics
   * @param {Object} options - 额外选项
   */
  _buildReflectionPrompt(currentPsyche, recentMessages, topics, options) {
    const { dialogCount = 0, originalMessageCount } = options;
    const actualMessageCount = originalMessageCount || recentMessages.length;
    
    // 1. 构建对话文本（包含工具调用）
    const messagesText = this._formatMessagesForPrompt(recentMessages);
    
    // 2. 构建工具调用摘要
    const toolCallSummary = this._summarizeToolCalls(recentMessages);
    
    // 3. 构建 Topics 引用
    const topicsText = topics.length > 0
      ? topics.map(t => `- ${t.title} (ID: ${t.id}, 消息数: ${t.message_count || 0})`).join('\n')
      : '暂无相关话题';
    
    const currentPsycheText = JSON.stringify(currentPsyche, null, 2);

    return `你是一位专业的对话分析师。请分析以下对话，更新"心神"(Psyche)状态。

## 当前心神状态
\`\`\`json
${currentPsycheText}
\`\`\`

## 相关话题（可用于 recall）
${topicsText}

## 工具调用摘要
${toolCallSummary}

## 最近对话（${dialogCount} 轮，${actualMessageCount} 条消息${originalMessageCount && originalMessageCount > recentMessages.length ? '，已截断显示最新 ' + recentMessages.length + ' 条' : ''}）
${messagesText}

## 任务
请分析对话内容，生成心神更新。你需要：

1. **识别用户意图**：用户想要做什么？
2. **判断工作方向**：是需要继续向用户提问澄清，还是继续执行任务？
3. **给出背景和过程**：之前做了什么尝试？有什么参考？
4. **决定下一步行动**：应该做什么？

## 输出格式（必须是有效的 JSON）
\`\`\`json
{
  "session_meta": {
    "current_topic": "当前讨论的主题（简洁明确）",
    "user_intent": "用户意图（一句话描述）",
    "conversation_round": 对话轮次数字
  },
  "methodology": {
    "approach": "采用的方法论（如：收集需求 → 分析问题 → 提出方案）",
    "current_phase": "当前阶段 (init/clarification/execution/review/complete)",
    "next_action": "下一步行动（具体明确）"
  },
  "key_exchange": {
    "round": 当前轮次,
    "summary": "本轮对话的关键内容摘要（包含工具调用结果）"
  },
  "key_decisions": ["已确定的关键决策1", "已确定的关键决策2"],
  "pending_questions": ["待确认问题1", "待确认问题2"],
  "tool_summary": [
    {"tool": "工具名", "action": "做了什么", "result": "结果摘要"}
  ],
  "topics_context": [
    {"topic_id": "话题ID", "title": "话题标题", "relevance": 0.95}
  ],
  "working_memory": {
    "calculated_values": {"key": "value"},
    "temp_notes": "临时笔记内容"
  }
}
\`\`\`

## 注意事项
1. 只输出 JSON，不要其他内容
2. 如果话题切换了，要反映在 current_topic 中
3. 工具调用摘要要简洁，只保留关键信息
4. pending_questions 只保留真正需要用户确认的问题
5. 确保 JSON 格式正确`;
  }

  /**
   * 格式化消息用于 Prompt
   */
  _formatMessagesForPrompt(messages) {
    // 构建 tool_call_id 到工具名称的映射
    const toolCallIdToName = this._buildToolCallIdMap(messages);
    
    return messages.map((msg, idx) => {
      const roleMap = {
        'user': '用户',
        'assistant': 'AI',
        'tool': '工具',
        'system': '系统'
      };
      const role = roleMap[msg.role] || msg.role;
      
      // 对于 tool 消息，使用 tool_call_id 查找工具名称
      if (msg.role === 'tool') {
        const toolName = toolCallIdToName.get(msg.tool_call_id) || 'unknown';
        const contentPreview = msg.content?.substring(0, 200) || '';
        return `[${idx + 1}] [工具:${toolName}] ${contentPreview}`;
      }
      
      // 对于 assistant 消息，如果有 tool_calls，显示调用信息
      if (msg.role === 'assistant' && msg.tool_calls) {
        // 确保 tool_calls 是数组（可能需要解析）
        const toolCalls = this._safeParseToolCalls(msg.tool_calls);
        const toolCallsText = toolCalls.map(tc =>
          `${tc.function?.name || 'unknown'}(${(tc.function?.arguments || '').substring(0, 100)})`
        ).join(', ');
        const contentPreview = msg.content?.substring(0, 300) || '';
        return `[${idx + 1}] AI: ${contentPreview}\n[调用工具: ${toolCallsText}]`;
      }
      
      return `[${idx + 1}] ${role}: ${msg.content?.substring(0, 500) || ''}`;
    }).join('\n\n');
  }

  /**
   * 构建 tool_call_id 到工具名称的映射
   * 从 assistant 消息的 tool_calls 中提取
   */
  _buildToolCallIdMap(messages) {
    const map = new Map();
    
    messages.forEach(msg => {
      if (msg.role === 'assistant' && msg.tool_calls) {
        const toolCalls = this._safeParseToolCalls(msg.tool_calls);
        toolCalls.forEach(tc => {
          if (tc.id) {
            map.set(tc.id, tc.function?.name || 'unknown');
          }
        });
      }
    });
    
    return map;
  }

  /**
   * 安全解析 tool_calls（可能是字符串或数组）
   */
  _safeParseToolCalls(toolCalls) {
    if (!toolCalls) return [];
    if (Array.isArray(toolCalls)) return toolCalls;
    if (typeof toolCalls === 'string') {
      try {
        const parsed = JSON.parse(toolCalls);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  /**
   * 总结工具调用
   */
  _summarizeToolCalls(messages) {
    const toolMessages = messages.filter(m => m.role === 'tool');
    const assistantWithTools = messages.filter(m =>
      m.role === 'assistant' && m.tool_calls
    );
    
    if (toolMessages.length === 0 && assistantWithTools.length === 0) {
      return '本次对话无工具调用';
    }
    
    const summaries = [];
    const toolCallIdToName = this._buildToolCallIdMap(messages);
    
    // 从 tool 消息中提取结果摘要
    toolMessages.forEach(msg => {
      const toolName = toolCallIdToName.get(msg.tool_call_id) || 'unknown';
      const resultPreview = msg.content?.substring(0, 50) || '完成';
      summaries.push(`- ${toolName}: ${resultPreview}`);
    });
    
    // 从 assistant 消息中提取工具调用意图
    assistantWithTools.forEach(msg => {
      const toolCalls = this._safeParseToolCalls(msg.tool_calls);
      toolCalls.forEach(tc => {
        // 如果还没有从 tool 消息中记录，则从 assistant 消息记录
        if (!toolCallIdToName.has(tc.id)) {
          summaries.push(`- ${tc.function?.name || 'unknown'}: 调用中`);
        }
      });
    });
    
    return summaries.length > 0
      ? summaries.join('\n')
      : '本次对话无工具调用';
  }

  /**
   * 创建回退反思结果（当 LLM 调用失败时）
   */
  _createFallbackReflection(currentPsyche, recentMessages, topics = []) {
    const lastMessage = recentMessages[recentMessages.length - 1];
    const round = (currentPsyche.session_meta?.conversation_round || 0) + 1;

    // 从最近的用户消息中提取可能的意图
    const lastUserMessage = [...recentMessages].reverse().find(m => m.role === 'user');
    
    return {
      session_meta: {
        conversation_round: round,
        last_updated: new Date().toISOString(),
        current_topic: currentPsyche.session_meta?.current_topic || null,
        user_intent: lastUserMessage?.content?.substring(0, 50) || null
      },
      methodology: {
        current_phase: currentPsyche.methodology?.current_phase || 'init'
      },
      key_exchange: {
        round: round,
        summary: lastMessage?.content?.substring(0, 100) || '继续对话'
      },
      topics_context: topics.slice(0, 3).map(t => ({
        topic_id: t.id,
        title: t.title,
        relevance: 0.8
      }))
    };
  }

  /**
   * 批量反思（用于历史消息重建 Psyche）
   */
  async reflectBatch(messages, batchSize = 4) {
    const reflections = [];
    
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      const reflection = await this.reflect(
        i === 0 ? {} : reflections[reflections.length - 1],
        batch
      );
      reflections.push(reflection);
    }

    return reflections;
  }
}

export default ReflectionService;  
