/**
 * Tool Manager - 工具管理器
 * 负责管理技能、生成工具定义、执行工具调用
 *
 * 工作流程：
 * 1. 从数据库加载专家启用的技能
 * 2. 生成工具定义供 LLM 使用
 * 3. 处理 LLM 的工具调用请求
 * 4. 执行工具并返回结果
 *
 * 注：builtin 工具已迁移为普通技能（data/skills/），所有技能统一通过 skill-runner 执行
 */

import SkillLoader from './skill-loader.js';
import logger from './logger.js';
import { getAssistantManager } from '../server/services/assistant/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 内置工具定义
 * 这些工具不依赖技能目录，直接在代码中定义
 */
const BUILTIN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'execute_javascript',
      description: '在安全的 VM 沙箱中执行 JavaScript 代码。可以访问 console、Buffer、URL、setTimeout 等基础 API。注意：无法访问 require、process、module 等危险 API。',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '要执行的 JavaScript 代码。代码在异步上下文中执行，可以使用 await。',
          },
          script_path: {
            type: 'string',
            description: '（可选）脚本文件路径，相对于工作目录。如果提供，将从文件加载代码执行。',
          },
        },
        required: ['code'],
      },
    },
    _meta: {
      builtin: true,
      toolName: 'execute_javascript',
      // 权限控制：仅 admin 和 creator 可执行脚本
      allowedRoles: ['admin', 'creator'],
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall',
      description: '回忆话题或消息内容。可以：1) 列出最近话题；2) 根据关键词搜索话题；3) 获取指定话题的详细消息；4) 获取单条消息的完整内容（当上下文中显示摘要时）。当用户提到之前讨论过的话题或需要查看完整工具结果时，使用此工具。',
      parameters: {
        type: 'object',
        properties: {
          topic_id: {
            type: 'string',
            description: '话题ID。如果提供，返回该话题的详细消息。',
          },
          message_id: {
            type: 'string',
            description: '消息ID。如果提供，返回该消息的完整内容（用于获取工具结果的完整内容）。',
          },
          keyword: {
            type: 'string',
            description: '搜索关键词。在话题标题、描述、关键词中搜索匹配的话题。如果提供，返回匹配的话题列表。',
          },
          start: {
            type: 'integer',
            description: '起始位置（从0开始）。不提供 topic_id 时，列出最近话题的起始索引。例如 start=2 表示从倒数第3个话题开始。',
          },
          count: {
            type: 'integer',
            description: '数量。不提供 topic_id 时，列出最近 N 个话题；提供 topic_id 时，返回最近 N 条消息。默认 5。',
          },
        },
      },
    },
    _meta: {
      builtin: true,
      toolName: 'recall',
    },
  },
];

class ToolManager {
  /**
   * @param {Database} db - 数据库实例
   * @param {string} expertId - 专家ID
   * @param {object} options - 配置选项
   */
  constructor(db, expertId, options = {}) {
    this.db = db;
    this.expertId = expertId;
    this.options = options;

    // 技能加载器
    this.skillLoader = new SkillLoader(db, options);

    // 已加载的技能
    this.skills = new Map();

    // 工具 ID 到技能的映射（toolId -> skillId）
    this.toolToSkill = new Map();

    // 工具注册表（toolId -> { skillId, skillName, toolName }）
    this.toolRegistry = new Map();

    // 是否已初始化
    this.initialized = false;
  }

  /**
   * 初始化工具管理器
   * 加载专家启用的所有技能
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    logger.info(`[ToolManager] 初始化专家 ${this.expertId} 的工具管理器`);

    // 加载专家技能
    const skills = await this.skillLoader.loadSkillsForExpert(this.expertId);

    // 注册技能
    for (const skill of skills) {
      this.registerSkill(skill);
    }

    this.initialized = true;
    logger.info(`[ToolManager] 初始化完成，注册了 ${this.skills.size} 个技能，${this.toolToSkill.size} 个工具`);
  }

  /**
   * 重新加载技能（用于动态更新）
   */
  async reload() {
    logger.info(`[ToolManager] 重新加载技能`);

    // 清除当前状态
    this.skills.clear();
    this.toolToSkill.clear();
    this.toolRegistry.clear();
    this.initialized = false;

    // 清除缓存
    this.skillLoader.invalidateCache();

    // 重新初始化
    await this.initialize();
  }

