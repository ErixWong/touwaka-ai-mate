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

    const skills = [];
    for (const row of skillRows) {
      try {
        const skill = await this.loadSkill(row);
        if (skill) {
          skills.push(skill);
          logger.debug(`[SkillLoader] 技能加载成功: ${skill.id}`);
        }
      } catch (error) {
        logger.error(`[SkillLoader] 加载技能 ${row.id} 失败:`, error.message);
      }
    }

    logger.info(`[SkillLoader] 专家 ${expertId} 加载了 ${skills.length} 个技能`);
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

    let skill;
    if (skillRow.source_type === 'filesystem') {
      skill = this.loadSkillFromFilesystem(skillRow);
    } else {
      skill = this.loadSkillFromDatabase(skillRow);
    }

    // 缓存技能
    this.skillCache.set(cacheKey, skill);

    return skill;
  }

  /**
   * 从文件系统加载技能（Docker 共享卷模式）
   * @param {object} skillRow - 技能数据库记录
   * @returns {object} 技能实例
   */
  loadSkillFromFilesystem(skillRow) {
    const skillPath = skillRow.source_path || path.join(this.skillsBasePath, skillRow.id);

    // 检查路径是否存在
    if (!fs.existsSync(skillPath)) {
      throw new Error(`Skill path not found: ${skillPath}`);
    }

    // 读取 skill.md
    const skillMdPath = path.join(skillPath, 'skill.md');
    if (!fs.existsSync(skillMdPath)) {
      throw new Error(`skill.md not found in ${skillPath}`);
    }
    const skillMd = fs.readFileSync(skillMdPath, 'utf-8');

    // 读取 index.js (仅用于提取工具定义，不执行)
    const indexJsPath = path.join(skillPath, 'index.js');
    if (!fs.existsSync(indexJsPath)) {
      throw new Error(`index.js not found in ${skillPath}`);
    }

    // 合并专家级别的配置
    const expertConfig = this.parseExpertConfig(skillRow.expert_config);

    return {
      id: skillRow.id,
      name: skillRow.name,
      description: skillRow.description,
      skillMd: skillMd,
      config: { ...this.parseJson(skillRow.config), ...expertConfig },
      // 注意：execute 方法不再直接执行，而是通过 executeSkillTool 在子进程中执行
      sourcePath: skillPath,
    };
  }

  /**
   * 从数据库加载技能（单实例模式）
   * @param {object} skillRow - 技能数据库记录
   * @returns {object} 技能实例
   */
  loadSkillFromDatabase(skillRow) {
    // 从数据库字段读取
    const skillMd = skillRow.skill_md;
    const indexJs = skillRow.index_js;

    if (!skillMd) {
      throw new Error(`skill_md is empty for skill: ${skillRow.id}`);
    }
    if (!indexJs) {
      throw new Error(`index_js is empty for skill: ${skillRow.id}`);
    }

    // 合并专家级别的配置
    const expertConfig = this.parseExpertConfig(skillRow.expert_config);

    return {
      id: skillRow.id,
      name: skillRow.name,
      description: skillRow.description,
      skillMd: skillMd,
      config: { ...this.parseJson(skillRow.config), ...expertConfig },
      // 数据库模式需要临时保存代码到文件系统供子进程执行
      indexJs: indexJs,
    };
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
      
      // 从数据库读取该技能的参数
      const config = await this.getSkillConfig(skillId);
      
      // 构建该技能的最小化环境变量（安全隔离）
      const env = this.buildSkillEnvironment(skillId, config);

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

        if (code !== 0) {
          reject(new Error(`Skill ${skillId} exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          logger.info(`[SkillLoader] 技能执行完成: ${skillId}.${toolName} (${duration}ms)`);
          
          if (result.success) {
            resolve(result.data);
          } else {
            reject(new Error(result.error || 'Skill execution failed'));
          }
        } catch (error) {
          reject(new Error(`Failed to parse skill output: ${error.message}`));
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
   * 构建技能的最小化环境变量
   * 安全原则：只暴露该技能需要的配置，不暴露其他技能或系统环境变量
   *
   * @param {string} skillId - 技能ID
   * @param {object} config - 技能配置对象
   * @returns {object} 环境变量对象
   */
  buildSkillEnvironment(skillId, config) {
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

    return {
      ...systemEnv,               // 1. 最小化系统变量
      SKILL_ID: skillId,          // 2. 当前技能ID
      SKILL_PATH: path.join(this.skillsBasePath, skillId),
      SKILL_CONFIG: JSON.stringify(config),  // 3. 完整配置JSON
      ...configEnv,               // 4. 展开的配置环境变量
      NODE_OPTIONS: `--max-old-space-size=${SKILL_MEMORY_LIMIT}`,
    };
  }

  /**
   * 从 skill.md 解析工具定义
   * @param {object} skill - 技能实例
   * @returns {Array} OpenAI 格式的工具定义数组
   */
  getToolDefinitions(skill) {
    if (!skill.skillMd) {
      return [];
    }

    try {
      // 从 skill.md 解析工具定义
      // 格式: ## Tools 或 ## 工具 部分
      const tools = this.parseToolsFromMarkdown(skill.skillMd, skill.id);
      return tools;
    } catch (error) {
      logger.error(`[SkillLoader] 解析技能 ${skill.id} 的工具定义失败:`, error.message);
      return [];
    }
  }

  /**
   * 从 Markdown 解析工具定义
   * @param {string} markdown - skill.md 内容
   * @param {string} skillId - 技能ID（用于命名空间）
   * @returns {Array} OpenAI 格式的工具定义数组
   */
  parseToolsFromMarkdown(markdown, skillId) {
    const tools = [];
    
    // 查找工具部分（支持 ## Tools 或 ## 工具）
    const toolSectionMatch = markdown.match(/##\s+(Tools|工具)\s*\n([\s\S]*?)(?=##|$)/i);
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
      
      tools.push({
        type: 'function',
        function: {
          name: `${skillId}_${toolName}`,  // 命名空间避免冲突
          description: this.extractFirstSentence(toolDesc),
          parameters: {
            type: 'object',
            properties: parameters,
            required: Object.keys(parameters).filter(k => parameters[k].required),
          },
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
        const skillMdPath = path.join(skillPath, 'skill.md');
        const indexJsPath = path.join(skillPath, 'index.js');

        if (fs.existsSync(skillMdPath) && fs.existsSync(indexJsPath)) {
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
