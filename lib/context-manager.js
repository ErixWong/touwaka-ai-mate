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
      return `${toolName} → ${contentLength} 字符 | recall({ message_id: "${toolCallId}" })`;
    }

    // Full 策略：详细摘要
    return `工具: ${toolName}
结果: ${contentLength} 字符
→ 调用 recall({ message_id: "${toolCallId}" }) 获取完整结果`;
  }

  /**
   * 统一的段落拼接方法
   * 将新段落追加到系统提示中，处理换行符
   * @param {string} basePrompt - 基础系统提示
   * @param {string|null} section - 要追加的段落（如果为 null 或空，返回原提示）
   * @returns {string} 拼接后的系统提示
   */
  appendSection(basePrompt, section) {
    if (!section) return basePrompt;
    return basePrompt + '\n\n' + section;
  }

  /**
   * 构建包含 Topic 总结的系统提示（新设计）
   *
   * 重构说明：
   * - 每个 generateSection* 方法只负责生成内容，不负责拼接
   * - 使用 appendSection() 统一处理拼接逻辑
   * - 职责分离，便于测试和维护
   *
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

    // 逐段添加内容，每段独立生成
    systemPrompt = this.appendSection(systemPrompt, this.generateTimestampSection());
    systemPrompt = this.appendSection(systemPrompt, this.generateSoulSection(this.soul, expert));
    
    if (skills && skills.length > 0) {
      systemPrompt = this.appendSection(systemPrompt, this.generateSkillsSection(skills));
    }
    
    if (assistants && assistants.length > 0) {
      systemPrompt = this.appendSection(systemPrompt, this.generateAssistantsSection(assistants));
    }
    
    if (taskContext) {
      systemPrompt = this.appendSection(systemPrompt, this.generateTaskContextSection(taskContext));
    }
    
    if (topicSummaries) {
      systemPrompt = this.appendSection(systemPrompt, this.generateTopicSummariesSection(topicSummaries));
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

  // ========================================
  // 新一代 Section 生成方法（只生成内容，不拼接）
  // ========================================

  /**
   * 生成时间戳段落
   * @returns {string} 时间戳段落内容
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
   * @param {object} soul - Soul 配置
   * @param {object} expert - 专家配置（可选）
   * @returns {string|null} Soul 段落内容，如果所有字段为空则返回 null
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

    // Issue #417: 过滤掉 mark 为空字符串的技能（质量控制）
    // 只有正确设置了 mark 的技能才会显示给 LLM
    const validSkills = skills.filter(skill => {
      const hasValidMark = skill.mark && skill.mark.trim() !== '';
      if (!hasValidMark) {
        logger.warn(`[ContextManager] 技能 ${skill.id} (${skill.name}) 的 mark 为空，不列入上下文`);
      }
      return hasValidMark;
    });

    if (validSkills.length === 0) {
      logger.warn(`[ContextManager] 所有 ${skills.length} 个技能的 mark 都为空，不注入技能段落`);
      return null;
    }

    logger.info(`[ContextManager] generateSkillsSection: 注入 ${validSkills.length} 个技能到 System Prompt (过滤了 ${skills.length - validSkills.length} 个)`);
    validSkills.forEach(s => logger.info(`[ContextManager] - ${s.id}: ${s.name} (mark: ${s.mark})`));

    // 生成技能映射表（技能标识 → 使用场景）
    const skillsTable = validSkills.map(skill => {
      const mark = skill.mark || skill.id;
      const useCase = this.getSkillUseCase(mark) || skill.description || '暂无描述';
      return `| \`${mark}\` | ${skill.name} | ${useCase} |`;
    }).join('\n');

    // 检查是否有 file-operations 技能（使用过滤后的 validSkills）
    const hasFileOperations = validSkills.some(s => s.mark === 'file-operations' || s.name === 'file-operations');
    const fileOperationsGuidance = hasFileOperations ? `

### ⚠️ 文件操作重要提示

**在读取文件之前，必须先了解文件信息！**

直接读取图片、压缩包、二进制文件对 LLM 是无意义的（会被截断）。正确做法：

1. **先调用 \`file-operations__fs_info\`** 获取文件信息：
   - \`size\` / \`sizeHuman\`: 文件大小
   - \`mimeType\`: 文件类型（image/png, application/zip 等）
   - \`isTextFile\`: 是否为文本文件

2. **根据文件信息选择处理方式**：
   - **图片文件** → 使用 \`file-operations__read_file(mode="data_url")\` 传给多模态模型
   - **压缩包** → 委托助理处理，或使用解压工具
   - **二进制文件** → 委托助理处理，或使用专门工具
   - **大文本文件** → 使用 \`from\` / \`lines\` 参数分块读取
   - **普通文本文件** → 正常读取

**示例流程**：
\`\`\`
1. file-operations__fs_info(path="input/screenshot.png")  → 得知是图片，大小 500KB
2. file-operations__read_file(path="input/screenshot.png", mode="data_url")  → 转为 base64 供多模态模型处理
\`\`\`` : '';

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
   * 生成助理段落
   * @param {Array} assistants - 助理列表
   * @returns {string|null} 助理段落内容
   */
  generateAssistantsSection(assistants) {
    if (!assistants || assistants.length === 0) {
      return null;
    }

    const activeAssistants = assistants.filter(a => a.is_active);
    if (activeAssistants.length === 0) {
      return null;
    }

    logger.info(`[ContextManager] generateAssistantsSection: 注入 ${activeAssistants.length} 个助理到 System Prompt`);

    const assistantsDescription = activeAssistants.map(a => {
      const executionMode = a.execution_mode || 'llm';
      const modelInfo = a.model_id ? `\n  - 模型: ${a.model_id}` : '';
      return `- **${a.name}** (${a.id}): ${a.description || '暂无描述'}\n  - 执行模式: ${executionMode}${modelInfo}`;
    }).join('\n\n');

    return `## 可用助理
你可以通过 \`assistant_summon\` 工具召唤以下助理来帮助你完成任务：

${assistantsDescription}

### 何时召唤助理

**应该召唤助理的情况：**
- 任务需要专门的能力（如图片分析、文档处理、数据分析）
- 任务可以异步执行，不需要立即得到结果
- 任务需要特定的工具或专业知识
- 任务较为复杂，适合委托给专门的助理处理

**应该自己处理的情况：**
- 简单的对话和问答
- 需要你个人风格和判断的回复
- 用户明确要求你直接回答
- 需要即时交互的场景
- 可以通过现有工具立刻得到结果的任务

### 使用方式
当需要调用助理时，使用 \`assistant_summon(assistant_id="助理ID", task="任务描述", input={...})\` 格式调用。`;
  }

  /**
   * 生成任务上下文段落（根据模式分发）
   * @param {object} taskContext - 任务上下文
   * @returns {string|null} 任务上下文段落内容
   */
  generateTaskContextSection(taskContext) {
    if (!taskContext) return null;

    const fullPath = taskContext.fullWorkspacePath || '';
    
    const isTaskMode = taskContext.id && taskContext.title;
    const isSkillMode = fullPath.startsWith('skills/');
    const isChatMode = fullPath.startsWith('work/') && !isTaskMode;

    logger.info(`[ContextManager] generateTaskContextSection: 模式=${isTaskMode ? '任务' : isSkillMode ? '技能' : '对话'}, 路径=${fullPath}`);

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
   * @param {object} taskContext - 任务上下文
   * @returns {string} 任务工作空间段落内容
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

    // 生成路径权限范围说明
    const permissionSection = this.generatePathPermissionSection(userId, fullPath, 'task');

    return `## 当前任务工作空间

你正在**任务工作空间模式**中。以下是当前任务的详细信息：

### 任务信息
- **任务ID**: ${taskContext.id}
- **任务标题**: ${taskContext.title}
${taskContext.description ? `- **任务描述**: ${taskContext.description}` : ''}

### 目录说明
当前目录是一个任务目录，可以根据用户的需要组织合适的目录结构。

- **工作目录**: ${fullPath}
- **当前浏览**: ${currentPathDisplay}

${permissionSection}
### 当前目录下的文件
${filesDescription}`;
  }

  /**
   * 生成技能目录段落（技能模式）
   * @param {object} taskContext - 任务上下文
   * @returns {string} 技能目录段落内容
   */
  generateSkillContextSection(taskContext) {
    const fullPath = taskContext.fullWorkspacePath || 'skills/unknown';
    const skillName = fullPath.replace(/^skills\//, '');
    const userId = taskContext.userId || 'unknown';

    // 生成路径权限范围说明
    const permissionSection = this.generatePathPermissionSection(userId, fullPath, 'skill');

    return `## 当前技能工作目录

你正在**技能模式**中，当前工作目录是技能的源码目录。

### 技能信息
- **技能名称**: ${skillName}
- **工作目录**: ${fullPath}

### 目录说明
当前目录是技能目录，各个技能的目录结构和内容不尽相同。但 \`SKILL.md\` 文件肯定存在，包含技能的详细说明。

${permissionSection}`;
  }

  /**
   * 生成对话模式段落
   * @param {object} taskContext - 任务上下文
   * @returns {string} 对话模式段落内容
   */
  generateChatContextSection(taskContext) {
    const fullPath = taskContext.fullWorkspacePath || 'work/unknown/temp';
    const userId = taskContext.userId || 'unknown';

    // 生成路径权限范围说明
    const permissionSection = this.generatePathPermissionSection(userId, fullPath, 'chat');

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
   * @param {string} mode - 模式类型 ('task' | 'skill' | 'chat')
   * @returns {string} 路径权限说明段落
   */
  generatePathPermissionSection(userId, currentPath, mode) {
    if (mode === 'skill') {
      // 技能模式：只读访问
      return `### 路径使用规则
- 路径是相对于系统 data/ 目录的，不需要再加 data/ 前缀
- 当前工作目录: \`${currentPath}/\`
- 使用 \`cat SKILL.md\` 或 \`read_file\` 查看技能说明
- ⚠️ 技能目录是只读的，不应该写入文件`;
    } else if (mode === 'chat') {
      // 对话模式：只读访问
      return `### 路径使用规则
- 路径是相对于系统 data/ 目录的，不需要再加 data/ 前缀
- 可以读取临时文件夹中的现有文件
- ⚠️ **禁止创建文件**：对话模式不支持文件创建操作`;
    } else {
      // 任务模式：读写访问
      return `### 路径使用规则
- 路径是相对于系统 data/ 目录的，不需要再加 data/ 前缀
- 用户上传文件时，一般会创建 \`input\` 目录存放
- 可以根据任务需要创建合适的子目录
- 不确定目录结构时，先用 \`ls\` 命令探测

### ⚠️ 路径权限范围
- **可访问目录**: \`data/work/${userId}/\` 及其所有子目录
- **当前任务目录**: \`${currentPath}/\`
- **路径格式**: 相对于 data/ 目录，例如 \`${currentPath}/input/file.xlsx\``;
    }
  }

  /**
   * 生成 Topic 总结段落
   * @param {string} topicSummaries - Topic 总结文本
   * @returns {string|null} Topic 总结段落内容
   */
  generateTopicSummariesSection(topicSummaries) {
    if (!topicSummaries) return null;

    return `## 之前的对话话题总结
以下是你们之前讨论过的话题，帮助你了解对话历史：

${topicSummaries}`;
  }

  /**
   * 生成 RAG 上下文段落
   * @param {string} ragContext - RAG 检索上下文
   * @returns {string|null} RAG 上下文段落内容
   */
  generateRAGContextSection(ragContext) {
    if (!ragContext) return null;

    return `## 相关知识库内容
以下是从知识库中检索到的相关内容，请参考这些信息回答用户问题：

${ragContext}`;
  }

  /**
   * 生成 Inner Voices 段落
   * @param {Array} innerVoices - 内心独白列表
   * @returns {string|null} Inner Voices 段落内容
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
   * @param {string} guidance - 引导提示
   * @returns {string|null} 用户信息引导段落内容
   */
  generateUserInfoGuidanceSection(guidance) {
    if (!guidance) return null;

    return `## 对话提示
${guidance}`;
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
        // 从 tool_calls 字段解析元数据（数据库原始字段名）
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
