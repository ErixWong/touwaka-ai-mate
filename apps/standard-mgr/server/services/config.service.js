import logger from '../../../../lib/logger.js';

/**
 * standard-mgr 应用级配置服务
 *
 * 配置存储于平台 `mini_apps.config`（TEXT JSON），与 current-feature-analyzer
 * 的 App 配置模式保持一致：
 * - 读：合并 DEFAULT_CONFIG 与已存配置（数据库为准）
 * - 写：校验 llm_model_id 存在且为 text/multimodal 后整体写回
 *
 * 全栈 snake_case：字段名从数据库到前端保持一致。
 */

const DEFAULT_CONFIG = {
  /** LLM 模型 ID（null = 使用专家绑定/系统默认模型） */
  llm_model_id: null,
  /** 清洗会话 temperature */
  temperature: 0,
};

class StandardMgrConfigService {
  constructor(db) {
    this.db = db;
  }

  async getConfig() {
    try {
      const app = await this.db.getOne(`
        SELECT config FROM mini_apps WHERE id = 'standard-mgr'
      `);
      if (!app || !app.config) return { ...DEFAULT_CONFIG };
      const stored = typeof app.config === 'string' ? JSON.parse(app.config) : app.config;
      return { ...DEFAULT_CONFIG, ...stored };
    } catch (err) {
      logger.error('[standard-mgr config] getConfig error:', err.message);
      return { ...DEFAULT_CONFIG };
    }
  }

  async saveConfig(config) {
    try {
      if (config.llm_model_id) {
        const modelConfig = await this.db.getModelConfig(config.llm_model_id);
        if (!modelConfig) throw new Error('指定的 LLM 模型不存在或未激活');
        if (modelConfig.model_type && !['text', 'multimodal'].includes(modelConfig.model_type)) {
          throw new Error('仅允许选择文本或多模态模型 (model_type: text | multimodal)');
        }
      }
      // 字段级合并：仅更新本应用管理的配置键，保留 mini_apps.config 中
      // 平台已有的其他字段（如 extension_tables），避免整体覆盖丢失。
      const existing = await this.getConfig();
      const merged = { ...existing, ...DEFAULT_CONFIG, ...config };
      const json = JSON.stringify(merged);
      await this.db.execute(
        `UPDATE mini_apps SET config = ? WHERE id = 'standard-mgr'`,
        [json]
      );
      logger.info('[standard-mgr config] saveConfig success');
      return merged;
    } catch (err) {
      logger.error('[standard-mgr config] saveConfig error:', err.message);
      throw err;
    }
  }

  /**
   * 返回完整 LLM 模型配置（含 provider 信息），未配置时返回 null。
   * 供清洗链路在启动前解析模型使用。
   */
  async getLLMConfig() {
    const config = await this.getConfig();
    if (!config.llm_model_id) return null;
    try {
      return await this.db.getModelConfig(config.llm_model_id);
    } catch (err) {
      logger.warn('[standard-mgr config] getLLMConfig model not found:', config.llm_model_id);
      return null;
    }
  }
}

export default StandardMgrConfigService;
