/**
 * SystemSettingService - 系统配置服务
 * 
 * 提供系统配置的缓存和获取功能
 * 支持从数据库读取配置并提供默认值回退
 */

import logger from '../../lib/logger.js';

// 默认配置（当数据库中没有配置时使用）
const DEFAULT_SETTINGS = {
  llm: {
    context_threshold: 0.70,
    temperature: 0.70,
    reflective_temperature: 0.30,
    top_p: 1.0,
    frequency_penalty: 0.0,
    presence_penalty: 0.0,
    // Note: max_tokens 不在系统设置中管理，由模型表和专家配置决定
  },
  connection: {
    max_per_user: 5,
    max_per_expert: 100,
  },
  token: {
    access_expiry: '15m',
    refresh_expiry: '7d',
  },
  // 技能执行超时配置（单位：秒）
  timeout: {
    vm_execution: 60,        // VM 沙箱执行超时（默认60秒）
    python_execution: 120,   // Python 执行超时（默认120秒）
    skill_http: 180,         // 技能 HTTP 调用超时（默认180秒）
    resident_skill: 300,     // 驻留技能超时（默认300秒/5分钟）
  },
};

// 配置值验证规则
const VALIDATION_RULES = {
  'llm.context_threshold': { min: 0, max: 1 },
  'llm.temperature': { min: 0, max: 2 },
  'llm.reflective_temperature': { min: 0, max: 2 },
  'llm.top_p': { min: 0, max: 1 },
  'llm.frequency_penalty': { min: -2, max: 2 },
  'llm.presence_penalty': { min: -2, max: 2 },
  // Note: max_tokens 不在系统设置中管理
  'connection.max_per_user': { min: 1, max: 100 },
  'connection.max_per_expert': { min: 1, max: 1000 },
  // 超时配置验证规则（单位：秒）
  'timeout.vm_execution': { min: 5, max: 3600 },        // 5秒 - 1小时
  'timeout.python_execution': { min: 10, max: 3600 },   // 10秒 - 1小时
  'timeout.skill_http': { min: 10, max: 1800 },         // 10秒 - 30分钟
  'timeout.resident_skill': { min: 30, max: 7200 },     // 30秒 - 2小时
};

class SystemSettingService {
  constructor(db) {
    this.db = db;
    this.SystemSetting = db.getModel('system_setting');
    this.cache = null;
    this.cacheTime = null;
    this.cacheTTL = 60000; // 缓存 60 秒
    this.isLoading = false; // 防止并发加载
    this.loadPromise = null; // 加载Promise
  }

  /**
   * 获取所有系统配置
   * @param {boolean} forceRefresh - 是否强制刷新缓存
   * @returns {Promise<Object>} 系统配置对象
   */
  async getAllSettings(forceRefresh = false) {
    // 检查缓存是否有效
    if (!forceRefresh && this.cache && this.cacheTime && (Date.now() - this.cacheTime < this.cacheTTL)) {
      return this.cache;
    }

    // 防止并发加载：如果正在加载，等待现有加载完成
    if (this.isLoading && this.loadPromise) {
      return this.loadPromise;
    }

    this.isLoading = true;
    this.loadPromise = this._loadSettingsFromDB();
    
    try {
      return await this.loadPromise;
    } finally {
      this.isLoading = false;
      this.loadPromise = null;
    }
  }

