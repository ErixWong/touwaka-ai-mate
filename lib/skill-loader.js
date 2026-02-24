/**
 * Skill Loader - 技能加载器
 * 支持从文件系统或数据库加载技能
 *
 * 架构：
 * - 文件系统模式（推荐用于 Docker 共享卷）: /shared/skills/{skillId}/skill.md + index.js
 * - 数据库模式（适合单实例）: 从 skills 表的 skill_md 和 index_js 字段读取
 * 
 * 安全说明：
 * - 技能代码在子进程中执行，提供真正的隔离
 * - 主进程通过 IPC 与子进程通信
 * - 子进程有资源限制（CPU时间、内存）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 技能执行超时（毫秒）
const SKILL_EXECUTION_TIMEOUT = 30000; // 30秒
// 技能子进程最大内存（MB）
const SKILL_MEMORY_LIMIT = 128; // 128MB
// 技能运行器脚本路径
const SKILL_RUNNER_PATH = path.join(__dirname, 'skill-runner.js');

class SkillLoader {
  /**
   * @param {Database} db - 数据库实例
   * @param {object} options - 配置选项
   * @param {string} options.skillsBasePath - 文件系统模式下的基础路径（默认 data/skills）
   */
  constructor(db, options = {}) {
    this.db = db;
    // 默认使用 data/skills 目录
    this.skillsBasePath = options.skillsBasePath || path.join(process.cwd(), 'data', 'skills');

    // 技能缓存
    this.skillCache = new Map();
  }

  /**
   * 加载专家启用的所有技能
   * @param {string} expertId - 专家ID
   * @returns {Promise<Array>} 技能实例列表
   */
  async loadSkillsForExpert(expertId) {
    // 从数据库获取专家启用的技能
    const skillRows = await this.db.getExpertSkills(expertId);
    
    logger.info(`[SkillLoader] 从数据库获取到 ${skillRows.length} 个技能记录 for expert ${expertId}`);
    skillRows.forEach((row, i) => {
      logger.info(`[SkillLoader] 技能记录 ${i + 1}: id=${row.id}, name=${row.name}, source_type=${row.source_type}, source_path=${row.source_path}`);
    });

    const skills = [];
    for (const row of skillRows) {
      try {
        const skill = await this.loadSkill(row);
        if (skill) {
          skills.push(skill);
          logger.info(`[SkillLoader] 技能加载成功: ${skill.id}`);
        }
      } catch (error) {
        logger.error(`[SkillLoader] 加载技能 ${row.id} 失败:`, error.message);
      }
    }

    logger.info(`[SkillLoader] 专家 ${expertId} 最终加载了 ${skills.length} 个技能`);
    return skills;
  }

  /**
   * 加载单个技能
   * @param {object} skillRow - 数据库中的技能记录
   * @returns {Promise<object>} 技能实例
   */
  async loadSkill(skillRow) {
    const cacheKey = `${skillRow.id}_${skillRow.updated_at}`;

    // 检查缓存
    if (this.skillCache.has(cacheKey)) {
      return this.skillCache.get(cacheKey);
    }

    // 从数据库加载技能的工具定义
    const skill = await this.loadSkillFromDatabase(skillRow);

    // 缓存技能
    this.skillCache.set(cacheKey, skill);

    return skill;
  }

  /**
   * 从数据库加载技能（包含工具定义）
   * @param {object} skillRow - 技能数据库记录
   * @returns {Promise<object>} 技能实例
   */
  async loadSkillFromDatabase(skillRow) {
    // 合并专家级别的配置
    const expertConfig = this.parseExpertConfig(skillRow.expert_config);

    // 构建基础技能对象
    const skill = {
      id: skillRow.id,
      name: skillRow.name,
      description: skillRow.description,
      skillMd: skillRow.skill_md,  // 可选的 skill.md 内容
      config: { ...this.parseJson(skillRow.config), ...expertConfig },
      sourcePath: skillRow.source_path,  // 可选的源码路径
      tools: [],  // 稍后填充
    };

    // 从 skill_tools 表加载工具定义（传入完整 skill 对象）
    skill.tools = await this.loadSkillTools(skill);

    return skill;
  }

  /**
   * 从 skill_tools 表加载工具定义
   * @param {object} skill - 技能对象（包含 id 和 name）
   * @returns {Promise<Array>} 工具定义数组
   */
  async loadSkillTools(skill) {
    try {
      const SkillTool = this.db.getModel('skill_tool');
      if (!SkillTool) {
        logger.warn(`[SkillLoader] SkillTool model not found`);
        return [];
      }

      const toolRows = await SkillTool.findAll({
        where: { skill_id: skill.id },
        raw: true,
      });

      logger.info(`[SkillLoader] 从 skill_tools 表加载了 ${toolRows.length} 个工具 for skill ${skill.id}`);

      return toolRows.map(row => this.convertToolToOpenAIFormat(row, skill));
    } catch (error) {
      logger.error(`[SkillLoader] 加载技能 ${skill.id} 的工具失败:`, error.message);
      return [];
    }
  }

  /**
   * 将 skill_tools 表的记录转换为 OpenAI 工具格式
   * @param {object} toolRow - skill_tools 表的记录
   * @param {object} skill - 技能对象（包含 id 和 name）
   * @returns {object} OpenAI 格式的工具定义
   */
  convertToolToOpenAIFormat(toolRow, skill) {
    // 解析 usage 字段作为参数定义
    let parameters = { type: 'object', properties: {}, required: [] };
    if (toolRow.usage) {
      try {
        const usageObj = typeof toolRow.usage === 'string' ? JSON.parse(toolRow.usage) : toolRow.usage;
        if (usageObj.parameters) {
          parameters = usageObj.parameters;
        } else if (usageObj.properties) {
          parameters = { type: 'object', properties: usageObj.properties, required: usageObj.required || [] };
        }
      } catch {
        // usage 不是 JSON，保持默认空参数
      }
    }

    // 使用 skill_tools.id 作为 tool_name（唯一且精确）
    const toolId = toolRow.id;

    return {
      type: 'function',
      function: {
        name: toolId,  // 使用 skill_tools.id 作为 LLM 调用的 tool_name
        description: toolRow.description || '',
        parameters,
      },
      // 保留原始信息用于执行和显示
      _meta: {
        toolId: toolId,              // 工具 ID（skill_tools.id）
        skillId: skill.id,           // 所属技能 ID
        skillName: skill.name,       // 技能名称（用于显示）
        toolName: toolRow.name,      // 工具名称（用于执行）
        type: toolRow.type,
        command: toolRow.command,
        endpoint: toolRow.endpoint,
        method: toolRow.method,
      },
    };
  }

  /**
   * 将字符串转换为 URL 友好的 slug 格式
   * @param {string} str - 原始字符串
   * @returns {string} slug 化的字符串
   */
  slugify(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')  // 非字母数字替换为下划线
      .replace(/^_|_$/g, '');       // 去掉首尾下划线
  }

  /**
   * 在子进程中执行技能工具
   * 提供真正的沙箱隔离
   *
   * @param {string} skillId - 技能ID
   * @param {string} toolName - 工具名称
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文 (userId, expertId等)
   * @returns {Promise<object>} 执行结果
   */
  async executeSkillTool(skillId, toolName, params, context = {}) {
    return new Promise(async (resolve, reject) => {
      const startTime = Date.now();
      
      // 从数据库读取该技能的参数和 source_path
      const config = await this.getSkillConfig(skillId);
      const sourcePath = await this.getSkillSourcePath(skillId);
      
      logger.info(`[SkillLoader] 执行技能工具: ${skillId}.${toolName}`, {
        sourcePath,
        configKeys: Object.keys(config),
      });
      
      // 构建该技能的最小化环境变量（安全隔离）
      const env = this.buildSkillEnvironment(skillId, config, sourcePath);
      
      logger.info(`[SkillLoader] 技能环境 SKILL_PATH: ${env.SKILL_PATH}`);

      // 启动子进程
      const proc = spawn('node', [SKILL_RUNNER_PATH, skillId, toolName], {
        env,
        timeout: SKILL_EXECUTION_TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        const duration = Date.now() - startTime;
        
        if (stderr) {
          logger.debug(`[SkillLoader] ${skillId} stderr:`, stderr);
        }

        // 尝试解析 stdout（即使 exit code 非 0，错误详情也在 stdout 的 JSON 中）
        try {
          const result = JSON.parse(stdout);
          
          if (result.success) {
            logger.info(`[SkillLoader] 技能执行完成: ${skillId}.${toolName} (${duration}ms)`);
            resolve(result.data);
          } else {
            // 技能执行失败，使用 JSON 中的错误信息
            const errorMsg = result.error || 'Skill execution failed';
            logger.error(`[SkillLoader] 技能执行失败: ${skillId}.${toolName} - ${errorMsg}`);
            if (result.stack) {
              logger.error(`[SkillLoader] 错误堆栈: ${result.stack}`);
            }
            reject(new Error(`${skillId}.${toolName}: ${errorMsg}`));
          }
        } catch (parseError) {
          // JSON 解析失败
          if (code !== 0) {
            reject(new Error(`Skill ${skillId} exited with code ${code}: ${stderr || stdout}`));
          } else {
            reject(new Error(`Failed to parse skill output: ${parseError.message}`));
          }
        }
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to spawn skill process: ${error.message}`));
      });

      // 发送参数到子进程
      const input = JSON.stringify({ params, context });
      proc.stdin.write(input);
      proc.stdin.end();
    });
  }

  /**
   * 解析专家配置
   */
  parseExpertConfig(config) {
    if (!config) return {};
    if (typeof config === 'object') return config;
    try {
      return JSON.parse(config);
    } catch {
      return {};
    }
  }

  /**
   * 解析 JSON 字段
   */
  parseJson(field) {
    if (!field) return {};
    if (typeof field === 'object') return field;
    try {
      return JSON.parse(field);
    } catch {
      return {};
    }
  }

  /**
   * 查找 skill.md 文件（支持大小写变体）
   * @param {string} skillPath - 技能目录路径
   * @returns {string|null} 找到的文件路径，未找到返回 null
   */
  findSkillMdFile(skillPath) {
    const variants = ['skill.md', 'SKILL.md', 'Skill.md'];
    for (const variant of variants) {
      const fullPath = path.join(skillPath, variant);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    return null;
  }

  /**
   * 从数据库获取技能配置参数
   * @param {string} skillId - 技能ID
   * @returns {Promise<object>} 配置对象
   */
  async getSkillConfig(skillId) {
    try {
      const SkillParameter = this.db.getModel('skill_parameter');
      if (!SkillParameter) {
        logger.warn(`[SkillLoader] SkillParameter model not found`);
        return {};
      }

      const parameters = await SkillParameter.findAll({
        where: { skill_id: skillId },
        raw: true,
      });

      return parameters.reduce((acc, p) => {
        acc[p.param_name] = p.param_value;
        return acc;
      }, {});
    } catch (error) {
      logger.error(`[SkillLoader] Failed to get skill config for ${skillId}:`, error.message);
      return {};
    }
  }

  /**
   * 从数据库获取技能的 source_path
   * @param {string} skillId - 技能ID
   * @returns {Promise<string|null>} 源码路径
   */
  async getSkillSourcePath(skillId) {
    try {
      const Skill = this.db.getModel('skill');
      if (!Skill) {
        logger.warn(`[SkillLoader] Skill model not found`);
        return null;
      }

      const skill = await Skill.findOne({
        where: { id: skillId },
        attributes: ['source_path'],
        raw: true,
      });

      return skill?.source_path || null;
    } catch (error) {
      logger.error(`[SkillLoader] Failed to get source_path for ${skillId}:`, error.message);
      return null;
    }
  }

  /**
   * 构建技能的最小化环境变量
   * 安全原则：只暴露该技能需要的配置，不暴露其他技能或系统环境变量
   *
   * @param {string} skillId - 技能ID
   * @param {object} config - 技能配置对象
   * @param {string|null} sourcePath - 技能源码路径（来自数据库的 source_path 字段）
   * @returns {object} 环境变量对象
   */
  buildSkillEnvironment(skillId, config, sourcePath = null) {
    // 最小化系统环境变量白名单（仅保留必要的）
    const allowedSystemVars = ['PATH', 'NODE_ENV', 'HOME', 'TMPDIR', 'LANG', 'TZ'];
    const systemEnv = Object.fromEntries(
      allowedSystemVars
        .filter(key => process.env[key])
        .map(key => [key, process.env[key]])
    );

    // 系统保留的环境变量名（不可被用户参数覆盖）
    const RESERVED_ENV_VARS = ['SKILL_ID', 'SKILL_PATH', 'SKILL_CONFIG', 'NODE_OPTIONS'];

    // 展开配置为独立环境变量（检查冲突）
    const configEnv = {};
    for (const [key, value] of Object.entries(config)) {
      const envVarName = `SKILL_${key.toUpperCase()}`;
      if (RESERVED_ENV_VARS.includes(envVarName)) {
        logger.warn(`[SkillLoader] 参数名 "${key}" 与系统保留变量冲突，跳过环境变量注入`);
        continue;
      }
      configEnv[envVarName] = String(value);
    }

    // 确定技能路径：
    // 1. 如果 source_path 是绝对路径，直接使用
    // 2. 如果 source_path 已经包含 skillsBasePath（如 "data/skills/searxng"），直接使用
    // 3. 否则拼接 skillsBasePath + source_path（或 skillId）
    let skillPath;
    if (sourcePath) {
      if (path.isAbsolute(sourcePath)) {
        skillPath = sourcePath;
      } else if (sourcePath.startsWith('data/skills/') || sourcePath.includes('/skills/')) {
        // source_path 已经包含完整相对路径，基于项目根目录
        skillPath = path.join(process.cwd(), sourcePath);
      } else {
        // source_path 只是技能目录名，拼接 skillsBasePath
        skillPath = path.join(this.skillsBasePath, sourcePath);
      }
    } else {
      skillPath = path.join(this.skillsBasePath, skillId);
    }

    return {
      ...systemEnv,               // 1. 最小化系统变量
      SKILL_ID: skillId,          // 2. 当前技能ID
      SKILL_PATH: skillPath,      // 3. 技能代码路径（使用 source_path）
      SKILL_CONFIG: JSON.stringify(config),  // 4. 完整配置JSON
      ...configEnv,               // 5. 展开的配置环境变量
      NODE_OPTIONS: `--max-old-space-size=${SKILL_MEMORY_LIMIT}`,
    };
  }

  /**
   * 获取技能的工具定义
   * 直接返回从 skill_tools 表加载的工具
   * @param {object} skill - 技能实例
   * @returns {Array} OpenAI 格式的工具定义数组
   */
  getToolDefinitions(skill) {
    // 如果已经有从数据库加载的工具，直接返回
    if (skill.tools && skill.tools.length > 0) {
      return skill.tools;
    }

    // 兼容：如果没有 tools 但有 skillMd，尝试从 Markdown 解析
    if (skill.skillMd) {
      try {
        const tools = this.parseToolsFromMarkdown(skill.skillMd, skill);
        return tools;
      } catch (error) {
        logger.error(`[SkillLoader] 解析技能 ${skill.id} 的工具定义失败:`, error.message);
      }
    }

    return [];
  }

  /**
   * 从 Markdown 解析工具定义
   * @param {string} markdown - skill.md 内容
   * @param {object} skill - 技能对象（包含 id 和 name）
   * @returns {Array} OpenAI 格式的工具定义数组
   */
  parseToolsFromMarkdown(markdown, skill) {
    const tools = [];
    
    // 查找工具部分（支持 ## Tools / ## 工具 / ## 工具清单 / ## Commands 等）
    const toolSectionMatch = markdown.match(/##\s+(Tools|工具[\u4e00-\u9fa5]*|Commands|命令[\u4e00-\u9fa5]*)\s*\n([\s\S]*?)(?=##|$)/i);
    if (!toolSectionMatch) {
      return tools;
    }
    
    const toolSection = toolSectionMatch[2];
    
    // 解析每个工具（### toolName 格式）
    const toolMatches = toolSection.matchAll(/###\s+(\w+)\s*\n([\s\S]*?)(?=###|$)/g);
    
    for (const match of toolMatches) {
      const toolName = match[1];
      const toolDesc = match[2].trim();
      
      // 解析参数（从描述中提取）
      const parameters = this.parseParametersFromDescription(toolDesc);
      
      // 从 Markdown 解析的工具没有数据库 ID，使用 skillId_toolName 格式
      const toolId = `${skill.id}_${toolName}`;
      
      tools.push({
        type: 'function',
        function: {
          name: toolId,
          description: this.extractFirstSentence(toolDesc),
          parameters: {
            type: 'object',
            properties: parameters,
            required: Object.keys(parameters).filter(k => parameters[k].required),
          },
        },
        // 保留原始信息用于执行和显示
        _meta: {
          toolId: toolId,
          skillId: skill.id,
          skillName: skill.name,
          toolName: toolName,
        },
      });
    }
    
    return tools;
  }

  /**
   * 从工具描述中解析参数
   */
  parseParametersFromDescription(description) {
    const parameters = {};
    
    // 匹配参数行: - `param` (type, required): description
    const paramMatches = description.matchAll(/[-*]\s+`(\w+)`\s*\(([^)]+)\):\s*(.+)/g);
    
    for (const match of paramMatches) {
      const name = match[1];
      const typeInfo = match[2].split(',').map(s => s.trim());
      const desc = match[3];
      
      const paramType = typeInfo[0] || 'string';
      const required = typeInfo.includes('required');
      
      parameters[name] = {
        type: paramType,
        description: desc,
        required,
      };
    }
    
    return parameters;
  }

  /**
   * 提取第一行作为描述
   */
  extractFirstSentence(text) {
    const firstLine = text.split('\n')[0].trim();
    // 限制长度
    return firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine;
  }

  /**
   * 重新加载技能（用于动态更新）
   * @param {string} skillId - 技能ID
   */
  invalidateCache(skillId = null) {
    if (skillId) {
      // 删除该技能的所有缓存条目
      for (const key of this.skillCache.keys()) {
        if (key.startsWith(`${skillId}_`)) {
          this.skillCache.delete(key);
        }
      }
      logger.info(`[SkillLoader] 技能缓存已清除: ${skillId}`);
    } else {
      this.skillCache.clear();
      logger.info('[SkillLoader] 所有技能缓存已清除');
    }
  }

  /**
   * 扫描技能目录（文件系统模式）
   * 用于自动发现新技能
   * @returns {Promise<Array>} 发现的技能列表
   */
  async scanSkillsDirectory() {
    if (!fs.existsSync(this.skillsBasePath)) {
      logger.warn(`[SkillLoader] 技能目录不存在: ${this.skillsBasePath}`);
      return [];
    }

    const skills = [];
    const entries = fs.readdirSync(this.skillsBasePath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(this.skillsBasePath, entry.name);
        const skillMdPath = this.findSkillMdFile(skillPath);
        const indexJsPath = path.join(skillPath, 'index.js');

        if (skillMdPath && fs.existsSync(indexJsPath)) {
          skills.push({
            id: entry.name,
            path: skillPath,
          });
        }
      }
    }

    return skills;
  }
}

export default SkillLoader;
