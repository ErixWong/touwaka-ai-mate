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
   * 构建包含 Topic 总结的系统提示（新设计）
   * @param {Array} innerVoices - 内心独白列表
   * @param {string} topicSummaries - Topic 总结文本
   * @param {string} userInfoGuidance - 用户信息引导提示（可选）
   * @param {Array} skills - 可用技能列表（可选）
   * @param {object} taskContext - 任务上下文（任务工作空间模式）
   * @param {string} ragContext - RAG 检索上下文（知识库检索结果）
   * @param {Array} assistants - 可用助理列表（可选）
   */
  buildSystemPromptWithTopics(innerVoices = [], topicSummaries = null, userInfoGuidance = null, skills = [], taskContext = null, ragContext = null, assistants = null) {
    const expert = this.expertConfig.expert || this.expertConfig;

    // 基础 System Prompt
    let systemPrompt = expert.prompt_template || expert.system_prompt || expert.introduction || '';

    // 添加当前时间信息（放在最前面，让模型知道当前时间）
    systemPrompt = this.enhanceWithTimestamp(systemPrompt);

    // 添加 Soul
    systemPrompt = this.enhanceWithSoul(systemPrompt, this.soul, expert);

    // 添加可用技能描述（在 Soul 之后，帮助 LLM 理解工具能力）
    if (skills && skills.length > 0) {
      systemPrompt = this.enhanceWithSkills(systemPrompt, skills);
    }

    // 添加可用助理列表
    if (assistants && assistants.length > 0) {
      systemPrompt = this.enhanceWithAssistants(systemPrompt, assistants);
    }

    // 添加任务工作空间上下文（在 Skills 之后、Topic 总结之前）
    if (taskContext) {
      systemPrompt = this.enhanceWithTaskContext(systemPrompt, taskContext);
    }

    // 添加 Topic 总结（新设计：在 Skills 之后、Inner Voices 之前）
    if (topicSummaries) {
      systemPrompt = this.enhanceWithTopicSummaries(systemPrompt, topicSummaries);
    }

    // 添加 RAG 检索上下文（知识库检索结果）
    if (ragContext) {
      systemPrompt = this.enhanceWithRAGContext(systemPrompt, ragContext);
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
   * 用 RAG 检索上下文增强系统提示
   * @param {string} systemPrompt - 系统提示
   * @param {string} ragContext - RAG 检索上下文（知识库检索结果）
   */
  enhanceWithRAGContext(systemPrompt, ragContext) {
    if (!ragContext) return systemPrompt;

    const ragPrompt = `
## 相关知识库内容
以下是从知识库中检索到的相关内容，请参考这些信息回答用户问题：

${ragContext}
`;

    return systemPrompt + '\n\n' + ragPrompt;
  }

  /**
   * 用当前时间戳增强系统提示
   * 让模型能够感知当前日期和时间
   * @param {string} systemPrompt - 系统提示
   * @returns {string} 增强后的系统提示
   */
  enhanceWithTimestamp(systemPrompt) {
    const now = new Date();

    // 格式化日期和时间（中文格式）
    const dateString = now.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });

    const timeString = now.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const timestampPrompt = `
## 当前时间
现在是中国标准时间（CST, UTC+8）：
- **日期**：${dateString}
- **时间**：${timeString}

请根据当前时间来理解和回应用户的请求。
`;

    return systemPrompt + '\n\n' + timestampPrompt;
  }

  /**
   * 用可用技能信息增强系统提示
   * 帮助 LLM 理解每个技能的用途和何时应该调用工具
   * @param {string} systemPrompt - 系统提示
   * @param {Array} skills - 技能列表，每项包含 id, name, description, tools
   *   - tools 可以是字符串数组（工具名称）或对象数组（包含 name 和 description）
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
      // 构建工具列表描述
      let toolsDescription = '无特定工具';
      if (skill.tools && skill.tools.length > 0) {
        if (typeof skill.tools[0] === 'object' && skill.tools[0].name) {
          // tools 是对象数组，包含 name 和 description
          // 工具名已经是 skillIdShort_toolName 格式（6字符前缀），直接使用
          toolsDescription = skill.tools.map(t => {
            return `  - \`${t.name}\`: ${t.description || '无描述'}`;
          }).join('\n');
        } else {
          // tools 是字符串数组（兼容旧格式）
          toolsDescription = skill.tools.map(t => {
            return `  - \`${t}\``;
          }).join('\n');
        }
      }

      return `- **${skill.name}**: ${skill.description || '暂无描述'}
${toolsDescription}`;
    }).join('\n\n');

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
   * 用可用助理列表增强系统提示
   * 帮助 LLM 知道有哪些助理可以召唤
   * @param {string} systemPrompt - 系统提示
   * @param {Array} assistants - 可用助理列表
   */
  enhanceWithAssistants(systemPrompt, assistants) {
    if (!assistants || assistants.length === 0) {
      return systemPrompt;
    }

    // 只保留已启用的助理
    const activeAssistants = assistants.filter(a => a.is_active);
    if (activeAssistants.length === 0) {
      return systemPrompt;
    }

    logger.info(`[ContextManager] enhanceWithAssistants: 注入 ${activeAssistants.length} 个助理到 System Prompt`);

    // 构建助理描述文本
    const assistantsDescription = activeAssistants.map(a => {
      const executionMode = a.execution_mode || 'llm';
      const modelInfo = a.model_id ? `\n  - 模型: ${a.model_id}` : '';
      return `- **${a.name}** (${a.assistant_type}): ${a.description || '暂无描述'}\n  - 执行模式: ${executionMode}${modelInfo}`;
    }).join('\n\n');

    const assistantsPrompt = `
## 可用助理
你可以通过 \`assistant_summon\` 工具召唤以下助理来帮助你完成任务：

${assistantsDescription}

**使用方式**：
当需要调用助理时，使用 \`assistant_summon(type="助理类型", task="任务描述", input={...})\` 格式调用。
`;

    logger.info('[ContextManager] enhanceWithAssistants: System Prompt 已增强');
    return systemPrompt + '\n\n' + assistantsPrompt;
  }

  /**
   * 用任务工作空间上下文增强系统提示
   * 帮助 LLM 理解当前在任务工作空间模式下，可以访问相关文件
   * @param {string} systemPrompt - 系统提示
   * @param {object} taskContext - 任务上下文对象
   */
  enhanceWithTaskContext(systemPrompt, taskContext) {
    if (!taskContext) return systemPrompt;

    logger.info('[ContextManager] enhanceWithTaskContext: 注入任务工作空间上下文');

    // 构建文件列表描述
    let filesDescription = '暂无文件';
    if (taskContext.inputFiles && taskContext.inputFiles.length > 0) {
      const fileList = taskContext.inputFiles.map(file => {
        const sizeKB = file.isDirectory ? '-' : `${(file.size / 1024).toFixed(1)} KB`;
        const pathInfo = file.path ? ` (路径: ${file.path})` : '';
        return file.isDirectory ? `📁 ${file.name}/${pathInfo}` : `📄 ${file.name} (${sizeKB})${pathInfo}`;
      }).join('\n');
      filesDescription = fileList;
    }

    // 获取路径信息
    const userId = taskContext.userId || 'unknown';
    const taskId = taskContext.id;
    const relativePath = taskContext.workspacePath || `${userId}/${taskId}`;
    // 注意：路径不含 data/ 前缀，因为 AI 的工作目录已经是 data/
    const fullPath = taskContext.fullWorkspacePath || `work/${relativePath}`;
    const systemRoot = taskContext.systemRoot || 'work';

    // 当前浏览路径描述
    const currentPathDisplay = taskContext.currentPath
      ? `${fullPath}/${taskContext.currentPath}`
      : `${fullPath}/input`;

    const taskPrompt = `
## 当前任务工作空间

你正在**任务工作空间模式**中。以下是当前任务的详细信息：

### 任务信息
- **任务ID**: ${taskContext.id}
- **任务标题**: ${taskContext.title}
${taskContext.description ? `- **任务描述**: ${taskContext.description}` : ''}

### 目录结构
\`\`\`
${systemRoot}/                           ← 系统根目录
└── ${userId}/                           ← 用户空间
    └── ${taskId}/                       ← 当前任务根目录 ⭐
        ├── input/                       ← 输入文件（用户上传）
        ├── output/                      ← 输出文件（写入结果到这里）
        ├── temp/                        ← 临时文件
        └── logs/                        ← 日志
\`\`\`

### 路径信息
- **完整路径**: ${fullPath}
- **当前浏览**: ${currentPathDisplay}

### 路径使用规则
- 路径是相对于系统 data/ 目录的，不需要再加 data/ 前缀
- 读取用户文件: \`${fullPath}/input/{filename}\`
- 写入结果文件: \`${fullPath}/output/{filename}\`
- 临时文件: \`${fullPath}/temp/{filename}\`
- 不确定路径时，先用 ls 命令探测确认
- ⚠️ 注意：路径已经是相对于 data/ 的，不要再加 data/ 前缀！

### 当前目录下的文件
${filesDescription}
`;

    return systemPrompt + '\n\n' + taskPrompt;
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
   *
   * 空字段处理逻辑：
   * - `null`、`undefined`、空字符串均视为空
   * - 空字段对应的章节标题也会被省略，不会输出空白内容
   * - 如果所有字段都为空，直接返回原 systemPrompt
   *
   * @param {string} systemPrompt - 基础系统提示
   * @param {object} soul - Soul 配置（字段为纯字符串）
   * @param {object} expert - 专家配置（可选，用于 speaking_style）
   * @returns {string} 增强后的系统提示
   */
  enhanceWithSoul(systemPrompt, soul, expert = null) {
    if (!soul) return systemPrompt;

    const sections = [];

    // 核心价值观（纯字符串）
    if (soul.coreValues?.trim()) {
      sections.push(`## 你的核心价值观\n${soul.coreValues.trim()}`);
    }

    // 行为准则（纯字符串）
    if (soul.behavioralGuidelines?.trim()) {
      sections.push(`## 你的行为准则\n${soul.behavioralGuidelines.trim()}`);
    }

    // 禁忌（纯字符串）
    if (soul.taboos?.trim()) {
      sections.push(`## 你的禁忌（绝对不能做的事）\n${soul.taboos.trim()}`);
    }

    // 情感基调
    if (soul.emotionalTone?.trim()) {
      sections.push(`## 你的情感基调\n${soul.emotionalTone.trim()}`);
    }

    // 说话风格
    const speakingStyle = expert?.speaking_style || soul.speakingStyle;
    if (speakingStyle?.trim()) {
      sections.push(`## 你的说话风格\n${speakingStyle.trim()}`);
    }

    // 如果没有有效内容，直接返回原提示
    if (sections.length === 0) return systemPrompt;

    const soulPrompt = '\n\n' + sections.join('\n\n');
    return systemPrompt + soulPrompt;
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

    if (!userProfile.name) missing.push('name');
    if (!userProfile.background) missing.push('background');

    return missing;
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
        
        // 使用消息主键 ID 作为 tool_call_id（用于 OpenAI API 格式）
        const toolCallId = msg.id;
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
