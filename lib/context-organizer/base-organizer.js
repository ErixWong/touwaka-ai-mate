/**
 * Base Context Organizer - 基础上下文组织器
 * 提供通用的上下文构建功能，供具体策略继承
 */

import logger from '../logger.js';
import { IContextOrganizer, ContextResult } from './interface.js';

/**
 * 处理单个消息的多模态格式
 * 将数据库存储的消息格式转换为 OpenAI API 所需的多模态格式
 * @param {Object} msg - 消息对象
 * @returns {Object} 处理后的消息对象
 */
export function processSingleMultimodalMessage(msg) {
  // 如果 content 已经是数组格式（多模态），需要过滤无效的图片
  if (Array.isArray(msg.content)) {
    // 过滤掉无效的图片 URL（如占位符 [图片]）
    const validContent = msg.content.filter(item => {
      if (item.type === 'image_url' && item.image_url?.url) {
        const url = item.image_url.url;
        // 跳过无效的 URL（占位符或非 http/https 开头）
        if (url === '[图片]' || !url.startsWith('http')) {
          return false;
        }
      }
      return true;
    });
    return { ...msg, content: validContent };
  }

  // 如果 content 是字符串，检查是否包含图片标记
  if (typeof msg.content === 'string') {
    // 检查是否是 JSON 格式的多模态内容
    try {
      const parsed = JSON.parse(msg.content);
      if (Array.isArray(parsed)) {
        // 已经是多模态数组格式，需要过滤无效图片
        const validContent = parsed.filter(item => {
          if (item.type === 'image_url' && item.image_url?.url) {
            const url = item.image_url.url;
            if (url === '[图片]' || !url.startsWith('http')) {
              return false;
            }
          }
          return true;
        });
        return { ...msg, content: validContent };
      }
      if (parsed.type === 'multimodal' && Array.isArray(parsed.content)) {
        // { type: 'multimodal', content: [...] } 格式，需要过滤无效图片
        const validContent = parsed.content.filter(item => {
          if (item.type === 'image_url' && item.image_url?.url) {
            const url = item.image_url.url;
            if (url === '[图片]' || !url.startsWith('http')) {
              return false;
            }
          }
          return true;
        });
        return { ...msg, content: validContent };
      }
    } catch (e) {
      // 不是 JSON，作为普通文本处理
    }

    // 检查是否包含 markdown 图片标记 ![alt](url)
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const images = [];
    let match;
    let textContent = msg.content;

    while ((match = imageRegex.exec(msg.content)) !== null) {
      const url = match[2];
      // 跳过无效的 URL
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        images.push({
          type: 'image_url',
          image_url: { url }
        });
      }
      // 移除图片标记，保留文本
      textContent = textContent.replace(match[0], '').trim();
    }

    // 如果有图片，返回多模态格式
    if (images.length > 0) {
      const content = [];
      if (textContent) {
        content.push({ type: 'text', text: textContent });
      }
      content.push(...images);
      return { ...msg, content };
    }
  }

  return msg;
}

/**
 * 基础上下文组织器
 * 提供通用的上下文构建功能
 */
export class BaseContextOrganizer extends IContextOrganizer {
  /**
   * @param {object} expertConfig - 专家配置
   * @param {object} options - 可选配置
   */
  constructor(expertConfig, options = {}) {
    super();
    this.expertConfig = expertConfig;
    this.options = options;

    // 从专家配置中提取 Soul
    this.soul = this.extractSoul(expertConfig);
  }

