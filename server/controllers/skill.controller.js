/**
 * Skill Controller - 技能控制器
 * 
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 * 
 * 使用 Sequelize ORM 进行数据库操�?
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { parseSkillMd, validateSkillPath } from '../../lib/skill-parser.js';
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
   * 获取技能列�?
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
      ctx.error('获取技能列表失�? ' + error.message, 500);
    }
  }

  /**
   * 获取技能详情（含工具清单和已分配专家）
   */
  async get(ctx) {
    try {
      const { id } = ctx.params;

      // 通过 ID 或名称查找
      let skill = await this.Skill.findOne({
        where: { id },
        raw: true,
      });

      if (!skill) {
        // 尝试按名称查找
        skill = await this.Skill.findOne({
          where: { name: id },
          raw: true,
        });
      }

      if (!skill) {
        ctx.error('技能不存在', 404);
        return;
      }

      // 获取工具清单
      const tools = await this.SkillTool.findAll({
        where: { skill_id: skill.id },
        raw: true,
      });

      // 获取已分配的专家
      const ExpertSkill = this.db.getModel('expert_skill');
      const Expert = this.db.getModel('expert');
      const assigned_experts = await ExpertSkill.findAll({
        where: { skill_id: skill.id },
        include: [{
          model: Expert,
          as: 'expert',
          attributes: ['id', 'name', 'introduction'],
        }],
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
          assigned_experts: assigned_experts.map(e => ({
            id: e['expert.id'] || e.expert_id,
            name: e['expert.name'] || 'Unknown',
            introduction: e['expert.introduction'] || '',
            is_enabled: !!e.is_enabled,
          })),
        }
      });
    } catch (error) {
      logger.error('Get skill error:', error);
      ctx.error('获取技能详情失败', 500);
    }
  }

  /**
   * �?URL 安装技�?
   * 支持�?
   * - GitHub 仓库 URL（https://github.com/user/repo�?
   * - GitHub 目录 URL（https://github.com/user/repo/tree/main/path/to/skill�?
   * - GitHub ZIP 下载（https://github.com/user/repo/archive/refs/heads/main.zip�?
   * - GitHub Release 附件
   * - 直接�?ZIP 文件 URL
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

      // 只允�?http/https 协议
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        ctx.error('只支�?HTTP/HTTPS 协议', 400);
        return;
      }

      logger.info(`[SkillController] 开始从 URL 下载技�? ${url}`);

      // 创建临时目录
      tempDir = path.join(process.cwd(), 'temp', `skill_url_${Date.now()}`);
      logger.info(`[SkillController] 创建临时目录: ${tempDir}`);
      await fs.mkdir(tempDir, { recursive: true });

      // 解析 URL 并获取下载链�?
      const downloadInfo = this.parseGitHubUrl(url);
      let zipPath;
      let skillSubDir = null;

      if (downloadInfo) {
        // GitHub URL
        logger.info(`[SkillController] 检测到 GitHub URL，下载仓�? ${downloadInfo.downloadUrl}`);
        if (downloadInfo.subDir) {
          logger.info(`[SkillController] 技能子目录: ${downloadInfo.subDir}`);
          skillSubDir = downloadInfo.subDir;
        }
        zipPath = path.join(tempDir, 'github.zip');
        logger.info(`[SkillController] 开始下载文件到: ${zipPath}`);
        await this.downloadFile(downloadInfo.downloadUrl, zipPath);
        logger.info(`[SkillController] 文件下载完成`);
      } else {
        // 直接 ZIP URL
        zipPath = path.join(tempDir, 'downloaded.zip');
        logger.info(`[SkillController] 开始下载ZIP: ${zipPath}`);
        await this.downloadFile(url, zipPath);
        logger.info(`[SkillController] 文件下载完成`);
      }

      // 检查文件大小（限制 50MB�?
      const stats = await fs.stat(zipPath);
      if (stats.size > 50 * 1024 * 1024) {
        throw new Error('文件大小超过限制50MB');
      }

      logger.info(`[SkillController] 文件大小: ${stats.size} bytes`);

      // 解压 ZIP
      logger.info(`[SkillController] 开始解压缩ZIP 文件...`);
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tempDir, true);
      logger.info(`[SkillController] ZIP 解压完成`);

      // 列出解压后的文件结构
      await this.logDirectoryStructure(tempDir, '');

      // 查找 SKILL.md
      let skillMdPath;
      if (skillSubDir) {
        // 如果指定了子目录，先尝试在该目录中查�?
        logger.info(`[SkillController] 查找子目录： ${skillSubDir}`);
        const subDirPath = await this.findSubDir(tempDir, skillSubDir);
        if (subDirPath) {
          logger.info(`[SkillController] 找到子目录： ${subDirPath}`);
          skillMdPath = await this.findSkillMd(subDirPath);
        } else {
          logger.warn(`[SkillController] 未找到子目录: ${skillSubDir}`);
        }
      }
      
      // 如果没找到，在整个解压目录中查找
      if (!skillMdPath) {
        logger.info(`[SkillController] 在整个解压目录中查找 SKILL.md...`);
        skillMdPath = await this.findSkillMd(tempDir);
      }
      
      if (!skillMdPath) {
        throw new Error('ZIP 文件中未找到 SKILL.md');
      }

      logger.info(`[SkillController] 找到 SKILL.md: ${skillMdPath}`);
      const tempSkillDir = path.dirname(skillMdPath);
      const skillMd = await fs.readFile(skillMdPath, 'utf-8');

      // 使用 AI 分析技�?
      logger.info(`[SkillController] 开始分析技�?..`);
      const skillData = await this.analyzeSkill(tempSkillDir, skillMd);
      logger.info(`[SkillController] 技能分析完�? ${skillData.name}`);

      // 生成 ID（如�?SKILL.md 中没有指定）
      const id = skillData.id || Utils.newID(20);

      // 创建永久存储目录（使用 DATA_BASE_PATH 环境变量）
      const dataBasePath = process.env.DATA_BASE_PATH
        ? (path.isAbsolute(process.env.DATA_BASE_PATH) 
            ? process.env.DATA_BASE_PATH 
            : path.join(process.cwd(), process.env.DATA_BASE_PATH))
        : path.join(process.cwd(), 'data');
      const permanentDir = path.join(dataBasePath, 'skills', 'installed', id);
      
      // 复制技能文件到永久目录
      await fs.mkdir(permanentDir, { recursive: true });
      await this.copyDirectory(tempSkillDir, permanentDir);

      // 开始事�?
      transaction = await this.db.sequelize.transaction();

      // 检查是否已存在
      const existing = await this.Skill.findOne({ where: { id }, transaction });
      if (existing) {
        // 更新现有技�?
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

        // 删除旧工�?
        await this.SkillTool.destroy({ where: { skill_id: id }, transaction });
      } else {
        // 创建新技�?
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
            parameters: tool.parameters,
            endpoint: tool.endpoint,
            method: tool.method,
          }, { transaction });
        }
      }

      // 提交事务
      await transaction.commit();
      transaction = null;

      // 获取完整技能信�?
      const skill = await this.Skill.findOne({ where: { id } });
      const tools = await this.SkillTool.findAll({ where: { skill_id: id } });

      logger.info(`[SkillController] 技能安装成功 ${id} - ${skillData.name}`);

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
      logger.error('[SkillController] Install skill from URL error:', error.message, error.stack);
      ctx.error('URL 安装失败: ' + error.message, 500);
    } finally {
      // 清理临时目录
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /**
   * 解析 GitHub URL
   * @param {string} url - GitHub URL
   * @returns {Object|null} { downloadUrl, subDir } �?null（非 GitHub URL�?
   */
  parseGitHubUrl(url) {
    try {
      const parsedUrl = new URL(url);
      
      // 只处�?GitHub URL
      if (!['github.com', 'www.github.com'].includes(parsedUrl.hostname)) {
        return null;
      }

      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      
      // 至少需�?user/repo
      if (pathParts.length < 2) {
        return null;
      }

      const owner = pathParts[0];
      const repo = pathParts[1];
      let branch = 'main';
      let subDir = null;

      // 解析不同类型�?GitHub URL
      if (pathParts.length >= 4 && pathParts[2] === 'tree') {
        // https://github.com/user/repo/tree/branch/path/to/skill
        branch = pathParts[3];
        if (pathParts.length > 4) {
          subDir = pathParts.slice(4).join('/');
        }
      } else if (pathParts.length >= 4 && pathParts[2] === 'blob') {
        // https://github.com/user/repo/blob/branch/path/to/file
        // 转换�?tree 并取目录
        branch = pathParts[3];
        if (pathParts.length > 5) {
          subDir = pathParts.slice(4, -1).join('/');
        }
      }

      // 构建 ZIP 下载 URL
      const downloadUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;

      return { downloadUrl, subDir };
    } catch {
      return null;
    }
  }

  /**
   * 在解压目录中查找子目�?
   * GitHub ZIP 解压后通常会有一个根目录�?repo-branch/
   * @param {string} extractDir - 解压目录
   * @param {string} subDirPath - 子目录路径（�?skills/pptx�?
   * @returns {Promise<string|null>} 找到的目录路�?
   */
  async findSubDir(extractDir, subDirPath) {
    const subDirParts = subDirPath.split('/');
    
    // 首先尝试直接路径
    const directPath = path.join(extractDir, subDirPath);
    try {
      const stat = await fs.stat(directPath);
      if (stat.isDirectory()) {
        return directPath;
      }
    } catch {
      // 直接路径不存�?
    }

    // 获取解压目录下的所有子目录（通常�?repo-branch/ 格式�?
    const entries = await fs.readdir(extractDir, { withFileTypes: true });
    const subDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    // 在每个一级子目录中查�?
    for (const dir of subDirs) {
      const candidatePath = path.join(extractDir, dir, subDirPath);
      try {
        const stat = await fs.stat(candidatePath);
        if (stat.isDirectory()) {
          return candidatePath;
        }
      } catch {
        // 不存在，继续查找
      }
    }

    return null;
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
        timeout: 60000, // 60 秒超�?
      }, (response) => {
        // 处理重定�?
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
   * �?ZIP 文件安装技�?
   */
  async installFromZip(ctx) {
    let transaction = null;
    try {
      const file = ctx.request.files?.file;
      
      if (!file) {
        ctx.error('请上�?ZIP 文件', 400);
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

        // 使用 AI 分析技�?
        const skillData = await this.analyzeSkill(tempSkillDir, skillMd);

        // 生成 ID（如�?SKILL.md 中没有指定）
        const id = skillData.id || Utils.newID(20);

        // 创建永久存储目录（使用 DATA_BASE_PATH 环境变量）
        const dataBasePath = process.env.DATA_BASE_PATH
          ? (path.isAbsolute(process.env.DATA_BASE_PATH) 
              ? process.env.DATA_BASE_PATH 
              : path.join(process.cwd(), process.env.DATA_BASE_PATH))
          : path.join(process.cwd(), 'data');
        const permanentDir = path.join(dataBasePath, 'skills', 'installed', id);
        
        // 复制技能文件到永久目录
        await fs.mkdir(permanentDir, { recursive: true });
        await this.copyDirectory(tempSkillDir, permanentDir);

        // 开始事�?
        transaction = await this.db.sequelize.transaction();

        // 检查是否已存在
        const existing = await this.Skill.findOne({ where: { id }, transaction });
        if (existing) {
          // 更新现有技�?
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

          // 删除旧工�?
          await this.SkillTool.destroy({ where: { skill_id: id }, transaction });
        } else {
          // 创建新技�?
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
              parameters: tool.parameters,
              endpoint: tool.endpoint,
              method: tool.method,
            }, { transaction });
          }
        }

        // 提交事务
        await transaction.commit();
        transaction = null;

        // 获取完整技能信�?
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
      ctx.error('ZIP 安装失败: ' + error.message, 500);
    }
  }

  /**
   * 从本地目录安装技�?
   */
  async installFromPath(ctx) {
    let transaction = null;
    try {
      const { path: skillPath } = ctx.request.body;

      if (!skillPath) {
        ctx.error('路径不能为空', 400);
        return;
      }

      // 检查路径是否存�?
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

      // 使用 AI 分析技�?
      const skillDir = path.dirname(skillMdPath);
      const skillData = await this.analyzeSkill(skillDir, skillMd);

      // 生成 ID（如�?SKILL.md 中没有指定）
      const id = skillData.id || Utils.newID(20);

      // 开始事�?
      transaction = await this.db.sequelize.transaction();

      // 检查是否已存在
      const existing = await this.Skill.findOne({ where: { id }, transaction });
      if (existing) {
        // 更新现有技�?
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

        // 删除旧工�?
        await this.SkillTool.destroy({ where: { skill_id: id }, transaction });
      } else {
        // 创建新技�?
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
            parameters: tool.parameters,
            endpoint: tool.endpoint,
            method: tool.method,
          }, { transaction });
        }
      }

      // 提交事务
      await transaction.commit();
      transaction = null;

      // 获取完整技能信�?
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
      ctx.error('从本地目录安装失�? ' + error.message, 500);
    }
  }

  /**
   * 更新技�?
   */
  async update(ctx) {
    try {
      const { id } = ctx.params;
      const { name, description, is_active } = ctx.request.body;

      // 检查技能是否存�?
      const existing = await this.Skill.findOne({ where: { id } });
      if (!existing) {
        ctx.error('技能不存在', 404);
        return;
      }

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段', 400);
        return;
      }

      await this.Skill.update(updates, { where: { id } });

      ctx.success({ id }, '技能更新成功');
    } catch (error) {
      logger.error('Update skill error:', error);
      ctx.error('更新技能失败 ' + error.message, 500);
    }
  }

  /**
   * 删除技能
   */
  async delete(ctx) {
    try {
      const { id } = ctx.params;

      // 检查技能是否存�?
      const existing = await this.Skill.findOne({ where: { id } });
      if (!existing) {
        ctx.error('技能不存在', 404);
        return;
      }

      // 删除关联的工�?
      await this.SkillTool.destroy({ where: { skill_id: id } });
      
      // 删除关联的参�?
      await this.SkillParameter.destroy({ where: { skill_id: id } });
      
      // 删除技�?
      await this.Skill.destroy({ where: { id } });

      ctx.success({ id }, '技能删除成功');
    } catch (error) {
      logger.error('Delete skill error:', error);
      ctx.error('删除技能失败：' + error.message, 500);
    }
  }

  /**
   * 重新分析技�?
   */
  async reanalyze(ctx) {
    try {
      const { id } = ctx.params;

      // 检查技能是否存�?
      const skill = await this.Skill.findOne({ where: { id } });
      if (!skill) {
        ctx.error('技能不存在', 404);
        return;
      }

      if (!skill.skill_md) {
        ctx.error('技能没�?SKILL.md 内容', 400);
        return;
      }

      // 使用 AI 重新分析技�?
      const skillDir = skill.source_path || path.dirname(skill.skill_md);
      const skillData = await this.analyzeSkill(skillDir, skill.skill_md);

      // 更新技�?
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

      // 删除旧工�?
      await this.SkillTool.destroy({ where: { skill_id: id } });

      // 创建新工具清�?
      if (skillData.tools && skillData.tools.length > 0) {
        for (const tool of skillData.tools) {
          await this.SkillTool.create({
            id: Utils.newID(32),
            skill_id: id,
            name: tool.name,
            description: tool.description,
            type: tool.type || 'http',
            parameters: tool.parameters,
            endpoint: tool.endpoint,
            method: tool.method,
          });
        }
      }

      // 获取更新后的技�?
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
      ctx.error('重新分析技能失败 ' + error.message, 500);
    }
  }

  /**
   * 记录目录结构（用于调试）
   */
  async logDirectoryStructure(dir, indent = '') {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries.slice(0, 20)) { // 限制显示�?0�?
        logger.info(`[SkillController] ${indent}${entry.isDirectory() ? '📁' : '📄'} ${entry.name}`);
        if (entry.isDirectory() && indent.length < 4) { // 只递归2�?
          await this.logDirectoryStructure(path.join(dir, entry.name), indent + '  ');
        }
      }
      if (entries.length > 20) {
        logger.info(`[SkillController] ${indent}... 还有 ${entries.length - 20} 个文�?目录`);
      }
    } catch (error) {
      logger.warn(`[SkillController] 无法读取目录 ${dir}: ${error.message}`);
    }
  }

  /**
   * 查找 SKILL.md 文件
   */
  async findSkillMd(dir) {
    logger.info(`[SkillController] findSkillMd: 搜索目录 ${dir}`);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    // 先检查当前目�?
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
        const foundPath = path.join(dir, entry.name);
        logger.info(`[SkillController] findSkillMd: 在当前目录找�?${foundPath}`);
        return foundPath;
      }
    }

    // 递归检查子目录（只检查一级）
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(dir, entry.name);
        try {
          const subEntries = await fs.readdir(subDir, { withFileTypes: true });
          for (const subEntry of subEntries) {
            if (subEntry.isFile() && subEntry.name.toLowerCase() === 'skill.md') {
              const foundPath = path.join(subDir, subEntry.name);
              logger.info(`[SkillController] findSkillMd: 在子目录 ${entry.name} 找到 ${foundPath}`);
              return foundPath;
            }
          }
        } catch (err) {
          logger.warn(`[SkillController] findSkillMd: 无法读取子目�?${subDir}: ${err.message}`);
        }
      }
    }

    logger.warn(`[SkillController] findSkillMd: �?${dir} 及其子目录中未找�?SKILL.md`);
    return null;
  }

  /**
   * 分析技能（使用 AI 或基础解析�?
   * @param {string} skillDir - 技能目�?
   * @param {string} skillMd - SKILL.md 内容
   * @param {Object} options - 选项
   * @param {boolean} options.useAI - 是否使用 AI 分析
   * @returns {Promise<Object>} 分析结果
   */
  async analyzeSkill(skillDir, skillMd, options = {}) {
    const { useAI = true } = options;

    // 读取可选文�?
    let indexJs = null;
    let packageJson = null;

    try {
      indexJs = await fs.readFile(path.join(skillDir, 'index.js'), 'utf-8');
    } catch {
      // index.js 不存�?
    }

    try {
      packageJson = await fs.readFile(path.join(skillDir, 'package.json'), 'utf-8');
    } catch {
      // package.json 不存�?
    }

    // 如果启用 AI 且已配置，使�?AI 分析
    if (useAI && this.skillAnalyzer.isConfigured()) {
      logger.info('[SkillController] 使用 AI 分析技�?..');
      try {
        const result = await this.skillAnalyzer.analyzeSkill({
          skillMd,
          indexJs,
          packageJson,
        });
        
        // 如果�?index.js，进行额外的安全检�?
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
    logger.info('[SkillController] 使用基础解析技�?..');
    const result = this.skillAnalyzer.basicAnalysis({ skillMd });
    
    // 如果�?index.js，进行安全检�?
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
   * 简单解�?SKILL.md
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

      // 解析作�?
      if (trimmed.toLowerCase().startsWith('author:') || trimmed.toLowerCase().startsWith('作�?')) {
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
            parameters: '',
          };
          continue;
        }

        // 工具属�?
        if (currentTool) {
          if (trimmed.toLowerCase().startsWith('type:')) {
            currentTool.type = trimmed.split(':')[1]?.trim() || 'http';
          } else if (trimmed.toLowerCase().startsWith('parameters:') || trimmed.toLowerCase().startsWith('参数:')) {
            currentTool.parameters = trimmed.split(':').slice(1).join(':').trim();
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

    // 添加最后一个工�?
    if (currentTool) {
      skill.tools.push(currentTool);
    }

    return skill;
  }

  /**
   * 获取技能参�?
   * GET /api/skills/:id/parameters
   */
  async getParameters(ctx) {
    try {
      const { id } = ctx.params;

      // 检查技能是否存�?
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
      ctx.error('获取技能参数失�? ' + error.message, 500);
    }
  }

  /**
   * 保存技能参数（全量替换�?
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

      // 检查技能是否存�?
      const skill = await this.Skill.findOne({ where: { id } });
      if (!skill) {
        ctx.error('技能不存在', 404);
        return;
      }

      // 验证参数名格式（只允许字母、数字、下划线，不能以数字开头）
      const paramNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      for (const param of parameters) {
        if (param.param_name && !paramNamePattern.test(param.param_name)) {
          ctx.error(`参数名格式无效 ${param.param_name}（只允许字母、数字、下划线，且不能以数字开头）`, 400);
          return;
        }
      }

      // 验证参数名唯一�?
      const names = parameters.map(p => p.param_name);
      const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
      if (duplicates.length > 0) {
        ctx.error(`参数名重复 ${duplicates.join(', ')}`, 400);
        return;
      }

      // 开始事�?
      transaction = await this.db.sequelize.transaction();

      // 删除旧参�?
      await this.SkillParameter.destroy({
        where: { skill_id: id },
        transaction,
      });

      // 创建新参�?
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
      ctx.error('保存技能参数失�? ' + error.message, 500);
    }
  }

  // ==================== Skills Studio API ====================

  /**
   * 注册技能（从本地路径）
   * POST /api/skills/register
   */
  async register(ctx) {
    try {
      const { source_path, name: provided_name, description: provided_desc, tools: provided_tools } = ctx.request.body;

      logger.info('[SkillController] register() called with:', {
        source_path,
        provided_name,
        provided_desc,
        provided_tools_type: typeof provided_tools,
        provided_tools_is_array: Array.isArray(provided_tools),
        provided_tools_length: provided_tools?.length,
      });

      if (!source_path) {
        ctx.error('source_path is required', 400);
        return;
      }

      // 安全验证：确保路径在允许的目录内
      const PROJECT_ROOT = process.cwd();
      const pathValidation = await validateSkillPath(source_path, PROJECT_ROOT, ['data', 'skills']);
      
      if (!pathValidation.valid) {
        ctx.error(pathValidation.error || 'Invalid skill path', 400);
        return;
      }
      
      const full_path = pathValidation.fullPath;

      // 读取 SKILL.md
      const skill_md_path = path.join(full_path, 'SKILL.md');
      if (!fsOriginal.existsSync(skill_md_path)) {
        ctx.error(`SKILL.md not found in ${source_path}`, 404);
        return;
      }

      const skill_md = fsOriginal.readFileSync(skill_md_path, 'utf-8');
      const skill_info = parseSkillMd(skill_md);
      const skill_name = provided_name || skill_info.name || path.basename(full_path);
      const skill_desc = provided_desc || skill_info.description || '';

      // 检查 index.js 是否存在
      const index_js_path = path.join(full_path, 'index.js');
      if (!fsOriginal.existsSync(index_js_path)) {
        ctx.error(`index.js not found in ${source_path}`, 404);
        return;
      }

      // 检查是否已存在同名技能
      const existing_skill = await this.Skill.findOne({
        where: { name: skill_name },
        raw: true,
      });

      const skill_id = existing_skill?.id || Utils.newID(20);
      const is_update = !!existing_skill;

      // 插入或更新技能
      await this.Skill.upsert({
        id: skill_id,
        name: skill_name,
        description: skill_desc,
        version: skill_info.version || '1.0.0',
        author: skill_info.author || '',
        tags: skill_info.tags ? JSON.stringify(skill_info.tags) : '[]',
        source_type: 'local',
        source_path: full_path,
        skill_md,
        is_active: true,
      });

      // 删除旧的工具定义
      await this.SkillTool.destroy({ where: { skill_id } });

      // 使用传入的 tools 参数，如果没有则尝试从 index.js 加载
      let tools_to_register = provided_tools;
      
      logger.info('[SkillController] tools_to_register initial:', {
        type: typeof tools_to_register,
        isArray: Array.isArray(tools_to_register),
        length: tools_to_register?.length,
      });
      
      if (!tools_to_register || (Array.isArray(tools_to_register) && tools_to_register.length === 0)) {
        // 尝试加载 index.js 获取工具定义
        logger.info('[SkillController] No tools provided, trying to load from index.js');
        try {
          const index_module = await import(index_js_path + '?t=' + Date.now());
          const skill_module = index_module.default || index_module;

          if (skill_module.getTools && typeof skill_module.getTools === 'function') {
            tools_to_register = skill_module.getTools();
            logger.info('[SkillController] Loaded tools from index.js:', tools_to_register?.length);
          }
        } catch (err) {
          logger.warn(`Could not parse tools from ${source_path}:`, err.message);
        }
      }

      // 插入工具定义
      let registered_tools = 0;
      if (tools_to_register && Array.isArray(tools_to_register)) {
        logger.info('[SkillController] Processing tools:', tools_to_register.length);
        for (const tool of tools_to_register) {
          const tool_name = tool.function?.name || tool.name;
          const tool_desc = tool.function?.description || tool.description;
          const tool_params = tool.function?.parameters || tool.parameters;
          const tool_script_path = tool.script_path || 'index.js';

          logger.info('[SkillController] Processing tool:', {
            tool_name,
            tool_desc: tool_desc?.substring(0, 50),
            tool_script_path,
          });

          if (!tool_name) {
            logger.warn(`Skipping tool without name:`, tool);
            continue;
          }

          await this.SkillTool.create({
            id: Utils.newID(20),
            skill_id,
            name: tool_name,
            description: tool_desc || '',
            type: 'http',
            parameters: tool_params ? JSON.stringify(tool_params) : '{}',
            script_path: tool_script_path,
          });
          registered_tools++;
        }
      } else {
        logger.warn('[SkillController] No tools to register:', {
          tools_to_register,
          isArray: Array.isArray(tools_to_register),
        });
      }

      logger.info('[SkillController] Registered tools count:', registered_tools);

      ctx.success({
        skill_id,
        name: skill_name,
        action: is_update ? 'updated' : 'created',
        tools_registered: registered_tools,
        message: `Skill "${skill_name}" ${is_update ? 'updated' : 'registered'} with ${registered_tools} tools`,
      });
    } catch (error) {
      logger.error('Register skill error:', error);
      ctx.error('注册技能失败: ' + error.message, 500);
    }
  }

  /**
   * 分配技能给专家
   * POST /api/skills/assign
   */
  async assign(ctx) {
    try {
      const { skill_id, expert_id } = ctx.request.body;

      if (!skill_id || !expert_id) {
        ctx.error('skill_id and expert_id are required', 400);
        return;
      }

      // 查找技能
      const skill = await this.Skill.findOne({
        where: { id: skill_id },
        raw: true,
      });
      if (!skill) {
        // 尝试按名称查找
        const skill_by_name = await this.Skill.findOne({
          where: { name: skill_id },
          raw: true,
        });
        if (!skill_by_name) {
          ctx.error(`Skill not found: ${skill_id}`, 404);
          return;
        }
      }
      const actual_skill_id = skill?.id || skill_id;

      // 查找专家
      const Expert = this.db.getModel('expert');
      const expert = await Expert.findOne({
        where: { id: expert_id },
        raw: true,
      });
      if (!expert) {
        // 尝试按名称查找
        const expert_by_name = await Expert.findOne({
          where: { name: expert_id },
          raw: true,
        });
        if (!expert_by_name) {
          ctx.error(`Expert not found: ${expert_id}`, 404);
          return;
        }
      }
      const actual_expert_id = expert?.id || expert_id;

      // 检查是否已关联
      const ExpertSkill = this.db.getModel('expert_skill');
      const existing = await ExpertSkill.findOne({
        where: { expert_id: actual_expert_id, skill_id: actual_skill_id },
        raw: true,
      });

      if (existing) {
        // 更新为启用状态
        await ExpertSkill.update(
          { is_enabled: true },
          { where: { id: existing.id } }
        );
        ctx.success({ message: 'Skill already assigned, enabled now' });
        return;
      }

      // 创建关联
      await ExpertSkill.create({
        id: Utils.newID(20),
        expert_id: actual_expert_id,
        skill_id: actual_skill_id,
        is_enabled: true,
      });

      ctx.success({ message: 'Skill assigned to expert successfully' });
    } catch (error) {
      logger.error('Assign skill error:', error);
      ctx.error('分配技能失败: ' + error.message, 500);
    }
  }

  /**
   * 取消技能分配
   * POST /api/skills/unassign
   */
  async unassign(ctx) {
    try {
      const { skill_id, expert_id } = ctx.request.body;

      if (!skill_id || !expert_id) {
        ctx.error('skill_id and expert_id are required', 400);
        return;
      }

      // 查找技能
      const skill = await this.Skill.findOne({
        where: { id: skill_id },
        raw: true,
      });
      const actual_skill_id = skill?.id || skill_id;

      // 查找专家
      const Expert = this.db.getModel('expert');
      const expert = await Expert.findOne({
        where: { id: expert_id },
        raw: true,
      });
      const actual_expert_id = expert?.id || expert_id;

      // 删除关联
      const ExpertSkill = this.db.getModel('expert_skill');
      const result = await ExpertSkill.destroy({
        where: {
          expert_id: actual_expert_id,
          skill_id: actual_skill_id,
        },
      });

      if (result === 0) {
        ctx.error('Skill was not assigned to this expert', 404);
        return;
      }

      ctx.success({ message: 'Skill unassigned from expert successfully' });
    } catch (error) {
      logger.error('Unassign skill error:', error);
      ctx.error('取消分配失败: ' + error.message, 500);
    }
  }

  /**
   * 启用/禁用技能
   * PATCH /api/skills/:id/toggle
   */
  async toggle(ctx) {
    try {
      const { id } = ctx.params;
      const { is_active } = ctx.request.body;

      const skill = await this.Skill.findOne({
        where: { id },
        raw: true,
      });

      if (!skill) {
        ctx.error('Skill not found', 404);
        return;
      }

      await this.Skill.update(
        { is_active: is_active ? 1 : 0 },
        { where: { id } }
      );

      ctx.success({
        message: `Skill "${skill.name}" ${is_active ? 'enabled' : 'disabled'}`,
      });
    } catch (error) {
      logger.error('Toggle skill error:', error);
      ctx.error('切换技能状态失败: ' + error.message, 500);
    }
  }
}

export default SkillController;
