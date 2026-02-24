/**
 * Context Manager - 上下文管理器
 * 负责构建发送给 LLM 的完整上下文
 *
 * 架构：System Prompt + Soul + Inner Voice + Topic Context + Contact Profile + Recent Messages
 */

import logger from './logger.js';

class ContextManager {
  /**
   * @param {object} expertConfig - 专家配置（从数据库加载）
   * @param {object} options - 可选配置
   * @param {number} options.recentMessageCount - 最近消息数量（默认 20）
   * @param {number} options.innerVoiceCount - 注入的 Inner Voice 数量（默认 3）
   */
  constructor(expertConfig, options = {}) {
    this.expertConfig = expertConfig;
    this.options = {
      recentMessageCount: options.recentMessageCount || 20,
      innerVoiceCount: options.innerVoiceCount || 3,
    };

    // 从专家配置中提取 Soul
    this.soul = this.extractSoul(expertConfig);
  }

  /**
   * 从专家配置中提取 Soul
   */
  extractSoul(expertConfig) {
    const expert = expertConfig.expert || expertConfig;

    return {
      coreValues: this.parseJsonField(expert.core_values),
      taboos: this.parseJsonField(expert.taboos),
      emotionalTone: expert.emotional_tone || '温和、真诚',
      behavioralGuidelines: this.parseJsonField(expert.behavioral_guidelines),
      speakingStyle: expert.speaking_style || '',  // 添加说话风格
    };
  }

  /**
   * 解析 JSON 字段（数据库中存储为 JSON 字符串）
   */
  parseJsonField(field) {
    if (!field) return [];
    if (Array.isArray(field)) return field;
    try {
      return JSON.parse(field);
    } catch {
      return [];
    }
  }

  /**
   * 构建完整的 LLM 上下文（新设计）
   *
   * 上下文结构：
   * 1. System Prompt（系统提示词）
   * 2. Skills Info（可用技能描述）
   * 3. Topic Summaries（话题总结，从 topics 表加载）
   * 4. Unarchived Messages（未归档消息，topic_id IS NULL）
   *
   * @param {MemorySystem} memorySystem - 记忆系统实例
   * @param {string} userId - 用户ID
   * @param {object} options - 构建选项
   * @param {string} options.currentMessage - 当前用户消息
   * @param {boolean} options.includeInnerVoices - 是否包含 Inner Voices（默认 true）
   * @param {boolean} options.includeTopicSummaries - 是否包含 Topic 总结（默认 true）
   * @param {Array} options.skills - 可用技能列表（用于注入技能描述）
   * @returns {Promise<object>} 上下文对象
   */
  async buildContext(memorySystem, userId, options = {}) {
    const {
      currentMessage = '',
      includeInnerVoices = true,
      includeTopicSummaries = true,
      skills = [],
    } = options;

    // 1. 确保用户档案存在
    const userProfile = await memorySystem.getOrCreateUserProfile(userId);

    // 2. 获取未归档消息（新设计：topic_id IS NULL）
    const unarchivedMessages = await memorySystem.getUnarchivedMessages(
      userId,
      this.options.recentMessageCount
    );

    // 3. 获取 Inner Voices（隐藏上下文）
    let innerVoices = [];
    if (includeInnerVoices) {
      innerVoices = await memorySystem.getRecentInnerVoices(
        userId,
        this.options.innerVoiceCount
      );
    }

    // 4. 获取 Topic 总结（新设计：从 topics 表加载）
    let topicSummaries = null;
    if (includeTopicSummaries) {
      topicSummaries = await this.buildTopicSummaries(memorySystem, userId);
    }

    // 5. 获取用户档案背景
    const userProfileContext = await this.buildUserProfileContext(userProfile);

    // 6. 生成用户信息引导提示（如果缺失基本信息）
    const conversationCount = Math.floor(unarchivedMessages.length / 2); // 估算对话轮次
    const userInfoGuidance = this.generateUserInfoGuidance(userProfileContext, conversationCount);

    // 7. 构建系统提示（包含 Skills、Topic 总结和引导提示）
    const systemPrompt = this.buildSystemPromptWithTopics(
      innerVoices,
      topicSummaries,
      userInfoGuidance,
      skills
    );

    // 8. 构建 LLM 消息数组（使用未归档消息）
    const messages = this.buildMessages(systemPrompt, unarchivedMessages, currentMessage);

    return {
      // LLM 输入
      messages,
      systemPrompt,

      // 隐藏上下文（用于调试和后续处理）
      hiddenContext: {
        soul: this.soul,
        innerVoices,
        topicSummaries,
        userProfile: userProfileContext,
        userInfoGuidance,
      },

      // 元数据
      metadata: {
        expertId: this.expertConfig.expert?.id || this.expertConfig.id,
        userId,
        messageCount: unarchivedMessages.length,
        innerVoiceCount: innerVoices.length,
        hasTopicSummaries: !!topicSummaries,
      },
    };
  }