  /**
   * 注册技能
   * @param {object} skill - 技能实例
   */
  registerSkill(skill) {
    if (!skill || !skill.id) {
      logger.warn('[ToolManager] 尝试注册无效的技能');
      return;
    }

    this.skills.set(skill.id, skill);

    // 获取该技能提供的工具
    const tools = this.skillLoader.getToolDefinitions(skill);

    // 建立工具 ID 到技能的映射，并填充 toolRegistry
    for (const tool of tools) {
      const toolId = this.extractToolName(tool);
      if (toolId) {
        // 使用 _meta 中的信息
        const skillId = tool._meta?.skillId || skill.id;
        const skillName = tool._meta?.skillName || skill.name || skillId;
        const toolName = tool._meta?.toolName || toolId;
        const scriptPath = tool._meta?.scriptPath || 'index.js';  // 工具入口脚本路径
        
        // 映射 toolId -> skillId
        this.toolToSkill.set(toolId, skillId);
        
        // 注册到 toolRegistry（用于显示和执行）
        this.toolRegistry.set(toolId, {
          skillId,
          skillName,
          toolName,
          scriptPath,  // 添加脚本路径
        });
        
        logger.debug(`[ToolManager] 注册工具: ${toolId} -> ${skillId} (${skillName}/${toolName}, script: ${scriptPath})`);
      }
    }
  }

  /**
   * 提取工具名称
   * @param {object} tool - 工具定义
   * @returns {string|null} 工具名称
   */
  extractToolName(tool) {
    // OpenAI 格式: { type: 'function', function: { name: 'toolName' } }
    if (tool?.function?.name) {
      return tool.function.name;
    }

    // 简化格式: { name: 'toolName' }
    if (tool?.name) {
      return tool.name;
    }

    return null;
  }

  /**
   * 获取所有工具定义（供 LLM 使用）
   * @returns {Array} OpenAI 格式的工具定义数组（不含 _meta，节省 token）
   */
  getToolDefinitions() {
    const definitions = [];

    // 添加内置工具（execute_javascript 等）
    for (const tool of BUILTIN_TOOLS) {
      const { _meta, ...llmTool } = tool;
      definitions.push(llmTool);
    }

    // 添加所有技能工具
    for (const skill of this.skills.values()) {
      const tools = this.skillLoader.getToolDefinitions(skill);
      // 移除 _meta 字段，不发送给 LLM（节省 token）
      for (const tool of tools) {
        const { _meta, ...llmTool } = tool;
        definitions.push(llmTool);
      }
    }

    // 添加助理工具（核心服务工具）
    try {
      const assistantManager = getAssistantManager(this.db);
      if (assistantManager) {
        const assistantTools = assistantManager.getAssistantTools();
        definitions.push(...assistantTools);
      }
    } catch (err) {
      logger.warn('[ToolManager] 获取助理工具失败:', err.message);
    }

    return definitions;
  }

  /**
   * 检查是否有可用工具
   * @returns {boolean}
   */
  hasTools() {
    return this.toolToSkill.size > 0;
  }

  /**
   * 格式化工具显示名称（用于日志和 UI）
   * @param {string} toolId - 工具 ID（skill_tools.id）
   * @returns {string} 友好的显示名称，如 "SearXNG/web_search"
   */
  formatToolDisplay(toolId) {
    const info = this.toolRegistry.get(toolId);
    if (!info) {
      return toolId;  // 未找到，返回原始 ID
    }
    return `${info.skillName}/${info.toolName}`;
  }

  /**
   * 获取工具的详细信息
   * @param {string} toolId - 工具 ID
   * @returns {object|null} 工具信息 { skillId, skillName, toolName }
   */
  getToolInfo(toolId) {
    return this.toolRegistry.get(toolId) || null;
  }

