/**
 * Full Context Organizer - 完整上下文组织器
 * 实现当前的上下文组织方式：
 * - 获取全部未归档消息（不限制数量，让上下文压缩机制自动处理）
 * - 获取最近的 Inner Voices（默认 3 条）
 * - 获取 Topic 总结（从 topics 表加载，默认 10 个）
 * - 构建完整的系统提示
 */

import logger from '../logger.js';
import { BaseContextOrganizer, processSingleMultimodalMessage } from './base-organizer.js';
import { ContextResult } from './interface.js';

/**
 * 完整上下文组织器
 * 对应原有的 ContextManager.buildContext 实现
 */
export class FullContextOrganizer extends BaseContextOrganizer {
  /**
   * @param {object} expertConfig - 专家配置
   * @param {object} options - 可选配置
   * @param {number} options.innerVoiceCount - 注入的 Inner Voice 数量（默认 3）
   * @param {number} options.topicCount - Topic 数量（默认 10）
   * @param {number} options.maxToolContentLength - 工具消息内容的最大长度（默认 8000）
   */
  constructor(expertConfig, options = {}) {
    super(expertConfig, options);
    this.innerVoiceCount = options.innerVoiceCount || 3;
    this.topicCount = options.topicCount || 10;
    // Full 策略使用更长的工具内容（8000 字符）
    this.maxToolContentLength = options.maxToolContentLength || 8000;
  }

  /**
   * 获取策略名称
   */
  getName() {
    return 'full';
  }

  /**
   * 获取策略描述
   */
  getDescription() {
    return '完整上下文组织策略：获取全部未归档消息 + 最近 Inner Voices + Topic 总结';
  }

  /**
   * 组织上下文
   * @param {MemorySystem} memorySystem - 记忆系统实例
   * @param {string} userId - 用户ID
   * @param {object} options - 组织选项
   * @param {string} options.currentMessage - 当前用户消息
   * @param {boolean} options.includeInnerVoices - 是否包含 Inner Voices（默认 true）
   * @param {boolean} options.includeTopicSummaries - 是否包含 Topic 总结（默认 true）
   * @param {Array} options.skills - 可用技能列表
   * @param {object} options.taskContext - 任务上下文
   * @param {string} options.ragContext - RAG 检索上下文
   * @returns {Promise<ContextResult>}
   */
  async organize(memorySystem, userId, options = {}) {
    const {
      currentMessage = '',
      includeInnerVoices = true,
      includeTopicSummaries = true,
      skills = [],
      taskContext = null,
      ragContext = null,
    } = options;

    logger.info(`[FullContextOrganizer] 开始组织上下文: user=${userId}`);

    // 1. 确保用户档案存在
    const userProfile = await memorySystem.getOrCreateUserProfile(userId);

    // 2. 获取全部未归档消息（不限制数量，让上下文压缩机制自动处理）
    const unarchivedMessages = await memorySystem.getUnarchivedMessages(userId, null);
    logger.info(`[FullContextOrganizer] 获取未归档消息: ${unarchivedMessages.length} 条`);

    // 3. 获取 Inner Voices
    let innerVoices = [];
    if (includeInnerVoices) {
      innerVoices = await memorySystem.getRecentInnerVoices(userId, this.innerVoiceCount);
      logger.info(`[FullContextOrganizer] 获取 Inner Voices: ${innerVoices.length} 条`);
    }

    // 4. 获取 Topic 总结
    let topicSummaries = null;
    if (includeTopicSummaries) {
      topicSummaries = await this.buildTopicSummaries(memorySystem, userId);
      logger.info(`[FullContextOrganizer] 获取 Topic 总结: ${topicSummaries ? '有' : '无'}`);
    }

    // 5. 获取用户档案背景
    const userProfileContext = await this.buildUserProfileContext(userProfile);

    // 6. 生成用户信息引导提示
    const conversationCount = Math.floor(unarchivedMessages.length / 2);
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
    const messages = this.buildMessages(systemPrompt, unarchivedMessages, currentMessage, {
      maxToolContentLength: this.maxToolContentLength,
    });

    logger.info(`[FullContextOrganizer] 上下文组织完成: messages=${messages.length}, tokens≈${Math.ceil(systemPrompt.length / 4)}`);

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
        messageCount: unarchivedMessages.length,
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
      // 包含 topic_id，让 LLM 可以通过 recall_topic 工具获取详情
      const summaryText = topics
        .reverse()
        .map(t => `【${t.title}】(ID: ${t.id})\n${t.description || '无描述'}`)
        .join('\n\n');

      return summaryText;
    } catch (error) {
      logger.warn('[FullContextOrganizer] 构建 Topic 总结失败:', error.message);
      return null;
    }
  }
}

export default FullContextOrganizer;