  /**
   * 构建系统提示（包含 Soul 和 Inner Voices）
   * @param {Array} innerVoices - 内心独白列表
   * @param {string} userInfoGuidance - 用户信息引导提示（可选）
   */
  buildSystemPrompt(innerVoices = [], userInfoGuidance = null) {
    const expert = this.expertConfig.expert || this.expertConfig;

    // 基础 System Prompt（优先使用 prompt_template，兼容 system_prompt）
    let systemPrompt = expert.prompt_template || expert.system_prompt || expert.introduction || '';

    // 添加 Soul（包含 speaking_style）
    systemPrompt = this.enhanceWithSoul(systemPrompt, this.soul, expert);

    // 添加 Inner Voices（内心独白）
    if (innerVoices.length > 0) {
      systemPrompt = this.enhanceWithInnerVoices(systemPrompt, innerVoices);
    }

    // 添加用户信息引导提示（如果有）
    if (userInfoGuidance) {
      systemPrompt = this.enhanceWithUserInfoGuidance(systemPrompt, userInfoGuidance);
    }

    return systemPrompt;
  }

  /**
   * 构建包含 Topic 总结的系统提示（新设计）
   * @param {Array} innerVoices - 内心独白列表
   * @param {string} topicSummaries - Topic 总结文本
   * @param {string} userInfoGuidance - 用户信息引导提示（可选）
   * @param {Array} skills - 可用技能列表（可选）
   */
  buildSystemPromptWithTopics(innerVoices = [], topicSummaries = null, userInfoGuidance = null, skills = []) {
    const expert = this.expertConfig.expert || this.expertConfig;

    // 基础 System Prompt
    let systemPrompt = expert.prompt_template || expert.system_prompt || expert.introduction || '';

    // 添加 Soul
    systemPrompt = this.enhanceWithSoul(systemPrompt, this.soul, expert);

    // 添加可用技能描述（在 Soul 之后，帮助 LLM 理解工具能力）
    if (skills && skills.length > 0) {
      systemPrompt = this.enhanceWithSkills(systemPrompt, skills);
    }

    // 添加 Topic 总结（新设计：在 Skills 之后、Inner Voices 之前）
    if (topicSummaries) {
      systemPrompt = this.enhanceWithTopicSummaries(systemPrompt, topicSummaries);
    }

    // 添加 Inner Voices
    if (innerVoices.length > 0) {
      systemPrompt = this.enhanceWithInnerVoices(systemPrompt, innerVoices);
    }

    // 添加用户信息引导提示
    if (userInfoGuidance) {
      systemPrompt = this.enhanceWithUserInfoGuidance(systemPrompt, userInfoGuidance);
    }

    return systemPrompt;
  }

  /**
   * 用 Topic 总结增强系统提示
   * @param {string} systemPrompt - 系统提示
   * @param {string} topicSummaries - Topic 总结文本
   */
  enhanceWithTopicSummaries(systemPrompt, topicSummaries) {
    if (!topicSummaries) return systemPrompt;

    const topicPrompt = `
## 之前的对话话题总结
以下是你们之前讨论过的话题，帮助你了解对话历史：

${topicSummaries}
`;

    return systemPrompt + '\n\n' + topicPrompt;
  }

  /**
   * 用可用技能信息增强系统提示
   * 帮助 LLM 理解每个技能的用途和何时应该调用工具
   * @param {string} systemPrompt - 系统提示
   * @param {Array} skills - 技能列表，每项包含 id, name, description, tools
   */
  enhanceWithSkills(systemPrompt, skills) {
    if (!skills || skills.length === 0) {
      logger.info('[ContextManager] enhanceWithSkills: 没有技能需要注入');
      return systemPrompt;
    }

    logger.info(`[ContextManager] enhanceWithSkills: 注入 ${skills.length} 个技能到 System Prompt`);
    skills.forEach(s => logger.info(`[ContextManager] - ${s.id}: ${s.name}`));

    // 构建技能描述文本
    const skillsDescription = skills.map(skill => {
      // 提取工具名称列表
      const toolNames = skill.tools && skill.tools.length > 0
        ? skill.tools.join(', ')
        : '无特定工具';

      return `- **${skill.name}** (${skill.id}): ${skill.description || '暂无描述'}
    - 可用工具: ${toolNames}`;
    }).join('\n');

    const skillsPrompt = `
## 你的可用技能
你拥有以下技能，可以在合适的时候调用相关工具来完成任务：

${skillsDescription}

当你需要使用这些技能时，系统会自动调用相应的工具。你只需要在回复中自然地表达即可，系统会处理工具调用。
`;

    logger.info('[ContextManager] enhanceWithSkills: System Prompt 已增强');
    return systemPrompt + '\n\n' + skillsPrompt;
  }

