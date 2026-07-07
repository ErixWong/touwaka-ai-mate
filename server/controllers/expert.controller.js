/**
 * Expert Controller - 专家控制器
 *
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 *
 * 使用 Sequelize ORM 进行数据库操作
 *
 * === knowledge_config 终态语义 ===
 *
 * 旧自动预检索路径已于 2026-07-07 退场，当前仅保留 tool 路径（document_retrieval）。
 *
 * 活跃字段：
 *   - enabled: document_retrieval 工具的总开关
 *   - collection_id / doc_types: tool 默认过滤条件
 *
 * 数据兼容（仅保留读取，不再消费）：
 *   - top_k / threshold / max_tokens / style: 旧自动路径专属，已不再消费
 *   - retire_auto_path: 迁移门控字段，已随旧路径退场移除
 *
 * 数据兼容：
 *   - 历史 expert 记录的 knowledge_config 字段不做修改
 *   - 读取时安全解析 JSON
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { getSystemSettingService } from '../services/system-setting.service.js';

const safeParseJson = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

class ExpertController {
  constructor(db, chatService = null) {
    this.db = db;
    this.chatService = chatService;
    this.Expert = db.getModel('expert');
    this.AiModel = db.getModel('ai_model');
    this.systemSettingService = getSystemSettingService(db);
  }

  /**
   * 获取专家列表
   */
  async list(ctx) {
    try {
      const { is_active } = ctx.query;
      const { Op } = this.db;

      const where = {};
      if (is_active !== undefined) {
        where.is_active = is_active === 'true';
      }

      const experts = await this.Expert.findAll({
        where,
        attributes: [
          'id', 'name', 'introduction', 'speaking_style', 'core_values',
          'behavioral_guidelines', 'taboos', 'emotional_tone',
          'expressive_model_id', 'reflective_model_id', 'prompt_template',
          'is_active', 'created_at',
          // 上下文压缩配置
          'context_threshold', 'context_strategy',
          // 知识策略配置
          'knowledge_config',
          // P2-1: Psyche 配置
          'psyche_config',
          // LLM 参数配置
          'temperature', 'reflective_temperature', 'top_p',
          'frequency_penalty', 'presence_penalty',
          // 工具调用配置
          'max_tool_rounds',
          // 头像
          'avatar_base64', 'avatar_large_base64'
        ],
        order: [['created_at', 'DESC']],
        raw: true,
      });

      // 将 bit 类型转换为 boolean，psyche_config 解析为对象
      const formattedExperts = experts.map(e => ({
        ...e,
        is_active: !!e.is_active,
        knowledge_config: e.knowledge_config ? safeParseJson(e.knowledge_config) : null,
        psyche_config: e.psyche_config ? safeParseJson(e.psyche_config) : null,
      }));

      ctx.success(formattedExperts);
    } catch (error) {
      logger.error('Get experts error:', error.message, error.stack);
      ctx.error('获取专家列表失败: ' + error.message, 500);
    }
  }

  /**
   * 获取专家详情
   */
  async get(ctx) {
    try {
      const { id } = ctx.params;

      const expert = await this.Expert.findOne({
        where: { id },
        attributes: [
          'id', 'name', 'introduction', 'speaking_style', 'core_values',
          'behavioral_guidelines', 'taboos', 'emotional_tone',
          'expressive_model_id', 'reflective_model_id', 'prompt_template', 'is_active',
          // 上下文压缩配置
          'context_threshold', 'context_strategy',
          // 知识策略配置
          'knowledge_config',
          // P2-1: Psyche 配置
          'psyche_config',
          // LLM 参数配置
          'temperature', 'reflective_temperature', 'top_p',
          'frequency_penalty', 'presence_penalty',
          // 工具调用配置
          'max_tool_rounds',
          // 头像
          'avatar_base64', 'avatar_large_base64'
        ],
        raw: true,
      });

      if (!expert) {
        ctx.error('专家不存在', 404);
        return;
      }

      ctx.success({
        ...expert,
        is_active: !!expert.is_active,
        knowledge_config: expert.knowledge_config ? safeParseJson(expert.knowledge_config) : null,
        psyche_config: expert.psyche_config ? safeParseJson(expert.psyche_config) : null,
      });
    } catch (error) {
      logger.error('Get expert error:', error);
      ctx.error('获取专家详情失败', 500);
    }
  }

  /**
   * 创建专家
   */
  async create(ctx) {
    try {
      const {
        name, introduction, speaking_style, core_values, behavioral_guidelines,
        taboos, emotional_tone, expressive_model_id, reflective_model_id,
        prompt_template, is_active = true,
        // 上下文压缩配置
        context_threshold, context_strategy,
        // 知识策略配置
        knowledge_config,
        // LLM 参数配置
        temperature, reflective_temperature, top_p,
        frequency_penalty, presence_penalty,
        // P2-1: Psyche 配置
        psyche_config,
        // 头像
        avatar_base64, avatar_large_base64
      } = ctx.request.body;

      if (!name) {
        ctx.error('专家名称不能为空', 400);
        return;
      }

      // 获取系统默认配置
      const llmDefaults = await this.systemSettingService.getLLMDefaults();

      const id = Utils.newID(20);

      // 创建专家（使用系统默认值作为回退）
      const expertData = {
        id,
        name,
        introduction: introduction || null,
        speaking_style: speaking_style || null,
        core_values: core_values || null,
        behavioral_guidelines: behavioral_guidelines || null,
        taboos: taboos || null,
        emotional_tone: emotional_tone || null,
        expressive_model_id: expressive_model_id || null,
        reflective_model_id: reflective_model_id || null,
        prompt_template: prompt_template || null,
        is_active: is_active ? true : false,
        // 上下文压缩配置（使用系统默认值）
        context_threshold: context_threshold ?? llmDefaults.context_threshold,
        context_strategy: context_strategy || 'full',
        // 知识策略配置（JSON 字符串存储）
        knowledge_config: typeof knowledge_config === 'object' ? JSON.stringify(knowledge_config) : (knowledge_config || null),
        // LLM 参数配置（使用系统默认值）
        temperature: temperature ?? llmDefaults.temperature,
        reflective_temperature: reflective_temperature ?? llmDefaults.reflective_temperature,
        top_p: top_p ?? llmDefaults.top_p,
        frequency_penalty: frequency_penalty ?? llmDefaults.frequency_penalty,
        presence_penalty: presence_penalty ?? llmDefaults.presence_penalty,
        // P2-1: Psyche 配置（JSON 字符串存储）
        psyche_config: typeof psyche_config === 'object' ? JSON.stringify(psyche_config) : (psyche_config || null),
        // 头像
        avatar_base64: avatar_base64 || null,
        avatar_large_base64: avatar_large_base64 || null,
      };

      await this.Expert.create(expertData);

      ctx.success({
        id, name, introduction, speaking_style, core_values, behavioral_guidelines,
        taboos, emotional_tone, expressive_model_id, reflective_model_id, prompt_template, is_active,
        // 上下文压缩配置
        context_threshold: expertData.context_threshold,
        context_strategy: expertData.context_strategy,
        // 知识策略配置
        knowledge_config: knowledge_config || null,
        // LLM 参数配置
        temperature: expertData.temperature,
        reflective_temperature: expertData.reflective_temperature,
        top_p: expertData.top_p,
        frequency_penalty: expertData.frequency_penalty,
        presence_penalty: expertData.presence_penalty,
        // P2-1: Psyche 配置
        psyche_config: psyche_config || null,
        // 头像
        avatar_base64, avatar_large_base64,
      }, '专家创建成功');
    } catch (error) {
      logger.error('Create expert error:', error);
      ctx.error('创建专家失败: ' + error.message, 500);
    }
  }

  /**
   * 更新专家
   */
  async update(ctx) {
    try {
      const { id } = ctx.params;
      const {
        name, introduction, speaking_style, core_values, behavioral_guidelines,
        taboos, emotional_tone, expressive_model_id, reflective_model_id,
        prompt_template, is_active,
        // 上下文压缩配置
        context_threshold, context_strategy,
        // 知识策略配置
        knowledge_config,
        // LLM 参数配置
        temperature, reflective_temperature, top_p,
        frequency_penalty, presence_penalty,
        // 工具调用配置
        max_tool_rounds,
        // P2-1: Psyche 配置
        psyche_config,
        // 头像
        avatar_base64, avatar_large_base64
      } = ctx.request.body;

      // 检查专家是否存在
      const existing = await this.Expert.findOne({ where: { id } });
      if (!existing) {
        ctx.error('专家不存在', 404);
        return;
      }

      // 构建更新对象（字符串字段直接存储）
      const updates = {};

      if (name !== undefined) updates.name = name;
      if (introduction !== undefined) updates.introduction = introduction;
      if (speaking_style !== undefined) updates.speaking_style = speaking_style;
      if (core_values !== undefined) updates.core_values = core_values || null;
      if (behavioral_guidelines !== undefined) updates.behavioral_guidelines = behavioral_guidelines || null;
      if (taboos !== undefined) updates.taboos = taboos || null;
      if (emotional_tone !== undefined) updates.emotional_tone = emotional_tone;
      if (expressive_model_id !== undefined) updates.expressive_model_id = expressive_model_id || null;
      if (reflective_model_id !== undefined) updates.reflective_model_id = reflective_model_id || null;
      if (prompt_template !== undefined) updates.prompt_template = prompt_template;
      if (is_active !== undefined) updates.is_active = is_active ? true : false;
      // 上下文压缩配置
      if (context_threshold !== undefined) updates.context_threshold = context_threshold;
      if (context_strategy !== undefined) updates.context_strategy = context_strategy;
      // 知识策略配置
      if (knowledge_config !== undefined) {
        updates.knowledge_config = typeof knowledge_config === 'object' ? JSON.stringify(knowledge_config) : (knowledge_config || null);
      }
      // LLM 参数配置
      if (temperature !== undefined) updates.temperature = temperature;
      if (reflective_temperature !== undefined) updates.reflective_temperature = reflective_temperature;
      if (top_p !== undefined) updates.top_p = top_p;
      if (frequency_penalty !== undefined) updates.frequency_penalty = frequency_penalty;
      if (presence_penalty !== undefined) updates.presence_penalty = presence_penalty;
      // 工具调用配置
      if (max_tool_rounds !== undefined) updates.max_tool_rounds = max_tool_rounds;
      // P2-1: Psyche 配置
      if (psyche_config !== undefined) {
        updates.psyche_config = typeof psyche_config === 'object' ? JSON.stringify(psyche_config) : (psyche_config || null);
      }
      // 头像
      if (avatar_base64 !== undefined) updates.avatar_base64 = avatar_base64 || null;
      if (avatar_large_base64 !== undefined) updates.avatar_large_base64 = avatar_large_base64 || null;

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段', 400);
        return;
      }

      // updated_at 会由 Sequelize 自动更新
      await this.Expert.update(updates, { where: { id } });

      // 清除专家缓存，确保下次对话使用最新配置
      if (this.chatService) {
        this.chatService.clearExpertCache(id);
      }

      ctx.success({ id }, '专家更新成功');
    } catch (error) {
      logger.error('Update expert error:', error);
      ctx.error('更新专家失败: ' + error.message, 500);
    }
  }

  /**
   * 删除专家
   */
  async delete(ctx) {
    try {
      const { id } = ctx.params;

      // 检查专家是否存在
      const existing = await this.Expert.findOne({ where: { id } });
      if (!existing) {
        ctx.error('专家不存在', 404);
        return;
      }

      await this.Expert.destroy({ where: { id } });

      ctx.success({ id }, '专家删除成功');
    } catch (error) {
      logger.error('Delete expert error:', error);
      ctx.error('删除专家失败: ' + error.message, 500);
    }
  }

  /**
   * 获取专家技能列表（包含所有可用技能及启用状态）
   * GET /api/experts/:id/skills
   */
  async getSkills(ctx) {
    try {
      const { id } = ctx.params;

      // 检查专家是否存在
      const existing = await this.Expert.findOne({ where: { id } });
      if (!existing) {
        ctx.error('专家不存在', 404);
        return;
      }

      // 获取所有技能及该专家的启用状态
      const skills = await this.db.getAllSkillsWithExpertStatus(id);

      ctx.success({ skills });
    } catch (error) {
      logger.error('Get expert skills error:', error);
      ctx.error('获取专家技能失败: ' + error.message, 500);
    }
  }

  /**
   * 刷新专家缓存
   * POST /api/experts/:id/refresh
   * 用于在技能/人设变更后刷新专家的运行时缓存
   */
  async refresh(ctx) {
    try {
      const { id } = ctx.params;
      const userId = ctx.state.session?.id || 'unknown';

      // 检查专家是否存在
      const existing = await this.Expert.findOne({ where: { id } });
      if (!existing) {
        ctx.error('专家不存在', 404);
        return;
      }

      // 清除专家缓存
      if (this.chatService) {
        this.chatService.clearExpertCache(id);
        logger.info(`[ExpertController] 专家缓存已刷新: ${id}, 操作者: ${userId}`);
      }

      ctx.success({ id }, '专家缓存刷新成功');
    } catch (error) {
      logger.error('Refresh expert error:', error);
      ctx.error('刷新专家缓存失败: ' + error.message, 500);
    }
  }

  /**
   * 批量更新专家技能
   * POST /api/experts/:id/skills
   * Body: { skills: [{ skill_id, is_enabled, config? }] }
   */
  async updateSkills(ctx) {
    try {
      const { id } = ctx.params;
      const { skills } = ctx.request.body;

      // 检查专家是否存在
      const existing = await this.Expert.findOne({ where: { id } });
      if (!existing) {
        ctx.error('专家不存在', 404);
        return;
      }

      if (!Array.isArray(skills)) {
        ctx.error('skills 必须是数组', 400);
        return;
      }

      // 批量更新技能关联
      const results = await this.db.batchUpdateExpertSkills(id, skills);

      // 清除专家缓存，确保下次对话使用最新配置
      if (this.chatService) {
        this.chatService.clearExpertCache(id);
      }

      ctx.success({ skills: results }, '专家技能更新成功');
    } catch (error) {
      logger.error('Update expert skills error:', error);
      ctx.error('更新专家技能失败: ' + error.message, 500);
    }
  }
}

export default ExpertController;
