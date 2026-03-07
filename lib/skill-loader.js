/**
 * Skill Loader - 技能加载器
 * 支持从文件系统或数据库加载技能
 *
 * 架构：
 * - 文件系统模式（推荐用于 Docker 共享卷）: /shared/skills/{skillId}/SKILL.md + index.js
 * - 数据库模式（适合单实例）: 从 skills 表读取元数据，代码通过 source_path 从文件系统加载
 *
 * 注：index_js 和 config 字段已从 skills 表移除
 * - 代码通过 source_path 字段指定的路径从文件系统加载
 * - 配置通过 skill_parameters 表管理
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
    // 默认使用 DATA_BASE_PATH/skills 目录
    const dataBasePath = process.env.DATA_BASE_PATH
      ? (path.isAbsolute(process.env.DATA_BASE_PATH)
          ? process.env.DATA_BASE_PATH
          : path.join(process.cwd(), process.env.DATA_BASE_PATH))
      : path.join(process.cwd(), 'data');
    this.skillsBasePath = options.skillsBasePath || path.join(dataBasePath, 'skills');

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
      config: expertConfig,  // 只使用专家级别的配置
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
    // 解析 parameters 字段
    let parameters = { type: 'object', properties: {}, required: [] };
    
    if (toolRow.parameters) {
      try {
        const paramsObj = typeof toolRow.parameters === 'string' ? JSON.parse(toolRow.parameters) : toolRow.parameters;
        if (paramsObj.type === 'object' && paramsObj.properties) {
          // 已经是完整的 JSON Schema 格式
          parameters = paramsObj;
        } else if (paramsObj.parameters) {
          // 嵌套在 parameters 字段中
          parameters = paramsObj.parameters;
        } else if (paramsObj.properties) {
          // 只有 properties 字段
          parameters = { type: 'object', properties: paramsObj.properties, required: paramsObj.required || [] };
        }
      } catch (e) {
        logger.warn(`[SkillLoader] 解析 parameters 字段失败 for tool ${toolRow.id}:`, e.message);
      }
    }
    
    // 如果 parameters 为空或解析失败，尝试从 description 字段解析参数
    // 格式: - `param` (type, required/optional): description
    if (Object.keys(parameters.properties || {}).length === 0 && toolRow.description) {
      const parsedParams = this.parseParametersFromDescription(toolRow.description);
      if (Object.keys(parsedParams).length > 0) {
        const required = Object.keys(parsedParams).filter(k => parsedParams[k].required);
        parameters = {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(parsedParams).map(([k, v]) => [k, { type: v.type, description: v.description }])
          ),
          required,
        };
        logger.info(`[SkillLoader] 从 description 解析到 ${Object.keys(parsedParams).length} 个参数 for tool ${toolRow.id}`);
      }
    }

    // 使用 skillId_toolName 格式作为工具名称（人类可读且唯一）
    const toolId = toolRow.id;  // 保留数据库 ID 用于内部引用
    const toolFunctionName = `${skill.id}_${toolRow.name}`;  // 如 "compression_zip"

    return {
      type: 'function',
      function: {
        name: toolFunctionName,  // 使用 skillId_toolName 格式，LLM 可读
        description: toolRow.description || '',
        parameters,
      },
      // 保留原始信息用于执行和显示
      _meta: {
        toolId: toolId,              // 工具 ID（skill_tools.id）- 用于数据库查询
        toolFunctionName,            // 完整工具函数名（skillId_toolName）
        skillId: skill.id,           // 所属技能 ID
        skillName: skill.name,       // 技能名称（用于显示）
        toolName: toolRow.name,      // 工具名称（用于执行）
        scriptPath: toolRow.script_path || 'index.js',  // 工具入口脚本路径
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
   * @param {object} context - 执行上下文 (userId, expertId, accessToken等)
   * @param {string} scriptPath - 工具入口脚本路径（相对于技能目录，默认 'index.js'）
   * @returns {Promise<object>} 执行结果
   */
  async executeSkillTool(skillId, toolName, params, context = {}, scriptPath = 'index.js') {
    const startTime = Date.now();
    
    // 1. 准备阶段：获取配置和构建环境变量
    let env;
    try {
      // 从数据库读取该技能的参数和 source_path
      const config = await this.getSkillConfig(skillId);
      const sourcePath = await this.getSkillSourcePath(skillId);
      
      logger.info(`[SkillLoader] 执行技能工具: ${skillId}.${toolName}`, {
        sourcePath,
        scriptPath,
        configKeys: Object.keys(config),
        hasToken: !!context?.accessToken,
      });
      
      // 构建该技能的最小化环境变量（安全隔离）
      env = this.buildSkillEnvironment(skillId, config, sourcePath, scriptPath, context);
    } catch (error) {
      // 捕获 buildSkillEnvironment 的同步错误（如 source_path 缺失）
      logger.error(`[SkillLoader] 构建技能环境失败: ${skillId}.${toolName}`, error.message);
      throw error;
    }
    
    logger.info(`[SkillLoader] 技能环境 DATA_BASE_PATH: ${env.DATA_BASE_PATH}, SCRIPT_PATH: ${env.SCRIPT_PATH}`);

    // 2. 执行阶段：在子进程中运行技能
    return this.executeInSubprocess(skillId, toolName, params, context, env, startTime);
  }

  /**
   * 在子进程中执行技能（内部方法）
   * @param {string} skillId - 技能ID
   * @param {string} toolName - 工具名称
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文
   * @param {object} env - 环境变量
   * @param {number} startTime - 开始时间
   * @returns {Promise<object>} 执行结果
   */
  executeInSubprocess(skillId, toolName, params, context, env, startTime) {
    return new Promise((resolve, reject) => {
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
   * 支持环境变量占位符替换：${ENV_VAR} 格式
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
        // 支持环境变量占位符替换：${ENV_VAR}
        let value = p.param_value;
        if (value && typeof value === 'string') {
          value = value.replace(/\$\{([^}]+)\}/g, (match, envVar) => {
            const envValue = process.env[envVar];
            if (envValue === undefined) {
              logger.warn(`[SkillLoader] 环境变量 ${envVar} 未定义，参数 ${p.param_name}`);
              return match; // 保留原始占位符
            }
            return envValue;
          });
        }
        acc[p.param_name] = value;
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
   * @returns {Promise<string|null>} 源码路径（已规范化为正斜杠）
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

      if (!skill?.source_path) {
        return null;
      }

      // 跨平台兼容：统一使用正斜杠（Windows 注册的技能可能使用反斜杠）
      const normalizedPath = skill.source_path.replace(/\\/g, '/');
      logger.debug(`[SkillLoader] 规范化路径: ${skill.source_path} -> ${normalizedPath}`);

      return normalizedPath;
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
   * @param {string} scriptPath - 工具入口脚本路径（相对于技能目录，默认 'index.js'）
   * @param {object} userContext - 用户上下文（包含 accessToken, userId 等）
   * @returns {object} 环境变量对象
   */
  buildSkillEnvironment(skillId, config, sourcePath = null, scriptPath = 'index.js', userContext = {}) {
    // 最小化系统环境变量白名单（仅保留必要的）
    // 注意：移除 INTERNAL_API_SECRET，技能应使用用户 Token 认证
    // 注意：API_BASE 在下面单独设置，不需要从系统环境变量继承
    const allowedSystemVars = ['PATH', 'NODE_ENV', 'HOME', 'TMPDIR', 'LANG', 'TZ'];
    const systemEnv = Object.fromEntries(
      allowedSystemVars
        .filter(key => process.env[key])
        .map(key => [key, process.env[key]])
    );

    // 系统保留的环境变量名（不可被用户参数覆盖）
    const RESERVED_ENV_VARS = [
      'SKILL_ID', 'DATA_BASE_PATH', 'SKILL_CONFIG', 'NODE_OPTIONS', 'SCRIPT_PATH',
      'USER_ACCESS_TOKEN', 'USER_ID', 'API_BASE',  // 安全关键参数
    ];

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

    // 计算数据基础路径（优先使用环境变量，否则默认为 cwd/data）
    const dataBasePath = process.env.DATA_BASE_PATH
      ? (path.isAbsolute(process.env.DATA_BASE_PATH)
          ? process.env.DATA_BASE_PATH
          : path.join(process.cwd(), process.env.DATA_BASE_PATH))
      : path.join(process.cwd(), 'data');

    // 确定技能路径：技能目录 = dataBasePath + source_path
    // - 绝对路径：直接使用
    // - 相对路径：dataBasePath + source_path
    // - 无 source_path：报错（必须有 source_path）
    if (!sourcePath) {
      throw new Error(`Skill ${skillId} has no source_path configured`);
    }
    
    const skillPath = path.isAbsolute(sourcePath)
      ? sourcePath
      : path.join(dataBasePath, sourcePath);

    return {
      ...systemEnv,               // 1. 最小化系统变量
      SKILL_ID: skillId,          // 2. 当前技能ID
      SKILL_PATH: skillPath,      // 3. 技能目录路径（解决 source_path 不匹配问题）
      SCRIPT_PATH: scriptPath,    // 4. 工具入口脚本路径（相对于技能目录）
      DATA_BASE_PATH: dataBasePath,  // 5. 数据基础路径（技能目录为 DATA_BASE_PATH/skills）
      SKILL_CONFIG: JSON.stringify(config),  // 6. 完整配置JSON
      // 用户认证信息（用于 API 调用）
      USER_ACCESS_TOKEN: userContext.accessToken || '',  // 7. 用户 JWT Token
      USER_ID: String(userContext.userId || ''),         // 8. 用户 ID
      API_BASE: process.env.API_BASE || 'http://localhost:3000',  // 9. API 基础地址
      ...configEnv,               // 10. 展开的配置环境变量
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