  /**
   * 构建 Topic 总结（新设计）
   * 从 topics 表加载，按时间倒序
   * @param {MemorySystem} memorySystem - 记忆系统实例
   * @param {string} userId - 用户ID
   * @returns {Promise<string|null>} Topic 总结文本
   */
  async buildTopicSummaries(memorySystem, userId) {
    try {
      // 获取最近的 Topics（按更新时间倒序）
      const topics = await memorySystem.getTopics(userId, 10);

      if (topics.length === 0) {
        return null;
      }

      // 构建 Topic 总结文本（按时间正序，即最早的在前）
      const summaryText = topics
        .reverse()  // 转为正序
        .map(t => `【${t.title}】${t.description || '无描述'}`)
        .join('\n\n');

      return summaryText;
    } catch (error) {
      logger.warn('[ContextManager] 构建 Topic 总结失败:', error.message);
      return null;
    }
  }

  /**
   * 用 Soul 增强系统提示
   * @param {string} systemPrompt - 基础系统提示
   * @param {object} soul - Soul 配置
   * @param {object} expert - 专家配置（可选，用于 speaking_style）
   */
  enhanceWithSoul(systemPrompt, soul, expert = null) {
    if (!soul) return systemPrompt;

    const coreValues = Array.isArray(soul.coreValues)
      ? soul.coreValues.map((v, i) => `${i + 1}. ${v}`).join('\n')
      : soul.coreValues || '';

    const taboos = Array.isArray(soul.taboos)
      ? soul.taboos.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : soul.taboos || '';

    const guidelines = Array.isArray(soul.behavioralGuidelines)
      ? soul.behavioralGuidelines.map((g, i) => `${i + 1}. ${g}`).join('\n')
      : soul.behavioralGuidelines || '';

    // 获取说话风格
    const speakingStyle = expert?.speaking_style || soul.speakingStyle || '';

    // 构建说话风格部分
    const speakingStyleSection = speakingStyle
      ? `\n## 你的说话风格\n${speakingStyle}\n`
      : '';

    const soulPrompt = `
## 你的核心价值观
${coreValues}

## 你的行为准则
${guidelines}

## 你的禁忌（绝对不能做的事）
${taboos}

## 你的情感基调
${soul.emotionalTone}
${speakingStyleSection}
`;

    return systemPrompt + '\n\n' + soulPrompt;
  }

  /**
   * 用 Inner Voices 增强系统提示
   */
  enhanceWithInnerVoices(systemPrompt, innerVoices) {
    if (!innerVoices || innerVoices.length === 0) return systemPrompt;

    // 分析评分趋势
    const trend = this.analyzeTrend(innerVoices);

    // 构建 Inner Voice 文本
    let innerVoiceText = '';

    // 如果趋势下降，强调 nextRoundAdvice
    if (trend.trend === 'declining' && trend.latest?.nextRoundAdvice) {
      innerVoiceText += `【重要提醒】最近表现有下降趋势，请注意：${trend.latest.nextRoundAdvice}\n\n`;
    }

    // 添加最近的内心独白
    const monologues = innerVoices
      .filter(iv => iv.monologue)
      .map(iv => iv.monologue)
      .join('\n');

    if (monologues) {
      innerVoiceText += `最近的内心独白：\n${monologues}`;
    }

    const innerVoicePrompt = `
## 你的内心独白（前几轮的反思结果）
这是你对自己之前表现的反思：

${innerVoiceText}

请根据这些反思调整你这一轮的回复。
`;

    return systemPrompt + '\n\n' + innerVoicePrompt;
  }

  /**
   * 用用户信息引导提示增强系统提示
   * @param {string} systemPrompt - 系统提示
   * @param {string} guidance - 引导提示
   */
  enhanceWithUserInfoGuidance(systemPrompt, guidance) {
    if (!guidance) return systemPrompt;

    const guidancePrompt = `
## 对话提示
${guidance}
`;

    return systemPrompt + '\n\n' + guidancePrompt;
  }

  /**
   * 分析 Inner Voice 评分趋势
   */
  analyzeTrend(innerVoices) {
    const scores = innerVoices
      .filter(iv => iv.selfEvaluation?.score)
      .map(iv => iv.selfEvaluation.score);

    if (scores.length < 2) {
      return { trend: 'stable', latest: innerVoices[0] };
    }

    const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
    const secondHalf = scores.slice(Math.floor(scores.length / 2));

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const diff = secondAvg - firstAvg;

    if (diff > 1) {
      return { trend: 'improving', diff, latest: innerVoices[0] };
    } else if (diff < -1) {
      return { trend: 'declining', diff, latest: innerVoices[0] };
    }

    return { trend: 'stable', diff, latest: innerVoices[0] };
  }