  /**
   * 执行工具调用
   * 所有技能统一通过 skill-runner 子进程隔离执行
   * 支持驻留工具（resident:// 协议）直接调用 ResidentSkillManager
   *
   * @param {string} toolId - 工具 ID（toolName__skillIdShort 格式）
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文
   * @param {string} context.userId - 用户ID
   * @param {string} context.expertId - 专家ID
   * @param {string} context.accessToken - 用户 JWT Token（用于 API 调用）
   * @param {object} context.memorySystem - 记忆系统实例（可选）
   * @param {object} context.taskContext - 任务上下文（包含工作空间路径）
   * @param {Array} context.roles - 用户角色列表（用于权限检查）
   * @returns {Promise<object>} 工具执行结果
   */
  async executeTool(toolId, params, context = {}) {
    const display = this.formatToolDisplay(toolId);
    logger.info(`[ToolManager] 执行工具: ${display}`, { toolId, params });

    // 检查是否是内置工具
    const builtinTool = BUILTIN_TOOLS.find(t => t.function.name === toolId);
    if (builtinTool) {
      return await this.executeBuiltinTool(toolId, params, context, display);
    }

    // 检查是否是助理工具（核心服务）
    const assistantTools = ['assistant_summon', 'assistant_roster'];
    if (assistantTools.includes(toolId)) {
      try {
        const assistantManager = getAssistantManager(this.db);
        if (assistantManager) {
          return await assistantManager.executeTool(toolId, params, {
            expertId: context.expertId || context.expert_id,
            userId: context.userId || context.user_id,
            contactId: context.contactId,
            topicId: context.topicId,
            taskContext: context.taskContext,  // 传递任务上下文（包含工作空间路径）
          });
        }
      } catch (err) {
        logger.error(`[ToolManager] 执行助理工具失败: ${toolId}`, err.message);
        return { success: false, error: err.message };
      }
    }

    // 从 toolRegistry 获取工具信息
    const toolInfo = this.toolRegistry.get(toolId);
    if (!toolInfo) {
      return {
        success: false,
        error: `Tool not found: ${toolId}`,
      };
    }

    const { skillId, toolName, scriptPath } = toolInfo;

    // 检查是否是驻留工具（resident:// 协议）
    if (scriptPath && scriptPath.startsWith('resident://')) {
      return await this.executeResidentTool(scriptPath, skillId, params, context, display, toolId);
    }

    // 通过子进程隔离执行
    const skill = this.skills.get(skillId);
    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${skillId}`,
      };
    }

    try {
      const startTime = Date.now();

      // 兼容 userId/user_id 和 expertId/expert_id 两种格式
      const userId = context.userId || context.user_id;
      const expertId = context.expertId || context.expert_id;
      const accessToken = context.accessToken;  // 用户 JWT Token
      const taskContext = context.taskContext;  // 任务上下文

      // 确定工作目录：
      // 1. 有任务时：使用任务工作空间路径（如 work/userId/taskId）
      // 2. 无任务时：使用用户 temp 目录（如 work/userId/temp）
      let workingDirectory;
      if (taskContext?.fullWorkspacePath) {
        workingDirectory = taskContext.fullWorkspacePath;
        logger.info(`[ToolManager] 使用任务工作目录: ${workingDirectory}`);
      } else if (userId) {
        workingDirectory = `work/${userId}/temp`;
        logger.info(`[ToolManager] 使用用户 temp 目录: ${workingDirectory}`);
      } else {
        workingDirectory = null;
        logger.warn(`[ToolManager] 无法确定工作目录，userId 为空`);
      }

      // 使用 toolRegistry 中的 toolName（原始工具名称）和 scriptPath
      const result = await this.skillLoader.executeSkillTool(
        skillId,
        toolName,  // 使用原始工具名称
        params,
        {
          userId,
          expertId,
          accessToken,  // 传递用户 Token
          workingDirectory,  // 传递工作目录
          isAdmin: context?.session?.isAdmin || false,  // 从 session 读取管理员标识
          isSkillCreator: context?.session?.roles?.includes('creator') || false,  // 从 session 读取技能创作者标识
        },
        scriptPath || 'index.js',  // 传递脚本路径
      );
      
      const duration = Date.now() - startTime;

      logger.info(`[ToolManager] 工具执行成功: ${display} (${duration}ms)`);

      return {
        success: true,
        data: result,
        toolId,
        toolName: display,  // 返回友好名称
        duration,
      };
    } catch (error) {
      logger.error(`[ToolManager] 工具执行失败: ${display}`, error.message);

      return {
        success: false,
        error: error.message,
        toolId,
        toolName: display,
      };
    }
  }

  /**
   * 执行内置工具
   * @param {string} toolId - 工具 ID
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文
   * @param {string} display - 工具显示名称
   * @returns {Promise<object>} 执行结果
   */
  async executeBuiltinTool(toolId, params, context, display) {
    logger.info(`[ToolManager] 执行内置工具: ${toolId}`);

    // 获取内置工具定义
    const builtinTool = BUILTIN_TOOLS.find(t => t.function.name === toolId);
    
    // 权限检查：检查 allowedRoles
    if (builtinTool?._meta?.allowedRoles) {
      const userRole = this.getUserRole(context);
      const allowedRoles = builtinTool._meta.allowedRoles;
      
      if (!allowedRoles.includes(userRole)) {
        logger.warn(`[ToolManager] 权限拒绝: 用户角色 ${userRole} 无权执行 ${toolId}`);
        return {
          success: false,
          error: `Permission denied: Only ${allowedRoles.join(' and ')} can execute ${toolId}`,
          toolId,
          toolName: display,
          permissionDenied: true,
        };
      }
    }

    // 执行 execute_javascript
    if (toolId === 'execute_javascript') {
      try {
        const startTime = Date.now();
        const { code, script_path } = params;

        if (!code) {
          return {
            success: false,
            error: 'Missing required parameter: code',
            toolId,
            toolName: display,
          };
        }

        // 确定工作目录
        const userId = context.userId || context.user_id;
        const taskContext = context.taskContext;
        let workingDirectory;
        if (taskContext?.fullWorkspacePath) {
          workingDirectory = taskContext.fullWorkspacePath;
        } else if (userId) {
          workingDirectory = `work/${userId}/temp`;
        }

        // 调用 skillLoader.executeUserCode 执行用户代码
        const result = await this.skillLoader.executeUserCode(code, {
          userId,
          expertId: context.expertId || context.expert_id,
          accessToken: context.accessToken,
          workingDirectory,
          isAdmin: context?.session?.isAdmin || false,  // 从 session 读取管理员标识
          isSkillCreator: context?.session?.roles?.includes('creator') || false,  // 从 session 读取技能创作者标识
        }, script_path);

        const duration = Date.now() - startTime;
        logger.info(`[ToolManager] 内置工具执行成功: ${toolId} (${duration}ms)`);

        return {
          success: true,
          data: result,
          toolId,
          toolName: display,
          duration,
        };
      } catch (error) {
        logger.error(`[ToolManager] 内置工具执行失败: ${toolId}`, error.message);
        return {
          success: false,
          error: error.message,
          toolId,
          toolName: display,
        };
      }
    }

    // 执行 recall
    if (toolId === 'recall') {
      return await this.executeRecall(params, context, display);
    }

    // 未知内置工具
    return {
      success: false,
      error: `Builtin tool not implemented: ${toolId}`,
      toolId,
      toolName: display,
    };
  }

  /**
   * 获取用户角色（用于权限检查）
   * @param {object} context - 执行上下文
   * @returns {string} 用户角色
   */
  getUserRole(context) {
    // 从 context.session.roles 数组中获取最高权限角色
    const roles = context?.session?.roles || [];
    
    // 角色优先级：admin > creator > user
    if (roles.includes('admin')) {
      return 'admin';
    }
    if (roles.includes('creator')) {
      return 'creator';
    }
    
    return 'user';
  }

  /**
   * 执行 recall 工具
   * 统一的回忆功能：列出话题、搜索话题、获取话题消息、获取单条消息完整内容
   *
   * @param {object} params - 工具参数
   * @param {string} params.topic_id - 话题ID（可选）
   * @param {string} params.message_id - 消息ID（可选，用于获取完整内容）
   * @param {string} params.keyword - 搜索关键词（可选）
   * @param {number} params.start - 起始位置（可选，默认 0）
   * @param {number} params.count - 数量（可选，默认 5）
   * @param {object} context - 执行上下文
   * @param {string} display - 工具显示名称
   * @returns {Promise<object>} 执行结果
   */
  async executeRecall(params, context, display) {
    const startTime = Date.now();
    const { topic_id, message_id, keyword, start = 0, count = 5 } = params;
    const userId = context.userId || context.user_id;

    logger.info(`[ToolManager] recall: topic_id=${topic_id}, message_id=${message_id}, keyword=${keyword}, start=${start}, count=${count}, user=${userId}`);

    try {
      // 情况 1：提供了 message_id，返回该消息的完整内容
      if (message_id) {
        return await this.getMessageContent(message_id, userId, display, startTime);
      }

      // 情况 2：提供了 topic_id，返回该话题的消息
      if (topic_id) {
        return await this.getTopicMessagesResult(topic_id, userId, start, count, display, startTime);
      }

      // 情况 3：提供了 keyword，搜索话题
      if (keyword && keyword.trim() !== '') {
        return await this.searchTopics(context, userId, keyword, start, count, display, startTime);
      }

      // 情况 4：未提供 topic_id、message_id 和 keyword，列出最近话题
      return await this.listTopics(context, userId, start, count, display, startTime);

    } catch (error) {
      logger.error(`[ToolManager] recall 执行失败:`, error.message);
      return {
        success: false,
        error: error.message,
        toolId: 'recall',
        toolName: display,
      };
    }
  }

  /**
   * 获取单条消息的完整内容
   * Issue #325: 从 tool_calls.result 获取完整结果
   *
   * @param {string} messageId - 消息ID
   * @param {string} userId - 用户ID（用于权限验证）
   * @param {string} display - 工具显示名称
   * @param {number} startTime - 开始时间
   * @returns {Promise<object>} 执行结果
   */
  async getMessageContent(messageId, userId, display, startTime) {
    const Message = this.db.getModel('message');
    if (!Message) {
      return {
        success: false,
        error: 'Message model not found',
        toolId: 'recall',
        toolName: display,
      };
    }

    // 查询消息
    const message = await Message.findOne({
      where: { id: messageId },
      raw: true,
    });

    if (!message) {
      return {
        success: false,
        error: `消息不存在: ${messageId}`,
        toolId: 'recall',
        toolName: display,
      };
    }

    // 权限验证：消息必须属于当前用户
    if (message.user_id !== userId) {
      logger.warn(`[ToolManager] 权限拒绝: 用户 ${userId} 尝试访问不属于自己的消息 ${messageId}`);
      return {
        success: false,
        error: 'Permission denied: Message does not belong to current user',
        toolId: 'recall',
        toolName: display,
      };
    }

    // 解析 tool_calls JSON
    let toolMetaData = {};
    try {
      toolMetaData = typeof message.tool_calls === 'string'
        ? JSON.parse(message.tool_calls)
        : message.tool_calls || {};
    } catch (e) {
      logger.warn('[ToolManager] 解析 tool_calls 失败:', e.message);
    }

    // Issue #325: 优先从 tool_calls.result 获取完整结果
    let fullContent;
    let isFromResult = false;

    if (toolMetaData.result !== undefined && toolMetaData.result !== null) {
      // 新存储方式：完整结果在 tool_calls.result 中
      fullContent = typeof toolMetaData.result === 'string'
        ? toolMetaData.result
        : JSON.stringify(toolMetaData.result);
      isFromResult = true;
      logger.info(`[ToolManager] recall: 从 tool_calls.result 获取完整内容: id=${message.id}, length=${fullContent.length}`);
    } else {
      // 旧存储方式或短结果：使用 content 字段
      fullContent = message.content || '';
      logger.info(`[ToolManager] recall: 从 content 获取内容: id=${message.id}, length=${fullContent.length}`);
    }

    return {
      success: true,
      data: {
        message_id: messageId,
        tool_name: toolMetaData.name || 'unknown',
        content: fullContent,
        content_length: fullContent.length,
        result_length: toolMetaData.result_length || fullContent.length,
        is_from_result: isFromResult,
        created_at: message.created_at,
      },
      toolId: 'recall',
      toolName: display,
      duration: Date.now() - startTime,
    };
  }

  /**
   * 获取话题消息列表（返回结果格式）
   *
   * @param {string} topicId - 话题ID
   * @param {string} userId - 用户ID
   * @param {number} start - 起始位置
   * @param {number} count - 数量
   * @param {string} display - 工具显示名称
   * @param {number} startTime - 开始时间
   * @returns {Promise<object>} 执行结果
   */
  async getTopicMessagesResult(topicId, userId, start, count, display, startTime) {
    const messages = await this.getTopicMessages(topicId, userId, start, count);

    if (!messages || messages.length === 0) {
      return {
        success: true,
        data: {
          topic_id: topicId,
          message: '该话题暂无消息记录',
          messages: [],
        },
        toolId: 'recall',
        toolName: display,
        duration: Date.now() - startTime,
      };
    }

    // 格式化消息
    const formattedMessages = messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.created_at || m.timestamp,
    }));

    return {
      success: true,
      data: {
        topic_id: topicId,
        start,
        message_count: messages.length,
        messages: formattedMessages,
      },
      toolId: 'recall',
      toolName: display,
      duration: Date.now() - startTime,
    };
  }

  /**
   * 列出最近话题
   *
   * @param {object} context - 执行上下文
   * @param {string} userId - 用户ID
   * @param {number} start - 起始位置
   * @param {number} count - 数量
   * @param {string} display - 工具显示名称
   * @param {number} startTime - 开始时间
   * @returns {Promise<object>} 执行结果
   */
  async listTopics(context, userId, start, count, display, startTime) {
    const memorySystem = context.memorySystem;
    if (!memorySystem) {
      return {
        success: false,
        error: 'MemorySystem not available in context',
        toolId: 'recall',
        toolName: display,
      };
    }

    // 回忆工具应该返回所有话题，不限制状态
    const topics = await memorySystem.getTopics(userId, start + count, null);
    logger.info(`[ToolManager] recall: 查询到 ${topics?.length || 0} 个话题 (请求 ${start + count} 个)`);

    if (!topics || topics.length === 0) {
      return {
        success: true,
        data: {
          message: '暂无话题记录',
          topics: [],
        },
        toolId: 'recall',
        toolName: display,
        duration: Date.now() - startTime,
      };
    }

    // 应用分页（start 和 count）
    const paginatedTopics = topics.slice(start, start + count);

    // 格式化话题列表
    const formattedTopics = paginatedTopics.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      message_count: t.message_count || 0,
      updated_at: t.updated_at,
    }));

    return {
      success: true,
      data: {
        total_count: topics.length,
        start,
        count: paginatedTopics.length,
        topics: formattedTopics,
      },
      toolId: 'recall',
      toolName: display,
      duration: Date.now() - startTime,
    };
  }

  /**
   * 搜索话题
   *
   * @param {object} context - 执行上下文
   * @param {string} userId - 用户ID
   * @param {string} keyword - 搜索关键词
   * @param {number} start - 起始位置
   * @param {number} count - 数量
   * @param {string} display - 工具显示名称
   * @param {number} startTime - 开始时间
   * @returns {Promise<object>} 执行结果
   */
  async searchTopics(context, userId, keyword, start, count, display, startTime) {
    const memorySystem = context.memorySystem;
    if (!memorySystem) {
      return {
        success: false,
        error: 'MemorySystem not available in context',
        toolId: 'recall',
        toolName: display,
      };
    }

    // 搜索话题
    const topics = await memorySystem.searchTopics(userId, keyword, start + count);
    logger.info(`[ToolManager] recall: 搜索关键词 "${keyword}" 找到 ${topics?.length || 0} 个话题`);

    if (!topics || topics.length === 0) {
      return {
        success: true,
        data: {
          keyword,
          message: `未找到包含 "${keyword}" 的话题`,
          topics: [],
        },
        toolId: 'recall',
        toolName: display,
        duration: Date.now() - startTime,
      };
    }

    // 应用分页
    const paginatedTopics = topics.slice(start, start + count);

    // 格式化话题列表
    const formattedTopics = paginatedTopics.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      message_count: t.message_count || 0,
      keywords: t.keywords,
      updated_at: t.updated_at,
    }));

    return {
      success: true,
      data: {
        keyword,
        total_count: topics.length,
        start,
        count: paginatedTopics.length,
        topics: formattedTopics,
      },
      toolId: 'recall',
      toolName: display,
      duration: Date.now() - startTime,
    };
  }

  /**
   * 获取话题的消息列表
   * @param {string} topicId - 话题ID
   * @param {string} userId - 用户ID（用于权限验证）
   * @param {number} start - 起始位置（从0开始）
   * @param {number} count - 数量限制
   * @returns {Promise<Array>} 消息列表
   */
  async getTopicMessages(topicId, userId, start = 0, count = 20) {
    const Topic = this.db.getModel('topic');
    if (!Topic) {
      throw new Error('Topic model not found');
    }

    // 验证话题是否属于当前用户
    const topic = await Topic.findOne({
      where: { id: topicId },
      raw: true,
    });

    if (!topic) {
      throw new Error('Topic not found');
    }

    if (topic.user_id !== userId) {
      logger.warn(`[ToolManager] 权限拒绝: 用户 ${userId} 尝试访问不属于自己的话题 ${topicId}`);
      throw new Error('Permission denied: Topic does not belong to current user');
    }

    const Message = this.db.getModel('message');
    if (!Message) {
      throw new Error('Message model not found');
    }

    // 先获取总数，然后应用分页
    // 使用 offset 和 limit 实现分页
    const messages = await Message.findAll({
      where: { topic_id: topicId },
      order: [['created_at', 'ASC']],
      offset: start,
      limit: count,
      raw: true,
    });

    logger.info(`[ToolManager] getTopicMessages: topic=${topicId}, start=${start}, count=${count}, 返回 ${messages.length} 条消息`);

    return messages;
  }

  /**
   * 执行驻留工具（通过 ResidentSkillManager）
   * @param {string} scriptPath - 脚本路径（resident://toolName 格式）
   * @param {string} skillId - 技能ID
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文
   * @param {string} display - 工具显示名称
   * @param {string} toolId - 工具ID
   * @returns {Promise<object>} 执行结果
   */
  async executeResidentTool(scriptPath, skillId, params, context, display, toolId) {
    // 解析驻留工具名称
    const residentToolName = scriptPath.replace('resident://', '');
    
    logger.info(`[ToolManager] 执行驻留工具: ${residentToolName} (skill: ${skillId})`);

    // 获取 ResidentSkillManager（从全局或 context）
    const residentSkillManager = global.residentSkillManager;
    if (!residentSkillManager) {
      logger.error('[ToolManager] ResidentSkillManager 未初始化');
      return {
        success: false,
        error: 'ResidentSkillManager not initialized',
        toolId,
        toolName: display,
      };
    }

    try {
      const startTime = Date.now();

      // 构建用户上下文
      const userContext = {
        userId: context.userId || context.user_id || '',
        accessToken: context.accessToken || '',
        expertId: context.expertId || context.expert_id || '',
        isAdmin: context?.session?.isAdmin || false,  // 从 session 读取管理员标识
        isSkillCreator: context?.session?.roles?.includes('creator') || false,  // 从 session 读取技能创作者标识
      };

      // 调用驻留工具
      const result = await residentSkillManager.invokeByName(
        skillId,
        residentToolName,
        params,
        userContext,
        60000  // 默认超时 60 秒
      );

      const duration = Date.now() - startTime;
      logger.info(`[ToolManager] 驻留工具执行成功: ${display} (${duration}ms)`);

      return {
        success: true,
        data: result,
        toolId,
        toolName: display,
        duration,
      };
    } catch (error) {
      logger.error(`[ToolManager] 驻留工具执行失败: ${display}`, error.message);
      return {
        success: false,
        error: error.message,
        toolId,
        toolName: display,
      };
    }
  }

  /**
   * 批量执行工具调用（处理 LLM 返回的多个工具调用）
   * 支持实时回调，每执行完一个工具就通知调用方
   *
   * @param {Array} toolCalls - LLM 返回的工具调用数组
   * @param {object} context - 执行上下文
   * @param {Function} onToolComplete - 单个工具执行完成回调 (result) => void
   * @returns {Promise<Array>} 执行结果数组
   */
  async executeToolCalls(toolCalls, context = {}, onToolComplete = null) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return [];
    }

    const results = [];

    for (const call of toolCalls) {
      // 处理不同格式的工具调用
      const toolName = call.function?.name || call.name;
      const params = this.parseToolArguments(
        call.function?.arguments || call.arguments || call.parameters
      );

      const result = await this.executeTool(toolName, params, context);
      const toolResult = {
        toolCallId: call.id || call.tool_call_id,
        toolName,
        arguments: params,  // 保存工具调用参数
        ...result,
      };
      
      results.push(toolResult);
      
      // 每执行完一个工具，立即回调通知
      if (onToolComplete) {
        onToolComplete(toolResult);
      }
    }

    return results;
  }

  /**
   * 解析工具参数
   * @param {string|object} args - 参数（可能是 JSON 字符串或对象）
   * @returns {object}
   */
  parseToolArguments(args) {
    if (!args) return {};
    if (typeof args === 'object') return args;

    try {
      return JSON.parse(args);
    } catch (parseError) {
      // 处理 LLM 返回多个 JSON 对象拼接的情况
      // 例如: {"path":"a.md"}{"path":"b.md"}{"path":"c.md"}
      // 尝试提取第一个完整的 JSON 对象
      try {
        const firstJsonMatch = args.match(/^\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
        if (firstJsonMatch) {
          const parsed = JSON.parse(firstJsonMatch[0]);
          logger.warn('[ToolManager] 工具参数包含多个 JSON 对象，仅使用第一个:', {
            original: args.substring(0, 200),
            extracted: firstJsonMatch[0],
          });
          return parsed;
        }
      } catch (extractError) {
        // 提取失败，继续
      }

      logger.warn('[ToolManager] 工具参数解析失败:', {
        error: parseError.message,
        args_preview: typeof args === 'string' ? args.substring(0, 200) : args,
      });
      return {};
    }
  }

  /**
   * 将工具结果格式化为 LLM 可用的消息
   * 自动截断过长的结果以防止上下文膨胀
   *
   * 多模态支持：当工具结果包含 dataUrl（图片 base64 数据）时，
   * 自动添加 Markdown 图片语法，让 processMultimodalMessages() 能正确转换
   *
   * @param {Array} results - 工具执行结果数组
   * @param {number} maxLength - 单个结果最大长度（字符数）
   * @returns {Array} LLM 消息数组
   */
  formatToolResultsForLLM(results, maxLength = 10000) {
    return results.map(result => {
      // 构建返回给 LLM 的内容
      // 如果有 data 字段，使用它；否则使用整个 result（排除元数据）
      const { toolCallId, toolName, duration, ...resultData } = result;
      
      // 检查是否包含图片 dataUrl（多模态支持）
      // 当 read_file 工具使用 mode="data_url" 读取图片时，返回 dataUrl 字段
      let imageDataUrl = null;
      if (result.success && result.data?.dataUrl) {
        imageDataUrl = result.data.dataUrl;
        // 验证是否是有效的 data URL
        if (typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:image/')) {
          logger.info(`[ToolManager] 检测到图片 dataUrl，将添加 Markdown 图片语法: ${result.toolName}`);
        } else {
          imageDataUrl = null;  // 不是图片 dataUrl，忽略
        }
      }
      
      let content = JSON.stringify(
        result.success !== undefined && result.data !== undefined
          ? { success: result.success, data: result.data, error: result.error }
          : resultData
      );

      // 如果有图片 dataUrl，在 content 前添加 Markdown 图片语法
      // 这样 processMultimodalMessages() 就能正确识别并转换为多模态格式
      if (imageDataUrl) {
        // 使用简短的描述，让多模态模型知道这是工具读取的图片
        const imageMarkdown = `\n\n![工具读取的图片](${imageDataUrl})`;
        content = content + imageMarkdown;
        logger.info(`[ToolManager] 已添加 Markdown 图片语法，总长度: ${content.length}`);
      }

      // 截断过长的结果（但保留图片 dataUrl 不被截断）
      if (content.length > maxLength && !imageDataUrl) {
        const originalLength = content.length;
        content = content.substring(0, maxLength) +
          `\n...[truncated, original ${originalLength} chars]`;
        
        logger.warn(`[ToolManager] 工具结果被截断: ${result.toolName} ` +
          `(${originalLength} → ${maxLength} chars)`);
      }

      return {
        role: 'tool',
        tool_call_id: result.toolCallId,
        name: result.toolName,
        content,
      };
    });
  }

  /**
   * 获取技能列表（用于调试）
   * @returns {Array} 技能信息列表
   */
  getSkillList() {
    logger.info(`[ToolManager] getSkillList 被调用，当前有 ${this.skills.size} 个技能`);
    
    const list = Array.from(this.skills.values()).map(skill => {
      const tools = this.skillLoader.getToolDefinitions(skill);
      // 使用 function.name（skill_mark__tool_name 格式，如 "kb-search__search"）
      // 这是 LLM 实际调用时使用的名称
      const toolNames = tools.map(t => t.function?.name || this.extractToolName(t));
      logger.info(`[ToolManager] 技能 ${skill.id} 的工具:`, toolNames);
      
      return {
        id: skill.id,
        mark: skill.mark || skill.id,  // Issue #417: 技能标识，用于生成 tool_name
        name: skill.name,
        description: skill.description,
        tools: toolNames,
      };
    });
    
    logger.info(`[ToolManager] getSkillList 返回:`, list.map(s => ({ id: s.id, mark: s.mark })));
    return list;
  }

  /**
   * 获取技能详情
   * @param {string} skillId - 技能ID
   * @returns {object|null}
   */
  getSkill(skillId) {
    return this.skills.get(skillId) || null;
  }

  /**
   * 获取技能配置参数
   * @param {string} skillId - 技能ID
   * @returns {Promise<object>} 配置对象
   */
  async getSkillConfig(skillId) {
    return await this.skillLoader.getSkillConfig(skillId);
  }
}

export default ToolManager;
