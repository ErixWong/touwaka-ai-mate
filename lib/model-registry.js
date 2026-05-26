/**
 * ModelRegistry - 模型配置统一管理
 * 
 * 单例模式，统一模型配置的获取与缓存
 * - 减少 DB 查询
 * - 消除多套缓存体系
 * - 支持按 expertId / modelId / modelType 查询
 */

import logger from './logger.js';

class ModelRegistry {
  constructor() {
    this.db = null;
    this.cache = new Map();
  }

  /**
   * 初始化（传入数据库实例）
   */
  init(db) {
    this.db = db;
    logger.info('[ModelRegistry] Initialized');
  }

  /**
   * 获取模型配置（按 modelId）
   */
  async getModelConfig(modelId) {
    if (!this.db) {
      throw new Error('[ModelRegistry] Not initialized');
    }

    const cacheKey = `model:${modelId}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const modelConfig = await this.db.getModelConfig(modelId);
    if (!modelConfig) {
      throw new Error(`[ModelRegistry] Model not found: ${modelId}`);
    }

    this.cache.set(cacheKey, modelConfig);
    return modelConfig;
  }

  /**
   * 获取专家关联的模型配置（优先反思模型）
   */
  async getExpertModelConfig(expertId) {
    if (!this.db) {
      throw new Error('[ModelRegistry] Not initialized');
    }

    const cacheKey = `expert:${expertId}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const expert = await this.db.getExpert(expertId);
    if (!expert) {
      throw new Error(`[ModelRegistry] Expert not found: ${expertId}`);
    }

    const modelId = expert.reflective_model_id || expert.expressive_model_id;
    if (!modelId) {
      throw new Error(`[ModelRegistry] No model configured for expert: ${expertId}`);
    }

    const modelConfig = await this.getModelConfig(modelId);
    this.cache.set(cacheKey, modelConfig);
    return modelConfig;
  }

  /**
   * 获取默认多模态模型（VL模型）
   */
  async getDefaultVLModel() {
    if (!this.db) {
      throw new Error('[ModelRegistry] Not initialized');
    }

    const cacheKey = 'defaultVL';
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const AiModel = this.db.getModel('ai_model');
    if (!AiModel) {
      throw new Error('[ModelRegistry] ai_model not available');
    }

    const model = await AiModel.findOne({
      where: { 
        is_active: true,
        model_type: 'multimodal'
      },
      order: [['created_at', 'DESC']],
      raw: true,
    });

    if (!model) {
      throw new Error('[ModelRegistry] No active multimodal model found');
    }

    const modelConfig = await this.getModelConfig(model.id);
    this.cache.set(cacheKey, modelConfig);
    logger.info(`[ModelRegistry] Default VL model: ${modelConfig.model_name}`);
    return modelConfig;
  }

  /**
   * 清除缓存
   */
  clearCache(key = null) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
      logger.info('[ModelRegistry] Cache cleared');
    }
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// 单例
const instance = new ModelRegistry();

export default instance;
export { ModelRegistry };