  /**
   * 构建用户档案上下文
   * @param {object} userProfile - 用户档案（包含 user 信息）
   * @returns {object} 用户档案上下文
   */
  async buildUserProfileContext(userProfile) {
    if (!userProfile) return null;

    return {
      id: userProfile.user_id,
      // 用户固有属性（来自 users 表）
      preferredName: userProfile.preferred_name,
      nickname: userProfile.nickname,
      email: userProfile.email,
      gender: userProfile.gender,
      birthday: userProfile.birthday,
      occupation: userProfile.occupation,
      location: userProfile.location,
      // 专家对用户的认知（来自 user_profiles 表）
      introduction: userProfile.introduction,
      background: userProfile.background,
      notes: userProfile.notes,
      firstMet: userProfile.first_met,
      lastActive: userProfile.last_active,
    };
  }

  /**
   * 检查用户缺失的基本信息
   * @param {object} userProfile - 用户档案
   * @returns {Array<string>} 缺失的信息字段名称
   */
  checkMissingUserInfo(userProfile) {
    const missing = [];
    
    // 称呼偏好（存储在 user_profiles，随 expert 不同）
    if (!userProfile?.preferredName) {
      missing.push('称呼');
    }
    // 用户固有属性（存储在 users 表）
    if (!userProfile?.gender) {
      missing.push('性别');
    }
    if (!userProfile?.birthday) {
      missing.push('年龄/生日');
    }
    if (!userProfile?.occupation) {
      missing.push('职业');
    }
    if (!userProfile?.location) {
      missing.push('所在地');
    }
    
    return missing;
  }

  /**
   * 生成用户信息引导提示
   * 在对话中自然地引导用户提供缺失的信息
   * @param {object} userProfile - 用户档案
   * @param {number} conversationCount - 对话轮次（用于控制引导频率）
   * @returns {string|null} 引导提示（如果不需要引导则返回 null）
   */
  generateUserInfoGuidance(userProfile, conversationCount = 0) {
    const missing = this.checkMissingUserInfo(userProfile);
    
    if (missing.length === 0) {
      return null;
    }

    // 控制引导频率：每 3 轮对话最多引导一次
    // 且每次只引导一个缺失项
    const guidanceIndex = conversationCount % 3;
    if (guidanceIndex !== 0) {
      return null;
    }

    // 根据对话轮次选择要引导的缺失项
    const itemIndex = Math.floor(conversationCount / 3) % missing.length;
    const targetItem = missing[itemIndex];

    // 生成自然的引导提示
    const guidancePrompts = {
      '称呼': '（提示：你还不知道对方希望被怎么称呼，可以在对话中自然地询问）',
      '性别': '（提示：你还不知道对方的性别，可以在适当时候了解）',
      '年龄/生日': '（提示：你还不知道对方的年龄，可以在聊天中自然地了解）',
      '职业': '（提示：你还不知道对方从事什么工作，可以在聊天中自然地了解）',
      '所在地': '（提示：你还不知道对方在哪里，可以在聊天中自然地了解）',
    };

    return guidancePrompts[targetItem] || null;
  }

  /**
   * 构建 Topic 上下文
   */
  async buildTopicContext(memorySystem, userId, currentMessage) {
    try {
      // 获取相关 Topics
      const topics = await memorySystem.getTopics(userId, 5);

      if (topics.length === 0) {
        return null;
      }

      // 简单匹配：返回最近的几个 Topic 描述
      // 未来可以实现更智能的语义匹配
      const topicSummaries = topics.map(t =>
        `【${t.title}】${t.description || ''} (${t.message_count || 0} 条消息)`
      );

      return topicSummaries.join('\n');
    } catch (error) {
      logger.warn('[ContextManager] 构建 Topic 上下文失败:', error.message);
      return null;
    }
  }

  /**
   * 构建 LLM 消息数组
   * @param {string} systemPrompt - 系统提示
   * @param {Array} recentMessages - 历史消息（必须是 ASC 顺序，即旧→新）
   * @param {string} currentMessage - 当前用户消息
   */
  buildMessages(systemPrompt, recentMessages, currentMessage) {
    const messages = [];

    // 系统提示
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // 历史消息（按时间正序：旧→新）
    // getUnarchivedMessages 返回 ASC 顺序，直接使用
    for (const msg of recentMessages) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // 当前消息
    if (currentMessage) {
      messages.push({ role: 'user', content: currentMessage });
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
      lines.push(`核心价值观: ${soul.coreValues?.join(', ')}`);
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
      const preview = msg.content?.substring(0, 80) || '';
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
      total += Math.ceil((msg.content?.length || 0) / 4) + 4;
    }

    return total;
  }
}

export default ContextManager;
