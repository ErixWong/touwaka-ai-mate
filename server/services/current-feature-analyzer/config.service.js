import logger from '../../../lib/logger.js';

const DEFAULT_CONFIG = {
  enabled: true,
  llm_model_id: null,
  temperature: 0.2,
  max_tokens: 8000,
  timeout_ms: 120000,
  retry_times: 2,
  enable_json_repair: true,
  default_rule_set_id: null,
  absolute_resolution: 0.03,
  relative_resolution: 0.02,
  merge_gap_ratio: 0.6,
  min_transition_points: 3,
  analysis_prompt_template: '',
  json_output_schema: '',
  ui: {
    show_ripple_rate: true,
    show_llm_reason: true,
    auto_select_first_file: true,
  },
  export: {
    format: 'xlsx',
    sheet_stage_detail_name: 'stage_detail',
    sheet_summary_name: 'summary',
  },
};

class ConfigService {
  constructor(db) {
    this.db = db;
  }

  async getConfig() {
    try {
      const app = await this.db.getOne(`
        SELECT config FROM mini_apps WHERE id = 'current-feature-analyzer'
      `);
      if (!app || !app.config) return { ...DEFAULT_CONFIG };
      const stored = typeof app.config === 'string' ? JSON.parse(app.config) : app.config;
      return { ...DEFAULT_CONFIG, ...stored };
    } catch (err) {
      logger.error('[cfa config] getConfig error:', err.message);
      return { ...DEFAULT_CONFIG };
    }
  }

  async saveConfig(config) {
    try {
      if (config.llm_model_id) {
        const modelConfig = await this.db.getModelConfig(config.llm_model_id);
        if (!modelConfig) throw new Error('指定的 LLM 模型不存在');
        if (modelConfig.model_type && modelConfig.model_type !== 'text') {
          throw new Error('仅允许选择文本模型 (model_type: text)');
        }
      }
      const merged = { ...DEFAULT_CONFIG, ...config };
      const json = JSON.stringify(merged);
      await this.db.execute(
        `UPDATE mini_apps SET config = ? WHERE id = 'current-feature-analyzer'`,
        [json]
      );
      logger.info('[cfa config] saveConfig success');
      return merged;
    } catch (err) {
      logger.error('[cfa config] saveConfig error:', err.message);
      throw err;
    }
  }

  async getLLMConfig() {
    const config = await this.getConfig();
    if (!config.llm_model_id) return null;
    try {
      const modelConfig = await this.db.getModelConfig(config.llm_model_id);
      return modelConfig;
    } catch (err) {
      logger.warn('[cfa config] getLLMConfig model not found:', config.llm_model_id);
      return null;
    }
  }
}

export default ConfigService;
