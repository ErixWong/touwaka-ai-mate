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
      maxTokens = 128000,
      taskContext = null
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
        logger.debug(`[MinimalContextOrganizer] 开始反思，历史消息: ${recentMessages.length} 条`);
        
        const reflection = await this._reflectionService.reflect(
          psyche.toJSON(),
          recentMessages,
          { userId, expertId }
        );
        
        logger.debug(`[MinimalContextOrganizer] 反思完成:`, JSON.stringify(reflection, null, 2).substring(0, 500));
        
        psyche = this._psycheManager.updateFromReflection(psyche, reflection);
        
        logger.info(`[MinimalContextOrganizer] Psyche 已更新: 轮次=${psyche.session_meta.conversation_round}, 主题=${psyche.session_meta.current_topic || '无'}`);
      } catch (error) {
        logger.error('[MinimalContextOrganizer] 反思失败:', error.message);
        logger.error('[MinimalContextOrganizer] 错误堆栈:', error.stack);
        // 继续，使用现有 Psyche
      }
    } else {
      logger.debug('[MinimalContextOrganizer] 无历史消息，跳过反思');
    }

    // 4. 压缩 Psyche（如需要）
    const maxPsycheTokens = Math.floor(maxTokens * this.config.maxTokensRatio);
    psyche = await this._psycheManager.compress(psyche, maxPsycheTokens, userId, expertId);

    // 5. 保存更新后的 Psyche
    await this._psycheManager.save(userId, expertId, psyche);

    // 6. 构建 System Prompt（注入 Psyche 文本 + 任务上下文）
    const psycheText = this._psycheManager.formatForPrompt(psyche);
    const systemPrompt = this._buildSystemPrompt(baseSystemPrompt, psycheText, taskContext);

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
      // 注意：getRecentMessages 返回的是 { role, content } 格式的消息
      const messages = await memorySystem.getRecentMessages(userId, this.config.lookbackRounds * 2);
      
      // 过滤掉 tool 角色的消息，只保留 user 和 assistant 的对话
      const dialogMessages = (messages || []).filter(msg =>
        msg.role === 'user' || msg.role === 'assistant'
      );
      
      // 只保留最近的 lookbackRounds 轮对话（每轮包含 user + assistant）
      const recentDialogs = dialogMessages.slice(-this.config.lookbackRounds * 2);
      
      logger.debug(`[MinimalContextOrganizer] 获取历史消息: ${recentDialogs.length} 条 (原始: ${messages?.length || 0} 条)`);
      
      return recentDialogs;
    } catch (error) {
      logger.error('[MinimalContextOrganizer] 获取历史消息失败:', error.message);
      return [];
    }
  }

  /**
   * 构建 System Prompt
   * 将 Psyche 文本注入到 System Prompt 中
   */
  _buildSystemPrompt(basePrompt, psycheText, taskContext = null) {
    const parts = [];
    
    if (basePrompt) {
      parts.push(basePrompt);
    }
    
    if (psycheText) {
      parts.push('\n\n' + psycheText);
    }

    // 添加任务上下文（如果有）
    if (taskContext) {
      const taskContextSection = this._buildTaskContextSection(taskContext);
      if (taskContextSection) {
        parts.push('\n\n' + taskContextSection);
      }
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
   * 构建任务上下文段落
   * @param {object} taskContext - 任务上下文
   * @returns {string|null} 任务上下文段落
   */
  _buildTaskContextSection(taskContext) {
    if (!taskContext) return null;

    const fullPath = taskContext.fullWorkspacePath || '';
    
    // 判断模式
    const isTaskMode = taskContext.id && taskContext.title;
    const isSkillMode = fullPath.startsWith('skills/');
    const isChatMode = fullPath.startsWith('work/') && !isTaskMode;

    if (isSkillMode) {
      return this._buildSkillContextSection(taskContext);
    } else if (isChatMode) {
      return this._buildChatContextSection(taskContext);
    } else if (isTaskMode) {
      return this._buildTaskWorkspaceSection(taskContext);
    }

    return null;
  }

  /**
   * 构建任务工作空间段落
   */
  _buildTaskWorkspaceSection(taskContext) {
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
    const fullPath = taskContext.fullWorkspacePath || '';

    const currentPathDisplay = taskContext.currentPath
      ? `${fullPath}/${taskContext.currentPath}`
      : fullPath;

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

### 路径权限范围
- **可访问目录**: \`data/work/${userId}/\` 及其所有子目录
- **当前任务目录**: \`${fullPath}/\`
- **路径格式**: 相对于 data/ 目录，例如 \`${fullPath}/input/file.xlsx\`

### 当前目录下的文件
${filesDescription}`;
  }

  /**
   * 构建技能目录段落
   */
  _buildSkillContextSection(taskContext) {
    const fullPath = taskContext.fullWorkspacePath || 'skills/unknown';
    const skillName = fullPath.replace(/^skills\//, '');
    const userId = taskContext.userId || 'unknown';

    return `## 当前技能工作目录

你正在**技能模式**中，当前工作目录是技能的源码目录。

### 技能信息
- **技能名称**: ${skillName}
- **工作目录**: ${fullPath}

### 目录说明
当前目录是技能目录，各个技能的目录结构和内容不尽相同。但 \`SKILL.md\` 文件肯定存在，包含技能的详细说明。

### 路径使用规则
- 路径是相对于系统 data/ 目录的，不需要再加 data/ 前缀
- 当前工作目录: \`${fullPath}/\`
- 使用 \`cat SKILL.md\` 或 \`read_file\` 查看技能说明
- ⚠️ 技能目录是只读的，不应该写入文件`;
  }

  /**
   * 构建对话模式段落
   */
  _buildChatContextSection(taskContext) {
    const fullPath = taskContext.fullWorkspacePath || 'work/unknown/temp';
    const userId = taskContext.userId || 'unknown';

    return `## 当前工作目录

你正在**对话模式**中，当前工作目录是用户的临时文件夹：\`${fullPath}/\`

### 路径使用规则
- 路径是相对于系统 data/ 目录的，不需要再加 data/ 前缀
- 可以读取临时文件夹中的现有文件
- ⚠️ **禁止创建文件**：对话模式不支持文件创建操作

### 文件操作限制
如果用户需要创建或写入文件，请提醒用户：
1. 创建一个任务（Task），系统会自动分配专门的工作目录
2. 在任务目录中，可以根据需要组织合适的目录结构
3. 用户上传文件时，一般会创建 \`input\` 目录存放

请友好地引导用户创建任务来处理需要文件操作的需求。`;
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
