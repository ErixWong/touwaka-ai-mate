/**
 * Tool Manager - 工具管理器
 * 负责管理技能、生成工具定义、执行工具调用
 *
 * 工作流程：
 * 1. 从数据库加载专家启用的技能
 * 2. 生成工具定义供 LLM 使用
 * 3. 处理 LLM 的工具调用请求
 * 4. 执行工具并返回结果
 */

import SkillLoader from './skill-loader.js';
import logger from './logger.js';

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

    // 工具名称到技能的映射
    this.toolToSkill = new Map();

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

    // 加载技能
    const skills = await this.skillLoader.loadSkillsForExpert(this.expertId);

    // 注册技能
    for (const skill of skills) {
      this.registerSkill(skill);
    }

    this.initialized = true;
    logger.info(`[ToolManager] 初始化完成，注册了 ${this.skills.size} 个技能`);
  }

  /**
   * 重新加载技能（用于动态更新）
   */
  async reload() {
    logger.info(`[ToolManager] 重新加载技能`);

    // 清除当前状态
    this.skills.clear();
    this.toolToSkill.clear();
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

    // 建立工具名称到技能的映射
    for (const tool of tools) {
      const toolName = this.extractToolName(tool);
      if (toolName) {
        this.toolToSkill.set(toolName, skill.id);
        logger.debug(`[ToolManager] 注册工具: ${toolName} -> ${skill.id}`);
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

    for (const skill of this.skills.values()) {
      const tools = this.skillLoader.getToolDefinitions(skill);
      definitions.push(...tools);
    }

    return definitions;
  }

  /**
   * 检查是否有可用工具
   * @returns {boolean}
   */
  hasTools() {
    return this.skills.size > 0;
  }

  /**
   * 执行工具调用
   * 使用子进程隔离执行技能代码
   *
   * @param {string} toolName - 工具名称
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文
   * @param {string} context.userId - 用户ID
   * @param {string} context.expertId - 专家ID
   * @param {object} context.memorySystem - 记忆系统实例（可选）
   * @returns {Promise<object>} 工具执行结果
   */
  async executeTool(toolName, params, context = {}) {
    logger.info(`[ToolManager] 执行工具: ${toolName}`, { params });

    // 查找技能
    const skillId = this.toolToSkill.get(toolName);
    if (!skillId) {
      return {
        success: false,
        error: `Tool not found: ${toolName}`,
      };
    }

    const skill = this.skills.get(skillId);
    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${skillId}`,
      };
    }

    // 执行工具（通过子进程隔离）
    try {
      const startTime = Date.now();
      
      // 使用 skill-loader 在子进程中执行
      const result = await this.skillLoader.executeSkillTool(
        skillId,
        toolName,
        params,
        {
          userId: context.userId,
          expertId: context.expertId,
        }
      );
      
      const duration = Date.now() - startTime;

      logger.info(`[ToolManager] 工具执行成功: ${toolName} (${duration}ms)`);

      return {
        success: true,
        data: result,
        toolName,
        duration,
      };
    } catch (error) {
      logger.error(`[ToolManager] 工具执行失败: ${toolName}`, error.message);

      return {
        success: false,
        error: error.message,
        toolName,
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
    } catch {
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
  formatToolResultsForLLM(results, maxLength = 4000) {
    return results.map(result => {
      let content = JSON.stringify({
        success: result.success,
        data: result.data,
        error: result.error,
      });

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
    return Array.from(this.skills.values()).map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tools: this.skillLoader.getToolDefinitions(skill).map(t => this.extractToolName(t)),
    }));
  }

  /**
   * 获取技能详情
   * @param {string} skillId - 技能ID
   * @returns {object|null}
   */
  getSkill(skillId) {
    return this.skills.get(skillId) || null;
  }
}

export default ToolManager;
