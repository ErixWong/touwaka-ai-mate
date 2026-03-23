/**
 * Simple Context Organizer - 简单上下文组织器
 * 实现简单的上下文组织方式：
 * - 获取最近 10 条消息
 * - 获取最近 5 个 Topic 总结
 * - 不包含 Inner Voices（减少 token 消耗）
 * - 适用于轻量级对话场景
 */

import logger from '../logger.js';
import { BaseContextOrganizer, processSingleMultimodalMessage } from './base-organizer.js';
import { ContextResult } from './interface.js';

/**
 * 简单上下文组织器
 * 轻量级策略：近期 10 条消息 + 近期 5 个 Topic
 */
export class SimpleContextOrganizer extends BaseContextOrganizer {
  /**
   * @param {object} expertConfig - 专家配置
   * @param {object} options - 可选配置
   * @param {number} options.messageCount - 消息数量（默认 10）
   * @param {number} options.topicCount - Topic 数量（默认 5）
   * @param {boolean} options.includeInnerVoices - 是否包含 Inner Voices（默认 false）
   * @param {number} options.maxToolContentLength - 工具消息内容的最大长度（默认 3000）
   */
  constructor(expertConfig, options = {}) {
    super(expertConfig, options);
    this.messageCount = options.messageCount || 10;
    this.topicCount = options.topicCount || 5;
    this.includeInnerVoices = options.includeInnerVoices || false;
    // Simple 策略使用较短的工具内容（3000 字符），保持上下文简洁
    this.maxToolContentLength = options.maxToolContentLength || 3000;
  }

  /**
   * 获取策略名称
   */
  getName() {
    return 'simple';
  }

  /**
   * 获取策略描述
   */
  getDescription() {
    return `简单上下文组织策略：最近 ${this.messageCount} 条消息 + 最近 ${this.topicCount} 个 Topic 总结`;
  }

  /**
   * 组织上下文
   * @param {MemorySystem} memorySystem - 记忆系统实例
   * @param {string} userId - 用户ID
   * @param {object} options - 组织选项
   * @param {string} options.currentMessage - 当前用户消息
   * @param {Array} options.skills - 可用技能列表
   * @param {object} options.taskContext - 任务上下文
   * @param {string} options.ragContext - RAG 检索上下文
   * @returns {Promise<ContextResult>}
   */
  async organize(memorySystem, userId, options = {}) {
    const {
      currentMessage = '',
      skills = [],
      taskContext = null,
      ragContext = null,
    } = options;

    logger.info(`[SimpleContextOrganizer] 开始组织上下文: user=${userId}`);

    // 1. 确保用户档案存在
    const userProfile = await memorySystem.getOrCreateUserProfile(userId);

    // 2. 获取最近 N 条未归档消息（与 FullContextOrganizer 保持一致）
    const recentMessages = await memorySystem.getUnarchivedMessages(userId, this.messageCount);
    logger.info(`[SimpleContextOrganizer] 获取最近未归档消息: ${recentMessages.length} 条`);

    // 3. 获取 Inner Voices（可选，默认不获取）
    let innerVoices = [];
    if (this.includeInnerVoices) {
      innerVoices = await memorySystem.getRecentInnerVoices(userId, 2);
      logger.info(`[SimpleContextOrganizer] 获取 Inner Voices: ${innerVoices.length} 条`);
    }

    // 4. 获取最近 N 个 Topic 总结
    const topicSummaries = await this.buildTopicSummaries(memorySystem, userId);
    logger.info(`[SimpleContextOrganizer] 获取 Topic 总结: ${topicSummaries ? '有' : '无'}`);

    // 5. 获取用户档案背景
    const userProfileContext = await this.buildUserProfileContext(userProfile);

    // 6. 生成用户信息引导提示（简单模式下减少引导频率）
    const conversationCount = Math.floor(recentMessages.length / 2);
    const userInfoGuidance = this.generateUserInfoGuidance(userProfileContext, conversationCount);

    // 7. 构建系统提示
    const systemPrompt = this.buildBaseSystemPrompt(
      innerVoices,
      topicSummaries,
      userInfoGuidance,
      skills,
      taskContext,
      ragContext
    );

    // 8. 构建 LLM 消息数组（传入工具内容截断配置）
    const messages = this.buildMessages(systemPrompt, recentMessages, currentMessage, {
      maxToolContentLength: this.maxToolContentLength,
    });

    logger.info(`[SimpleContextOrganizer] 上下文组织完成: messages=${messages.length}, tokens≈${Math.ceil(systemPrompt.length / 4)}`);

    return new ContextResult({
      messages,
      systemPrompt,
      hiddenContext: {
        soul: this.soul,
        innerVoices,
        topicSummaries,
        userProfile: userProfileContext,
        userInfoGuidance,
        taskContext,
        ragContext,
      },
      metadata: {
        expertId: this.expertConfig.expert?.id || this.expertConfig.id,
        userId,
        messageCount: recentMessages.length,
        innerVoiceCount: innerVoices.length,
        hasTopicSummaries: !!topicSummaries,
        hasTaskContext: !!taskContext,
        hasRagContext: !!ragContext,
        strategy: this.getName(),
      },
    });
  }

  /**
   * 构建 Topic 总结
   * @param {MemorySystem} memorySystem - 记忆系统实例
   * @param {string} userId - 用户ID
   * @returns {Promise<string|null>}
   */
  async buildTopicSummaries(memorySystem, userId) {
    try {
      // 获取最近的 Topics（按更新时间倒序，只获取 active 状态的）
      const topics = await memorySystem.getTopics(userId, this.topicCount, 'active');

      if (topics.length === 0) {
        return null;
      }

      // 构建 Topic 总结文本（按时间正序，即最早的在前）
      // 包含 topic_id，让 LLM 可以通过 recall 工具获取详情
      const summaryText = topics
        .reverse()
        .map(t => `【${t.title}】(ID: ${t.id})\n${t.description || '无描述'}`)
        .join('\n\n');

      return summaryText;
    } catch (error) {
      logger.warn('[SimpleContextOrganizer] 构建 Topic 总结失败:', error.message);
      return null;
    }
  }
}

export default SimpleContextOrganizer;
