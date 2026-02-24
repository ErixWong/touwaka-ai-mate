/**
 * Skill Controller - 技能控制器
 * 
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 * 
 * 使用 Sequelize ORM 进行数据库操作
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import fs from 'fs/promises';
import fsOriginal from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import AdmZip from 'adm-zip';
import SkillAnalyzer from '../../lib/skill-analyzer.js';

class SkillController {
  constructor(db) {
    this.db = db;
    this.Skill = db.getModel('skill');
    this.SkillTool = db.getModel('skill_tool');
    this.SkillParameter = db.getModel('skill_parameter');
    this.skillAnalyzer = new SkillAnalyzer();
  }

  /**
   * 获取技能列表
   */
  async list(ctx) {
    try {
      const { is_active } = ctx.query;

      const where = {};
      if (is_active !== undefined) {
        where.is_active = is_active === 'true';
      }

      const skills = await this.Skill.findAll({
        where,
        attributes: [
          'id', 'name', 'description', 'version', 'author', 'tags',
          'source_type', 'source_path', 'source_url',
          'security_score', 'security_warnings',
          'is_active', 'created_at', 'updated_at'
        ],
        order: [['created_at', 'DESC']],
        raw: true,
      });

      // 获取每个技能的工具数量
      const skillIds = skills.map(s => s.id);
      const toolCounts = await this.SkillTool.findAll({
        attributes: [
          'skill_id',
          [this.db.sequelize.fn('COUNT', this.db.sequelize.col('id')), 'count']
        ],
        where: { skill_id: skillIds },
        group: ['skill_id'],
        raw: true,
      });

      const toolCountMap = {};
      toolCounts.forEach(t => {
        toolCountMap[t.skill_id] = parseInt(t.count);
      });

      const formattedSkills = skills.map(s => {
        // 安全解析 JSON 字段
        let tags = [];
        try {
          tags = s.tags ? (typeof s.tags === 'string' ? JSON.parse(s.tags) : s.tags) : [];
        } catch (e) {
          logger.warn(`Failed to parse tags for skill ${s.id}:`, e.message);
        }
        
        let securityWarnings = [];
        try {
          securityWarnings = s.security_warnings
            ? (typeof s.security_warnings === 'string' ? JSON.parse(s.security_warnings) : s.security_warnings)
            : [];
        } catch (e) {
          logger.warn(`Failed to parse security_warnings for skill ${s.id}:`, e.message);
        }
        
        return {
          ...s,
          is_active: !!s.is_active,
          tags,
          security_warnings: securityWarnings,
          tool_count: toolCountMap[s.id] || 0,
        };
      });

      ctx.success({ skills: formattedSkills });
    } catch (error) {
      logger.error('Get skills error:', error.message, error.stack);
      ctx.error('获取技能列表失败: ' + error.message, 500);
    }
  }

  /**
   * 获取技能详情（含工具清单）
   */
  async get(ctx) {
    try {
      const { id } = ctx.params;

      const skill = await this.Skill.findOne({
        where: { id },
        raw: true,
      });

      if (!skill) {
        ctx.error('技能不存在', 404);
        return;
      }

      // 获取工具清单
      const tools = await this.SkillTool.findAll({
        where: { skill_id: id },
        raw: true,
      });

      // 安全解析 JSON 字段
      let tags = [];
      try {
        tags = skill.tags ? (typeof skill.tags === 'string' ? JSON.parse(skill.tags) : skill.tags) : [];
      } catch (e) {
        logger.warn(`Failed to parse tags for skill ${skill.id}:`, e.message);
      }
      
      let securityWarnings = [];
      try {
        securityWarnings = skill.security_warnings
          ? (typeof skill.security_warnings === 'string' ? JSON.parse(skill.security_warnings) : skill.security_warnings)
          : [];
      } catch (e) {
        logger.warn(`Failed to parse security_warnings for skill ${skill.id}:`, e.message);
      }
      
      ctx.success({
        skill: {
          ...skill,
          is_active: !!skill.is_active,
          tags,
          security_warnings: securityWarnings,
          tools: tools.map(t => ({
            ...t,
            type: t.type || 'http',
          })),
        }
      });
    } catch (error) {
      logger.error('Get skill error:', error);
      ctx.error('获取技能详情失败', 500);
    }
  }

  /**
   * 从 URL 安装技能
   * 支持：
   * - GitHub 仓库 ZIP 下载（https://github.com/user/repo/archive/refs/heads/main.zip）
   * - GitHub Release 附件
   * - 直接的 ZIP 文件 URL
   */
  async installFromUrl(ctx) {
    let transaction = null;
    let tempDir = null;
    
    try {
      const { url } = ctx.request.body;

      if (!url) {
        ctx.error('URL 不能为空', 400);
        return;
      }

      // 验证 URL 格式
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch {
        ctx.error('URL 格式无效', 400);
        return;
      }

      // 只允许 http/https 协议
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        ctx.error('只支持 HTTP/HTTPS 协议', 400);
        return;
      }

      logger.info(`[SkillController] 开始从 URL 下载技能: ${url}`);

      // 创建临时目录
      tempDir = path.join(process.cwd(), 'temp', `skill_url_${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      // 下载文件
      const zipPath = path.join(tempDir, 'downloaded.zip');
      await this.downloadFile(url, zipPath);

      // 检查文件大小（限制 50MB）
      const stats = await fs.stat(zipPath);
      if (stats.size > 50 * 1024 * 1024) {
        throw new Error('文件大小超过限制（50MB）');
      }

      logger.info(`[SkillController] 文件下载完成，大小: ${stats.size} bytes`);

      // 解压 ZIP
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tempDir, true);

      // 查找 SKILL.md
      const skillMdPath = await this.findSkillMd(tempDir);
      if (!skillMdPath) {
        throw new Error('ZIP 文件中未找到 SKILL.md');
      }

      const tempSkillDir = path.dirname(skillMdPath);
      const skillMd = await fs.readFile(skillMdPath, 'utf-8');

      // 使用 AI 分析技能
      const skillData = await this.analyzeSkill(tempSkillDir, skillMd);

      // 生成 ID（如果 SKILL.md 中没有指定）
      const id = skillData.id || Utils.newID(20);

      // 创建永久存储目录
      const permanentDir = path.join(process.cwd(), 'data', 'skills', 'installed', id);
      
      // 复制技能文件到永久目录
      await fs.mkdir(permanentDir, { recursive: true });
      await this.copyDirectory(tempSkillDir, permanentDir);

      // 开始事务
      transaction = await this.db.sequelize.transaction();

      // 检查是否已存在
      const existing = await this.Skill.findOne({ where: { id }, transaction });
      if (existing) {
        // 更新现有技能
        await this.Skill.update({
          name: skillData.name,
          description: skillData.description,
          version: skillData.version,
          author: skillData.author,
          tags: skillData.tags ? JSON.stringify(skillData.tags) : null,
          skill_md: skillMd,
          source_type: 'url',
          source_path: permanentDir,
          source_url: url,
          security_score: skillData.security_score || 100,
          security_warnings: skillData.security_warnings ? JSON.stringify(skillData.security_warnings) : null,
          updated_at: new Date(),
        }, { where: { id }, transaction });

        // 删除旧工具
        await this.SkillTool.destroy({ where: { skill_id: id }, transaction });
      } else {
        // 创建新技能
        await this.Skill.create({
          id,
          name: skillData.name,
          description: skillData.description,
          version: skillData.version,
          author: skillData.author,
          tags: skillData.tags ? JSON.stringify(skillData.tags) : null,
          skill_md: skillMd,
          source_type: 'url',
          source_path: permanentDir,
          source_url: url,
          security_score: skillData.security_score || 100,
          security_warnings: skillData.security_warnings ? JSON.stringify(skillData.security_warnings) : null,
          is_active: true,
        }, { transaction });
      }

      // 创建工具清单
      if (skillData.tools && skillData.tools.length > 0) {
        for (const tool of skillData.tools) {
          await this.SkillTool.create({
            id: Utils.newID(32),
            skill_id: id,
            name: tool.name,
            description: tool.description,
            type: tool.type || 'http',
            usage: tool.usage,
            endpoint: tool.endpoint,
            method: tool.method,
          }, { transaction });
        }
      }

      // 提交事务
      await transaction.commit();
      transaction = null;

      // 获取完整技能信息
      const skill = await this.Skill.findOne({ where: { id } });
      const tools = await this.SkillTool.findAll({ where: { skill_id: id } });

      logger.info(`[SkillController] 技能安装成功: ${id} - ${skillData.name}`);

      ctx.success({
        skill: {
          ...skill.get({ plain: true }),
          tools: tools.map(t => t.get({ plain: true })),
        }
      }, '技能安装成功');
    } catch (error) {
      // 回滚事务
      if (transaction) {
        await transaction.rollback().catch(() => {});
      }
      logger.error('[SkillController] Install skill from URL error:', error);
      ctx.error('从 URL 安装失败: ' + error.message, 500);
    } finally {
      // 清理临时目录
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /**
   * 下载文件
   * @param {string} url - 文件 URL
   * @param {string} destPath - 目标路径
   */
  async downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const request = httpModule.get(url, {
        headers: {
          'User-Agent': 'TouwakaMate/2.0',
          'Accept': '*/*',
        },
        timeout: 60000, // 60 秒超时
      }, (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307 || response.statusCode === 308) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            logger.info(`[SkillController] 重定向到: ${redirectUrl}`);
            this.downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`下载失败: HTTP ${response.statusCode}`));
          return;
        }

        const writeStream = fsOriginal.createWriteStream(destPath);
        response.pipe(writeStream);

        writeStream.on('finish', () => {
          writeStream.close();
          resolve();
        });

        writeStream.on('error', (err) => {
          fs.unlink(destPath).catch(() => {});
          reject(err);
        });
      });

      request.on('error', (err) => {
        reject(new Error(`下载失败: ${err.message}`));
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('下载超时'));
      });
    });
  }

  /**
   * 从 ZIP 文件安装技能
   */
  async installFromZip(ctx) {
    let transaction = null;
    try {
      const file = ctx.request.files?.file;
      
      if (!file) {
        ctx.error('请上传 ZIP 文件', 400);
        return;
      }

      // 创建临时目录
      const tempDir = path.join(process.cwd(), 'temp', `skill_${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      try {
        // 解压 ZIP
        const zip = new AdmZip(file.filepath || file.path);
        zip.extractAllTo(tempDir, true);

        // 查找 SKILL.md
        const skillMdPath = await this.findSkillMd(tempDir);
        if (!skillMdPath) {
          throw new Error('ZIP 文件中未找到 SKILL.md');
        }

        const tempSkillDir = path.dirname(skillMdPath);
        const skillMd = await fs.readFile(skillMdPath, 'utf-8');

        // 使用 AI 分析技能
        const skillData = await this.analyzeSkill(tempSkillDir, skillMd);

        // 生成 ID（如果 SKILL.md 中没有指定）
        const id = skillData.id || Utils.newID(20);

        // 创建永久存储目录
        const permanentDir = path.join(process.cwd(), 'data', 'skills', 'installed', id);
        
        // 复制技能文件到永久目录
        await fs.mkdir(permanentDir, { recursive: true });
        await this.copyDirectory(tempSkillDir, permanentDir);

        // 开始事务
        transaction = await this.db.sequelize.transaction();

        // 检查是否已存在
        const existing = await this.Skill.findOne({ where: { id }, transaction });
        if (existing) {
          // 更新现有技能
          await this.Skill.update({
            name: skillData.name,
            description: skillData.description,
            version: skillData.version,
            author: skillData.author,
            tags: skillData.tags ? JSON.stringify(skillData.tags) : null,
            skill_md: skillMd,
            source_type: 'zip',
            source_path: permanentDir,
            security_score: skillData.security_score || 100,
            security_warnings: skillData.security_warnings ? JSON.stringify(skillData.security_warnings) : null,
            updated_at: new Date(),
          }, { where: { id }, transaction });

          // 删除旧工具
          await this.SkillTool.destroy({ where: { skill_id: id }, transaction });
        } else {
          // 创建新技能
          await this.Skill.create({
            id,
            name: skillData.name,
            description: skillData.description,
            version: skillData.version,
            author: skillData.author,
            tags: skillData.tags ? JSON.stringify(skillData.tags) : null,
            skill_md: skillMd,
            source_type: 'zip',
            source_path: permanentDir,
            security_score: skillData.security_score || 100,
            security_warnings: skillData.security_warnings ? JSON.stringify(skillData.security_warnings) : null,
            is_active: true,
          }, { transaction });
        }

        // 创建工具清单
        if (skillData.tools && skillData.tools.length > 0) {
          for (const tool of skillData.tools) {
            await this.SkillTool.create({
              id: Utils.newID(32),
              skill_id: id,
              name: tool.name,
              description: tool.description,
              type: tool.type || 'http',
              usage: tool.usage,
              endpoint: tool.endpoint,
              method: tool.method,
            }, { transaction });
          }
        }

        // 提交事务
        await transaction.commit();
        transaction = null;

        // 获取完整技能信息
        const skill = await this.Skill.findOne({ where: { id } });
        const tools = await this.SkillTool.findAll({ where: { skill_id: id } });

        ctx.success({
          skill: {
            ...skill.get({ plain: true }),
            tools: tools.map(t => t.get({ plain: true })),
          }
        }, '技能安装成功');
      } finally {
        // 清理临时目录
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    } catch (error) {
      // 回滚事务
      if (transaction) {
        await transaction.rollback().catch(() => {});
      }
      logger.error('Install skill from ZIP error:', error);
      ctx.error('从 ZIP 安装失败: ' + error.message, 500);
    }
  }

  /**
   * 从本地目录安装技能
   */
  async installFromPath(ctx) {
    let transaction = null;
    try {
      const { path: skillPath } = ctx.request.body;

      if (!skillPath) {
        ctx.error('路径不能为空', 400);
        return;
      }

      // 检查路径是否存在
      try {
        await fs.access(skillPath);
      } catch {
        ctx.error('指定的路径不存在', 400);
        return;
      }

      // 查找 SKILL.md
      const skillMdPath = await this.findSkillMd(skillPath);
      if (!skillMdPath) {
        ctx.error('目录中未找到 SKILL.md 文件', 400);
        return;
      }

      const skillMd = await fs.readFile(skillMdPath, 'utf-8');

      // 使用 AI 分析技能
      const skillDir = path.dirname(skillMdPath);
      const skillData = await this.analyzeSkill(skillDir, skillMd);

      // 生成 ID（如果 SKILL.md 中没有指定）
      const id = skillData.id || Utils.newID(20);

      // 开始事务
      transaction = await this.db.sequelize.transaction();

      // 检查是否已存在
      const existing = await this.Skill.findOne({ where: { id }, transaction });
      if (existing) {
        // 更新现有技能
        await this.Skill.update({
          name: skillData.name,
          description: skillData.description,
          version: skillData.version,
          author: skillData.author,
          tags: skillData.tags ? JSON.stringify(skillData.tags) : null,
          skill_md: skillMd,
          source_type: 'local',
          source_path: skillPath,
          security_score: skillData.security_score || 100,
          security_warnings: skillData.security_warnings ? JSON.stringify(skillData.security_warnings) : null,
          updated_at: new Date(),
        }, { where: { id }, transaction });

        // 删除旧工具
        await this.SkillTool.destroy({ where: { skill_id: id }, transaction });
      } else {
        // 创建新技能
        await this.Skill.create({
          id,
          name: skillData.name,
          description: skillData.description,
          version: skillData.version,
          author: skillData.author,
          tags: skillData.tags ? JSON.stringify(skillData.tags) : null,
          skill_md: skillMd,
          source_type: 'local',
          source_path: skillPath,
          security_score: skillData.security_score || 100,
          security_warnings: skillData.security_warnings ? JSON.stringify(skillData.security_warnings) : null,
          is_active: true,
        }, { transaction });
      }

      // 创建工具清单
      if (skillData.tools && skillData.tools.length > 0) {
        for (const tool of skillData.tools) {
          await this.SkillTool.create({
            id: Utils.newID(32),
            skill_id: id,
            name: tool.name,
            description: tool.description,
            type: tool.type || 'http',
            usage: tool.usage,
            endpoint: tool.endpoint,
            method: tool.method,
          }, { transaction });
        }
      }

      // 提交事务
      await transaction.commit();
      transaction = null;

      // 获取完整技能信息
      const skill = await this.Skill.findOne({ where: { id } });
      const tools = await this.SkillTool.findAll({ where: { skill_id: id } });

      ctx.success({
        skill: {
          ...skill.get({ plain: true }),
          tools: tools.map(t => t.get({ plain: true })),
        }
      }, '技能安装成功');
    } catch (error) {
      // 回滚事务
      if (transaction) {
        await transaction.rollback().catch(() => {});
      }
      logger.error('Install skill from path error:', error);
      ctx.error('从本地目录安装失败: ' + error.message, 500);
    }
  }

  /**
   * 更新技能
   */
  async update(ctx) {
    try {
      const { id } = ctx.params;
      const { name, description, is_active, config } = ctx.request.body;

      // 检查技能是否存在
      const existing = await this.Skill.findOne({ where: { id } });
      if (!existing) {
        ctx.error('技能不存在', 404);
        return;
      }

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;
      if (config !== undefined) updates.config = typeof config === 'string' ? config : JSON.stringify(config);

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段', 400);
        return;
      }

      await this.Skill.update(updates, { where: { id } });

      ctx.success({ id }, '技能更新成功');
    } catch (error) {
      logger.error('Update skill error:', error);
      ctx.error('更新技能失败: ' + error.message, 500);
    }
  }

  /**
   * 删除技能
   */
  async delete(ctx) {
    try {
      const { id } = ctx.params;

      // 检查技能是否存在
      const existing = await this.Skill.findOne({ where: { id } });
      if (!existing) {
        ctx.error('技能不存在', 404);
        return;
      }

      // 删除关联的工具
      await this.SkillTool.destroy({ where: { skill_id: id } });
      
      // 删除关联的参数
      await this.SkillParameter.destroy({ where: { skill_id: id } });
      
      // 删除技能
      await this.Skill.destroy({ where: { id } });

      ctx.success({ id }, '技能删除成功');
    } catch (error) {
      logger.error('Delete skill error:', error);
      ctx.error('删除技能失败: ' + error.message, 500);
    }
  }

  /**
   * 重新分析技能
   */
  async reanalyze(ctx) {
    try {
      const { id } = ctx.params;

      // 检查技能是否存在
      const skill = await this.Skill.findOne({ where: { id } });
      if (!skill) {
        ctx.error('技能不存在', 404);
        return;
      }

      if (!skill.skill_md) {
        ctx.error('技能没有 SKILL.md 内容', 400);
        return;
      }

      // 使用 AI 重新分析技能
      const skillDir = skill.source_path || path.dirname(skill.skill_md);
      const skillData = await this.analyzeSkill(skillDir, skill.skill_md);

      // 更新技能
      await this.Skill.update({
        name: skillData.name,
        description: skillData.description,
        version: skillData.version,
        author: skillData.author,
        tags: skillData.tags ? JSON.stringify(skillData.tags) : null,
        security_score: skillData.security_score || 100,
        security_warnings: skillData.security_warnings ? JSON.stringify(skillData.security_warnings) : null,
        updated_at: new Date(),
      }, { where: { id } });

      // 删除旧工具
      await this.SkillTool.destroy({ where: { skill_id: id } });

      // 创建新工具清单
      if (skillData.tools && skillData.tools.length > 0) {
        for (const tool of skillData.tools) {
          await this.SkillTool.create({
            id: Utils.newID(32),
            skill_id: id,
            name: tool.name,
            description: tool.description,
            type: tool.type || 'http',
            usage: tool.usage,
            endpoint: tool.endpoint,
            method: tool.method,
          });
        }
      }

      // 获取更新后的技能
      const updatedSkill = await this.Skill.findOne({ where: { id } });
      const tools = await this.SkillTool.findAll({ where: { skill_id: id } });

      ctx.success({
        skill: {
          ...updatedSkill.get({ plain: true }),
          tools: tools.map(t => t.get({ plain: true })),
        }
      }, '技能重新分析成功');
    } catch (error) {
      logger.error('Reanalyze skill error:', error);
      ctx.error('重新分析技能失败: ' + error.message, 500);
    }
  }

  /**
   * 查找 SKILL.md 文件
   */
  async findSkillMd(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    // 先检查当前目录
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
        return path.join(dir, entry.name);
      }
    }

    // 递归检查子目录（只检查一级）
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(dir, entry.name);
        const subEntries = await fs.readdir(subDir, { withFileTypes: true });
        for (const subEntry of subEntries) {
          if (subEntry.isFile() && subEntry.name.toLowerCase() === 'skill.md') {
            return path.join(subDir, subEntry.name);
          }
        }
      }
    }

    return null;
  }

  /**
   * 分析技能（使用 AI 或基础解析）
   * @param {string} skillDir - 技能目录
   * @param {string} skillMd - SKILL.md 内容
   * @param {Object} options - 选项
   * @param {boolean} options.useAI - 是否使用 AI 分析
   * @returns {Promise<Object>} 分析结果
   */
  async analyzeSkill(skillDir, skillMd, options = {}) {
    const { useAI = true } = options;

    // 读取可选文件
    let indexJs = null;
    let packageJson = null;

    try {
      indexJs = await fs.readFile(path.join(skillDir, 'index.js'), 'utf-8');
    } catch {
      // index.js 不存在
    }

    try {
      packageJson = await fs.readFile(path.join(skillDir, 'package.json'), 'utf-8');
    } catch {
      // package.json 不存在
    }

    // 如果启用 AI 且已配置，使用 AI 分析
    if (useAI && this.skillAnalyzer.isConfigured()) {
      logger.info('[SkillController] 使用 AI 分析技能...');
      try {
        const result = await this.skillAnalyzer.analyzeSkill({
          skillMd,
          indexJs,
          packageJson,
        });
        
        // 如果有 index.js，进行额外的安全检查
        if (indexJs) {
          const securityCheck = this.skillAnalyzer.performSecurityCheck(indexJs);
          result.security_score = Math.min(result.security_score || 100, securityCheck.score);
          result.security_warnings = [...(result.security_warnings || []), ...securityCheck.warnings];
        }
        
        return result;
      } catch (error) {
        logger.warn('[SkillController] AI 分析失败，降级到基础解析:', error.message);
      }
    }

    // 降级到基础解析
    logger.info('[SkillController] 使用基础解析技能...');
    const result = this.skillAnalyzer.basicAnalysis({ skillMd });
    
    // 如果有 index.js，进行安全检查
    if (indexJs) {
      const securityCheck = this.skillAnalyzer.performSecurityCheck(indexJs);
      result.security_score = securityCheck.score;
      result.security_warnings = securityCheck.warnings;
    }
    
    return result;
  }

  /**
   * 递归复制目录
   */
  async copyDirectory(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * 简单解析 SKILL.md
   * TODO: 使用 AI 进行更智能的解析
   */
  parseSkillMd(content) {
    const lines = content.split('\n');
    const skill = {
      name: '',
      description: '',
      version: '',
      author: '',
      tags: [],
      tools: [],
    };

    let currentSection = '';
    let inToolSection = false;
    let currentTool = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // 解析标题
      if (trimmed.startsWith('# ')) {
        skill.name = trimmed.substring(2).trim();
        continue;
      }

      // 解析字段
      if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
        const field = trimmed.slice(2, -2).toLowerCase();
        currentSection = field;
        continue;
      }

      // 解析描述
      if (currentSection === 'description' && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('**')) {
        skill.description += (skill.description ? ' ' : '') + trimmed;
      }

      // 解析版本
      if (trimmed.toLowerCase().startsWith('version:') || trimmed.toLowerCase().startsWith('版本:')) {
        skill.version = trimmed.split(':')[1]?.trim() || '';
      }

      // 解析作者
      if (trimmed.toLowerCase().startsWith('author:') || trimmed.toLowerCase().startsWith('作者:')) {
        skill.author = trimmed.split(':')[1]?.trim() || '';
      }

      // 解析标签
      if (trimmed.toLowerCase().startsWith('tags:') || trimmed.toLowerCase().startsWith('标签:')) {
        const tagsStr = trimmed.split(':')[1]?.trim() || '';
        skill.tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
      }

      // 解析工具部分
      if (trimmed.toLowerCase().includes('## tools') || trimmed.toLowerCase().includes('## 工具')) {
        inToolSection = true;
        continue;
      }

      if (inToolSection) {
        // 新的工具
        if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) {
          if (currentTool) {
            skill.tools.push(currentTool);
          }
          currentTool = {
            name: trimmed.replace(/^#+\s*/, ''),
            description: '',
            type: 'http',
            usage: '',
          };
          continue;
        }

        // 工具属性
        if (currentTool) {
          if (trimmed.toLowerCase().startsWith('type:')) {
            currentTool.type = trimmed.split(':')[1]?.trim() || 'http';
          } else if (trimmed.toLowerCase().startsWith('usage:') || trimmed.toLowerCase().startsWith('用法:')) {
            currentTool.usage = trimmed.split(':').slice(1).join(':').trim();
          } else if (trimmed.toLowerCase().startsWith('endpoint:')) {
            currentTool.endpoint = trimmed.split(':').slice(1).join(':').trim();
          } else if (trimmed.toLowerCase().startsWith('method:')) {
            currentTool.method = trimmed.split(':')[1]?.trim() || 'GET';
          } else if (trimmed && !trimmed.startsWith('#')) {
            currentTool.description += (currentTool.description ? ' ' : '') + trimmed;
          }
        }
      }
    }

    // 添加最后一个工具
    if (currentTool) {
      skill.tools.push(currentTool);
    }

    return skill;
  }

  /**
   * 获取技能参数
   * GET /api/skills/:id/parameters
   */
  async getParameters(ctx) {
    try {
      const { id } = ctx.params;

      // 检查技能是否存在
      const skill = await this.Skill.findOne({ where: { id } });
      if (!skill) {
        ctx.error('技能不存在', 404);
        return;
      }

      const parameters = await this.SkillParameter.findAll({
        where: { skill_id: id },
        order: [['created_at', 'ASC']],
        raw: true,
      });

      ctx.success({
        parameters: parameters.map(p => ({
          id: p.id,
          skill_id: p.skill_id,
          param_name: p.param_name,
          param_value: p.param_value,
          is_secret: !!p.is_secret,
          created_at: p.created_at,
          updated_at: p.updated_at,
        })),
      });
    } catch (error) {
      logger.error('Get skill parameters error:', error);
      ctx.error('获取技能参数失败: ' + error.message, 500);
    }
  }

  /**
   * 保存技能参数（全量替换）
   * POST /api/skills/:id/parameters
   */
  async saveParameters(ctx) {
    let transaction = null;
    try {
      const { id } = ctx.params;
      const { parameters } = ctx.request.body;

      if (!Array.isArray(parameters)) {
        ctx.error('参数格式错误，需要数组', 400);
        return;
      }

      // 检查技能是否存在
      const skill = await this.Skill.findOne({ where: { id } });
      if (!skill) {
        ctx.error('技能不存在', 404);
        return;
      }

      // 验证参数名格式（只允许字母、数字、下划线，不能以数字开头）
      const paramNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      for (const param of parameters) {
        if (param.param_name && !paramNamePattern.test(param.param_name)) {
          ctx.error(`参数名格式无效: ${param.param_name}（只允许字母、数字、下划线，且不能以数字开头）`, 400);
          return;
        }
      }

      // 验证参数名唯一性
      const names = parameters.map(p => p.param_name);
      const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
      if (duplicates.length > 0) {
        ctx.error(`参数名重复: ${duplicates.join(', ')}`, 400);
        return;
      }

      // 开始事务
      transaction = await this.db.sequelize.transaction();

      // 删除旧参数
      await this.SkillParameter.destroy({
        where: { skill_id: id },
        transaction,
      });

      // 创建新参数
      const createdParameters = [];
      for (const param of parameters) {
        if (!param.param_name || param.param_name.trim() === '') {
          continue; // 跳过空参数名
        }

        const newParam = await this.SkillParameter.create({
          id: Utils.newID(32),
          skill_id: id,
          param_name: param.param_name.trim(),
          param_value: param.param_value || '',
          is_secret: param.is_secret ? 1 : 0,
        }, { transaction });

        createdParameters.push(newParam.get({ plain: true }));
      }

      // 提交事务
      await transaction.commit();
      transaction = null;

      ctx.success({
        parameters: createdParameters.map(p => ({
          id: p.id,
          skill_id: p.skill_id,
          param_name: p.param_name,
          param_value: p.param_value,
          is_secret: !!p.is_secret,
        })),
      }, '参数保存成功');
    } catch (error) {
      // 回滚事务
      if (transaction) {
        await transaction.rollback().catch(() => {});
      }
      logger.error('Save skill parameters error:', error);
      ctx.error('保存技能参数失败: ' + error.message, 500);
    }
  }
}

export default SkillController;
