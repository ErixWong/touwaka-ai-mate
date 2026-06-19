import logger from '../../../lib/logger.js';
import { callWithRetry } from '../../../lib/chat/base-llm.js';
import modelRegistry from '../../../lib/model-registry.js';

class LlmStageRecognitionService {
  constructor(db) {
    this.db = db;
    modelRegistry.init(db);
  }

  async recognize(globals, segments, events, ruleSet, appConfig) {
    let modelConfig = null;
    if (appConfig.llm_model_id) {
      try {
        modelConfig = await this.db.getModelConfig(appConfig.llm_model_id);
      } catch (err) {
        logger.warn('[cfa llm] configured model not found, falling back to default:', appConfig.llm_model_id);
      }
    }

    if (!modelConfig) {
      try {
        modelConfig = await modelRegistry.getExpertModelConfig(null, { model_type: 'text' });
      } catch (err) {
        logger.error('[cfa llm] failed to auto-select text model:', err.message);
        return {
          stages: [],
          summary: '无可用 LLM 模型',
          warnings: [{ message: '未配置 LLM 模型，无法执行阶段识别' }],
          _error: 'no_model_available',
        };
      }
    }

    if (!modelConfig) {
      return {
        stages: [],
        summary: '无可用 LLM 模型',
        warnings: [{ message: '未找到可用文本模型，请先在系统设置中添加并激活文本模型' }],
        _error: 'no_model_available',
      };
    }

    const userMessage = this.buildUserMessage(globals, segments, events, ruleSet, appConfig);

    const systemPrompt = ruleSet.prompt_template
      || appConfig.analysis_prompt_template
      || this.buildDefaultSystemPrompt();

    const schemaText = ruleSet.output_json_schema
      || appConfig.json_output_schema
      || this.buildDefaultOutputSchema();

    const messages = [
      { role: 'system', content: `${systemPrompt}\n\n输出必须严格遵守以下 JSON Schema:\n${schemaText}` },
      { role: 'user', content: userMessage },
    ];

    const retryTimes = appConfig.retry_times ?? 2;
    const timeout = appConfig.timeout_ms ?? 120000;

    for (let attempt = 0; attempt <= retryTimes; attempt++) {
      try {
        const response = await callWithRetry(modelConfig, messages, {
          temperature: appConfig.temperature ?? 0.2,
          max_tokens: appConfig.max_tokens ?? 8000,
          timeout,
        });

        const content = response?.content || response?.message?.content || '';
        const parsed = this.extractAndValidateJson(content);

        if (parsed && parsed.stages && Array.isArray(parsed.stages)) {
          parsed.stages = parsed.stages.filter(s => s.start_time != null && s.end_time != null);
          parsed.stages.sort((a, b) => a.start_time - b.start_time);
          for (const stage of parsed.stages) {
            if (stage.start_time > stage.end_time) {
              [stage.start_time, stage.end_time] = [stage.end_time, stage.start_time];
            }
          }
          return parsed;
        }

        logger.warn(`[cfa llm] attempt ${attempt + 1}: invalid JSON response, retrying`);
      } catch (err) {
        logger.error(`[cfa llm] attempt ${attempt + 1} error:`, err.message);
        if (attempt >= retryTimes) {
          return {
            stages: [],
            summary: 'LLM 调用失败',
            warnings: [{ message: `LLM 调用失败（已重试 ${retryTimes} 次）: ${err.message}` }],
            _error: err.message,
          };
        }
      }
    }

    return {
      stages: [],
      summary: 'JSON 解析失败',
      warnings: [{ message: 'LLM 未返回有效 JSON，阶段识别失败' }],
      _error: 'invalid_json_response',
    };
  }

  buildUserMessage(globals, segments, events, ruleSet, appConfig) {
    const stageDefs = ruleSet.stages || [];

    let segText = '';
    for (const seg of segments) {
      segText += `段${seg.segment_index}: ${seg.kind}, 时间${seg.start_time}s-${seg.end_time}s, 持续${seg.duration}s, 电流均值${seg.mean_current}A, 点数${seg.point_count}, 斜率${seg.slope}, 基线比${seg.baseline_ratio}\n`;
    }

    let ruleText = '';
    for (const stage of stageDefs) {
      ruleText += `- ${stage.stage_code} (${stage.stage_name}): ${stage.semantic_definition || ''}\n`;
    }

    return `文件摘要:
总点数: ${segments.reduce((s, seg) => s + seg.point_count, 0)}
全局: 最小电流 ${globals.min_current}A, 最大电流 ${globals.max_current}A, 均值 ${globals.mean_current}A, 基线均值 ${globals.baseline_mean}A

压缩段列表:
${segText}

当前规则集:
业务背景: ${ruleSet.business_context || '无'}
阶段定义:
${ruleText}

请根据上述压缩段信息和规则集，识别并返回各阶段的起止时间。`;
  }

  buildDefaultSystemPrompt() {
    return `你是一个电流时序数据分析专家。
基于压缩后的电流时序分段信息，识别出符合业务规则的各个阶段。
每个阶段应尽可能连续覆盖完整时间区间，不允许多个阶段的 start_time/end_time 在同一层级产生冲突。
对于不确定的阶段，请通过 confidence 字段表达置信度，并在 warnings 中说明。`;
  }

  buildDefaultOutputSchema() {
    return JSON.stringify({
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
  }

  extractAndValidateJson(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // noop
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      let jsonStr = jsonMatch[0];
      jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }
}

export default LlmStageRecognitionService;
