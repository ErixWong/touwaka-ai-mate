/**
 * Memory System - 记忆系统（数据库版）
 * 管理专家的对话历史、Topic 和联系人信息
 * 基于 MariaDB 存储
 */

import LLMClient from './llm-client.js';
import logger from './logger.js';
import Utils from './utils.js';
import { parseJsonLikeContent } from './json-parse-utils.js';
import { estimateMessagesTokens } from './token-utils.js';

/**
 * Topic 总结质量评分（Phase 3）
 * @param {object} topic - Topic 对象 { title, description, keywords, summary }
 * @returns {object} { score, keywordCoverage, retrievability, infoDensity, pass }
 */
export function assessTopicQuality(topic) {
  const title = topic.title || '';
  const desc = topic.description || '';
  const summary = topic.summary || '';
  const keywords = topic.keywords || '';
  const content = title + ' ' + desc + ' ' + summary;

  // 关键词覆盖率（有标题+描述+关键词字段）
  const keywordCoverage = (title.length > 0 ? 0.3 : 0)
    + (desc.length > 0 ? 0.3 : 0)
    + (keywords.length > 0 ? 0.4 : 0);

  // 信息密度（内容长度在合理范围内）
  const contentLen = content.length;
  let infoDensity = 0;
  if (contentLen >= 50 && contentLen <= 2000) {
    infoDensity = 1.0;
  } else if (contentLen > 2000) {
    infoDensity = Math.max(0.3, 1.0 - (contentLen - 2000) / 3000);
  } else if (contentLen > 10) {
    infoDensity = contentLen / 50;
  } else {
    infoDensity = 0.1;
  }

  // 检索可用性（关键词提取数量）
  const keywordCount = keywords.split(/[,，;；\s]+/).filter(k => k.length > 1).length;
  const retrievability = Math.min(1.0, keywordCount / 5);

  // 综合评分
  const score = (keywordCoverage * 0.35 + infoDensity * 0.35 + retrievability * 0.3);
  const pass = score >= 0.4;

  return {
    score: Math.round(score * 100) / 100,
    keywordCoverage: Math.round(keywordCoverage * 100) / 100,
    infoDensity: Math.round(infoDensity * 100) / 100,
    retrievability: Math.round(retrievability * 100) / 100,
    pass,
    detail: {
      contentLength: contentLen,
      keywordCount,
      titleLength: title.length,
    }
  };
}

class MemorySystem {
  /**
   * @param {Database} db - 数据库实例
   * @param {string} expertId - 专家ID
   * @param {LLMClient} llmClient - LLM客户端（用于总结）
   * @param {object} options - 可选配置（保留参数兼容性）
   */
  constructor(db, expertId, llmClient, options = {}) {
    this.db = db;
    this.expertId = expertId;
    this.llmClient = llmClient;
    // WP-5: 总结调用计数
    this._summarizationCallCount = 0;
    this._compressionLocks = new Map();
    // P18: legacy 通道低频闸门。现代路径下 legacy 消息通常为空，
    // 上次检查低于 minMessages 时在间隔内跳过重复的 1000 条扫描，避免每轮固定 DB 开销。
    this._legacyCheckState = new Map();
    this._legacyCheckIntervalMs = options.legacyCheckIntervalMs ?? 60000;
  }

  /**
   * ==================== 消息操作 ====================
   */

