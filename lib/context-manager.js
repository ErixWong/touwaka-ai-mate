/**
 * Context Manager - 上下文管理器
 * 负责构建发送给 LLM 的完整上下文
 *
 * 架构：System Prompt + Soul + Inner Voice + Topic Context + Contact Profile + Recent Messages
 *
 * 重构说明：
 * - 现在内部使用 ContextOrganizerFactory 来选择策略
 * - 保持原有 API 向后兼容
 * - 支持通过 expertConfig.expert.context_strategy 配置策略
 */

import logger from './logger.js';
import { ContextOrganizerFactory } from './context-organizer/index.js';

/**
 * 处理单条多模态消息
 * 如果内容是 JSON 字符串且包含多模态结构，则解析为标准格式
 * @param {Object} msg - 消息对象 { role, content }
 * @returns {Object} 处理后的消息
 */
function processSingleMultimodalMessage(msg) {
  if (!msg.content) {
    return { role: msg.role, content: '' };
  }

  // 如果已经是数组格式，直接返回
  if (Array.isArray(msg.content)) {
    return { role: msg.role, content: msg.content };
  }

  // 尝试解析 JSON
  if (typeof msg.content === 'string' && msg.content.startsWith('[')) {
    try {
      const parsed = JSON.parse(msg.content);
      if (Array.isArray(parsed)) {
        return { role: msg.role, content: parsed };
      }
    } catch (e) {
      // 解析失败，保持原样
    }
  }

  return { role: msg.role, content: msg.content };
}

class ContextManager {
  /**
   * @param {object} expertConfig - 专家配置（从数据库加载）
   * @param {object} options - 可选配置
   * @param {number} options.recentMessageCount - 最近消息数量（默认 20，已废弃）
   * @param {number} options.innerVoiceCount - 注入的 Inner Voice 数量（默认 3）
   * @param {string} options.strategy - 上下文组织策略（默认 'full'）
   */
  constructor(expertConfig, options = {}) {
    this.expertConfig = expertConfig;
    this.options = {
      recentMessageCount: options.recentMessageCount || 20,  // 已废弃，保留向后兼容
      innerVoiceCount: options.innerVoiceCount || 3,
      strategy: options.strategy || expertConfig?.expert?.context_strategy || 'full',
    };

    // 从专家配置中提取 Soul（保留向后兼容）
    this.soul = this.extractSoul(expertConfig);

    // 创建上下文组织器
    this.organizer = ContextOrganizerFactory.create(this.options.strategy, expertConfig, {
      innerVoiceCount: this.options.innerVoiceCount,
    });

    logger.info(`[ContextManager] 使用上下文组织策略: ${this.options.strategy}`);
  }

  /**
   * 从专家配置中提取 Soul
   * 注：字段现在按纯字符串存储，不再需要 JSON 解析
   */
  extractSoul(expertConfig) {
    const expert = expertConfig.expert || expertConfig;

    return {
      coreValues: expert.core_values || '',
      taboos: expert.taboos || '',
      emotionalTone: expert.emotional_tone || '',
      behavioralGuidelines: expert.behavioral_guidelines || '',
      speakingStyle: expert.speaking_style || '',
    };
  }

  /**
   * 构建完整的 LLM 上下文（新设计）
   *
   * 上下文结构：
   * 1. System Prompt（系统提示词）
   * 2. Skills Info（可用技能描述）
   * 3. Task Context（任务工作空间上下文，如果有的话）
   * 4. Topic Summaries（话题总结，从 topics 表加载）
   * 5. Unarchived Messages（未归档消息，topic_id IS NULL）
   *
   * @param {MemorySystem} memorySystem - 记忆系统实例
   * @param {string} userId - 用户ID
   * @param {object} options - 构建选项
   * @param {string} options.currentMessage - 当前用户消息
   * @param {boolean} options.includeInnerVoices - 是否包含 Inner Voices（默认 true）
   * @param {boolean} options.includeTopicSummaries - 是否包含 Topic 总结（默认 true）
   * @param {Array} options.skills - 可用技能列表（用于注入技能描述）
   * @param {object} options.taskContext - 任务上下文（任务工作空间模式）
   * @returns {Promise<object>} 上下文对象
   */
  async buildContext(memorySystem, userId, options = {}) {
    // 委托给上下文组织器
    const result = await this.organizer.organize(memorySystem, userId, options);

    // 转换为原有格式（保持向后兼容）
    return {
      messages: result.messages,
      systemPrompt: result.systemPrompt,
      hiddenContext: result.hiddenContext,
      metadata: result.metadata,
    };
  }

  /**
   * 生成工具消息摘要
   * 根据 tool_call_id 和工具信息生成简洁的摘要
   * @param {Object} options - 选项
   * @param {string} options.toolCallId - 工具调用 ID
   * @param {string} options.toolName - 工具名称
   * @param {string} options.content - 工具结果内容
   * @param {string} options.strategy - 上下文策略 ('full' | 'simple')
   * @returns {string} 摘要文本
   */
  buildToolMessageSummary(options) {
    const { toolCallId, toolName, content, strategy = 'full' } = options;
    const contentLength = content?.length || 0;
    
    if (strategy === 'simple') {
      // Simple 策略：极简摘要
      return `${toolName} → ${contentLength} 字符 | get_message_content("${toolCallId}")`;
    }
    
    // Full 策略：详细摘要
    return `工具: ${toolName}
结果: ${contentLength} 字符
→ 调用 get_message_content("${toolCallId}") 获取完整结果`;
  }