  /**
   * 从数据库加载配置
   * @returns {Promise<Object>} 系统配置对象
   */
  async _loadSettingsFromDB() {
    try {
      const records = await this.SystemSetting.findAll({ raw: true });
      const result = this._parseSettings(records);
      this.cache = result;
      this.cacheTime = Date.now();
      return result;
    } catch (error) {
      logger.error('Failed to load system settings:', error);
      // 返回默认值，并设置较短缓存时间防止缓存穿透
      this.cacheTime = Date.now();
      this.cacheTTL = 5000; // 失败时缩短缓存时间为5秒
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
  }

  /**
   * 获取指定路径的配置值
   * @param {string} path - 配置路径，如 'llm.temperature'
   * @param {any} defaultValue - 默认值
   * @returns {Promise<any>} 配置值
   */
  async get(path, defaultValue = undefined) {
    const settings = await this.getAllSettings();
    const parts = path.split('.');
    let result = settings;
    
    for (const part of parts) {
      if (result && typeof result === 'object' && part in result) {
        result = result[part];
      } else {
        return defaultValue !== undefined ? defaultValue : this._getNestedValue(DEFAULT_SETTINGS, path);
      }
    }
    
    return result;
  }

  /**
   * 获取 LLM 默认参数
   * @returns {Promise<Object>} LLM 参数对象
   */
  async getLLMDefaults() {
    const settings = await this.getAllSettings();
    return settings.llm || DEFAULT_SETTINGS.llm;
  }

  /**
   * 获取连接限制配置
   * @returns {Promise<Object>} 连接限制对象
   */
  async getConnectionLimits() {
    const settings = await this.getAllSettings();
    return settings.connection || DEFAULT_SETTINGS.connection;
  }

  /**
   * 获取 Token 配置
   * @returns {Promise<Object>} Token 配置对象
   */
  async getTokenConfig() {
    const settings = await this.getAllSettings();
    return settings.token || DEFAULT_SETTINGS.token;
  }

  /**
   * 获取超时配置（返回毫秒值，便于直接使用）
   * @returns {Promise<Object>} 超时配置对象（毫秒）
   */
  async getTimeoutConfig() {
    const settings = await this.getAllSettings();
    const timeoutConfig = settings.timeout || DEFAULT_SETTINGS.timeout;
    // 转换为毫秒
    return {
      vm_execution: timeoutConfig.vm_execution * 1000,
      python_execution: timeoutConfig.python_execution * 1000,
      skill_http: timeoutConfig.skill_http * 1000,
      resident_skill: timeoutConfig.resident_skill * 1000,
    };
  }

  /**
   * 获取默认超时配置（毫秒值）
   * 用于 skill-loader 等模块在数据库不可用时使用
   * @returns {Object} 超时配置对象（毫秒）
   */
  static getDefaultTimeouts() {
    return {
      vm_execution: DEFAULT_SETTINGS.timeout.vm_execution * 1000,
      python_execution: DEFAULT_SETTINGS.timeout.python_execution * 1000,
      skill_http: DEFAULT_SETTINGS.timeout.skill_http * 1000,
      resident_skill: DEFAULT_SETTINGS.timeout.resident_skill * 1000,
    };
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache = null;
    this.cacheTime = null;
  }

  /**
   * 解析数据库记录为嵌套对象
   * @param {Array} records - 数据库记录数组
   * @returns {Object} 嵌套的配置对象
   */
  _parseSettings(records) {
    const result = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    
    for (const record of records) {
      const parts = record.setting_key.split('.');
      if (parts.length === 2) {
        const [section, key] = parts;
        if (result[section] && key in result[section]) {
          const parsedValue = this._parseValue(record.setting_value, record.value_type);
          // 验证配置值范围
          const validatedValue = this._validateValue(record.setting_key, parsedValue);
          result[section][key] = validatedValue;
        }
      }
    }
    
    return result;
  }

  /**
   * 验证配置值是否在有效范围内
   * @param {string} key - 配置键
   * @param {any} value - 配置值
   * @returns {any} 验证后的值（无效时返回默认值）
   */
  _validateValue(key, value) {
    const rule = VALIDATION_RULES[key];
    if (!rule || typeof value !== 'number') {
      return value;
    }

    if (value < rule.min || value > rule.max) {
      logger.warn(`System setting ${key} value ${value} out of range [${rule.min}, ${rule.max}], using default`);
      return this._getNestedValue(DEFAULT_SETTINGS, key);
    }

    return value;
  }

  /**
   * 解析值类型
   * @param {string} value - 字符串值
   * @param {string} type - 值类型
   * @returns {any} 解析后的值
   */
  _parseValue(value, type) {
    if (type === 'number') return parseFloat(value);
    if (type === 'boolean') return value === 'true';
    return value;
  }

  /**
   * 获取嵌套对象的值
   * @param {Object} obj - 对象
   * @param {string} path - 路径
   * @returns {any} 值
   */
  _getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  }
}

// 单例实例
let instance = null;

/**
 * 获取 SystemSettingService 单例
 * @param {Object} db - 数据库实例
 * @returns {SystemSettingService}
 */
export function getSystemSettingService(db) {
  if (!instance && db) {
    instance = new SystemSettingService(db);
  }
  return instance;
}

export { DEFAULT_SETTINGS, SystemSettingService };
export default SystemSettingService;