  /**
   * 获取最近消息
   * @param {string} userId - 用户ID
   * @param {number} limit - 数量限制
   * @returns {Promise<Array>} 消息列表（DESC 顺序：最新的在前）
   */
  async getRecentMessages(userId, limit = 20) {
    // 直接从数据库加载（DESC 顺序：最新的在前）
    const messages = await this.db.getRecentMessages(this.expertId, userId, limit);

    // 安全解析 JSON
    const safeParseJSON = (value) => {
      if (!value) return null;
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch (e) {
        return null;
      }
    };

    // 转换格式（保持数据库字段名一致，不做驼峰转换）
    return messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: new Date(m.created_at).getTime(),
      inner_voice: safeParseJSON(m.inner_voice),
      tool_calls: safeParseJSON(m.tool_calls),
      topic_id: m.topic_id,
    }));
  }

  /**
   * 获取消息（支持时间范围）
   * @param {string} userId - 用户ID
   * @param {Date} startTime - 开始时间（Date 对象，本地时间）
   * @param {Date} endTime - 结束时间（Date 对象，本地时间）
   * @returns {Promise<Array>} 消息列表（格式与 getRecentMessages 一致）
   *
   * 注意：时区处理
   * - 传入的 startTime/endTime 应该是本地时间的 Date 对象
   * - 数据库中的 created_at 也是本地时间
   * - Sequelize 会自动处理时区转换
   */
  async getMessagesByTimeRange(userId, startTime, endTime) {
    // 确保传入的是 Date 对象
    const start = startTime instanceof Date ? startTime : new Date(startTime);
    const end = endTime instanceof Date ? endTime : new Date(endTime);
    
    logger.debug(`[MemorySystem] getMessagesByTimeRange: 本地时间=${start.toLocaleString('zh-CN')} ~ ${end.toLocaleString('zh-CN')}`);
    
    const messages = await this.db.getMessagesByTimeRange(
      this.expertId,
      userId,
      start,
      end
    );

    // 安全解析 JSON（与 getRecentMessages 保持一致）
    const safeParseJSON = (value) => {
      if (!value) return null;
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch (e) {
        return null;
      }
    };

    // 转换格式（与 getRecentMessages 保持一致）
    return messages.map(m => {
      const toolCalls = safeParseJSON(m.tool_calls);
      
      // 对于 tool 消息，从 tool_calls 字段中提取 tool_call_id
      // tool_calls 格式: { tool_call_id, name, arguments, success, duration, timestamp, context, result_length, result? }
      let toolCallId = null;
      if (m.role === 'tool' && toolCalls) {
        toolCallId = toolCalls.tool_call_id || null;
      }
      
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.created_at).getTime(),
        inner_voice: safeParseJSON(m.inner_voice),
        tool_calls: toolCalls,
        tool_call_id: toolCallId,  // tool 消息需要此字段
        topic_id: m.topic_id,
      };
    });
  }

  /**
   * 获取最近对话的时间边界
   * 直接查询最近 N 条 user/assistant 消息的时间范围
   * @param {string} userId - 用户ID
   * @param {number} limit - 消息数量限制（默认 32 条 = 16 轮对话）
   * @returns {Promise<{startTime: Date, endTime: Date, messageCount: number}|null>} 时间边界
   */
  async getRecentDialogTimeBoundary(userId, limit = 32) {
    const sql = `
      SELECT created_at 
      FROM messages 
      WHERE expert_id = ? AND user_id = ? AND role IN ('user', 'assistant')
      ORDER BY created_at DESC 
      LIMIT ?
    `;
    
    const rows = await this.db.query(sql, [this.expertId, userId, limit]);
    
    if (rows.length === 0) {
      return null;
    }
    
    // rows 是倒序的（最新的在前），最早的时间在最后一行
    return {
      startTime: new Date(rows[rows.length - 1].created_at),  // 最早的
      endTime: new Date(rows[0].created_at),                   // 最新的
      messageCount: rows.length
    };
  }

  /**
   * 获取或创建用户档案
   * @param {string} userId - 用户ID
   * @param {string} preferredName - 希望被称呼的名字（可选）
   * @returns {Promise<object>} 用户档案信息
   */
  async getOrCreateUserProfile(userId, preferredName = null) {
    // 获取或创建用户档案（会自动创建用户基础记录）
    let profile = await this.db.getOrCreateUserProfile(
      this.expertId, 
      userId, 
      preferredName
    );

    if (profile) {
      logger.info(`[MemorySystem] 获取用户档案: user=${userId}, expert=${this.expertId}`);
    }

    return profile;
  }

  /**
   * 更新用户档案背景
   * @param {string} userId - 用户ID
   * @param {string} background - 背景描述
   */
  async updateUserProfileBackground(userId, background) {
    await this.db.updateUserProfileBackground(this.expertId, userId, background);
    logger.debug(`[MemorySystem] 更新用户档案背景: user=${userId}`);
  }

  /**
   * 更新用户基本信息（从对话中提取的）
   * @param {string} userId - 用户ID
   * @param {object} userInfo - 用户信息 { gender, age, preferredName, occupation, location }
   */
  async updateUserInfo(userId, userInfo) {
    if (!userInfo) return;

    const updates = [];

    // 更新性别（存到 users 表）
    if (userInfo.gender) {
      await this.db.updateUserGender(userId, userInfo.gender);
      updates.push(`gender=${userInfo.gender}`);
    }

    // 更新生日/年龄（存到 users 表）
    if (userInfo.age) {
      // 根据年龄计算大概的出生年份
      const birthYear = new Date().getFullYear() - userInfo.age;
      const birthday = `${birthYear}-01-01`;
      await this.db.updateUserBirthday(userId, birthday);
      updates.push(`age≈${userInfo.age}`);
    }

    // 更新职业（存到 users 表）
    if (userInfo.occupation) {
      await this.db.updateUserOccupation(userId, userInfo.occupation);
      updates.push(`occupation=${userInfo.occupation}`);
    }

    // 更新所在地（存到 users 表）
    if (userInfo.location) {
      await this.db.updateUserLocation(userId, userInfo.location);
      updates.push(`location=${userInfo.location}`);
    }

    // 更新称呼偏好（存到 user_profiles 表，随 expert 不同）
    if (userInfo.preferredName) {
      await this.db.updateUserProfilePreferredName(this.expertId, userId, userInfo.preferredName);
      updates.push(`preferredName=${userInfo.preferredName}`);
    }

    if (updates.length > 0) {
      logger.info(`[MemorySystem] 更新用户信息: user=${userId}, ${updates.join(', ')}`);
    }
  }

  /**
   * 获取用户档案背景
   * @param {string} userId - 用户ID
   * @returns {Promise<string>} 背景描述
   */
  async getUserProfileBackground(userId) {
    const profile = await this.db.getUserProfile(this.expertId, userId);
    return profile?.background || '';
  }

  /**
   * 获取用户在当前专家面前的名字
   * @param {string} userId - 用户ID
   * @returns {Promise<string>} 用户名字（preferred_name 或 nickname）
   */
  async getUserPreferredName(userId) {
    const profile = await this.db.getUserProfile(this.expertId, userId);
    return profile?.preferred_name || profile?.nickname || userId;
  }

  /**
   * ==================== Topic 操作 ====================
   */

  /**
   * 获取用户的 Topics
   * @param {string} userId - 用户ID
   * @param {number} limit - 数量限制
   * @param {string} status - 状态过滤（默认 'active'，传 null 表示不过滤）
   * @returns {Promise<Array>} Topic 列表
   */
  async getTopics(userId, limit = 10, status = 'active', offset = 0) {
    return await this.db.getTopicsByExpertAndUser(this.expertId, userId, limit, status, offset);
  }

  async countTopics(userId, status = 'active') {
    if (!this.db.countTopicsByExpertAndUser) return null;
    return await this.db.countTopicsByExpertAndUser(this.expertId, userId, status);
  }

  /**
   * 根据关键词搜索话题
   * @param {string} userId - 用户ID
   * @param {string} keyword - 搜索关键词
   * @param {number} limit - 数量限制
   * @returns {Promise<Array>} 匹配的话题列表
   */
  async searchTopics(userId, keyword, limit = 10, offset = 0) {
    return await this.db.searchTopicsByKeyword(this.expertId, userId, keyword, limit, offset);
  }

  async countSearchTopics(userId, keyword) {
    if (!this.db.countSearchTopicsByKeyword) return null;
    return await this.db.countSearchTopicsByKeyword(this.expertId, userId, keyword);
  }

  /**
   * 创建 Topic
   * @param {string} userId - 用户ID
   * @param {object} topicData - Topic 数据
   * @returns {Promise<string>} Topic ID
   */
  async createTopic(userId, topicData) {
    const topicId = this.generateTopicId();

    await this.db.createTopic({
      id: topicId,
      expertId: this.expertId,
      userId: userId,
      name: topicData.name,  // db.createTopic 会将 name 映射到 title
      description: topicData.description,
      category: topicData.category || 'general',
      keywords: topicData.keywords || [],
      status: topicData.status || 'active',
      startTime: topicData.startTime || new Date(),
      endTime: topicData.endTime,
    });

    logger.info(`[MemorySystem] 创建 Topic: ${topicId} - ${topicData.name}`);

    return topicId;
  }

  /**
   * 更新 Topic 的消息数量
   * @param {string} topicId - Topic ID
   */
  async updateTopicMessageCount(topicId) {
    await this.db.updateTopicMessageCount(topicId);
  }

  /**
   * 将消息关联到 Topic
   * @param {string} userId - 用户ID
   * @param {string} topicId - Topic ID
   * @param {Date} startTime - 开始时间
   * @param {Date} endTime - 结束时间
   */
  async assignMessagesToTopic(userId, topicId, startTime, endTime) {
    await this.db.assignMessagesToTopic(
      this.expertId,
      userId,
      topicId,
      startTime,
      endTime
    );
    logger.debug(`[MemorySystem] 消息关联到 Topic: ${topicId}`);
  }

  /**
   * ==================== 上下文压缩（新设计） ====================
   */

  /**
   * 检查是否需要压缩上下文
   * @param {string} userId - 用户ID
   * @param {number} contextSize - 上下文大小（token）
   * @param {number} threshold - 阈值比例（默认 0.7）
   * @param {number} minMessages - 最小消息数（默认 5 条）
   * @param {number} maxMessages - 最大 legacy unassigned 消息数（默认 50 条），超过此数量强制压缩
   * @returns {Promise<{needCompress: boolean, reason: string, tokenCount: number}>}
   */
  async shouldCompressContext(userId, contextSize = 128000, threshold = 0.7, minMessages = 5, maxMessages = 50) {
    // 当前在线消息已绑定 active Topic。这里仅检查旧版未绑定 Topic 的消息。
    const unarchivedMessages = await this.getUnarchivedMessages(userId, 1000);
    
    if (unarchivedMessages.length < minMessages) {
      return {
        needCompress: false,
        reason: `legacy unassigned 消息不足 ${minMessages} 条`,
        tokenCount: 0,
        messageCount: unarchivedMessages.length,
      };
    }

    // 估算 token 数
    const estimatedTokens = this.estimateTokens(unarchivedMessages);
    const tokenThreshold = contextSize * threshold;

    logger.debug(`[MemorySystem] 压缩检查: messages=${unarchivedMessages.length}, tokens=${estimatedTokens}, threshold=${tokenThreshold}, maxMessages=${maxMessages}`);

    // 检查 Token 阈值
    if (estimatedTokens >= tokenThreshold) {
      return {
        needCompress: true,
        reason: `Token 数 ${estimatedTokens} >= 阈值 ${tokenThreshold}`,
        tokenCount: estimatedTokens,
        messageCount: unarchivedMessages.length,
      };
    }

    // 检查消息数量阈值（即使 Token 未超，消息太多也需要压缩）
    if (unarchivedMessages.length >= maxMessages) {
      return {
        needCompress: true,
        reason: `legacy unassigned 消息数 ${unarchivedMessages.length} >= 最大值 ${maxMessages}`,
        tokenCount: estimatedTokens,
        messageCount: unarchivedMessages.length,
      };
    }

    return {
      needCompress: false,
      reason: `Token 数 ${estimatedTokens} < 阈值 ${tokenThreshold}，消息数 ${unarchivedMessages.length} < ${maxMessages}`,
      tokenCount: estimatedTokens,
      messageCount: unarchivedMessages.length,
    };
  }

  /**
   * 获取旧版未绑定 Topic 的消息
   *
   * 当前在线消息会绑定 active Topic；此方法保留用于旧压缩路径和历史数据兼容。
   * 后续 Memory Summary 落库前，不要把这里的结果当作完整待压缩集合。
   * @param {string} userId - 用户ID
   * @param {number|null} limit - 数量限制（null 表示不限制）
   * @returns {Promise<Array>} legacy unassigned 消息列表
   */
  async getUnarchivedMessages(userId, limit = null) {
    // null 表示不限制，传入一个大数值
    const effectiveLimit = limit === null ? 10000 : limit;
    const messages = await this.db.getUnarchivedMessages(this.expertId, userId, effectiveLimit);

    // 安全解析 JSON
    const safeParseJSON = (value) => {
      if (!value) return null;
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch (e) {
        return null;
      }
    };

    return messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: new Date(m.created_at).getTime(),
      inner_voice: safeParseJSON(m.inner_voice),
      tool_calls: safeParseJSON(m.tool_calls),
    }));
  }

  /**
   * 压缩上下文（核心方法）
   * 1. 获取旧版未绑定 Topic 的消息
   * 2. 调用 LLM 识别话题
   * 3. 创建 Topic 并关联消息
   * 4. 更新用户信息
   * @param {string} userId - 用户ID
   * @param {object} options - 配置选项
   * @param {boolean} options.force - 强制压缩，跳过阈值检查（用于反思触发）
   * @returns {Promise<object>} 压缩结果
   */
  async _withCompressionLock(userId, work) {
    const key = `${this.expertId}:${userId}`;
    const previous = this._compressionLocks.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(work);
    const cleanup = run.catch(() => {}).finally(() => {
      if (this._compressionLocks.get(key) === cleanup) {
        this._compressionLocks.delete(key);
      }
    });
    this._compressionLocks.set(key, cleanup);
    return await run;
  }

  async _runInTransaction(work) {
    if (!this.db?.sequelize?.transaction) {
      return await work(null);
    }

    const transaction = await this.db.sequelize.transaction();
    try {
      const result = await work(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  _safeParseJSON(value) {
    if (!value) return null;
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch (error) {
      return null;
    }
  }

  _normalizeDbMessages(messages) {
    return (messages || []).map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: new Date(m.created_at || m.timestamp || Date.now()).getTime(),
      inner_voice: this._safeParseJSON(m.inner_voice),
      tool_calls: this._safeParseJSON(m.tool_calls),
      topic_id: m.topic_id,
    }));
  }

  async _getActiveTopicMessages(userId, activeTopicId, excludeMessageIds = []) {
    if (!activeTopicId || !this.db?.getMessagesByTopicId) {
      return [];
    }

    const excluded = new Set((excludeMessageIds || []).filter(Boolean));
    const messages = await this.db.getMessagesByTopicId(this.expertId, userId, activeTopicId, 1000);
    return this._normalizeDbMessages(messages).filter(message => !excluded.has(message.id));
  }

  async _shouldCompressActiveTopic(userId, options = {}) {
    const {
      activeTopicId = null,
      contextSize = 128000,
      threshold = 0.7,
      minMessages = 5,
      maxMessages = 50,
      excludeMessageIds = [],
      force = false,
    } = options;

    if (!activeTopicId || !this.db?.getTopicById) {
      return {
        needCompress: false,
        scope: null,
        reason: 'no active topic',
        activeTopicId,
        tokenCount: 0,
        messageCount: 0,
      };
    }

    const topic = await this.db.getTopicById(activeTopicId, this.expertId, userId);
    if (!topic || topic.status !== 'active') {
      return {
        needCompress: false,
        scope: null,
        reason: 'topic is not active',
        activeTopicId,
        tokenCount: 0,
        messageCount: 0,
      };
    }

    const messages = await this._getActiveTopicMessages(userId, activeTopicId, excludeMessageIds);
    const tokenCount = this.estimateTokens(messages);
    const tokenThreshold = contextSize * threshold;
    const tokenExceeded = tokenCount >= tokenThreshold;
    const messageExceeded = messages.length >= maxMessages;
    const hasEnoughMessages = messages.length >= minMessages;
    const needCompress = force ? hasEnoughMessages : hasEnoughMessages && (tokenExceeded || messageExceeded);

    return {
      needCompress,
      scope: needCompress ? 'active' : null,
      reason: needCompress
        ? `active topic messages=${messages.length}, tokens=${tokenCount}, threshold=${tokenThreshold}`
        : `active topic messages=${messages.length}, tokens=${tokenCount}`,
      activeTopicId,
      tokenCount,
      messageCount: messages.length,
    };
  }

  _combineCompressionResults(results) {
    const successes = results.filter(result => result?.success);
    if (successes.length === 0) {
      return results[0] || { success: false, reason: 'no compression scope matched' };
    }

    return {
      success: true,
      scope: successes.map(result => result.scope).filter(Boolean).join('+') || undefined,
      topicsCreated: successes.reduce((sum, result) => sum + (result.topicsCreated || 0), 0),
      messagesArchived: successes.reduce((sum, result) => sum + (result.messagesArchived || 0), 0),
      topics: successes.flatMap(result => result.topics || []),
      archivedTopicId: successes.find(result => result.archivedTopicId)?.archivedTopicId || null,
      newTopicId: successes.find(result => result.newTopicId)?.newTopicId || null,
      results: successes,
    };
  }

  async _compressActiveTopic(userId, options = {}) {
    const {
      activeTopicId,
      minMessages = 5,
      excludeMessageIds = [],
      carryMessageIds = [],
      force = false,
    } = options;

    if (!activeTopicId || !this.db?.getTopicById || !this.db?.getMessagesByTopicId) {
      return { success: false, scope: 'active', reason: 'active topic helpers unavailable' };
    }

    const activeTopic = await this.db.getTopicById(activeTopicId, this.expertId, userId);
    if (!activeTopic || activeTopic.status !== 'active') {
      return { success: false, scope: 'active', reason: 'topic is not active' };
    }

    const messages = await this._getActiveTopicMessages(userId, activeTopicId, excludeMessageIds);
    if (!force && messages.length < minMessages) {
      return { success: false, scope: 'active', reason: 'not enough active topic messages' };
    }

    this._summarizationCallCount++;
    logger.info(`[MemorySystem] summarizeConversation (source=active_split, call#${this._summarizationCallCount}): ${messages.length} messages`);
    const summary = await this.summarizeConversation(messages);
    const newTopicId = this.generateTopicId();
    const now = new Date();
    const keywords = Array.isArray(summary.keywords) ? summary.keywords : [];
    const summaryQuality = assessTopicQuality({
      title: summary.topicName || activeTopic.title,
      description: summary.topicDescription || activeTopic.description,
      summary: summary.topicDescription || activeTopic.description,
      keywords: keywords.join(','),
    });
    logger.info(`[MemorySystem] topic_summary_quality: score=${summaryQuality.score}, pass=${summaryQuality.pass}, source=active_split, topic="${summary.topicName || activeTopic.title}"`);

    await this._runInTransaction(async (transaction) => {
      await this.db.updateTopic(activeTopicId, {
        title: summary.topicName || activeTopic.title,
        description: summary.topicDescription || activeTopic.description,
        category: summary.category || activeTopic.category || 'general',
        keywords: JSON.stringify(keywords),
        status: 'archived',
        end_time: now,
        message_count: messages.length,
      }, { transaction });

      await this.db.createTopic({
        id: newTopicId,
        expertId: this.expertId,
        userId,
        name: 'New conversation',
        description: null,
        category: 'general',
        keywords: [],
        taskId: activeTopic.task_id || options.taskId || null,
        status: 'active',
        startTime: now,
        endTime: null,
        messageCount: 0,
      }, { transaction });

      const carryIds = (carryMessageIds || []).filter(Boolean);
      if (carryIds.length > 0) {
        await this.db.updateMessageTopicId(carryIds, newTopicId, { transaction });
      }

      await this.db.updateTopicMessageCount(activeTopicId, { transaction });
      await this.db.updateTopicMessageCount(newTopicId, { transaction });
    });

    logger.info(`[MemorySystem] active topic split complete: archived=${activeTopicId}, new=${newTopicId}, messages=${messages.length}`);

    return {
      success: true,
      scope: 'active',
      archivedTopicId: activeTopicId,
      newTopicId,
      topicsCreated: 1,
      messagesArchived: messages.length,
      topics: [{
        title: summary.topicName || activeTopic.title,
        summary: summary.topicDescription || activeTopic.description,
      }],
      summaryQuality,
    };
  }

  async compressContext(userId, options = {}) {
    return await this._withCompressionLock(userId, async () => {
      const {
        contextSize = 128000,
        threshold = 0.7,
        minMessages = 5,
        maxMessages = 50,
        activeTopicId = null,
        excludeMessageIds = [],
        force = false,
      } = options;

      const results = [];
      const activeCheck = await this._shouldCompressActiveTopic(userId, {
        activeTopicId,
        contextSize,
        threshold,
        minMessages,
        maxMessages,
        excludeMessageIds,
        force,
      });

      if (activeCheck.needCompress) {
        results.push(await this._compressActiveTopic(userId, {
          activeTopicId,
          minMessages,
          excludeMessageIds,
          carryMessageIds: options.carryMessageIds || [],
          force,
        }));
      }

      const legacyRequested = !activeCheck.needCompress || options.scope === 'both' || options.scope === 'legacy';
      const legacyForce = force && !activeTopicId;
      if (legacyRequested && this._shouldRunLegacyCheck(userId, legacyForce)) {
        const legacyResult = await this._compressLegacyContext(userId, {
          contextSize,
          threshold,
          minMessages,
          maxMessages,
          force: legacyForce,
        });
        this._recordLegacyCheckResult(userId, legacyResult);
        results.push(legacyResult);
      }

      return this._combineCompressionResults(results);
    });
  }

  /**
   * P18: legacy 通道低频闸门。上次检查结果低于 minMessages（现代路径的常态）时，
   * 间隔期内跳过重查；legacy 消息真实存在并累积（belowMin=false）时保持每轮检查，
   * 避免延迟清理。force 压缩不受闸门限制。
   */
  _shouldRunLegacyCheck(userId, force = false) {
    if (force) return true;
    const state = this._legacyCheckState.get(`${this.expertId}:${userId}`);
    if (!state || !state.belowMin) return true;
    return Date.now() - state.lastCheck >= this._legacyCheckIntervalMs;
  }

  _recordLegacyCheckResult(userId, result) {
    const belowMin = result?.success === false && result?.reason === '消息不足';
    this._legacyCheckState.set(`${this.expertId}:${userId}`, { lastCheck: Date.now(), belowMin });
  }

  async _compressLegacyContext(userId, options = {}) {
    const {
      contextSize = 128000,
      threshold = 0.7,
      minMessages = 5,
      maxMessages = 50,  // 最大 legacy unassigned 消息数，超过此数量强制压缩
      force = false,     // 强制压缩，跳过阈值检查
    } = options;

    logger.info(`[MemorySystem] 开始压缩上下文: expert=${this.expertId}, user=${userId}, force=${force}`);

    try {
      // 1. 获取旧版未绑定 Topic 的消息
      const unarchivedMessages = await this.getUnarchivedMessages(userId, 1000);

      if (unarchivedMessages.length < minMessages) {
        logger.debug(`[MemorySystem] legacy unassigned 消息不足 ${minMessages} 条，跳过压缩`);
        return { success: false, reason: '消息不足' };
      }

      // 2. 估算 Token
      const tokens = this.estimateTokens(unarchivedMessages);
      const tokenThreshold = contextSize * threshold;

      // 检查是否需要压缩：Token 超阈值 OR 消息数超限 OR 强制压缩
      const tokenExceeded = tokens >= tokenThreshold;
      const messageExceeded = unarchivedMessages.length >= maxMessages;

      // 如果不是强制压缩，才检查阈值
      if (!force && !tokenExceeded && !messageExceeded) {
        logger.debug(`[MemorySystem] Token 数 ${tokens} 未超阈值 ${tokenThreshold}，消息数 ${unarchivedMessages.length} 未超限 ${maxMessages}，跳过压缩`);
        return { success: false, reason: 'Token 和消息数均未超阈值' };
      }

      logger.info(`[MemorySystem] 触发压缩: force=${force}, tokenExceeded=${tokenExceeded}, messageExceeded=${messageExceeded}, tokens=${tokens}, messages=${unarchivedMessages.length}`);

      // 3. 话题识别（LLM 调用 - 在线总结）
      this._summarizationCallCount++;
      logger.info(`[MemorySystem] identifyTopics (source=online, call#${this._summarizationCallCount}): ${unarchivedMessages.length} 条消息, ${tokens} tokens`);
      const identifyResult = await this.identifyTopics(unarchivedMessages);

      // identifyResult 是 { topics: [...], userInfo: {...} } 格式
      const topics = identifyResult.topics || identifyResult;

      if (!topics || !Array.isArray(topics) || topics.length === 0) {
        logger.warn('[MemorySystem] 话题识别未返回任何话题');
        return { success: false, reason: '话题识别失败' };
      }

      // 4. 创建 Topic 并关联消息
      let createdTopics = 0;
      let archivedMessages = 0;

      for (const topic of topics) {
        const topicId = this.generateTopicId();

        // 获取该话题的消息
        const topicMessages = unarchivedMessages.slice(topic.startIndex, topic.endIndex + 1);
        const messageIds = topicMessages.map(m => m.id);

        // 计算话题的时间范围
        const startTime = topicMessages.length > 0 
          ? new Date(topicMessages[0].timestamp) 
          : new Date();
        const endTime = topicMessages.length > 0 
          ? new Date(topicMessages[topicMessages.length - 1].timestamp) 
          : new Date();

        // 创建 Topic（显式设置 status 和时间边界）
        await this.db.createTopic({
          id: topicId,
          expertId: this.expertId,
          userId: userId,
          name: topic.title,
          description: topic.summary,
          category: topic.category || 'general',
          keywords: topic.keywords || [],
          status: 'archived',
          startTime,
          endTime,
        });

        logger.debug(`[MemorySystem] 创建话题: ${topic.title}, 时间范围: ${startTime.toISOString()} ~ ${endTime.toISOString()}`);

        // 关联消息到 Topic
        if (messageIds.length > 0) {
          await this.db.updateMessageTopicId(messageIds, topicId);
          archivedMessages += messageIds.length;
        }

        // 更新 Topic 消息计数
        await this.db.updateTopicMessageCount(topicId);

        createdTopics++;
        logger.debug(`[MemorySystem] 创建话题: ${topic.title}, 消息数: ${messageIds.length}`);

        // Phase 3: Topic 总结质量评分
        const quality = assessTopicQuality({
          title: topic.title,
          description: topic.summary,
          summary: topic.summary,
          keywords: topic.keywords ? (Array.isArray(topic.keywords) ? topic.keywords.join(',') : topic.keywords) : '',
        });
        logger.info(`[MemorySystem] topic_summary_quality: score=${quality.score}, pass=${quality.pass}, topic="${topic.title}"`);
      }

      // 5. 更新用户信息（如果提取到）
      if (identifyResult.userInfo) {
        await this.updateUserInfo(userId, identifyResult.userInfo);
      }

      logger.info(`[MemorySystem] 压缩完成: 创建 ${createdTopics} 个话题, 归档 ${archivedMessages} 条消息`);

      return {
        success: true,
        topicsCreated: createdTopics,
        messagesArchived: archivedMessages,
        topics: topics.map(t => ({ title: t.title, summary: t.summary })),
      };

    } catch (error) {
      logger.error('[MemorySystem] 压缩失败:', error.message);
      throw error;
    }
  }

  /**
   * 话题识别（LLM 调用）
   * 一次性识别所有话题，避免多次 LLM 调用
   * @param {Array} messages - legacy unassigned 消息列表
   * @returns {Promise<object>} 话题列表和用户信息
   */
  async identifyTopics(messages) {
    const conversationText = messages
      .map((m, i) => `[${i}] ${m.role}: ${m.content}`)
      .join('\n');

    const prompt = `分析以下对话，识别话题并生成总结。

对话内容：
${conversationText}

## 任务
1. 识别话题边界（每个话题至少 10 条消息）
2. 为每个话题生成标题和总结
3. 提取用户信息（如果有的话）

## 输出格式（JSON）
{
  "topics": [
    {
      "title": "React性能优化",
      "summary": "讨论了useMemo和useCallback的使用场景...",
      "startIndex": 0,
      "endIndex": 15,
      "keywords": ["React", "性能", "useMemo"],
      "category": "技术"
    },
    {
      "title": "用户登录方案",
      "summary": "对比了JWT和Session的优缺点...",
      "startIndex": 16,
      "endIndex": 30,
      "keywords": ["登录", "JWT", "Session"],
      "category": "技术"
    }
  ],
  "userInfo": {
    "gender": null,
    "occupation": "前端开发者",
    "preferredName": null,
    "location": null
  }
}

要求：
- 每个话题至少包含 10 条消息
- 标题简洁（8-15字）
- 总结详细（50-100字）
- startIndex 和 endIndex 是消息在数组中的索引（从 0 开始）
- 话题之间不应该有重叠
- 如果所有消息属于同一个话题，只返回一个话题
- location 为居住城市，非文件路径`;

    try {
      const response = await this.llmClient.callExpressive([
        {
          role: 'system',
          content: '你是一个对话分析助手，负责识别话题边界和提取用户信息。你需要将对话分割成不同的话题，并提取每个话题的标题、总结和关键词。同时，从对话中提取用户透露的个人信息。',
        },
        { role: 'user', content: prompt },
      ], { temperature: 0.3 });

      const result = parseJsonLikeContent(response.content);
      if (result && !result._parse_failed && typeof result === 'object' && !Array.isArray(result)) {
        logger.debug('[MemorySystem] 话题识别完成:', {
          topicsCount: result.topics?.length || 0,
          userInfo: result.userInfo,
        });
        return result;
      }
    } catch (error) {
      logger.warn('[MemorySystem] 话题识别解析失败:', error.message);
    }

    // 默认返回值：将所有消息作为一个话题
    return {
      topics: [{
        title: '对话记录',
        summary: '自动归档的对话',
        startIndex: 0,
        endIndex: messages.length - 1,
        keywords: [],
        category: '其他',
      }],
      userInfo: null,
    };
  }

  /**
   * ==================== 历史处理（旧版，保留向后兼容） ====================
   */

  /**
   * 检查是否需要处理历史
   * @param {string} userId - 用户ID
   * @param {number} maxMessages - 最大消息数阈值（默认 6 条，即 3 轮对话）
   * @param {number} contextSize - 上下文大小（token）
   * @param {number} threshold - 阈值比例
   * @returns {Promise<boolean>}
   */
  async shouldProcessHistory(userId, maxMessages = 6, contextSize = 128000, threshold = 0.7) {
    const count = await this.db.getMessageCount(this.expertId, userId);
    
    logger.debug(`[MemorySystem] 检查历史处理: user=${userId}, messageCount=${count}, threshold=${maxMessages}`);

    if (count >= maxMessages) {
      logger.info(`[MemorySystem] 触发历史处理: 消息数 ${count} >= ${maxMessages}`);
      return true;
    }

    // 估算 token 数
    const messages = await this.getRecentMessages(userId, 50);
    const estimatedTokens = this.estimateTokens(messages);
    
    const tokenThreshold = contextSize * threshold;
    logger.debug(`[MemorySystem] Token估算: ${estimatedTokens}/${tokenThreshold}`);

    if (estimatedTokens >= tokenThreshold) {
      logger.info(`[MemorySystem] 触发历史处理: Token数 ${estimatedTokens} >= ${tokenThreshold}`);
      return true;
    }

    return false;
  }

  /**
   * 估算消息的 token 数
   * @param {Array} messages - 消息列表
   * @returns {number} 估算的 token 数
   */
  estimateTokens(messages) {
    return estimateMessagesTokens(Array.isArray(messages) ? messages : []);
  }

  /**
   * 处理历史消息（总结、归档到 Topic）
   * @param {string} userId - 用户ID
   * @param {string} currentTopicId - 当前话题ID（可选，用于更新标题）
   */
  async processHistory(userId, currentTopicId = null) {
    logger.info(`[MemorySystem] 开始处理历史消息: expert=${this.expertId}, user=${userId}, currentTopic=${currentTopicId}`);

    try {
      // 1. 获取所有消息（最多100条）
      // getRecentMessages 返回的消息按 created_at DESC 排序（最新的在前）
      const allMessages = await this.getRecentMessages(userId, 100);
      
      // 保留最新的 10 条（数组前 10 个），归档其余的（数组 10 之后的）
      // allMessages[0] 是最新的消息，allMessages[n-1] 是最旧的
      const keepCount = 10;
      const messagesToArchive = allMessages.length > keepCount
        ? allMessages.slice(keepCount)  // 归档第 10 条之后的消息（较旧的）
        : [];
      
      logger.debug(`[MemorySystem] 总消息数: ${allMessages.length}, 待归档: ${messagesToArchive.length}, 保留: ${Math.min(allMessages.length, keepCount)}`);

      // 2. 总结对话（LLM 调用 - 归档总结，使用全部消息来生成更好的标题）
      this._summarizationCallCount++;
      logger.info(`[MemorySystem] summarizeConversation (source=archive, call#${this._summarizationCallCount}): ${allMessages.length} 条消息`);
      const summary = await this.summarizeConversation(allMessages);

      // 3. 如果提供了 currentTopicId，更新当前话题的标题
      if (currentTopicId) {
        logger.info(`[MemorySystem] 更新当前话题标题: ${currentTopicId} -> ${summary.topicName}`);
        await this.db.updateTopic(currentTopicId, {
          title: summary.topicName,
          description: summary.topicDescription,
        });

        // 更新用户档案背景（复用总结结果）
        if (summary.userProfile) {
          await this.updateUserProfileBackground(userId, summary.userProfile);
        }

        // 更新用户基本信息（如果从对话中提取到）
        if (summary.userInfo) {
          await this.updateUserInfo(userId, summary.userInfo);
        }

        logger.info('[MemorySystem] 话题标题更新完成');
        // 注意：不要 return，继续处理需要归档的消息
      }

      // 4. 如果没有需要归档的消息，直接返回
      if (messagesToArchive.length === 0) {
        logger.debug('[MemorySystem] 没有需要归档的消息');
        return;
      }

      // 5. 执行归档逻辑
      // 显示待归档消息的时间范围（messagesToArchive 是倒序的，所以 firstMsg 是较新的，lastMsg 是最旧的）
      const firstMsg = messagesToArchive[0];
      const lastMsg = messagesToArchive[messagesToArchive.length - 1];
      logger.debug(`[MemorySystem] 归档时间范围: ${new Date(lastMsg.timestamp).toISOString()} ~ ${new Date(firstMsg.timestamp).toISOString()}`);
      logger.debug(`[MemorySystem] 最旧消息ID: ${lastMsg.id}, 最新归档消息ID: ${firstMsg.id}`);

      // 6. 匹配或创建 Topic（只匹配 active 状态的 Topic）
      const existingTopics = await this.getTopics(userId, 5, 'active');
      this._summarizationCallCount++;
      logger.info(`[MemorySystem] matchOrCreateTopic (source=archive, call#${this._summarizationCallCount}): 现有 ${existingTopics.length} 个活跃话题`);
      const topicResult = await this.matchOrCreateTopic(summary, existingTopics);

      // 7. 执行归档
      // messagesToArchive 是倒序的（[0] 最新，[n-1] 最旧）
      const oldestMsg = messagesToArchive[messagesToArchive.length - 1];
      const newestMsg = messagesToArchive[0];
      const archiveStartTime = new Date(oldestMsg.timestamp);
      const archiveEndTime = new Date(newestMsg.timestamp);
      
      if (topicResult.action === 'create') {
        // 创建新 Topic
        const topicId = await this.createTopic(userId, {
          name: summary.topicName,
          description: summary.topicDescription,
          category: summary.category,
          keywords: summary.keywords || [],
          startTime: archiveStartTime,
          endTime: archiveEndTime,
        });

        // 关联消息到 Topic
        logger.debug(`[MemorySystem] 正在将消息关联到 Topic ${topicId}...`);
        await this.assignMessagesToTopic(userId, topicId, archiveStartTime, archiveEndTime);
        
        // 更新 Topic 消息计数
        await this.updateTopicMessageCount(topicId);
        logger.debug(`[MemorySystem] Topic ${topicId} 消息计数已更新`);

        logger.info(`[MemorySystem] 创建新 Topic: ${topicId}, 归档 ${messagesToArchive.length} 条消息`);

        // Phase 3: 质量评分
        const quality = assessTopicQuality({
          title: summary.topicName || '',
          description: summary.topicDescription || '',
          summary: summary.topicDescription || '',
          keywords: summary.keywords || '',
        });
        logger.info(`[MemorySystem] topic_summary_quality: score=${quality.score}, pass=${quality.pass}, topic="${summary.topicName}"`);
      } else if (topicResult.topicId) {
        // 追加到现有 Topic
        logger.debug(`[MemorySystem] 正在将消息追加到现有 Topic ${topicResult.topicId}...`);
        await this.assignMessagesToTopic(userId, topicResult.topicId, archiveStartTime, archiveEndTime);
        
        // 更新 Topic 消息计数
        await this.updateTopicMessageCount(topicResult.topicId);
        logger.debug(`[MemorySystem] Topic ${topicResult.topicId} 消息计数已更新`);

        logger.info(`[MemorySystem] 追加到 Topic: ${topicResult.topicId}, 归档 ${messagesToArchive.length} 条消息`);
      }

      logger.info('[MemorySystem] 历史处理完成');
    } catch (error) {
      logger.error('[MemorySystem] 历史处理失败:', error.message);
      throw error;
    }
  }

  /**
   * 总结对话
   * @param {Array} messages - 消息列表
   * @returns {Promise<object>} 总结结果
   */
  async summarizeConversation(messages) {
    const conversationText = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const prompt = `请分析以下对话，生成一个便于检索的话题标题。

对话内容：
${conversationText}

## 任务目标
生成的话题标题将用于历史对话检索，需要让用户一眼就能判断这个对话是否包含他们要找的内容。

## 输出要求（JSON格式）

### 1. topicName（话题标题）- 最重要！
- **长度**：8-15个字
- **原则**：包含核心关键词，便于搜索匹配
- **结构建议**：[主题领域] + [具体内容/问题]
- **好的例子**：
  - "React性能优化：useMemo使用场景"
  - "Node.js内存泄漏排查方法"
  - "产品需求评审流程改进讨论"
  - "用户登录状态管理方案选型"
- **不好的例子**：
  - "技术问答"（太泛，无法检索）
  - "讨论"（无意义）
  - "关于代码的一些问题"（没有关键词）

### 2. topicDescription（话题描述）
- **长度**：30-60字
- **内容**：概括讨论的核心问题、解决方案或结论
- **作用**：作为标题的补充，帮助确认是否是目标对话

### 3. keywords（关键词数组）
- 提取3-5个核心关键词，用于搜索匹配
- 例如：["React", "性能优化", "useMemo", "缓存"]

### 4. category（分类）
- 从以下选择：工作、学习、生活、技术、娱乐、其他

### 5. userProfile（用户画像）
- 基于对话分析用户特征（50-100字）
- 包括：职业/身份、技术水平、沟通风格、关注点

### 6. userInfo（用户基本信息）- 新增！
- 从对话中提取用户透露的个人信息
- **只有在对话中明确提到时才填写，否则为 null**
- gender: "male" / "female" / "other" / null
- age: 数字年龄 / null
- preferredName: 用户希望被称呼的名字 / null
- occupation: 职业 / null
- location: 居住城市（如：北京、上海）/ null

## 返回格式
{
  "topicName": "React性能优化：useMemo使用场景",
  "topicDescription": "讨论了React中useMemo的使用场景、性能优化效果以及与useCallback的区别",
  "keywords": ["React", "性能优化", "useMemo", "缓存"],
  "category": "技术",
  "userProfile": "一位有经验的前端开发者，关注性能优化，沟通风格直接。",
  "userInfo": {
    "gender": null,
    "age": null,
    "preferredName": null,
    "occupation": null,
    "location": null
  }
}`;

    try {
      const response = await this.llmClient.callExpressive([
        {
          role: 'system',
          content: '你是一个对话分析助手，专门生成便于检索的话题标题和提取用户信息。你的核心目标是让生成的标题包含足够的关键词，帮助用户快速找到历史对话。标题应该具体、有信息量，而不是泛泛而谈。同时，你需要从对话中提取用户透露的个人信息（性别、年龄、称呼偏好），只有在对话中明确提到时才提取。'
        },
        { role: 'user', content: prompt },
      ], { temperature: 0.3 });

      const result = parseJsonLikeContent(response.content);
      if (result && !result._parse_failed && typeof result === 'object' && !Array.isArray(result)) {
        logger.debug('[MemorySystem] 对话总结完成:', {
          topicName: result.topicName,
          keywords: result.keywords,
          category: result.category,
          userInfo: result.userInfo,
        });
        return result;
      }
    } catch (error) {
      logger.warn('[MemorySystem] 总结解析失败，使用默认值:', error.message);
    }

    // 默认返回值
    return {
      topicName: '未命名话题',
      topicDescription: '自动归档的对话',
      keywords: [],
      category: '其他',
      userProfile: '',
      userInfo: {
        gender: null,
        age: null,
        preferredName: null,
        occupation: null,
        location: null,
      },
    };
  }

  /**
   * 匹配或创建 Topic
   * @param {object} summary - 对话总结
   * @param {Array} existingTopics - 现有 Topics
   * @returns {Promise<object>} 匹配结果
   */
  async matchOrCreateTopic(summary, existingTopics) {
    if (existingTopics.length === 0) {
      return { action: 'create' };
    }

    const prompt = `现有 Topics：
${JSON.stringify(existingTopics.map(t => ({
  id: t.id,
  name: t.title,
  description: t.description,
})), null, 2)}

新对话总结：
话题名称：${summary.topicName}
描述：${summary.topicDescription}
分类：${summary.category}

请判断：
1. 是否与现有某个 Topic 属于同一话题？
2. 如果匹配，返回该 Topic 的 id
3. 如果不匹配，建议创建新 Topic

返回 JSON 格式：
{
  "matched": true/false,
  "topicId": "匹配的 Topic ID（如果匹配）",
  "action": "append" 或 "create",
  "reason": "判断理由"
}`;

    try {
      const response = await this.llmClient.callExpressive([
        { role: 'system', content: '你是一个记忆管理助手，负责对话的分类和归档。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.3 });

      const result = parseJsonLikeContent(response.content);
      if (result && !result._parse_failed && typeof result === 'object' && !Array.isArray(result)) {
        result.summary = summary;
        return result;
      }
    } catch (error) {
      logger.warn('[MemorySystem] Topic 匹配解析失败:', error.message);
    }

    // 默认创建新 Topic
    return { action: 'create', summary };
  }

  /**
   * ==================== Inner Voice 操作 ====================
   */

  /**
   * 获取最近的 Inner Voices
   * @param {string} userId - 用户ID
   * @param {number} limit - 数量限制
   * @returns {Promise<Array>} Inner Voice 列表
   */
  async getRecentInnerVoices(userId, limit = 3) {
    const messages = await this.db.getMessagesWithInnerVoice(
      this.expertId,
      userId,
      limit
    );

    // 安全解析 JSON
    const safeParseJSON = (value) => {
      if (!value) return null;
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch (e) {
        return null;
      }
    };

    return messages
      .filter(m => m.inner_voice)
      .map(m => safeParseJSON(m.inner_voice));
  }

  /**
   * ==================== 辅助方法 ====================
   */

  /**
   * 生成 Topic ID
   * @returns {string} Topic ID
   */
  generateTopicId() {
    return Utils.newID(20);
  }

}

export default MemorySystem;
