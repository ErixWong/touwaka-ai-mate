/**
 * Config Loader
 * 从数据库加载专家/模型/技能配置，支持缓存
 */

import logger from './logger.js';

class ConfigLoader {
  constructor(db) {
    this.db = db;
    this.cache = new Map();
    this.cacheExpiry = new Map();
    this.defaultCacheTTL = 5 * 60 * 1000; // 默认缓存 5 分钟
  }

  /**
   * 加载专家完整配置（包含模型、技能）
   * @param {string} expertId - 专家ID
   * @param {boolean} useCache - 是否使用缓存
   * @returns {Object} 完整配置
   */
  async loadExpertConfig(expertId, useCache = true) {
    // 检查缓存
    if (useCache && this.cache.has(expertId)) {
      const expiry = this.cacheExpiry.get(expertId);
      if (expiry && Date.now() < expiry) {
        logger.debug(`Config loaded from cache for expert: ${expertId}`);
        return this.cache.get(expertId);
      }
      // 缓存过期，清除
      this.cache.delete(expertId);
      this.cacheExpiry.delete(expertId);
    }

    try {
      // 从数据库加载完整配置
      const config = await this.db.getExpertFullConfig(expertId);

      // 验证配置完整性
      this.validateExpertConfig(config, expertId);

      // 处理 Soul 配置
      config.soul = this.parseSoulConfig(config.expert);

      // 缓存配置
      this.cache.set(expertId, config);
      this.cacheExpiry.set(expertId, Date.now() + this.defaultCacheTTL);

      logger.info(`Config loaded and validated for expert: ${expertId}`);
      return config;
    } catch (error) {
      logger.error(`Failed to load config for expert ${expertId}:`, error.message);
      throw error;
    }
  }

  /**
   * 验证专家配置完整性
   * @param {Object} config - 配置对象
   * @param {string} expertId - 专家ID（用于错误信息）
   * @throws {Error} 配置无效时抛出错误
   */
  validateExpertConfig(config, expertId) {
    if (!config) {
      throw new Error(`Config is empty for expert: ${expertId}`);
    }

    // 验证专家基本信息
    if (!config.expert) {
      throw new Error(`Expert record not found: ${expertId}`);
    }

    const requiredFields = ['id', 'name', 'expressive_model_id'];
    for (const field of requiredFields) {
      if (!config.expert[field]) {
        throw new Error(`Expert config missing required field: ${field}`);
      }
    }

    // 验证表达模型配置
    if (!config.expressiveModel) {
      throw new Error(`Expressive model not found or inactive: ${config.expert.expressive_model_id}`);
    }
    this.validateModelConfig(config.expressiveModel, 'expressive');

    // 验证反思模型配置（如果配置了）
    if (config.expert.reflective_model_id && config.reflectiveModel) {
      this.validateModelConfig(config.reflectiveModel, 'reflective');
    }

    logger.debug(`Config validation passed for expert: ${expertId}`);
  }

  /**
   * 验证模型配置
   * @param {Object} model - 模型配置
   * @param {string} type - 模型类型（用于错误信息）
   * @throws {Error} 配置无效时抛出错误
   */
  validateModelConfig(model, type) {
    if (!model.base_url) {
      throw new Error(`${type} model missing base_url`);
    }

    if (!model.api_key) {
      throw new Error(`${type} model missing api_key`);
    }

    if (!model.model_name) {
      throw new Error(`${type} model missing model_name`);
    }

    // 验证 URL 格式
    try {
      new URL(model.base_url);
    } catch {
      throw new Error(`${type} model has invalid base_url: ${model.base_url}`);
    }
  }

  /**
   * 解析 Soul 配置
   * @param {Object} expert - 专家数据库记录
   * @returns {Object} 解析后的 Soul 配置
   */
  parseSoulConfig(expert) {
    return {
      coreValues: this.parseJsonField(expert.core_values, []),
      behavioralGuidelines: this.parseJsonField(expert.behavioral_guidelines, []),
      taboos: this.parseJsonField(expert.taboos, []),
      emotionalTone: expert.emotional_tone || '',
      speakingStyle: expert.speaking_style || '',  // 添加说话风格
    };
  }

  /**
   * 解析 JSON 字段
   */
  parseJsonField(value, defaultValue = null) {
    if (!value) return defaultValue;
    try {
      if (typeof value === 'string') {
        return JSON.parse(value);
      }
      return value;
    } catch (error) {
      logger.warn('Failed to parse JSON field:', error.message);
      return defaultValue;
    }
  }

  /**
   * 获取模型配置（包含 Provider 信息）
   * @param {string} modelId - 模型ID
   * @returns {Object} 模型配置
   */
  async getModelConfig(modelId) {
    return await this.db.getModelConfig(modelId);
  }

  /**
   * 获取专家技能列表
   * @param {string} expertId - 专家ID
   * @returns {Array} 技能列表
   */
  async getExpertSkills(expertId) {
    return await this.db.getExpertSkills(expertId);
  }

  /**
   * 获取单个技能详情
   * @param {string} skillId - 技能ID
   * @returns {Object} 技能详情
   */
  async getSkill(skillId) {
    return await this.db.getSkill(skillId);
  }

  /**
   * 清除指定专家的缓存
   * @param {string} expertId - 专家ID
   */
  clearCache(expertId = null) {
    if (expertId) {
      this.cache.delete(expertId);
      this.cacheExpiry.delete(expertId);
      logger.info(`Cache cleared for expert: ${expertId}`);
    } else {
      this.cache.clear();
      this.cacheExpiry.clear();
      logger.info('All config cache cleared');
    }
  }

  /**
   * 设置缓存 TTL
   * @param {number} ttlMs - 缓存时间（毫秒）
   */
  setCacheTTL(ttlMs) {
    this.defaultCacheTTL = ttlMs;
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

export default ConfigLoader;