  /**
   * 从专家配置中提取 Soul
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
   * 用当前时间戳增强系统提示
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
   * 用 Soul 增强系统提示
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
   * 用可用技能信息增强系统提示
   */
  enhanceWithSkills(systemPrompt, skills) {
    if (!skills || skills.length === 0) {
      return systemPrompt;
    }

    // 构建技能描述文本
    const skillsDescription = skills.map(skill => {
      // 构建工具列表描述
      let toolsDescription = '无特定工具';
      if (skill.tools && skill.tools.length > 0) {
        if (typeof skill.tools[0] === 'object' && skill.tools[0].name) {
          // tools 是对象数组，包含 name 和 description
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

    return systemPrompt + '\n\n' + skillsPrompt;
  }

  /**
   * 用任务工作空间上下文增强系统提示
   */
  enhanceWithTaskContext(systemPrompt, taskContext) {
    if (!taskContext) return systemPrompt;

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
   * 用 Topic 总结增强系统提示
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
   */
  async buildUserProfileContext(userProfile) {
    if (!userProfile) return null;

    return {
      id: userProfile.user_id,
      preferredName: userProfile.preferred_name,
      nickname: userProfile.nickname,
      email: userProfile.email,
      gender: userProfile.gender,
      birthday: userProfile.birthday,
      occupation: userProfile.occupation,
      location: userProfile.location,
      introduction: userProfile.introduction,
      background: userProfile.background,
      notes: userProfile.notes,
      firstMet: userProfile.first_met,
      lastActive: userProfile.last_active,
    };
  }

  /**
   * 检查用户缺失的基本信息
   */
  checkMissingUserInfo(userProfile) {
    const missing = [];

    if (!userProfile?.preferredName) {
      missing.push('称呼');
    }
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
   */
  generateUserInfoGuidance(userProfile, conversationCount = 0) {
    const missing = this.checkMissingUserInfo(userProfile);

    if (missing.length === 0) {
      return null;
    }

    // 控制引导频率：每 3 轮对话最多引导一次
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
   * 构建 LLM 消息数组
   * @param {string} systemPrompt - 系统提示
   * @param {Array} messages - 历史消息
   * @param {string} currentMessage - 当前消息
   * @param {object} options - 可选配置
   * @param {number} options.maxToolContentLength - 工具消息内容的最大长度（默认 5000）
   */
  buildMessages(systemPrompt, messages, currentMessage, options = {}) {
    const { maxToolContentLength = 5000 } = options;
    const result = [];

    // 系统提示
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    // 历史消息
    for (const msg of messages) {
      // 处理 tool 角色消息
      if (msg.role === 'tool') {
        let toolMetaData = null;
        try {
          toolMetaData = typeof msg.tool_calls === 'string'
            ? JSON.parse(msg.tool_calls)
            : msg.tool_calls;
        } catch (e) {
          toolMetaData = null;
        }

        // 智能截断工具消息内容
        const truncatedContent = this.truncateToolContent(msg.content, maxToolContentLength);

        result.push({
          role: 'tool',
          tool_call_id: toolMetaData?.tool_call_id || '',
          name: toolMetaData?.name || 'unknown_tool',
          content: truncatedContent,
        });
      } else {
        // 处理普通消息
        const processedMsg = processSingleMultimodalMessage({
          role: msg.role,
          content: msg.content,
        });
        result.push(processedMsg);
      }
    }

    // 当前消息
    // 注意：如果历史消息的最后一条已经是当前用户消息（因为消息已保存到数据库），
    // 则不再重复添加，避免消息重复
    if (currentMessage) {
      const lastMsg = result[result.length - 1];
      const isAlreadyIncluded = lastMsg?.role === 'user' &&
        (lastMsg?.content === currentMessage ||
         JSON.stringify(lastMsg?.content) === JSON.stringify(currentMessage));
      
      if (!isAlreadyIncluded) {
        const currentMsg = processSingleMultimodalMessage({ role: 'user', content: currentMessage });
        result.push(currentMsg);
      } else {
        logger.debug('[BaseContextOrganizer] 当前消息已存在于历史消息中，跳过重复添加');
      }
    }

    return result;
  }

  /**
   * 智能截断工具消息内容
   * 在上下文构建时根据配置截断，不影响数据库中的完整存储
   *
   * @param {string} content - 原始内容
   * @param {number} maxLength - 最大长度
   * @returns {string} 截断后的内容
   */
  truncateToolContent(content, maxLength = 5000) {
    if (!content) return '';
    
    // 如果内容在限制内，直接返回
    if (content.length <= maxLength) {
      return content;
    }

    // 尝试智能截断：
    // 1. 如果是 JSON 格式，尝试提取关键信息
    try {
      const parsed = JSON.parse(content);
      
      // 如果是对象，尝试提取摘要信息
      if (typeof parsed === 'object' && parsed !== null) {
        // 常见的数据结构处理
        if (Array.isArray(parsed)) {
          // 数组：保留前面的元素，指示总数
          const summary = {
            _truncated: true,
            totalItems: parsed.length,
            preview: parsed.slice(0, Math.min(5, Math.floor(maxLength / 200))),
            _hint: `已截断，共 ${parsed.length} 项`
          };
          const summaryStr = JSON.stringify(summary, null, 2);
          if (summaryStr.length <= maxLength) {
            return summaryStr;
          }
        } else if (parsed.success !== undefined) {
          // 工具返回格式 { success, data, error }
          const summary = {
            success: parsed.success,
            error: parsed.error,
            _truncated: true,
            _hint: `结果已截断，原始 ${content.length} 字符`
          };
          
          // 尝试保留部分 data
          if (parsed.data) {
            const remainingLength = maxLength - JSON.stringify(summary).length - 50;
            if (remainingLength > 100) {
              let dataPreview;
              if (typeof parsed.data === 'string') {
                dataPreview = parsed.data.substring(0, remainingLength);
              } else if (Array.isArray(parsed.data)) {
                dataPreview = {
                  _items: parsed.data.length,
                  preview: parsed.data.slice(0, 3)
                };
              } else {
                const dataStr = JSON.stringify(parsed.data);
                dataPreview = dataStr.substring(0, remainingLength);
              }
              summary.data = dataPreview;
            }
          }
          
          return JSON.stringify(summary, null, 2);
        }
      }
    } catch (e) {
      // 不是 JSON，继续使用简单截断
    }

    // 简单截断：保留前面部分 + 截断提示
    return content.substring(0, maxLength - 100) +
      `\n\n... [上下文构建时截断，原始 ${content.length} 字符]`;
  }

  /**
   * 构建基础系统提示
   */
  buildBaseSystemPrompt(innerVoices = [], topicSummaries = null, userInfoGuidance = null, skills = [], taskContext = null, ragContext = null) {
    const expert = this.expertConfig.expert || this.expertConfig;

    // 基础 System Prompt
    let systemPrompt = expert.prompt_template || expert.system_prompt || expert.introduction || '';

    // 添加当前时间信息
    systemPrompt = this.enhanceWithTimestamp(systemPrompt);

    // 添加 Soul
    systemPrompt = this.enhanceWithSoul(systemPrompt, this.soul, expert);

    // 添加可用技能描述
    if (skills && skills.length > 0) {
      systemPrompt = this.enhanceWithSkills(systemPrompt, skills);
    }

    // 添加任务工作空间上下文
    if (taskContext) {
      systemPrompt = this.enhanceWithTaskContext(systemPrompt, taskContext);
    }

    // 添加 Topic 总结
    if (topicSummaries) {
      systemPrompt = this.enhanceWithTopicSummaries(systemPrompt, topicSummaries);
    }

    // 添加 RAG 检索上下文
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
}
