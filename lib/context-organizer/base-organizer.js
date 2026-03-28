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
   * 统一的段落拼接方法
   */
  appendSection(basePrompt, section) {
    if (!section) return basePrompt;
    return basePrompt + '\n\n' + section;
  }

  /**
   * 生成时间戳段落
   */
  generateTimestampSection() {
    const now = new Date();

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

    return `## 当前时间
现在是中国标准时间（CST, UTC+8）：
- **日期**：${dateString}
- **时间**：${timeString}

请根据当前时间来理解和回应用户的请求。`;
  }

  /**
   * 生成 Soul 段落
   */
  generateSoulSection(soul, expert = null) {
    if (!soul) return null;

    const sections = [];

    if (soul.coreValues?.trim()) {
      sections.push(`## 你的核心价值观\n${soul.coreValues.trim()}`);
    }

    if (soul.behavioralGuidelines?.trim()) {
      sections.push(`## 你的行为准则\n${soul.behavioralGuidelines.trim()}`);
    }

    if (soul.taboos?.trim()) {
      sections.push(`## 你的禁忌（绝对不能做的事）\n${soul.taboos.trim()}`);
    }

    if (soul.emotionalTone?.trim()) {
      sections.push(`## 你的情感基调\n${soul.emotionalTone.trim()}`);
    }

    const speakingStyle = expert?.speaking_style || soul.speakingStyle;
    if (speakingStyle?.trim()) {
      sections.push(`## 你的说话风格\n${speakingStyle.trim()}`);
    }

    if (sections.length === 0) return null;

    return sections.join('\n\n');
  }

  /**
   * 生成技能段落
   *
   * 设计原则（基于 OpenAI Function Calling 最佳实践）：
   * - tools 参数已包含工具名称、描述、参数定义，无需在 System Prompt 中重复
   * - System Prompt 只需提供：命名空间解释、技能场景映射、使用指导
   * - 让 LLM 能够根据 skill_mark 在 tools 数组中找到对应工具
   *
   * @param {Array} skills - 技能列表
   * @returns {string|null} 技能段落内容
   */
  generateSkillsSection(skills) {
    if (!skills || skills.length === 0) {
      return null;
    }

    // 生成技能映射表（技能标识 → 使用场景）
    const skillsTable = skills.map(skill => {
      const mark = skill.mark || skill.id;
      const useCase = this.getSkillUseCase(mark) || skill.description || '暂无描述';
      return `| \`${mark}\` | ${skill.name} | ${useCase} |`;
    }).join('\n');

    // 检查是否有 file-operations 技能
    const hasFileOperations = skills.some(s => s.mark === 'file-operations' || s.name === 'file-operations');
    const fileOperationsGuidance = hasFileOperations ? `

### ⚠️ 文件操作重要提示

**在读取文件之前，必须先了解文件信息！**

直接读取图片、压缩包、二进制文件对 LLM 是无意义的（会被截断）。正确做法：

1. **先调用 \`file-operations__fs_info\`** 获取文件信息
2. **根据文件信息选择处理方式**：
   - 图片文件 → 使用 \`file-operations__read_file(mode="data_url")\`
   - 压缩包/二进制文件 → 委托助理处理
   - 大文本文件 → 使用 \`from\` / \`lines\` 参数分块读取` : '';

    return `## 技能使用指南

### 工具命名规范

工具名称格式为 \`skill_mark__tool_name\`，其中：
- \`skill_mark\` 是技能的语义标识（如 \`kb-search\`）
- \`tool_name\` 是具体工具名称（如 \`search\`）
- \`__\` 是命名空间分隔符

### 可用技能

| 技能标识 | 技能名称 | 使用场景 |
|---------|---------|---------|
${skillsTable}
${fileOperationsGuidance}
### 使用建议

1. **识别场景** → 确定需要哪个技能（如：用户要搜索知识库 → \`kb-search\`）
2. **查找工具** → 在 tools 数组中找到以 \`skill_mark__\` 开头的工具
3. **选择工具** → 根据工具描述选择最合适的工具
4. **调用工具** → 按参数要求构造调用

**注意**：如果信息不足，先询问用户再调用工具。`;
  }

  /**
   * 根据技能 mark 获取使用场景描述
   * @param {string} mark - 技能标识
   * @returns {string|null} 使用场景描述
   */
  getSkillUseCase(mark) {
    const useCaseMap = {
      'kb-search': '查询知识库内容、搜索专业知识',
      'kb-editor': '编辑知识库内容、管理知识条目',
      'docx': '创建或编辑 Word 文档',
      'xlsx': '处理 Excel 电子表格',
      'pptx': '创建或编辑 PowerPoint 演示文稿',
      'pdf': '读取或转换 PDF 文件',
      'file-operations': '文件系统操作、文件信息查询',
      'compression': '压缩或解压文件',
      'searxng': '网络搜索',
      'hacknews': '获取 Hacker News 资讯',
      'remote-llm': '调用远程 LLM 服务',
      'echarts-chart': '生成 ECharts 图表',
      'wikijs': '与 Wiki.js 知识库交互',
      'erix-ssh': 'SSH 远程连接和命令执行',
      'user-code-executor': '执行用户自定义代码',
      'net-operations': '网络操作、HTTP 请求',
      'skill-manager': '技能管理、工具列表查询',
      'unifuncs-web-reader': '读取网页内容',
      'prompt-editor': '编辑和优化提示词',
    };
    return useCaseMap[mark] || null;
  }

  /**
   * 生成任务上下文段落（根据模式分发）
   */
  generateTaskContextSection(taskContext) {
    if (!taskContext) return null;

    const fullPath = taskContext.fullWorkspacePath || '';
    
    const isTaskMode = taskContext.id && taskContext.title;
    const isSkillMode = fullPath.startsWith('skills/');
    const isChatMode = fullPath.startsWith('work/') && !isTaskMode;

    if (isSkillMode) {
      return this.generateSkillContextSection(taskContext);
    } else if (isChatMode) {
      return this.generateChatContextSection(taskContext);
    } else {
      return this.generateTaskWorkspaceSection(taskContext);
    }
  }

  /**
   * 生成任务工作空间段落（任务模式）
   */
  generateTaskWorkspaceSection(taskContext) {
    let filesDescription = '暂无文件';
    if (taskContext.inputFiles && taskContext.inputFiles.length > 0) {
      const fileList = taskContext.inputFiles.map(file => {
        const sizeKB = file.isDirectory ? '-' : `${(file.size / 1024).toFixed(1)} KB`;
        const pathInfo = file.path ? ` (路径: ${file.path})` : '';
        return file.isDirectory ? `📁 ${file.name}/${pathInfo}` : `📄 ${file.name} (${sizeKB})${pathInfo}`;
      }).join('\n');
      filesDescription = fileList;
    }

    const userId = taskContext.userId || 'unknown';
    const taskId = taskContext.id;
    const relativePath = taskContext.workspacePath || `${userId}/${taskId}`;
    const fullPath = taskContext.fullWorkspacePath || `work/${relativePath}`;

    const currentPathDisplay = taskContext.currentPath
      ? `${fullPath}/${taskContext.currentPath}`
      : fullPath;

    // 构建 README 内容（如果存在）
    let readmeSection = '';
    if (taskContext.readme) {
      readmeSection = `
### README.md 内容
\`\`\`markdown
${taskContext.readme}
\`\`\`
`;
    }

    // 构建 TODO 内容（如果存在）
    let todoSection = '';
    if (taskContext.todo) {
      todoSection = `
### TODO.md 待办事项
\`\`\`markdown
${taskContext.todo}
\`\`\`
`;
    }

    // 生成路径权限范围说明
    const userRole = {
      isAdmin: taskContext.isAdmin || false,
      isSkillCreator: taskContext.isSkillCreator || false,
    };
    const permissionSection = this.generatePathPermissionSection(userId, fullPath, 'task', userRole);

    return `## 当前任务工作空间

你正在**任务工作空间模式**中。以下是当前任务的详细信息：

### 任务信息
- **任务ID**: ${taskContext.id}
- **任务标题**: ${taskContext.title}
${taskContext.description ? `- **任务描述**: ${taskContext.description}` : ''}
${readmeSection}${todoSection}
### 目录说明
当前目录是一个任务目录，可以根据用户的需要组织合适的目录结构。

- **工作目录**: \`${fullPath}/\`（相对于 data/ 目录）
- **当前浏览**: ${currentPathDisplay}

${permissionSection}
### 当前目录下的文件
${filesDescription}`;
  }

  /**
   * 生成技能目录段落（技能模式）
   */
  generateSkillContextSection(taskContext) {
    const fullPath = taskContext.fullWorkspacePath || 'skills/unknown';
    const skillName = fullPath.replace(/^skills\//, '');
    const userId = taskContext.userId || 'unknown';

    // 生成路径权限范围说明
    const userRole = {
      isAdmin: taskContext.isAdmin || false,
      isSkillCreator: taskContext.isSkillCreator || false,
    };
    const permissionSection = this.generatePathPermissionSection(userId, fullPath, 'skill', userRole);

    return `## 当前技能工作目录

你正在**技能模式**中，当前工作目录是技能的源码目录。

### 技能信息
- **技能名称**: ${skillName}
- **工作目录**: \`${fullPath}/\`（相对于 data/ 目录）

### 目录说明
当前目录是技能目录，各个技能的目录结构和内容不尽相同。但 \`SKILL.md\` 文件肯定存在，包含技能的详细说明。

${permissionSection}`;
  }

  /**
   * 生成对话模式段落
   */
  generateChatContextSection(taskContext) {
    const fullPath = taskContext.fullWorkspacePath || 'work/unknown/temp';
    const userId = taskContext.userId || 'unknown';

    // 生成路径权限范围说明
    const userRole = {
      isAdmin: taskContext.isAdmin || false,
      isSkillCreator: taskContext.isSkillCreator || false,
    };
    const permissionSection = this.generatePathPermissionSection(userId, fullPath, 'chat', userRole);

    return `## 当前工作目录

你正在**对话模式**中，当前工作目录是用户的临时文件夹：\`${fullPath}/\`

${permissionSection}

### 文件操作限制
如果用户需要创建或写入文件，请提醒用户：
1. 创建一个任务（Task），系统会自动分配专门的工作目录
2. 在任务目录中，可以根据需要组织合适的目录结构
3. 用户上传文件时，一般会创建 \`input\` 目录

请友好地引导用户创建任务来处理需要文件操作的需求。`;
  }

  /**
   * 生成路径权限范围说明段落
   * @param {string} userId - 用户ID
   * @param {string} currentPath - 当前工作路径
   * @param {string} mode - 模式（'task' | 'skill' | 'chat'）
   * @param {object} userRole - 用户角色 { isAdmin: boolean, isSkillCreator: boolean }
   */
  generatePathPermissionSection(userId, currentPath, mode, userRole = {}) {
    const { isAdmin, isSkillCreator } = userRole;
    
    // 根据用户角色确定可访问目录
    let accessibleDirs;
    if (isAdmin) {
      accessibleDirs = '整个 data/ 目录';
    } else if (isSkillCreator) {
      accessibleDirs = `data/skills/ 目录和 data/work/${userId}/ 目录`;
    } else {
      accessibleDirs = `data/work/${userId}/ 目录`;
    }
    
    if (mode === 'skill') {
      // 技能模式：技能创作者和管理员可以访问
      const permissionNote = isAdmin
        ? '（管理员权限：可访问整个 data 目录）'
        : isSkillCreator
          ? '（技能创作者权限：可访问 skills 目录和自己的工作区）'
          : '（普通用户权限：只能访问自己的工作区）';
      
      return `### 路径使用规则
- 路径是相对于系统 data/ 目录的，不需要再加 data/ 前缀
- 使用 \`cat SKILL.md\` 或 \`read_file\` 查看技能说明
- ⚠️ 技能目录是只读的，不应该写入文件

### ⚠️ 路径权限范围
- **可访问目录**: ${accessibleDirs}
- **权限说明**: ${permissionNote}`;
    } else if (mode === 'chat') {
      const permissionNote = isAdmin
        ? '（管理员权限：可访问整个 data 目录）'
        : isSkillCreator
          ? '（技能创作者权限：可访问 skills 目录和自己的工作区）'
          : '（普通用户权限：只能访问自己的工作区）';
      
      return `### 路径使用规则
- 路径是相对于系统 data/ 目录的，不需要再加 data/ 前缀
- 可以读取临时文件夹中的现有文件
- ⚠️ **禁止创建文件**：对话模式不支持文件创建操作

### ⚠️ 路径权限范围
- **可访问目录**: ${accessibleDirs}
- **当前工作目录**: \`${currentPath}/\`
- **权限说明**: ${permissionNote}`;
    } else {
      // 任务模式
      const permissionNote = isAdmin
        ? '（管理员权限：可访问整个 data 目录）'
        : isSkillCreator
          ? '（技能创作者权限：可访问 skills 目录和自己的工作区）'
          : '（普通用户权限：只能访问自己的工作区）';
      
      return `### 路径使用规则
- 路径是相对于系统 data/ 目录的，不需要再加 data/ 前缀
- 用户上传文件时，一般会创建 \`input\` 目录存放
- 可以根据任务需要创建合适的子目录
- 不确定目录结构时，先用 \`ls\` 命令探测

### ⚠️ 路径权限范围
- **可访问目录**: ${accessibleDirs}
- **路径格式**: 相对于 data/ 目录，例如 \`${currentPath}/input/file.xlsx\`
- **权限说明**: ${permissionNote}`;
    }
  }

  /**
   * 生成 Topic 总结段落
   * @param {string} topicSummaries - Topic 总结文本
   * @param {number} topicCount - 实际注入的 Topic 数量（可选）
   * @param {number} messageCount - 实际注入的消息数量（可选）
   */
  generateTopicSummariesSection(topicSummaries, topicCount = 10, messageCount = 15) {
    if (!topicSummaries) return null;

    return `## 之前的对话话题总结
以下是最新的 ${topicCount} 个话题摘要，以及最近 ${messageCount} 条对话消息。这只是部分历史，如果需要更多历史话题详情，可以使用 \`recall\` 工具通过 Topic ID 获取完整内容：

${topicSummaries}`;
  }

  /**
   * 生成 RAG 上下文段落
   */
  generateRAGContextSection(ragContext) {
    if (!ragContext) return null;

    return `## 相关知识库内容
以下是从知识库中检索到的相关内容，请参考这些信息回答用户问题：

${ragContext}`;
  }

  /**
   * 生成 Inner Voices 段落
   */
  generateInnerVoicesSection(innerVoices) {
    if (!innerVoices || innerVoices.length === 0) return null;

    const trend = this.analyzeTrend(innerVoices);

    let innerVoiceText = '';

    if (trend.trend === 'declining' && trend.latest?.nextRoundAdvice) {
      innerVoiceText += `【重要提醒】最近表现有下降趋势，请注意：${trend.latest.nextRoundAdvice}\n\n`;
    }

    const monologues = innerVoices
      .filter(iv => iv.monologue)
      .map(iv => iv.monologue)
      .join('\n');

    if (monologues) {
      innerVoiceText += `最近的内心独白：\n${monologues}`;
    }

    return `## 你的内心独白（前几轮的反思结果）
这是你对自己之前表现的反思：

${innerVoiceText}

请根据这些反思调整你这一轮的回复。`;
  }

  /**
   * 生成用户信息引导段落
   */
  generateUserInfoGuidanceSection(guidance) {
    if (!guidance) return null;

    return `## 对话提示
${guidance}`;
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
          // 从 tool_calls 字段解析元数据（数据库原始字段名）
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
          tool_call_id: msg.id,  // 使用消息主键 ID 作为 tool_call_id
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
   *
   * 重构说明：
   * - 每个 generateSection* 方法只负责生成内容，不负责拼接
   * - 使用 appendSection() 统一处理拼接逻辑
   * - 职责分离，便于测试和维护
   * 
   * @param {Array} innerVoices - Inner Voices 数组
   * @param {string|null} topicSummaries - Topic 总结文本
   * @param {string|null} userInfoGuidance - 用户信息引导
   * @param {Array} skills - 技能列表
   * @param {object|null} taskContext - 任务上下文
   * @param {string|null} ragContext - RAG 上下文
   * @param {object} options - 可选配置
   * @param {number} options.topicCount - Topic 数量（用于提示说明）
   * @param {number} options.messageCount - 消息数量（用于提示说明）
   */
  buildBaseSystemPrompt(innerVoices = [], topicSummaries = null, userInfoGuidance = null, skills = [], taskContext = null, ragContext = null, options = {}) {
    const { topicCount = 10, messageCount = 15 } = options;
    const expert = this.expertConfig.expert || this.expertConfig;

    // 基础 System Prompt
    let systemPrompt = expert.prompt_template || expert.system_prompt || expert.introduction || '';

    // 逐段添加内容，每段独立生成
    systemPrompt = this.appendSection(systemPrompt, this.generateTimestampSection());
    systemPrompt = this.appendSection(systemPrompt, this.generateSoulSection(this.soul, expert));
    
    if (skills && skills.length > 0) {
      systemPrompt = this.appendSection(systemPrompt, this.generateSkillsSection(skills));
    }
    
    if (taskContext) {
      systemPrompt = this.appendSection(systemPrompt, this.generateTaskContextSection(taskContext));
    }
    
    if (topicSummaries) {
      systemPrompt = this.appendSection(systemPrompt, this.generateTopicSummariesSection(topicSummaries, topicCount, messageCount));
    }
    
    if (ragContext) {
      systemPrompt = this.appendSection(systemPrompt, this.generateRAGContextSection(ragContext));
    }
    
    if (innerVoices.length > 0) {
      systemPrompt = this.appendSection(systemPrompt, this.generateInnerVoicesSection(innerVoices));
    }
    
    if (userInfoGuidance) {
      systemPrompt = this.appendSection(systemPrompt, this.generateUserInfoGuidanceSection(userInfoGuidance));
    }

    return systemPrompt;
  }
}
