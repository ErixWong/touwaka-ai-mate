/**
 * SystemSetting 控制器
 * 管理系统级配置的增删改查
 * 仅管理员可访问
 */

import logger from '../../lib/logger.js';
import { getSystemSettingService, DEFAULT_SETTINGS as SERVICE_DEFAULTS } from '../services/system-setting.service.js';
import {
  DOC_PIPELINE_KEYS,
  getStageDefault,
  mergeWithDefaults,
  isOcrStage,
} from '../../lib/doc-pipeline-defaults.js';

// 从服务层导出的 DEFAULT_SETTINGS 提取扁平默认值（用于控制器 reset 等场景）
// 服务层是权威来源，控制器不独立维护默认值定义
const DEFAULT_SETTINGS = {};
for (const [section, keys] of Object.entries(SERVICE_DEFAULTS)) {
  DEFAULT_SETTINGS[section] = {};
  for (const [key, config] of Object.entries(keys)) {
    DEFAULT_SETTINGS[section][key] = config.value;
  }
}

class SystemSettingController {
  constructor(db) {
    this.db = db;
    this.SystemSetting = db.getModel('system_setting');
    this.systemSettingService = getSystemSettingService(db);
  }

  _checkAdmin(ctx) {
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return false;
    }
    return true;
  }

  _parseSettings(records) {
    const result = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    for (const record of records) {
      const parts = record.setting_key.split('.');
      if (parts.length === 2) {
        const [section, key] = parts;
        if (result[section] && key in result[section]) {
          const defaultType = typeof DEFAULT_SETTINGS[section][key];
          let effectiveType = record.value_type;
          if (defaultType === 'boolean' && record.value_type === 'string' &&
              (record.setting_value === 'true' || record.setting_value === 'false')) {
            effectiveType = 'boolean';
          }
          result[section][key] = this._parseValue(record.setting_value, effectiveType);
        }
      }
    }
    return result;
  }

  _parseValue(value, type) {
    if (type === 'number') return parseFloat(value);
    if (type === 'boolean') return value === 'true';
    return value;
  }

  _getValueType(value) {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'string';
  }

  _flattenSettings(obj, prefix = '') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'object' && value !== null) {
        Object.assign(result, this._flattenSettings(value, fullKey));
      } else {
        result[fullKey] = value;
      }
    }
    return result;
  }

  _getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  }

  async getAll(ctx) {
    if (!this._checkAdmin(ctx)) return;
    try {
      const records = await this.SystemSetting.findAll({ raw: true });
      const result = this._parseSettings(records);
      ctx.success(result);
    } catch (error) {
      logger.error('Get system settings error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  async getRuntime(ctx) {
    try {
      const chatIdle = await this.systemSettingService.get('timeout.chat_idle');
      ctx.success({
        timeout: {
          chat_idle: chatIdle ?? DEFAULT_SETTINGS.timeout.chat_idle,
        },
      });
    } catch (error) {
      logger.error('Get runtime system settings error:', error);
      ctx.error('获取运行时配置失败', 500);
    }
  }

  async update(ctx) {
    if (!this._checkAdmin(ctx)) return;
    try {
      const updates = ctx.request.body;
      const flatUpdates = this._flattenSettings(updates);
      for (const [key, value] of Object.entries(flatUpdates)) {
        const valueType = this._getValueType(value);
        await this.SystemSetting.upsert({
          setting_key: key,
          setting_value: String(value),
          value_type: valueType,
          updated_at: new Date(),
        });
      }
      // 清除 Service 缓存，确保配置更新立即生效
      if (this.systemSettingService) {
        this.systemSettingService.clearCache();
      }
      const records = await this.SystemSetting.findAll({ raw: true });
      ctx.success(this._parseSettings(records));
    } catch (error) {
      logger.error('Update system settings error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  async getDocPipeline(ctx) {
    if (!this._checkAdmin(ctx)) return;
    try {
      const records = await this.SystemSetting.findAll({
        where: { setting_key: DOC_PIPELINE_KEYS.map(k => `doc_pipeline.${k}`) },
        raw: true,
      });
      const stored = {};
      for (const record of records) {
        const stageKey = record.setting_key.replace('doc_pipeline.', '');
        try {
          stored[stageKey] = JSON.parse(record.setting_value);
        } catch {
          stored[stageKey] = null;
        }
      }
      const result = mergeWithDefaults(stored);
      ctx.success(result);
    } catch (error) {
      logger.error('Get doc pipeline config error:', error);
      ctx.error('获取文档预处理配置失败', 500);
    }
  }

  async updateDocPipeline(ctx) {
    if (!this._checkAdmin(ctx)) return;
    try {
      const body = ctx.request.body || {};
      const config = mergeWithDefaults(body);

      for (const key of DOC_PIPELINE_KEYS) {
        if (isOcrStage(key)) {
          const stage = config[key];
          if (stage.type && stage.type !== 'mcp') {
            ctx.error(`阶段 ${key} 执行方式必须为 mcp`, 400);
            return;
          }
          if (stage.enabled === false) {
            ctx.error(`阶段 ${key} 必须启用`, 400);
            return;
          }
        }
      }

      for (const key of DOC_PIPELINE_KEYS) {
        const settingKey = `doc_pipeline.${key}`;
        const value = config[key] || getStageDefault(key);
        await this.SystemSetting.upsert({
          setting_key: settingKey,
          setting_value: JSON.stringify(value),
          value_type: 'json',
          description: `文档预处理流水线配置 - ${key}`,
          updated_at: new Date(),
        });
      }

      if (this.systemSettingService) {
        this.systemSettingService.clearCache();
      }

      ctx.success(config);
    } catch (error) {
      logger.error('Update doc pipeline config error:', error);
      ctx.error('保存文档预处理配置失败', 500);
    }
  }

  async resetDocPipeline(ctx) {
    if (!this._checkAdmin(ctx)) return;
    try {
      const { keys } = ctx.request.body || {};
      const stageKeys = (keys && Array.isArray(keys) && keys.length > 0)
        ? keys.filter(k => DOC_PIPELINE_KEYS.includes(k))
        : DOC_PIPELINE_KEYS;

      const config = {};
      for (const key of stageKeys) {
        const settingKey = `doc_pipeline.${key}`;
        const defaultValue = getStageDefault(key);
        if (defaultValue !== null) {
          await this.SystemSetting.upsert({
            setting_key: settingKey,
            setting_value: JSON.stringify(defaultValue),
            value_type: 'json',
            description: `文档预处理流水线配置 - ${key}`,
            updated_at: new Date(),
          });
        }
        config[key] = defaultValue;
      }

      if (this.systemSettingService) {
        this.systemSettingService.clearCache();
      }

      const records = await this.SystemSetting.findAll({
        where: { setting_key: DOC_PIPELINE_KEYS.map(k => `doc_pipeline.${k}`) },
        raw: true,
      });
      const stored = {};
      for (const record of records) {
        const stageKey = record.setting_key.replace('doc_pipeline.', '');
        try {
          stored[stageKey] = JSON.parse(record.setting_value);
        } catch {
          stored[stageKey] = null;
        }
      }
      ctx.success(mergeWithDefaults(stored));
    } catch (error) {
      logger.error('Reset doc pipeline config error:', error);
      ctx.error('重置文档预处理配置失败', 500);
    }
  }

  async reset(ctx) {
    if (!this._checkAdmin(ctx)) return;
    try {
      const { keys, all } = ctx.request.body;
      if (all) {
        for (const [key, value] of Object.entries(this._flattenSettings(DEFAULT_SETTINGS))) {
          const valueType = this._getValueType(value);
          await this.SystemSetting.upsert({
            setting_key: key,
            setting_value: String(value),
            value_type: valueType,
            updated_at: new Date(),
          });
        }
      } else if (keys && Array.isArray(keys)) {
        for (const key of keys) {
          const defaultValue = this._getNestedValue(DEFAULT_SETTINGS, key);
          if (defaultValue !== undefined) {
            const valueType = this._getValueType(defaultValue);
            await this.SystemSetting.upsert({
              setting_key: key,
              setting_value: String(defaultValue),
              value_type: valueType,
              updated_at: new Date(),
            });
          }
        }
      }
      // 清除 Service 缓存，确保配置更新立即生效
      if (this.systemSettingService) {
        this.systemSettingService.clearCache();
      }
      const records = await this.SystemSetting.findAll({ raw: true });
      ctx.success(this._parseSettings(records));
    } catch (error) {
      logger.error('Reset system settings error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }
}

export default SystemSettingController;
