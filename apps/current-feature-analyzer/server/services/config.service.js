import logger from '../../../../lib/logger.js';

export const DEFAULT_ANALYSIS_PROMPT_TEMPLATE = `你是一个电流时序数据分析专家。
基于压缩后的电流时序分段信息，识别出符合业务规则的各个阶段。
每个阶段应尽可能连续覆盖完整时间区间，不允许多个阶段的 start_time/end_time 在同一层级产生冲突。
对于不确定的阶段，请通过 confidence 字段表达置信度，并在 warnings 中说明。
你是结构化输出接口的一部分，不允许输出自然语言解释、思维链、分析过程或 markdown。`;

export const DEFAULT_JSON_OUTPUT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    stages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stage_code: { type: 'string' },
          stage_name: { type: 'string' },
          start_time: { type: 'number' },
          end_time: { type: 'number' },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['stage_code', 'stage_name', 'start_time', 'end_time'],
      },
    },
    summary: { type: 'string' },
    warnings: { type: 'array', items: { type: 'object' } },
  },
  required: ['stages'],
});

const DEFAULT_CONFIG = {
  enabled: true,
  llm_model_id: null,
  temperature: 0,
  enable_json_repair: true,
  default_rule_set_id: null,
  absolute_resolution: 0.03,
  relative_resolution: 0.02,
  merge_gap_ratio: 0.6,
  min_transition_points: 3,
  analysis_prompt_template: DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
  json_output_schema: DEFAULT_JSON_OUTPUT_SCHEMA,
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
        if (modelConfig.model_type && !['text', 'multimodal'].includes(modelConfig.model_type)) {
          throw new Error('仅允许选择文本或多模态模型 (model_type: text | multimodal)');
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
