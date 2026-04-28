/**
 * SystemSetting 控制器
 * 管理系统级配置的增删改查
 * 仅管理员可访问
 */

import logger from '../../lib/logger.js';
import { getSystemSettingService } from '../services/system-setting.service.js';

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
  timeout: {
    vm_execution: 30,       // VM 执行超时（秒）
    python_execution: 300,  // Python 执行超时（秒）
    skill_call: 60,         // 技能调用超时（秒）
    skill_http: 180,        // 技能 HTTP 调用超时（秒）
    resident_skill: 300,    // 驻留技能超时（秒）
    remote_llm: 120,        // 远程 LLM 调用超时（秒）
  },
  tool: {
    max_rounds: 20,         // 最大工具调用轮数
  },
  registration: {
    allow_self_registration: false,    // 是否允许自主注册
    default_invitation_quota: 1,       // 默认邀请配额
    default_invitation_max_uses: 5,    // 默认邀请码最大使用次数
    invitation_expiry_days: 0,         // 邀请码有效期（天）
  },
  app: {
    clock_interval: 30,                // AppClock 轮询间隔（秒）
    batch_size: 10,                    // 每批处理记录数量
    max_concurrency: 5,                // 最大并发处理数
    text_filter_max_length: 50000,     // 文本过滤最大长度（字符）
    attachment_base_path: './data/attachments', // 附件存储路径
    max_upload_size: 50,               // 附件上传大小限制（MB）
  },
};

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
          result[section][key] = this._parseValue(record.setting_value, record.value_type);
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

  async update(ctx) {
    if (!this._checkAdmin(ctx)) return;
    try {
      const updates = ctx.request.body;
      const flatUpdates = this._flattenSettings(updates);
      for (const [key, value] of Object.entries(flatUpdates)) {
        const valueType = typeof value === 'number' ? 'number' : 'string';
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

  async reset(ctx) {
    if (!this._checkAdmin(ctx)) return;
    try {
      const { keys, all } = ctx.request.body;
      if (all) {
        for (const [key, value] of Object.entries(this._flattenSettings(DEFAULT_SETTINGS))) {
          const valueType = typeof value === 'number' ? 'number' : 'string';
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
            const valueType = typeof defaultValue === 'number' ? 'number' : 'string';
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
