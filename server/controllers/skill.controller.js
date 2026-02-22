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
import path from 'path';
import AdmZip from 'adm-zip';

class SkillController {
  constructor(db) {
    this.db = db;
    this.Skill = db.getModel('skill');
    this.SkillTool = db.getModel('skill_tool');
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

      const formattedSkills = skills.map(s => ({
        ...s,
        is_active: !!s.is_active,
        tags: s.tags ? (typeof s.tags === 'string' ? JSON.parse(s.tags) : s.tags) : [],
        security_warnings: s.security_warnings 
          ? (typeof s.security_warnings === 'string' ? JSON.parse(s.security_warnings) : s.security_warnings) 
          : [],
        tool_count: toolCountMap[s.id] || 0,
      }));

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

      ctx.success({
        skill: {
          ...skill,
          is_active: !!skill.is_active,
          tags: skill.tags ? (typeof skill.tags === 'string' ? JSON.parse(skill.tags) : skill.tags) : [],
          security_warnings: skill.security_warnings 
            ? (typeof skill.security_warnings === 'string' ? JSON.parse(skill.security_warnings) : skill.security_warnings) 
            : [],
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
   */
  async installFromUrl(ctx) {
    try {
      const { url } = ctx.request.body;

      if (!url) {
        ctx.error('URL 不能为空', 400);
        return;
      }

      // TODO: 实现从 URL 下载技能文件
      // 1. 下载文件
      // 2. 如果是 ZIP，解压
      // 3. 读取 SKILL.md
      // 4. 调用 AI 分析
      // 5. 存入数据库

      ctx.error('从 URL 安装功能暂未实现', 501);
    } catch (error) {
      logger.error('Install skill from URL error:', error);
      ctx.error('从 URL 安装失败: ' + error.message, 500);
    }
  }

  /**
   * 从 ZIP 文件安装技能
   */
  async installFromZip(ctx) {
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

        const skillDir = path.dirname(skillMdPath);
        const skillMd = await fs.readFile(skillMdPath, 'utf-8');

        // TODO: 调用 AI 分析技能
        // 目前使用简单的解析
        const skillData = this.parseSkillMd(skillMd);

        // 生成 ID（如果 SKILL.md 中没有指定）
        const id = skillData.id || Utils.newID(20);

        // 检查是否已存在
        const existing = await this.Skill.findOne({ where: { id } });
        if (existing) {
          // 更新现有技能
          await this.Skill.update({
            ...skillData,
            skill_md: skillMd,
            source_type: 'zip',
            source_path: skillDir,
            updated_at: new Date(),
          }, { where: { id } });

          // 删除旧工具
          await this.SkillTool.destroy({ where: { skill_id: id } });
        } else {
          // 创建新技能
          await this.Skill.create({
            id,
            ...skillData,
            skill_md: skillMd,
            source_type: 'zip',
            source_path: skillDir,
            security_score: 100, // 默认安全评分
            is_active: true,
          });
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
            });
          }
        }

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
      logger.error('Install skill from ZIP error:', error);
      ctx.error('从 ZIP 安装失败: ' + error.message, 500);
    }
  }

  /**
   * 从本地目录安装技能
   */
  async installFromPath(ctx) {
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

      // 解析技能
      const skillData = this.parseSkillMd(skillMd);

      // 生成 ID（如果 SKILL.md 中没有指定）
      const id = skillData.id || Utils.newID(20);

      // 检查是否已存在
      const existing = await this.Skill.findOne({ where: { id } });
      if (existing) {
        // 更新现有技能
        await this.Skill.update({
          ...skillData,
          skill_md: skillMd,
          source_type: 'local',
          source_path: skillPath,
          updated_at: new Date(),
        }, { where: { id } });

        // 删除旧工具
        await this.SkillTool.destroy({ where: { skill_id: id } });
      } else {
        // 创建新技能
        await this.Skill.create({
          id,
          ...skillData,
          skill_md: skillMd,
          source_type: 'local',
          source_path: skillPath,
          security_score: 100,
          is_active: true,
        });
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
          });
        }
      }

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

      // TODO: 调用 AI 重新分析技能
      // 目前只是重新解析 SKILL.md

      if (!skill.skill_md) {
        ctx.error('技能没有 SKILL.md 内容', 400);
        return;
      }

      const skillData = this.parseSkillMd(skill.skill_md);

      // 更新技能
      await this.Skill.update({
        ...skillData,
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
}

export default SkillController;
