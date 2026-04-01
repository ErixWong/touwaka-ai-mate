/**
 * MinimalContextOrganizer - 精简上下文组织器
 * 
 * Psyche 上下文管理机制的核心实现。
 * 使用 Psyche（心神）替代原始 Messages，实现精简高效的上下文管理。
 * 
 * 工作流程：
 * 1. 获取过去 N 轮对话
 * 2. 获取当前 Psyche
 * 3. 调用反思 LLM 更新 Psyche
 * 4. 压缩 Psyche（如需要）
 * 5. 构建 System Prompt（注入 Psyche 文本）
 * 6. 返回精简上下文（Psyche 替代 Messages）
 */

import { BaseContextOrganizer } from './base-organizer.js';
import { ContextResult } from './interface.js';
import { PsycheManager } from '../psyche/psyche-manager.js';
import { ReflectionService } from '../psyche/reflection-service.js';
import { StoreFactory } from '../psyche-store/index.js';
import logger from '../logger.js';

/**
 * 精简上下文组织器
 * 使用 Psyche 机制管理上下文
 */
export class MinimalContextOrganizer extends BaseContextOrganizer {
  constructor(config = {}) {
    super(config);
    this.name = 'minimal';
    this.description = '精简上下文策略 - 使用 Psyche 替代原始 Messages';
    
    this.config = {
      lookbackRounds: 4,        // 反思时查看过去 4 轮
      maxTokensRatio: 0.3,      // Psyche 占上下文最大比例
      enableNotes: true,        // 启用 Notes
      reflectionModel: 'gpt-4o-mini',
      ...config
    };

    // 延迟初始化的组件
    this._psycheManager = null;
    this._reflectionService = null;
    this._storeFactory = null;
  }

  /**
   * 获取策略名称
   */
  getName() {
    return this.name;
  }

  /**
   * 获取策略描述
   */
  getDescription() {
    return this.description;
  }

  /**
   * 初始化存储和组件
   */
  async _initialize(llmClient) {
    if (this._psycheManager) return;

    logger.info('[MinimalContextOrganizer] 初始化组件...');

    // 创建存储工厂
    this._storeFactory = new StoreFactory({
      psyche: {
        store: process.env.PSYCHE_STORE || 'memory',
        ttl: 3600,
        maxSize: 38400
      },
      notes: {
        store: process.env.NOTES_STORE || 'memory',
        ttl: 3600,
        maxCount: 100
      }
    });

    // 获取存储实例
    const psycheStore = await this._storeFactory.getPsycheStore();
    const notesStore = await this._storeFactory.getNotesStore();

    // 创建 Psyche 管理器
    this._psycheManager = new PsycheManager(psycheStore, notesStore, {
      maxTokensRatio: this.config.maxTokensRatio,
      warningThreshold: 0.8,
      maxNotesRefs: 10,
      maxTopicsContext: 3
    });

    // 创建反思服务
    this._reflectionService = new ReflectionService(llmClient, {
      model: this.config.reflectionModel,
      temperature: 0.3,
      maxTokens: 2000,
      lookbackRounds: this.config.lookbackRounds
    });

    logger.info('[MinimalContextOrganizer] 初始化完成');
  }

  /**
   * 组织上下文
   * 核心方法，实现 Psyche 机制
   */
  async organize(memorySystem, userId, options = {}) {
    const { 
      expertId = 'default', 
      currentMessage,
      systemPrompt: baseSystemPrompt,
      llmClient,
      maxTokens = 128000
    } = options;

    // 初始化组件
    await this._initialize(llmClient);

    logger.debug(`[MinimalContextOrganizer] 组织上下文: ${userId}:${expertId}`);

    // 1. 获取过去 N 轮对话
    const recentMessages = await this._getRecentMessages(memorySystem, userId, expertId);

    // 2. 获取或创建 Psyche
    let psyche = await this._psycheManager.getOrCreate(userId, expertId);

    // 3. 如果有历史消息，执行反思更新 Psyche
    if (recentMessages.length > 0) {
      try {
        const reflection = await this._reflectionService.reflect(
          psyche.toJSON(),
          recentMessages,
          { userId, expertId }
        );
        psyche = this._psycheManager.updateFromReflection(psyche, reflection);
        logger.debug('[MinimalContextOrganizer] Psyche 已更新');
      } catch (error) {
        logger.error('[MinimalContextOrganizer] 反思失败:', error.message);
        // 继续，使用现有 Psyche
      }
    }

    // 4. 压缩 Psyche（如需要）
    const maxPsycheTokens = Math.floor(maxTokens * this.config.maxTokensRatio);
    psyche = await this._psycheManager.compress(psyche, maxPsycheTokens, userId, expertId);

    // 5. 保存更新后的 Psyche
    await this._psycheManager.save(userId, expertId, psyche);

    // 6. 构建 System Prompt（注入 Psyche 文本）
    const psycheText = this._psycheManager.formatForPrompt(psyche);
    const systemPrompt = this._buildSystemPrompt(baseSystemPrompt, psycheText);

    // 7. 返回精简上下文
    // 只包含：System Prompt + 当前用户消息
    const messages = currentMessage ? [{ role: 'user', content: currentMessage }] : [];

    logger.debug(`[MinimalContextOrganizer] 上下文组织完成: ${messages.length} 条消息`);

    return new ContextResult({
      systemPrompt,
      messages,
      hiddenContext: {
        psyche: psyche.toJSON(),
        stats: this._psycheManager.getStats(psyche)
      }
    });
  }

  /**
   * 获取最近 N 轮对话
   */
  async _getRecentMessages(memorySystem, userId, expertId) {
    try {
      // 从 memorySystem 获取最近消息
      const messages = await memorySystem.getRecentMessages(userId, this.config.lookbackRounds);
      return messages || [];
    } catch (error) {
      logger.error('[MinimalContextOrganizer] 获取历史消息失败:', error.message);
      return [];
    }
  }

  /**
   * 构建 System Prompt
   * 将 Psyche 文本注入到 System Prompt 中
   */
  _buildSystemPrompt(basePrompt, psycheText) {
    const parts = [];
    
    if (basePrompt) {
      parts.push(basePrompt);
    }
    
    if (psycheText) {
      parts.push('\n\n' + psycheText);
    }

    // 添加使用说明
    parts.push(`

【使用说明】
- 以上【心神】是你的工作记忆，包含当前主题、关键决策和可用笔记
- 如需查看笔记内容，使用 notes.read 工具
- 如需保存新材料，使用 notes.take 工具
- 如需查看所有笔记，使用 notes.list 工具`);

    return parts.join('\n');
  }

  /**
   * 清理 Psyche（会话结束时调用）
   */
  async cleanup(userId, expertId) {
    if (!this._psycheManager) return;
    
    try {
      await this._psycheManager.delete(userId, expertId);
      logger.debug(`[MinimalContextOrganizer] 清理 Psyche: ${userId}:${expertId}`);
    } catch (error) {
      logger.error('[MinimalContextOrganizer] 清理失败:', error.message);
    }
  }

  /**
   * 获取 Psyche 统计信息
   */
  async getStats(userId, expertId) {
    if (!this._psycheManager) return null;
    
    try {
      const psyche = await this._psycheManager.getOrCreate(userId, expertId);
      return this._psycheManager.getStats(psyche);
    } catch (error) {
      logger.error('[MinimalContextOrganizer] 获取统计失败:', error.message);
      return null;
    }
  }
}

export default MinimalContextOrganizer; 