  /**
   * 构建 LLM 消息数组
   * @param {string} systemPrompt - 系统提示
   * @param {Array} recentMessages - 历史消息（必须是 ASC 顺序，即旧→新）
   * @param {string} currentMessage - 当前用户消息
   * @param {Object} options - 可选配置
   * @param {boolean} options.summarizeToolMessages - 是否对工具消息生成摘要（默认 false）
   * @param {string} options.strategy - 上下文策略 ('full' | 'simple')
   */
  buildMessages(systemPrompt, recentMessages, currentMessage, options = {}) {
    const { summarizeToolMessages = false, strategy = 'full' } = options;
    const messages = [];

    // 系统提示
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // 历史消息（按时间正序：旧→新）
    // getUnarchivedMessages 返回 ASC 顺序，直接使用
    // 需要处理多模态格式和 tool 角色消息
    for (const msg of recentMessages) {
      // 处理 tool 角色消息（OpenAI API 格式）
      if (msg.role === 'tool') {
        // 从 tool_calls 字段解析元数据
        let toolMetaData = null;
        try {
          toolMetaData = typeof msg.tool_calls === 'string' 
            ? JSON.parse(msg.tool_calls) 
            : msg.tool_calls;
        } catch (e) {
          // 解析失败，使用默认值
          toolMetaData = null;
        }
        
        const toolCallId = toolMetaData?.tool_call_id || '';
        const toolName = toolMetaData?.name || 'unknown_tool';
        
        // 决定是生成摘要还是使用完整内容
        let content = msg.content || '';
        if (summarizeToolMessages && toolCallId) {
          content = this.buildToolMessageSummary({
            toolCallId,
            toolName,
            content: msg.content,
            strategy
          });
        }
        
        // 构建 OpenAI 格式的 tool 消息
        messages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          name: toolName,
          content,
        });
      } else {
        // 处理普通消息（user、assistant）
        const processedMsg = processSingleMultimodalMessage({
          role: msg.role,
          content: msg.content,
        });
        messages.push(processedMsg);
      }
    }

    // 当前消息（需要处理多模态格式）
    if (currentMessage) {
      const currentMsg = processSingleMultimodalMessage({ role: 'user', content: currentMessage });
      messages.push(currentMsg);
    }

    return messages;
  }

  /**
   * 格式化上下文为可读文本（用于调试）
   */
  formatContext(context) {
    const lines = [];

    lines.push('=== System Prompt ===');
    lines.push(context.systemPrompt?.substring(0, 1000) + '...');

    if (context.hiddenContext?.soul) {
      lines.push('\n=== Soul (隐藏) ===');
      const soul = context.hiddenContext.soul;
      lines.push(`核心价值观: ${soul.coreValues?.join?.(', ') || soul.coreValues}`);
      lines.push(`情感基调: ${soul.emotionalTone}`);
    }

    if (context.hiddenContext?.innerVoices?.length > 0) {
      lines.push('\n=== Inner Voices (隐藏) ===');
      for (const iv of context.hiddenContext.innerVoices) {
        if (iv.selfEvaluation) {
          lines.push(`评分: ${iv.selfEvaluation.score}/10 - ${iv.selfEvaluation.reason || ''}`);
        }
        if (iv.nextRoundAdvice) {
          lines.push(`建议: ${iv.nextRoundAdvice}`);
        }
      }
    }

    if (context.hiddenContext?.topicContext) {
      lines.push('\n=== Topic Context ===');
      lines.push(context.hiddenContext.topicContext);
    }

    if (context.hiddenContext?.userProfile) {
      lines.push('\n=== User Profile ===');
      const profile = context.hiddenContext.userProfile;
      lines.push(`ID: ${profile.id}`);
      if (profile.preferredName) {
        lines.push(`称呼: ${profile.preferredName}`);
      }
      if (profile.background) {
        lines.push(`背景: ${profile.background}`);
      }
    }

    lines.push('\n=== Messages ===');
    for (const msg of context.messages || []) {
      const preview = typeof msg.content === 'string' 
        ? msg.content?.substring(0, 80) 
        : JSON.stringify(msg.content)?.substring(0, 80) || '';
      lines.push(`${msg.role}: ${preview}...`);
    }

    return lines.join('\n');
  }

  /**
   * 获取上下文的 token 估算
   */
  estimateTokens(context) {
    let total = 0;

    // 系统提示
    if (context.systemPrompt) {
      total += Math.ceil(context.systemPrompt.length / 4);
    }

    // 消息
    for (const msg of context.messages || []) {
      const contentLength = typeof msg.content === 'string' 
        ? msg.content?.length || 0
        : JSON.stringify(msg.content)?.length || 0;
      total += Math.ceil(contentLength / 4) + 4;
    }

    return total;
  }

  /**
   * 获取当前使用的策略名称
   * @returns {string} 策略名称
   */
  getStrategy() {
    return this.options.strategy;
  }

  /**
   * 切换上下文组织策略
   * @param {string} strategyName - 策略名称 ('full' | 'simple')
   */
  setStrategy(strategyName) {
    if (!ContextOrganizerFactory.isValidStrategy(strategyName)) {
      logger.warn(`[ContextManager] 无效的策略: ${strategyName}，保持当前策略: ${this.options.strategy}`);
      return;
    }

    this.options.strategy = strategyName;
    this.organizer = ContextOrganizerFactory.create(strategyName, this.expertConfig, {
      innerVoiceCount: this.options.innerVoiceCount,
    });

    logger.info(`[ContextManager] 切换上下文组织策略: ${strategyName}`);
  }
}

export default ContextManager;
