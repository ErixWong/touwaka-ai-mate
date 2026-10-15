/**
 * Reflection Service - 反思服务
 * 调用 LLM 生成新的 Psyche，实现自动反思更新
 */

import logger from '../logger.js';
import { estimateMessagesTokens, estimateTokens } from '../token-utils.js';
import { parseJsonLikeContent } from '../json-parse-utils.js';

/** 作废日志里带出的原文长度（只打 error.message 不足以复现模型返回的形状） */
const RAW_PREVIEW_CHARS = 200;

/**
 * 内容拿到了、但提不出可用的 JSON 对象。
 * 与「LLM 调用失败」区分开，便于在日志里分诊两类作废原因。
 */
class ReflectionParseError extends Error {
  constructor(content, detail = '') {
    super(`响应中无可用的 JSON 对象${detail ? `（${detail}）` : ''}`);
    this.name = 'ReflectionParseError';
    this.contentLength = typeof content === 'string' ? content.length : 0;
    this.contentPreview = typeof content === 'string' ? content.slice(0, RAW_PREVIEW_CHARS) : String(content ?? '');
  }
}

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

  _applyLookbackRounds(messages) {
    if (!messages || messages.length === 0) return [];

    const lookbackRounds = Math.max(1, parseInt(this.config.lookbackRounds, 10) || 4);
    let userRoundsSeen = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') {
        userRoundsSeen++;
        if (userRoundsSeen === lookbackRounds) {
          const result = messages.slice(i);
          logger.info(`[ReflectionService] lookbackRounds=${lookbackRounds}: 消息从 ${messages.length} 条裁剪至 ${result.length} 条`);
          return result;
        }
      }
    }

    return messages;
  }

  /**
   * 估算 JSON 对象的 token 数
   * @param {Object} json - JSON 对象
   * @returns {number} 估算的 token 数
   */
  _estimateJsonTokens(json) {
    return estimateTokens(json);
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
      total += estimateTokens(text) + 4; // +4 for formatting
    }
    return total;
  }

  /**
   * 估算消息列表的 token 数
   * @param {Array} messages - 消息列表
   * @returns {number} 估算的 token 数
   */
  _estimateMessagesTokens(messages) {
    return estimateMessagesTokens(Array.isArray(messages) ? messages : []);
  }

  /**
   * 执行反思，生成 Psyche 更新
   * @param {Object} currentPsyche - 当前 Psyche 数据
   * @param {Array} recentMessages - 最近对话消息（包含 tool 消息）
   * @param {Array} topics - 相关 Topics
   * @param {Object} options - 额外选项 { userId, expertId, dialogCount }
   * @returns {Promise<Object|null>} 反思结果，用于更新 Psyche；
   *   **null = 本轮反思作废**（LLM 调用失败，或响应里提不出可用 JSON）。
   *   作废时调用方必须跳过 `updateFromReflection`——本方法不再返回「最小化默认反思」，
   *   因为那会把一次可见的失败换成一条不可见的假反思写进 psyche（#1214）。
   */
  async reflect(currentPsyche, recentMessages, topics = [], options = {}) {
    const lookbackMessages = this._applyLookbackRounds(recentMessages);
    // 使用滑动窗口：基于 token 数限制，从最早的消息开始移除，直到符合要求
    // 输入限制为反思 LLM 上下文的 85%，预留 15% 给输出和系统提示
    const messagesToProcess = this._applySlidingWindow(lookbackMessages, currentPsyche, topics);
    
    if (messagesToProcess.length < lookbackMessages.length) {
      logger.info(`[ReflectionService] 消息从 ${lookbackMessages.length} 条截断至 ${messagesToProcess.length} 条`);
    }
    
    const prompt = this._buildReflectionPrompt(currentPsyche, messagesToProcess, topics, {
      ...options,
      originalMessageCount: recentMessages.length,
      selectedMessageCount: messagesToProcess.length
    });
    
    try {
      logger.debug('[ReflectionService] 开始反思...');
      const response = await this.llmClient.callReflective(
        [{ role: 'user', content: prompt }],
        {
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

      // 容错提取 JSON：模型实际输出常是「JSON + 尾部解释文字」「```json 围栏之后还有话」
      // 「前面多一句好的，以下是分析：」——只剥整段围栏的老写法在这些形状上必抛
      // `Unexpected non-whitespace character after JSON`（#1214 的 13 次静默作废）。
      // 复用 lib/json-parse-utils.js，不再手抄第 5 份。
      // returnRawOnFail=false：提不出来就得到 null。默认的 `{ _parse_failed, _raw }` 哨兵是对象，
      // 一旦当反思结果往下喂，会变成一条字段全默认值的假反思（比作废更糟，因为看不出来）。
      const parsed = parseJsonLikeContent(content, {
        returnRawOnFail: false,
        logPrefix: '[ReflectionService]'
      });

      if (!this._isUsableReflection(parsed)) {
        throw new ReflectionParseError(content, parsed === null ? '提取后仍解析失败' : '提取结果不是 JSON 对象');
      }

      logger.info('[ReflectionService] 反思成功生成:', {
        has_session_meta: !!parsed.session_meta,
        has_methodology: !!parsed.methodology,
        has_key_exchange: !!parsed.key_exchange,
        current_topic: parsed.session_meta?.current_topic,
        current_phase: parsed.methodology?.current_phase
      });
      logger.debug('[ReflectionService] 反思完成');
      return parsed;
    } catch (error) {
      // 作废：本轮不产出反思，也不塞默认值兜底（调用方见 null 必须跳过 updateFromReflection）
      const invalidationNote = '反思作废（本轮不更新 psyche）';
      if (error instanceof ReflectionParseError) {
        logger.error(`[ReflectionService] 反思失败: ${error.message} —— ${invalidationNote}; ` +
          `响应长度=${error.contentLength}; 原文前 ${RAW_PREVIEW_CHARS} 字=${JSON.stringify(error.contentPreview)}`);
      } else {
        logger.error(`[ReflectionService] 反思失败: ${error.message} —— ${invalidationNote}`);
      }
      return null;
    }
  }

  /**
   * 解析结果是否可以当反思结果用。
   * 必须挡住三种东西：null（提取失败）、`{ _parse_failed, _raw }` 哨兵、顶层数组/标量
   * （`updateFromReflection` 只认 session_meta / methodology 等顶层字段，喂数组会静默 no-op）。
   */
  _isUsableReflection(parsed) {
    return !!parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && parsed._parse_failed !== true;
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
   * 批量反思（用于历史消息重建 Psyche）
   * 作废的批次返回 null 占位：不把 null 当「空反思」往下传，
   * 种子回退到上一个非空反思（首批就作废则用 {}）。
   */
  async reflectBatch(messages, batchSize = 4) {
    const reflections = [];
    let seed = {};

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      const reflection = await this.reflect(seed, batch);
      reflections.push(reflection);
      if (reflection) {
        seed = reflection;
      }
    }

    return reflections;
  }
}

export default ReflectionService;  
