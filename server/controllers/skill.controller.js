/**
 * Skill Controller - 技能控制器
 * 
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 * 
 * 使用 Sequelize ORM 进行数据库操作
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { parseSkillMd, validateSkillPath } from '../../lib/skill-parser.js';
import fsOriginal from 'fs';
import path from 'path';

class SkillController {
  constructor(db) {
    this.db = db;
    this.Skill = db.getModel('skill');
    this.SkillTool = db.getModel('skill_tool');
    this.SkillParameter = db.getModel('skill_parameter');
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
   * 更新技能
   */
  async update(ctx) {
    try {
      const { id } = ctx.params;
      const { name, description, is_active } = ctx.request.body;

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
      ctx.error('删除技能失败：' + error.message, 500);
    }
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
          ctx.error(`参数名格式无效 ${param.param_name}（只允许字母、数字、下划线，且不能以数字开头）`, 400);
          return;
        }
      }

      // 验证参数名唯一性
      const names = parameters.map(p => p.param_name);
      const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
      if (duplicates.length > 0) {
        ctx.error(`参数名重复 ${duplicates.join(', ')}`, 400);
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

      // 检查技能目录中是否有可执行的入口文件
      // 支持多种入口文件：index.js, index.py, 或通过 tools[].script_path 指定的文件
      const hasIndexJs = fsOriginal.existsSync(path.join(full_path, 'index.js'));
      const hasIndexPy = fsOriginal.existsSync(path.join(full_path, 'index.py'));
      
      // 检查提供的工具中是否有指定 script_path 的入口文件
      let hasCustomEntry = false;
      if (provided_tools && Array.isArray(provided_tools)) {
        for (const tool of provided_tools) {
          if (tool.script_path) {
            const customEntryPath = path.join(full_path, tool.script_path);
            if (fsOriginal.existsSync(customEntryPath)) {
              hasCustomEntry = true;
              logger.info(`[SkillController] Found custom entry file: ${tool.script_path}`);
              break;
            }
          }
        }
      }
      
      // 如果没有任何入口文件，报错
      if (!hasIndexJs && !hasIndexPy && !hasCustomEntry) {
        ctx.error(`No entry file found in ${source_path}. Expected: index.js, index.py, or custom script_path in tools`, 404);
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
        // 尝试加载入口文件获取工具定义
        // 优先使用 index.js，如果不存在则使用其他入口文件
        const entryFile = hasIndexJs ? 'index.js' : (hasIndexPy ? 'index.py' : null);
        
        if (entryFile) {
          logger.info(`[SkillController] No tools provided, trying to load from ${entryFile}`);
          try {
            // Windows 需要使用 file:// URL 格式
            const { pathToFileURL } = await import('url');
            const entry_path = path.join(full_path, entryFile);
            const entry_url = pathToFileURL(entry_path).href + '?t=' + Date.now();
            logger.info('[SkillController] Loading from:', entry_url);
            
            const index_module = await import(entry_url);
            const skill_module = index_module.default || index_module;

            if (skill_module.getTools && typeof skill_module.getTools === 'function') {
              tools_to_register = skill_module.getTools();
              logger.info(`[SkillController] Loaded tools from ${entryFile}:`, tools_to_register?.length);
            }
          } catch (err) {
            logger.warn(`Could not parse tools from ${source_path}:`, err.message);
          }
        } else {
          logger.info('[SkillController] No tools provided and no standard entry file found, using custom script_path');
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
   * 更新工具信息
   * PUT /api/skills/:id/tools/:tool_id
   */
  async updateTool(ctx) {
    try {
      const { id, tool_id } = ctx.params;
      const { name, description, script_path, parameters, is_resident } = ctx.request.body;

      // 检查工具是否存在
      const tool = await this.SkillTool.findOne({
        where: { id: tool_id, skill_id: id },
      });

      if (!tool) {
        ctx.error('工具不存在', 404);
        return;
      }

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (script_path !== undefined) updates.script_path = script_path;
      if (parameters !== undefined) updates.parameters = typeof parameters === 'string' ? parameters : JSON.stringify(parameters);
      if (is_resident !== undefined) updates.is_resident = is_resident ? 1 : 0;

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段', 400);
        return;
      }

      await this.SkillTool.update(updates, { where: { id: tool_id } });

      ctx.success({ id: tool_id }, '工具更新成功');
    } catch (error) {
      logger.error('Update tool error:', error);
      ctx.error('更新工具失败: ' + error.message, 500);
    }
  }

  /**
   * 批量更新技能工具
   * PUT /api/skills/:id/tools
   */
  async updateTools(ctx) {
    let transaction = null;
    try {
      const { id } = ctx.params;
      const { tools } = ctx.request.body;

      if (!Array.isArray(tools)) {
        ctx.error('工具格式错误，需要数组', 400);
        return;
      }

      // 检查技能是否存在
      const skill = await this.Skill.findOne({ where: { id } });
      if (!skill) {
        ctx.error('技能不存在', 404);
        return;
      }

      // 开始事务
      transaction = await this.db.sequelize.transaction();

      // 逐个更新工具
      for (const tool of tools) {
        if (!tool.id) continue;

        const updates = {};
        if (tool.name !== undefined) updates.name = tool.name;
        if (tool.description !== undefined) updates.description = tool.description;
        if (tool.script_path !== undefined) updates.script_path = tool.script_path;
        if (tool.parameters !== undefined) updates.parameters = typeof tool.parameters === 'string' ? tool.parameters : JSON.stringify(tool.parameters);
        if (tool.is_resident !== undefined) updates.is_resident = tool.is_resident ? 1 : 0;

        if (Object.keys(updates).length > 0) {
          await this.SkillTool.update(updates, {
            where: { id: tool.id, skill_id: id },
            transaction,
          });
        }
      }

      // 提交事务
      await transaction.commit();
      transaction = null;

      ctx.success({ updated: tools.length }, '工具更新成功');
    } catch (error) {
      // 回滚事务
      if (transaction) {
        await transaction.rollback().catch(() => {});
      }
      logger.error('Update tools error:', error);
      ctx.error('更新工具失败: ' + error.message, 500);
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

  // ==================== 技能目录文件管理 API ====================

  /**
   * 获取技能目录文件列表
   * GET /api/skills/:id/files
   *
   * :id 可以是 skill_id 或者目录名（如 "file-operations"）
   */
  async listFiles(ctx) {
    try {
      const { id } = ctx.params;
      const { subdir } = ctx.query;

      logger.info('[listFiles] Request params:', { id, subdir });

      // 尝试通过 ID 或名称查找技能
      let skill = await this.Skill.findOne({ where: { id }, raw: true });
      
      // 如果没找到，尝试按名称查找
      if (!skill) {
        skill = await this.Skill.findOne({ where: { name: id }, raw: true });
      }

      logger.info('[listFiles] Skill lookup result:', {
        found: !!skill,
        skillId: skill?.id,
        sourcePath: skill?.source_path
      });

      const PROJECT_ROOT = process.cwd();
      let skillPath;
      let usedFallback = false;
      
      if (skill) {
        // 已注册技能，使用 source_path
        let sourcePath = skill.source_path;
        
        // 检查 source_path 是否有效
        if (sourcePath) {
          // 处理 source_path 可能缺少 data/ 前缀的情况
          if (!sourcePath.startsWith('data/') && !path.isAbsolute(sourcePath)) {
            sourcePath = path.join('data', sourcePath);
          }
          skillPath = path.isAbsolute(sourcePath) ? sourcePath : path.join(PROJECT_ROOT, sourcePath);
        }
        
        // 如果 source_path 无效或目录不存在，尝试多种 fallback 策略
        if (!skillPath || !fsOriginal.existsSync(skillPath)) {
          logger.warn('[listFiles] source_path invalid or directory not found, trying fallbacks:', {
            sourcePath: skill.source_path,
            skillName: skill.name,
            skillId: skill.id
          });
          
          // Fallback 1: 从 source_path 中提取目录名
          if (skill.source_path) {
            const dirName = path.basename(skill.source_path);
            const fallbackPath1 = path.join(PROJECT_ROOT, 'data', 'skills', dirName);
            if (fsOriginal.existsSync(fallbackPath1)) {
              skillPath = fallbackPath1;
              usedFallback = true;
              logger.info('[listFiles] Using fallback path from source_path basename:', { fallbackPath: fallbackPath1 });
            }
          }
          
          // Fallback 2: 使用技能名称作为目录名
          if (!skillPath && skill.name) {
            const fallbackPath2 = path.join(PROJECT_ROOT, 'data', 'skills', skill.name);
            if (fsOriginal.existsSync(fallbackPath2)) {
              skillPath = fallbackPath2;
              usedFallback = true;
              logger.info('[listFiles] Using fallback path from skill name:', { fallbackPath: fallbackPath2 });
            }
          }
        }
      } else {
        // 未注册目录，直接使用 data/skills/:name
        skillPath = path.join(PROJECT_ROOT, 'data', 'skills', id);
      }

      logger.info('[listFiles] Computed skillPath:', { skillPath, exists: skillPath ? fsOriginal.existsSync(skillPath) : false, usedFallback });

      if (!skillPath || !fsOriginal.existsSync(skillPath)) {
        ctx.error('技能目录不存在', 404);
        return;
      }

      // 构建目标目录路径
      let targetPath = skillPath;
      if (subdir) {
        // 安全检查：防止路径遍历攻击
        const normalizedSubdir = path.normalize(subdir).replace(/^(\.\.(\/|\\|$))+/, '');
        targetPath = path.join(skillPath, normalizedSubdir);
        
        // 确保目标路径仍在技能目录内
        if (!targetPath.startsWith(skillPath)) {
          ctx.error('非法路径', 403);
          return;
        }
      }

      // 读取目录内容
      const items = fsOriginal.readdirSync(targetPath, { withFileTypes: true });
      const files = items.map(item => {
        const itemPath = path.join(targetPath, item.name);
        const stats = fsOriginal.statSync(itemPath);
        
        return {
          name: item.name,
          type: item.isDirectory() ? 'directory' : 'file',
          path: subdir ? `${subdir}/${item.name}` : item.name,
          size: item.isFile() ? stats.size : 0,
          modified_at: stats.mtime.toISOString(),
        };
      });

      // 排序：目录在前，然后按名称排序
      files.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });

      ctx.success({ files });
    } catch (error) {
      logger.error('List skill files error:', error);
      ctx.error('获取文件列表失败: ' + error.message, 500);
    }
  }

  /**
   * 获取文件内容
   * GET /api/skills/:id/files/content
   *
   * :id 可以是 skill_id 或者目录名（如 "file-operations"）
   */
  async getFileContent(ctx) {
    try {
      const { id } = ctx.params;
      const { path: filePath } = ctx.query;

      if (!filePath) {
        ctx.error('文件路径不能为空', 400);
        return;
      }

      // 尝试通过 ID 或名称查找技能
      let skill = await this.Skill.findOne({ where: { id }, raw: true });

      // 如果没找到，尝试按名称查找
      if (!skill) {
        skill = await this.Skill.findOne({ where: { name: id }, raw: true });
      }

      const PROJECT_ROOT = process.cwd();
      let skillPath;
      
      if (skill) {
        // 已注册技能，使用 source_path
        let sourcePath = skill.source_path;
        
        // 检查 source_path 是否有效
        if (sourcePath) {
          // 处理 source_path 可能缺少 data/ 前缀的情况
          if (!sourcePath.startsWith('data/') && !path.isAbsolute(sourcePath)) {
            sourcePath = path.join('data', sourcePath);
          }
          skillPath = path.isAbsolute(sourcePath) ? sourcePath : path.join(PROJECT_ROOT, sourcePath);
        }
        
        // 如果 source_path 无效或目录不存在，尝试多种 fallback 策略
        if (!skillPath || !fsOriginal.existsSync(skillPath)) {
          logger.warn('[getFileContent] source_path invalid or directory not found, trying fallbacks:', {
            sourcePath: skill.source_path,
            skillName: skill.name,
            skillId: skill.id
          });
          
          // Fallback 1: 从 source_path 中提取目录名
          if (skill.source_path) {
            const dirName = path.basename(skill.source_path);
            const fallbackPath1 = path.join(PROJECT_ROOT, 'data', 'skills', dirName);
            if (fsOriginal.existsSync(fallbackPath1)) {
              skillPath = fallbackPath1;
              logger.info('[getFileContent] Using fallback path from source_path basename:', { fallbackPath: fallbackPath1 });
            }
          }
          
          // Fallback 2: 使用技能名称作为目录名
          if (!skillPath && skill.name) {
            const fallbackPath2 = path.join(PROJECT_ROOT, 'data', 'skills', skill.name);
            if (fsOriginal.existsSync(fallbackPath2)) {
              skillPath = fallbackPath2;
              logger.info('[getFileContent] Using fallback path from skill name:', { fallbackPath: fallbackPath2 });
            }
          }
        }
      } else {
        // 未注册目录，直接使用 data/skills/:name
        skillPath = path.join(PROJECT_ROOT, 'data', 'skills', id);
      }

      if (!skillPath || !fsOriginal.existsSync(skillPath)) {
        ctx.error('技能目录不存在', 404);
        return;
      }

      // 安全检查：防止路径遍历攻击
      const normalizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
      const fullPath = path.join(skillPath, normalizedPath);

      // 确保文件路径仍在技能目录内
      if (!fullPath.startsWith(skillPath)) {
        ctx.error('非法路径', 403);
        return;
      }

      if (!fsOriginal.existsSync(fullPath)) {
        ctx.error('文件不存在', 404);
        return;
      }

      const stats = fsOriginal.statSync(fullPath);
      if (stats.isDirectory()) {
        ctx.error('不能读取目录内容', 400);
        return;
      }

      // 检查文件大小（限制 1MB）
      if (stats.size > 1024 * 1024) {
        ctx.error('文件过大，请下载查看', 400);
        return;
      }

      const content = fsOriginal.readFileSync(fullPath, 'utf-8');

      ctx.success({
        content,
        path: filePath,
        size: stats.size,
        modified_at: stats.mtime.toISOString(),
      });
    } catch (error) {
      logger.error('Get file content error:', error);
      ctx.error('获取文件内容失败: ' + error.message, 500);
    }
  }

  /**
   * 列出所有技能目录（纯文件系统操作）
   * GET /api/skills/directories
   *
   * 注意：注册状态由前端通过 skills 列表判断，后端只返回目录基本信息
   */
  async listDirectories(ctx) {
    try {
      const PROJECT_ROOT = process.cwd();
      const skillsDir = path.join(PROJECT_ROOT, 'data', 'skills');

      // 确保 data/skills 目录存在
      if (!fsOriginal.existsSync(skillsDir)) {
        fsOriginal.mkdirSync(skillsDir, { recursive: true });
      }

      // 读取目录内容
      const items = fsOriginal.readdirSync(skillsDir, { withFileTypes: true });
      const directories = [];

      // 遍历目录
      for (const item of items) {
        if (!item.isDirectory()) continue;

        const dirName = item.name;
        const dirPath = path.join(skillsDir, dirName);
        const relativePath = `data/skills/${dirName}`;

        // 尝试读取 SKILL.md 获取描述
        let description = '';
        const skillMdPath = path.join(dirPath, 'SKILL.md');
        if (fsOriginal.existsSync(skillMdPath)) {
          try {
            const skillMd = fsOriginal.readFileSync(skillMdPath, 'utf-8');
            const skillInfo = parseSkillMd(skillMd);
            description = skillInfo.description || '';
          } catch (e) {
            logger.warn(`Failed to parse SKILL.md for ${dirName}:`, e.message);
          }
        }

        directories.push({
          name: dirName,
          path: relativePath,
          description,
        });
      }

      // 按名称排序
      directories.sort((a, b) => a.name.localeCompare(b.name));

      ctx.success({ directories });
    } catch (error) {
      logger.error('List skill directories error:', error);
      ctx.error('获取技能目录列表失败: ' + error.message, 500);
    }
  }

  /**
   * 创建新技能目录
   * POST /api/skills/directories
   */
  async createDirectory(ctx) {
    try {
      const { name, description } = ctx.request.body;

      if (!name) {
        ctx.error('目录名称不能为空', 400);
        return;
      }

      // 验证目录名格式（只允许字母、数字、下划线、连字符）
      const namePattern = /^[a-zA-Z0-9_-]+$/;
      if (!namePattern.test(name)) {
        ctx.error('目录名称只能包含字母、数字、下划线和连字符', 400);
        return;
      }

      const PROJECT_ROOT = process.cwd();
      const skillsDir = path.join(PROJECT_ROOT, 'data', 'skills');
      const newDirPath = path.join(skillsDir, name);

      // 检查目录是否已存在
      if (fsOriginal.existsSync(newDirPath)) {
        ctx.error('目录已存在', 400);
        return;
      }

      // 创建目录结构
      fsOriginal.mkdirSync(newDirPath, { recursive: true });

      // 创建默认的 SKILL.md 文件
      const skillMdContent = `# ${name}

${description || '新技能描述'}

## 版本
1.0.0

## 工具列表
<!-- 在此定义工具 -->
`;

      fsOriginal.writeFileSync(path.join(newDirPath, 'SKILL.md'), skillMdContent, 'utf-8');

      ctx.success({
        name,
        path: `data/skills/${name}`,
        message: '技能目录创建成功',
      });
    } catch (error) {
      logger.error('Create skill directory error:', error);
      ctx.error('创建技能目录失败: ' + error.message, 500);
    }
  }
}

export default SkillController;
