/**
 * Expert Controller - 专家控制器
 * 
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 * 
 * 使用 Sequelize ORM 进行数据库操作
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';

class ExpertController {
  constructor(db, chatService = null) {
    this.db = db;
    this.chatService = chatService;
    this.Expert = db.getModel('expert');
    this.AiModel = db.getModel('ai_model');
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
          'context_threshold',
          // LLM 参数配置
          'temperature', 'reflective_temperature', 'top_p',
          'frequency_penalty', 'presence_penalty'
        ],
        order: [['created_at', 'DESC']],
        raw: true,
      });

      // 将 bit 类型转换为 boolean，字符串字段直接返回
      const formattedExperts = experts.map(e => ({
        ...e,
        is_active: !!e.is_active,
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
          'context_threshold',
          // LLM 参数配置
          'temperature', 'reflective_temperature', 'top_p',
          'frequency_penalty', 'presence_penalty'
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
        context_threshold,
        // LLM 参数配置
        temperature, reflective_temperature, top_p,
        frequency_penalty, presence_penalty
      } = ctx.request.body;

      if (!name) {
        ctx.error('专家名称不能为空', 400);
        return;
      }

      const id = Utils.newID(20);

      // 创建专家（字符串字段直接存储）
      await this.Expert.create({
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
        is_active: is_active ? 1 : 0,
        // 上下文压缩配置
        context_threshold: context_threshold ?? 0.70,
        // LLM 参数配置
        temperature: temperature ?? 0.70,
        reflective_temperature: reflective_temperature ?? 0.30,
        top_p: top_p ?? 1.0,
        frequency_penalty: frequency_penalty ?? 0.0,
        presence_penalty: presence_penalty ?? 0.0,
      });

      ctx.success({
        id, name, introduction, speaking_style, core_values, behavioral_guidelines,
        taboos, emotional_tone, expressive_model_id, reflective_model_id, prompt_template, is_active,
        // 上下文压缩配置
        context_threshold: context_threshold ?? 0.70,
        // LLM 参数配置
        temperature: temperature ?? 0.70,
        reflective_temperature: reflective_temperature ?? 0.30,
        top_p: top_p ?? 1.0,
        frequency_penalty: frequency_penalty ?? 0.0,
        presence_penalty: presence_penalty ?? 0.0,
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
        context_threshold,
        // LLM 参数配置
        temperature, reflective_temperature, top_p,
        frequency_penalty, presence_penalty
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
      if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;
      // 上下文压缩配置
      if (context_threshold !== undefined) updates.context_threshold = context_threshold;
      // LLM 参数配置
      if (temperature !== undefined) updates.temperature = temperature;
      if (reflective_temperature !== undefined) updates.reflective_temperature = reflective_temperature;
      if (top_p !== undefined) updates.top_p = top_p;
      if (frequency_penalty !== undefined) updates.frequency_penalty = frequency_penalty;
      if (presence_penalty !== undefined) updates.presence_penalty = presence_penalty;

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
}

export default ExpertController;
