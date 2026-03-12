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
import { hasSkillAccess, validateSkillAccess, SKILL_META } from './skill-meta.js';
import { getAssistantManager } from '../server/services/assistant-manager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
   * @returns {Array} OpenAI 格式的工具定义数组
   */
  getToolDefinitions() {
    const definitions = [];

    // 添加所有技能工具
    for (const skill of this.skills.values()) {
      const tools = this.skillLoader.getToolDefinitions(skill);
      definitions.push(...tools);
    }

    // 添加助理工具（核心服务工具）
    try {
      const assistantManager = getAssistantManager(this.db);
      if (assistantManager) {
        const assistantTools = assistantManager.getToolDefinitions();
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
   *
   * @param {string} toolId - 工具 ID（skillId_toolName 格式）
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文
   * @param {string} context.userId - 用户ID
   * @param {string} context.expertId - 专家ID
   * @param {string} context.accessToken - 用户 JWT Token（用于 API 调用）
   * @param {object} context.memorySystem - 记忆系统实例（可选）
   * @param {object} context.taskContext - 任务上下文（包含工作空间路径）
   * @returns {Promise<object>} 工具执行结果
   */
  async executeTool(toolId, params, context = {}) {
    const display = this.formatToolDisplay(toolId);
    logger.info(`[ToolManager] 执行工具: ${display}`, { toolId, params });

    // 检查是否是助理工具（核心服务）
    const assistantTools = ['assistant_summon', 'assistant_status', 'assistant_roster'];
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

    // Phase 2 权限检查（仅对技能工具）
    const isAdmin = context?.is_admin || false;
    const validation = validateSkillAccess(isAdmin ? 'admin' : 'user', toolId);
    if (!validation.allowed) {
      logger.warn(`[ToolManager] 权限拒绝: ${display} - ${validation.error}`);
      return {
        success: false,
        error: validation.error,
        toolId,
        toolName: display,
        permissionDenied: true,
      };
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
          isAdmin: context?.is_admin || false,  // 传递管理员标识
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
   * 批量执行工具调用（处理 LLM 返回的多个工具调用）
   *
   * @param {Array} toolCalls - LLM 返回的工具调用数组
   * @param {object} context - 执行上下文
   * @returns {Promise<Array>} 执行结果数组
   */
  async executeToolCalls(toolCalls, context = {}) {
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
      results.push({
        toolCallId: call.id || call.tool_call_id,
        toolName,
        ...result,
      });
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
   * @param {Array} results - 工具执行结果数组
   * @param {number} maxLength - 单个结果最大长度（字符数）
   * @returns {Array} LLM 消息数组
   */
  formatToolResultsForLLM(results, maxLength = 10000) {
    return results.map(result => {
      // 构建返回给 LLM 的内容
      // 如果有 data 字段，使用它；否则使用整个 result（排除元数据）
      const { toolCallId, toolName, duration, ...resultData } = result;
      
      let content = JSON.stringify(
        result.success !== undefined && result.data !== undefined
          ? { success: result.success, data: result.data, error: result.error }
          : resultData
      );

      // 截断过长的结果
      if (content.length > maxLength) {
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
      // 使用 function.name（skillId_toolName 格式，如 "compression_zip"）
      // 这是 LLM 实际调用时使用的名称
      const toolNames = tools.map(t => t.function?.name || this.extractToolName(t));
      logger.info(`[ToolManager] 技能 ${skill.id} 的工具:`, toolNames);
      
      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tools: toolNames,
      };
    });
    
    logger.info(`[ToolManager] getSkillList 返回:`, list.map(s => s.id));
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
