/**
 * SystemSettingService - 系统配置服务
 * 
 * 提供系统配置的缓存和获取功能
 * 所有配置都从数据库读取，如果数据库没有则创建默认记录
 */

import logger from '../../lib/logger.js';

// 默认配置（仅用于初始化数据库记录）
const DEFAULT_SETTINGS = {
  llm: {
    context_threshold: { value: 0.70, type: 'number', description: 'LLM 上下文阈值' },
    temperature: { value: 0.70, type: 'number', description: 'LLM 温度参数' },
    reflective_temperature: { value: 0.30, type: 'number', description: '反思心智温度参数' },
    top_p: { value: 1.0, type: 'number', description: 'LLM Top-P 参数' },
    frequency_penalty: { value: 0.0, type: 'number', description: 'LLM 频率惩罚' },
    presence_penalty: { value: 0.0, type: 'number', description: 'LLM 存在惩罚' },
  },
  connection: {
    max_per_user: { value: 5, type: 'number', description: '每用户最大连接数' },
    max_per_expert: { value: 100, type: 'number', description: '每专家最大连接数' },
  },
  token: {
    access_expiry: { value: '15m', type: 'string', description: 'Access Token 过期时间' },
    refresh_expiry: { value: '7d', type: 'string', description: 'Refresh Token 过期时间' },
  },
  timeout: {
    vm_execution: { value: 30, type: 'number', description: 'VM 执行超时（秒）' },
    python_execution: { value: 300, type: 'number', description: 'Python 执行超时（秒）' },
    skill_call: { value: 60, type: 'number', description: '技能调用超时（秒）' },
    skill_http: { value: 180, type: 'number', description: '技能 HTTP 调用超时（秒）' },
    resident_skill: { value: 300, type: 'number', description: '驻留技能超时（秒）' },
    remote_llm: { value: 120, type: 'number', description: '远程 LLM 调用超时（秒）' },
  },
  tool: {
    max_rounds: { value: 20, type: 'number', description: '最大工具调用轮数' },
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
  'connection.max_per_user': { min: 1, max: 100 },
  'connection.max_per_expert': { min: 1, max: 1000 },
  'timeout.vm_execution': { min: 5, max: 300 },
  'timeout.python_execution': { min: 10, max: 1800 },
  'timeout.skill_call': { min: 10, max: 600 },
  'timeout.skill_http': { min: 10, max: 1800 },
  'timeout.resident_skill': { min: 30, max: 7200 },
  'timeout.remote_llm': { min: 30, max: 600 },
  'tool.max_rounds': { min: 1, max: 50 },
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
   * 从数据库加载配置，如果没有则创建默认记录
   * @returns {Promise<Object>} 系统配置对象
   */
  async _loadSettingsFromDB() {
    try {
      const records = await this.SystemSetting.findAll({ raw: true });
      
      // 构建结果对象
      const result = {};
      const missingSettings = []; // 需要创建的默认配置
      
      // 遍历所有预期的配置项
      for (const [section, keys] of Object.entries(DEFAULT_SETTINGS)) {
        result[section] = {};
        for (const [key, config] of Object.entries(keys)) {
          const settingKey = `${section}.${key}`;
          const record = records.find(r => r.setting_key === settingKey);
          
          if (record) {
            // 数据库有记录，使用数据库的值
            const parsedValue = this._parseValue(record.setting_value, record.value_type);
            result[section][key] = this._validateValue(settingKey, parsedValue);
          } else {
            // 数据库没有记录，准备创建默认值
            result[section][key] = config.value;
            missingSettings.push({
              setting_key: settingKey,
              setting_value: String(config.value),
              value_type: config.type,
              description: config.description,
            });
          }
        }
      }
      
      // 异步创建缺失的默认配置（不阻塞当前请求）
      if (missingSettings.length > 0) {
        logger.info(`[SystemSettingService] 创建 ${missingSettings.length} 条默认配置记录`);
        this._createDefaultSettings(missingSettings).catch(err => {
          logger.error('[SystemSettingService] 创建默认配置失败:', err.message);
        });
      }
      
      this.cache = result;
      this.cacheTime = Date.now();
      return result;
    } catch (error) {
      logger.error('Failed to load system settings:', error);
      // 返回空对象，避免系统崩溃
      return this._getEmptySettings();
    }
  }

  /**
   * 异步创建默认配置记录
   * @param {Array} settings - 需要创建的配置数组
   */
  async _createDefaultSettings(settings) {
    for (const setting of settings) {
      try {
        // id 字段是自增整数，不需要手动指定
        await this.SystemSetting.create({
          ...setting,
          created_at: new Date(),
          updated_at: new Date(),
        });
      } catch (err) {
        // 忽略重复键错误（并发创建时可能发生）
        if (!err.message.includes('Duplicate') && !err.message.includes('PRIMARY')) {
          logger.warn(`[SystemSettingService] 创建配置失败: ${setting.setting_key}`, err.message);
        }
      }
    }
  }

  /**
   * 获取空配置对象（兜底）
   * @returns {Object}
   */
  _getEmptySettings() {
    const result = {};
    for (const [section, keys] of Object.entries(DEFAULT_SETTINGS)) {
      result[section] = {};
      for (const [key, config] of Object.entries(keys)) {
        result[section][key] = config.value;
      }
    }
    return result;
  }

  /**
   * 获取指定路径的配置值
   * @param {string} path - 配置路径，如 'llm.temperature'
   * @param {any} defaultValue - 默认值（可选）
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
        // 返回默认值
        return defaultValue !== undefined ? defaultValue : this._getDefaultValue(path);
      }
    }
    
    return result;
  }

  /**
   * 获取默认值
   * @param {string} path - 配置路径
   * @returns {any} 默认值
   */
  _getDefaultValue(path) {
    const [section, key] = path.split('.');
    return DEFAULT_SETTINGS[section]?.[key]?.value;
  }

  /**
   * 获取 LLM 默认参数
   * @returns {Promise<Object>} LLM 参数对象
   */
  async getLLMDefaults() {
    const settings = await this.getAllSettings();
    return settings.llm || this._getEmptySettings().llm;
  }

  /**
   * 获取连接限制配置
   * @returns {Promise<Object>} 连接限制对象
   */
  async getConnectionLimits() {
    const settings = await this.getAllSettings();
    return settings.connection || this._getEmptySettings().connection;
  }

  /**
   * 获取 Token 配置
   * @returns {Promise<Object>} Token 配置对象
   */
  async getTokenConfig() {
    const settings = await this.getAllSettings();
    return settings.token || this._getEmptySettings().token;
  }

  /**
   * 获取超时配置
   * @returns {Promise<Object>} 超时配置对象（单位：秒）
   */
  async getTimeoutConfig() {
    const settings = await this.getAllSettings();
    return settings.timeout || this._getEmptySettings().timeout;
  }

  /**
   * 获取单个超时配置值
   * @param {string} key - 超时配置键名（如 'vm_execution'）
   * @returns {Promise<number>} 超时值（单位：秒）
   */
  async getTimeout(key) {
    const timeoutConfig = await this.getTimeoutConfig();
    return timeoutConfig[key] || DEFAULT_SETTINGS.timeout[key]?.value;
  }

  /**
   * 获取工具调用配置
   * @returns {Promise<Object>} 工具配置对象
   */
  async getToolConfig() {
    const settings = await this.getAllSettings();
    return settings.tool || this._getEmptySettings().tool;
  }

  /**
   * 获取最大工具调用轮数
   * @returns {Promise<number>} 最大轮数
   */
  async getMaxToolRounds() {
    const toolConfig = await this.getToolConfig();
    return toolConfig.max_rounds || DEFAULT_SETTINGS.tool.max_rounds.value;
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache = null;
    this.cacheTime = null;
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
      return this._getDefaultValue(key);
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
