/**
 * Model Controller - 模型控制器
 * 提供 AI 模型的增删改查功能
 * 
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 * 
 * 使用 Sequelize ORM 进行数据库操作
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';

class ModelController {
  constructor(db) {
    this.db = db;
    this.AiModel = db.getModel('ai_model');
    this.Provider = db.getModel('provider');
    this.Expert = db.getModel('expert');
  }

  /**
   * 获取模型列表
   */
  async list(ctx) {
    try {
      const models = await this.AiModel.findAll({
        attributes: [
          'id', 'name', 'model_name', 'provider_id', 'max_tokens',
          'cost_per_1k_input', 'cost_per_1k_output', 'description', 'is_active'
        ],
        include: [{
          model: this.Provider,
          as: 'provider',
          attributes: [['id', 'provider_id'], ['name', 'provider_name']],
        }],
        order: [['created_at', 'DESC']],
        raw: true,
        nest: true,
      });

      // 将 bit 类型转换为 boolean，但保持字段名不变
      const formattedModels = models.map(m => ({
        ...m,
        provider_name: m.provider?.name || m.provider?.provider_name,
        provider_id: m.provider?.id || m.provider?.provider_id || m.provider_id,
        is_active: !!m.is_active,
      }));

      ctx.success(formattedModels);
    } catch (error) {
      logger.error('Get models error:', error);
      ctx.error('获取模型列表失败', 500);
    }
  }

  /**
   * 获取单个模型详情
   */
  async getById(ctx) {
    try {
      const { id } = ctx.params;

      const model = await this.AiModel.findOne({
        where: { id },
        attributes: [
          'id', 'name', 'model_name', 'provider_id', 'max_tokens',
          'cost_per_1k_input', 'cost_per_1k_output', 'description', 'is_active',
          'created_at', 'updated_at'
        ],
        include: [{
          model: this.Provider,
          as: 'provider',
          attributes: ['id', 'name'],
        }],
        raw: true,
        nest: true,
      });

      if (!model) {
        return ctx.error('模型不存在', 404);
      }

      // 将 bit 类型转换为 boolean，但保持字段名不变
      ctx.success({
        ...model,
        provider_name: model.provider?.name,
        is_active: !!model.is_active,
      });
    } catch (error) {
      logger.error('Get model error:', error);
      ctx.error('获取模型详情失败', 500);
    }
  }

  /**
   * 创建模型
   */
  async create(ctx) {
    try {
      const body = ctx.request.body;

      // 验证必填字段
      if (!body.name || !body.model_name || !body.provider_id) {
        return ctx.error('模型名称、模型标识符和提供商不能为空', 400);
      }

      // 检查提供商是否存在
      const provider = await this.Provider.findOne({
        where: { id: body.provider_id },
      });
      if (!provider) {
        return ctx.error('指定的提供商不存在', 400);
      }

      // 检查模型名称是否已存在
      const existing = await this.AiModel.findOne({
        where: { name: body.name },
      });
      if (existing) {
        return ctx.error('模型名称已存在', 409);
      }

      // 生成 ID
      const id = Utils.newID(20);

      // 插入数据
      await this.AiModel.create({
        id,
        name: body.name,
        model_name: body.model_name,
        provider_id: body.provider_id,
        max_tokens: body.max_tokens || 4096,
        cost_per_1k_input: body.cost_per_1k_input || 0,
        cost_per_1k_output: body.cost_per_1k_output || 0,
        description: body.description || null,
        is_active: body.is_active !== undefined ? body.is_active : true,
      });

      // 返回创建的模型
      const newModel = await this.AiModel.findOne({
        where: { id },
        attributes: [
          'id', 'name', 'model_name', 'provider_id', 'max_tokens',
          'cost_per_1k_input', 'cost_per_1k_output', 'description', 'is_active'
        ],
        include: [{
          model: this.Provider,
          as: 'provider',
          attributes: ['id', 'name'],
        }],
        raw: true,
        nest: true,
      });

      logger.info(`Model created: ${id}`);
      ctx.success({
        ...newModel,
        provider_name: newModel.provider?.name,
        is_active: !!newModel.is_active,
      }, '模型创建成功', 201);
    } catch (error) {
      logger.error('Create model error:', error);
      ctx.error('创建模型失败', 500);
    }
  }

  /**
   * 更新模型
   */
  async update(ctx) {
    try {
      const { id } = ctx.params;
      const body = ctx.request.body;

      // 检查模型是否存在
      const existing = await this.AiModel.findOne({ where: { id } });
      if (!existing) {
        return ctx.error('模型不存在', 404);
      }

      // 如果更改了提供商，验证新提供商是否存在
      if (body.provider_id) {
        const provider = await this.Provider.findOne({
          where: { id: body.provider_id },
        });
        if (!provider) {
          return ctx.error('指定的提供商不存在', 400);
        }
      }

      // 如果更改了名称，检查是否与其他模型冲突
      if (body.name) {
        const nameConflict = await this.AiModel.findOne({
          where: {
            name: body.name,
            id: { [this.db.Op.ne]: id },
          },
        });
        if (nameConflict) {
          return ctx.error('模型名称已存在', 409);
        }
      }

      // 构建更新对象
      const updates = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.model_name !== undefined) updates.model_name = body.model_name;
      if (body.provider_id !== undefined) updates.provider_id = body.provider_id;
      if (body.max_tokens !== undefined) updates.max_tokens = body.max_tokens;
      if (body.cost_per_1k_input !== undefined) updates.cost_per_1k_input = body.cost_per_1k_input;
      if (body.cost_per_1k_output !== undefined) updates.cost_per_1k_output = body.cost_per_1k_output;
      if (body.description !== undefined) updates.description = body.description;
      if (body.is_active !== undefined) updates.is_active = body.is_active;

      if (Object.keys(updates).length === 0) {
        return ctx.error('没有要更新的字段', 400);
      }

      // 执行更新
      await this.AiModel.update(updates, { where: { id } });

      // 返回更新后的模型
      const updatedModel = await this.AiModel.findOne({
        where: { id },
        attributes: [
          'id', 'name', 'model_name', 'provider_id', 'max_tokens',
          'cost_per_1k_input', 'cost_per_1k_output', 'description', 'is_active'
        ],
        include: [{
          model: this.Provider,
          as: 'provider',
          attributes: ['id', 'name'],
        }],
        raw: true,
        nest: true,
      });

      logger.info(`Model updated: ${id}`);
      ctx.success({
        ...updatedModel,
        provider_name: updatedModel.provider?.name,
        is_active: !!updatedModel.is_active,
      }, '模型更新成功');
    } catch (error) {
      logger.error('Update model error:', error);
      ctx.error('更新模型失败', 500);
    }
  }

  /**
   * 删除模型
   */
  async delete(ctx) {
    try {
      const { id } = ctx.params;

      // 检查模型是否存在
      const existing = await this.AiModel.findOne({ where: { id } });
      if (!existing) {
        return ctx.error('模型不存在', 404);
      }

      // 检查是否有专家正在使用此模型
      const expertUsing = await this.Expert.findOne({
        where: {
          [this.db.Op.or]: [
            { expressive_model_id: id },
            { reflective_model_id: id },
          ],
        },
      });
      if (expertUsing) {
        return ctx.error('该模型正在被专家使用，无法删除', 409);
      }

      // 删除模型
      await this.AiModel.destroy({ where: { id } });

      logger.info(`Model deleted: ${id}`);
      ctx.success(null, '模型删除成功');
    } catch (error) {
      logger.error('Delete model error:', error);
      ctx.error('删除模型失败', 500);
    }
  }
}

export default ModelController;
