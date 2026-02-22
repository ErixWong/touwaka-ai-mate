/**
 * Provider 控制器
 * 管理 LLM Provider 的增删改查
 * 
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 * 
 * 使用 Sequelize ORM 进行数据库操作
 */

import Utils from '../../lib/utils.js';
import logger from '../../lib/logger.js';

class ProviderController {
  constructor(db) {
    this.db = db;
    this.Provider = db.getModel('provider');
    this.AiModel = db.getModel('ai_model');
  }

  /**
   * 脱敏处理 Provider 数据
   */
  _maskProvider(provider) {
    if (!provider) return null;
    return {
      ...provider,
      api_key: provider.api_key ? '****' + provider.api_key.slice(-4) : '',
      is_active: !!provider.is_active,
      timeout: Math.floor((provider.timeout || 60000) / 1000), // 毫秒转秒
    };
  }

  /**
   * 获取所有 Providers
   * GET /api/providers
   */
  async getAll(ctx) {
    try {
      const providers = await this.Provider.findAll({
        attributes: ['id', 'name', 'base_url', 'api_key', 'timeout', 'is_active', 'created_at', 'updated_at'],
        order: [['created_at', 'DESC']],
        raw: true,
      });

      // API Key 脱敏处理
      const maskedProviders = providers.map(p => this._maskProvider(p));

      ctx.success(maskedProviders);
    } catch (error) {
      logger.error('Get providers error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  /**
   * 获取单个 Provider
   * GET /api/providers/:id
   */
  async getOne(ctx) {
    try {
      const { id } = ctx.params;

      const provider = await this.Provider.findOne({
        where: { id },
        attributes: ['id', 'name', 'base_url', 'api_key', 'timeout', 'is_active', 'created_at', 'updated_at'],
        raw: true,
      });

      if (!provider) {
        ctx.throw(404, 'Provider 不存在');
        return;
      }

      ctx.success(this._maskProvider(provider));
    } catch (error) {
      logger.error('Get provider error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  /**
   * 创建 Provider
   * POST /api/providers
   */
  async create(ctx) {
    try {
      const body = ctx.request.body;
      const name = body.name;
      const base_url = body.base_url;
      const api_key = body.api_key;
      // 前端传入的是秒，需要转换为毫秒存储
      const timeout = (body.timeout ?? 30) * 1000;
      const is_active = body.is_active !== undefined ? body.is_active : true;

      // 参数验证
      if (!name || !base_url) {
        ctx.throw(400, '名称和基础 URL 不能为空');
        return;
      }

      // 检查名称是否已存在
      const existing = await this.Provider.findOne({
        where: { name },
      });

      if (existing) {
        ctx.throw(409, 'Provider 名称已存在');
        return;
      }

      const newId = Utils.newID(20);
      await this.Provider.create({
        id: newId,
        name,
        base_url,
        api_key: api_key || null,
        timeout,
        is_active: is_active ? 1 : 0,
      });

      // 获取刚插入的记录
      const newProvider = await this.Provider.findOne({
        where: { id: newId },
        attributes: ['id', 'name', 'base_url', 'api_key', 'timeout', 'is_active', 'created_at', 'updated_at'],
        raw: true,
      });

      ctx.success(this._maskProvider(newProvider), 'Provider 创建成功');
    } catch (error) {
      logger.error('Create provider error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  /**
   * 更新 Provider
   * PUT /api/providers/:id
   */
  async update(ctx) {
    try {
      const { id } = ctx.params;
      const body = ctx.request.body;
      const name = body.name;
      const base_url = body.base_url;
      const api_key = body.api_key;
      const timeout = body.timeout;
      const is_active = body.is_active;

      // 检查 Provider 是否存在
      const existing = await this.Provider.findOne({
        where: { id },
      });

      if (!existing) {
        ctx.throw(404, 'Provider 不存在');
        return;
      }

      // 如果修改名称，检查是否与其他 Provider 冲突
      if (name) {
        const nameConflict = await this.Provider.findOne({
          where: {
            name,
            id: { [this.db.Op.ne]: id },
          },
        });

        if (nameConflict) {
          ctx.throw(409, 'Provider 名称已存在');
          return;
        }
      }

      // 构建更新对象
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (base_url !== undefined) updates.base_url = base_url;
      if (api_key !== undefined) updates.api_key = api_key || null;
      if (timeout !== undefined) updates.timeout = timeout * 1000; // 秒转毫秒
      if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;

      if (Object.keys(updates).length === 0) {
        ctx.throw(400, '没有要更新的字段');
        return;
      }

      await this.Provider.update(updates, { where: { id } });

      const updatedProvider = await this.Provider.findOne({
        where: { id },
        attributes: ['id', 'name', 'base_url', 'api_key', 'timeout', 'is_active', 'created_at', 'updated_at'],
        raw: true,
      });

      ctx.success(this._maskProvider(updatedProvider), 'Provider 更新成功');
    } catch (error) {
      logger.error('Update provider error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  /**
   * 删除 Provider
   * DELETE /api/providers/:id
   */
  async delete(ctx) {
    try {
      const { id } = ctx.params;

      // 检查 Provider 是否存在
      const existing = await this.Provider.findOne({
        where: { id },
      });

      if (!existing) {
        ctx.throw(404, 'Provider 不存在');
        return;
      }

      // 检查是否有关联的模型
      const models = await this.AiModel.findAll({
        where: { provider_id: id },
        attributes: ['id'],
      });

      if (models.length > 0) {
        ctx.throw(409, `无法删除：该 Provider 下还有 ${models.length} 个模型，请先删除这些模型`);
        return;
      }

      await this.Provider.destroy({ where: { id } });

      ctx.success(null, 'Provider 删除成功');
    } catch (error) {
      logger.error('Delete provider error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }
}

export default ProviderController;
