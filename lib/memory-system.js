/**
 * Memory System - 记忆系统（数据库版）
 * 管理专家的对话历史、Topic 和联系人信息
 * 基于 MariaDB 存储
 */

import LLMClient from './llm-client.js';
import logger from './logger.js';
import Utils from './utils.js';

class MemorySystem {
  /**
   * @param {Database} db - 数据库实例
   * @param {string} expertId - 专家ID
   * @param {LLMClient} llmClient - LLM客户端（用于总结）
   * @param {object} options - 可选配置
   */
  constructor(db, expertId, llmClient, options = {}) {
    this.db = db;
    this.expertId = expertId;
    this.llmClient = llmClient;

    // 内存缓存配置
    this.messageCache = new Map(); // userId -> recentMessages
    this.cacheMaxSize = options.cacheMaxSize || 100; // 每个用户的最大消息数
    this.maxCachedUsers = options.maxCachedUsers || 50; // 最大缓存用户数量
    this.lruList = []; // LRU 访问顺序追踪
  }

  /**
   * ==================== 消息操作 ====================
   */

  /**
   * 获取最近消息
   * @param {string} userId - 用户ID
   * @param {number} limit - 数量限制
   * @returns {Promise<Array>} 消息列表
   */
  async getRecentMessages(userId, limit = 20) {
    // 先检查缓存
    const cached = this.messageCache.get(userId);
    if (cached && cached.length >= limit) {
      // 更新 LRU 顺序
      this.updateLRU(userId);
      return cached.slice(-limit);
    }

    // 从数据库加载
    const messages = await this.db.getRecentMessages(this.expertId, userId, limit);

    // 转换格式
    const formatted = messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: new Date(m.created_at).getTime(),
      innerVoice: m.inner_voice ? JSON.parse(m.inner_voice) : null,
      toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
      topicId: m.topic_id,
    }));

    // 更新缓存
    this.messageCache.set(userId, formatted);

    return formatted;
  }

  /**
   * 获取消息（支持时间范围）
   * @param {string} userId - 用户ID
   * @param {Date} startTime - 开始时间
   * @param {Date} endTime - 结束时间
   * @returns {Promise<Array>} 消息列表
   */
  async getMessagesByTimeRange(userId, startTime, endTime) {
    return await this.db.getMessagesByTimeRange(
      this.expertId,
      userId,
      startTime,
      endTime
    );
  }

  /**
   * ==================== 用户档案操作 ====================
   */

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
   * @returns {Promise<Array>} Topic 列表
   */
  async getTopics(userId, limit = 10) {
    return await this.db.getTopicsByExpertAndUser(this.expertId, userId, limit);
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
      startTime: topicData.startTime || new Date(),
      endTime: topicData.endTime || new Date(),
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
   * ==================== 历史处理（Topic 归档） ====================
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
    // 简单估算：1 token ≈ 4 个字符（中文字符）
    let total = 0;
    for (const msg of messages) {
      total += Math.ceil(msg.content.length / 4) + 4; // +4 用于 role 等开销
    }
    return total;
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

      // 2. 总结对话（使用全部消息来生成更好的标题）
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

      // 6. 匹配或创建 Topic
      const existingTopics = await this.getTopics(userId, 5);
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
- location: 所在地 / null

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

      // 解析 JSON
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
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

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
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

    return messages
      .filter(m => m.inner_voice)
      .map(m => JSON.parse(m.inner_voice));
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

  /**
   * 更新消息缓存
   * @param {string} userId - 用户ID
   * @param {object} message - 消息对象
   */
  updateMessageCache(userId, message) {
    // 更新 LRU 顺序
    this.updateLRU(userId);

    // 检查是否需要清理旧用户
    if (!this.messageCache.has(userId) &&
        this.messageCache.size >= this.maxCachedUsers) {
      this.evictLRU();
    }

    if (!this.messageCache.has(userId)) {
      this.messageCache.set(userId, []);
    }

    const cache = this.messageCache.get(userId);
    cache.push(message);

    // 限制单个用户的缓存大小
    if (cache.length > this.cacheMaxSize) {
      cache.shift();
    }
  }

  /**
   * 更新 LRU 访问顺序
   * @param {string} userId - 用户ID
   */
  updateLRU(userId) {
    // 从列表中移除（如果存在）
    const index = this.lruList.indexOf(userId);
    if (index > -1) {
      this.lruList.splice(index, 1);
    }
    // 添加到末尾（最近使用）
    this.lruList.push(userId);
  }

  /**
   * 清理最久未使用的用户缓存
   */
  evictLRU() {
    if (this.lruList.length === 0) return;
    
    // 移除列表第一个（最久未使用）
    const oldestUser = this.lruList.shift();
    if (oldestUser && this.messageCache.has(oldestUser)) {
      this.messageCache.delete(oldestUser);
      logger.debug(`[MemorySystem] 缓存清理: ${oldestUser}`);
    }
  }

  /**
   * 清除缓存
   * @param {string} userId - 用户ID（可选）
   */
  clearCache(userId = null) {
    if (userId) {
      this.messageCache.delete(userId);
    } else {
      this.messageCache.clear();
    }
  }
}

export default MemorySystem;
