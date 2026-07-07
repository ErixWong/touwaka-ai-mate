import logger from '../../../../lib/logger.js';
import modelRegistry from '../../../../lib/model-registry.js';
import InternalLLMService from '../../../../lib/internal-llm-service.js';

const INVALID_JSON_LOG_LIMIT = 1200;
const MAX_SEGMENTS_FOR_LLM = 120;

class StageRecognitionWorkflowService {
  constructor(db) {
    this.db = db;
    modelRegistry.init(db);
    this.internalLLM = new InternalLLMService(db);
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
        const AiModel = this.db.getModel('ai_model');
        if (!AiModel) {
          throw new Error('ai_model not available');
        }

        const model = await AiModel.findOne({
          where: {
            is_active: true,
            model_type: ['text', 'multimodal'],
          },
          order: [['created_at', 'DESC']],
          raw: true,
        });

        if (!model) {
          throw new Error('No active text/multimodal model found');
        }

        modelConfig = await this.db.getModelConfig(model.id);
      } catch (err) {
        logger.error('[cfa llm] failed to auto-select text/multimodal model:', err.message);
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
        warnings: [{ message: '未找到可用文本或多模态模型，请先在系统设置中添加并激活模型' }],
        _error: 'no_model_available',
      };
    }

    const reducedSegments = this.reduceSegmentsForLlm(segments);
    const userMessage = this.buildUserMessage(globals, reducedSegments, events, ruleSet, appConfig, segments.length);

    const systemPrompt = this.buildSystemPrompt(ruleSet, appConfig);

    const schemaText = appConfig.json_output_schema || this.buildDefaultOutputSchema();
    const finalSystemPrompt = `${systemPrompt}\n\n输出要求：\n1. 只能输出一个 JSON 对象，禁止输出 markdown、代码块、注释、前言、结尾说明。\n2. 禁止输出思考过程、reasoning、analysis、thinking process。\n3. 即使无法完整识别，也必须返回合法 JSON。\n4. JSON 中只能包含 schema 允许的字段，不要添加额外字段。\n5. 所有字符串必须使用标准 JSON 双引号。\n\n输出必须严格遵守以下 JSON Schema:\n${schemaText}`;
    const finalUserPrompt = `${userMessage}\n\n请直接返回纯 JSON，不要附加任何解释。`;

    const retryTimes = this.internalLLM.maxRetries;
    let lastDebugResponse = null;

    for (let attempt = 0; attempt <= retryTimes; attempt++) {
      try {
        let parsed = await this.internalLLM.extractJson(finalSystemPrompt, finalUserPrompt, {
          modelId: modelConfig.id,
          temperature: appConfig.temperature ?? 0.2,
          schema: JSON.parse(schemaText),
        });

        const content = JSON.stringify(parsed);
        const reasoningContent = '';

        if ((!parsed || !Array.isArray(parsed.stages) || parsed.stages.length === 0) && appConfig.enable_json_repair !== false) {
          parsed = this.extractStagesFromNarrative(content, ruleSet);
        }

        if ((!parsed || !Array.isArray(parsed.stages) || parsed.stages.length === 0) && appConfig.enable_json_repair !== false) {
          parsed = this.buildHeuristicFallback(segments, ruleSet, content);
        }

        if (parsed && parsed.stages && Array.isArray(parsed.stages)) {
          parsed.stages = parsed.stages.filter(s => s.start_time != null && s.end_time != null);
          parsed.stages.sort((a, b) => a.start_time - b.start_time);
          for (const stage of parsed.stages) {
            if (stage.start_time > stage.end_time) {
              [stage.start_time, stage.end_time] = [stage.end_time, stage.start_time];
            }
          }
          // 始终保留 LLM 原始返回，便于前端和调试查看
          parsed._debug = {
            content: content || '',
            reasoning_content: reasoningContent || '',
            content_length: typeof content === 'string' ? content.length : 0,
            reasoning_length: typeof reasoningContent === 'string' ? reasoningContent.length : 0,
            parsed_from: this.detectParsedSource(content, reasoningContent),
          };
          return parsed;
        }

        const content_preview = this.buildLogPreview(content);
        const reasoning_preview = this.buildLogPreview(reasoningContent);
        const debug_response = {
          attempt: attempt + 1,
          content_length: typeof content === 'string' ? content.length : 0,
          content_preview,
          reasoning_preview,
          parsed_from: this.detectParsedSource(content, reasoningContent),
        };

        logger.warn('[cfa llm] invalid JSON response details:', {
          ...debug_response,
        });
        lastDebugResponse = debug_response;
        logger.warn(`[cfa llm] attempt ${attempt + 1}: invalid JSON response, retrying`);
      } catch (err) {
        logger.error(`[cfa llm] attempt ${attempt + 1} error:`, err.message);
        if (attempt >= retryTimes) {
          return {
            stages: [],
            summary: 'LLM 调用失败',
            warnings: [{ message: `LLM 调用失败（已重试 ${retryTimes} 次）: ${err.message}` }],
            _error: err.message,
            _debug: lastDebugResponse,
          };
        }
      }
    }

    return {
      stages: [],
      summary: 'JSON 解析失败',
      warnings: [{ message: 'LLM 未返回有效 JSON，阶段识别失败' }],
      _error: 'invalid_json_response',
      _debug: lastDebugResponse,
    };
  }

  buildSystemPrompt(ruleSet, appConfig) {
    const basePrompt = appConfig.analysis_prompt_template || this.buildDefaultSystemPrompt();
    const scenarioDescription = String(ruleSet?.description || '').trim();
    const stageDefinitions = Array.isArray(ruleSet?.stages) ? ruleSet.stages : [];

    const stageText = stageDefinitions.length > 0
      ? stageDefinitions.map((stage, index) => {
        return `${index + 1}. ${stage.stage_code || 'unnamed'} (${stage.stage_name || '未命名阶段'})：${stage.semantic_definition || ''}`;
      }).join('\n')
      : '未配置阶段定义，请仅基于可识别信号输出最接近的阶段结果。';

    const sections = [
      basePrompt,
      scenarioDescription ? `场景说明：\n${scenarioDescription}` : null,
      `阶段定义：\n${stageText}`,
      '请基于以上阶段定义识别每个阶段的起止时间，并保持阶段数组结构稳定。',
    ].filter(Boolean);

    return sections.join('\n\n');
  }

  getBestJsonCandidate(content, reasoningContent) {
    if (typeof content === 'string' && content.trim()) {
      return content;
    }

    if (typeof reasoningContent === 'string' && reasoningContent.includes('{')) {
      return reasoningContent;
    }

    return content || reasoningContent || '';
  }

  detectParsedSource(content, reasoningContent) {
    if (typeof content === 'string' && content.trim()) {
      return 'content';
    }
    if (typeof reasoningContent === 'string' && reasoningContent.trim()) {
      return 'reasoning_content';
    }
    return 'empty';
  }

  extractStagesFromNarrative(text, ruleSet) {
    if (typeof text !== 'string' || !text.trim()) return null;

    const stageDefs = Array.isArray(ruleSet?.stages) ? ruleSet.stages : [];
    const stages = [];

    for (const stage of stageDefs) {
      const aliases = [stage.stage_code, stage.stage_name]
        .filter(Boolean)
        .map(value => String(value).trim())
        .filter(Boolean);

      if (aliases.length === 0) continue;

      const aliasPattern = aliases
        .map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

      const regex = new RegExp(`(?:${aliasPattern})[^\\n。；]*?(\\d+(?:\\.\\d+)?)\\s*s?\\s*(?:-|–|—|到|至)\s*(\\d+(?:\\.\\d+)?)\\s*s?`, 'ig');

      let match = null;
      while ((match = regex.exec(text)) !== null) {
        const startTime = Number(match[1]);
        const endTime = Number(match[2]);
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;

        stages.push({
          stage_code: stage.stage_code,
          stage_name: stage.stage_name,
          start_time: Math.min(startTime, endTime),
          end_time: Math.max(startTime, endTime),
          confidence: 0.45,
          reason: '从模型自然语言输出中提取时间区间',
        });
      }
    }

    if (stages.length === 0) return null;

    return {
      stages: this.normalizeStages(stages),
      summary: this.buildLogPreview(text, 300) || '（空响应）',
      warnings: [{ message: '结果来自文本提取，请人工复核' }],
    };
  }

  buildHeuristicFallback(segments, ruleSet, sourceText = '') {
    if (!Array.isArray(segments) || segments.length === 0) {
      return null;
    }

    const stageDefs = Array.isArray(ruleSet?.stages) ? ruleSet.stages : [];
    const stageByCode = new Map(stageDefs.map(stage => [String(stage.stage_code || '').toLowerCase(), stage]));
    const fallbackStages = [];

    const stableLowSegments = segments.filter(seg => seg.kind === 'stable' && Number(seg.baseline_ratio || 0) <= 1.2);
    const startupSegments = segments.filter(seg => ['surge', 'spike', 'transition'].includes(seg.kind) && Number(seg.slope || 0) > 0);
    const normalSegments = segments.filter(seg => ['stable', 'surge'].includes(seg.kind) && Number(seg.baseline_ratio || 0) >= 1.2);
    const stallSegments = segments.filter(seg => ['surge', 'spike'].includes(seg.kind) && Number(seg.baseline_ratio || 0) >= 3);

    this.pushMergedStage(fallbackStages, stageByCode.get('standby'), stableLowSegments, 0.35, '按低电流稳定段推断');
    this.pushMergedStage(fallbackStages, stageByCode.get('startup'), startupSegments.slice(0, 3), 0.35, '按上升尖峰段推断');
    this.pushMergedStage(fallbackStages, stageByCode.get('normal_output'), normalSegments, 0.35, '按持续输出段推断');
    this.pushMergedStage(fallbackStages, stageByCode.get('stall'), stallSegments, 0.3, '按高基线尖峰段推断');

    if (fallbackStages.length === 0) {
      return null;
    }

    return {
      stages: this.normalizeStages(fallbackStages),
      summary: 'LLM 未返回合法 JSON，已按压缩段规则生成候选阶段',
      warnings: [{ message: '结果来自规则兜底，请人工复核' }],
      _debug: {
        attempt: null,
        content_length: typeof sourceText === 'string' ? sourceText.length : 0,
        content_preview: this.buildLogPreview(sourceText),
        reasoning_preview: '',
      },
    };
  }

  pushMergedStage(target, stageDef, matchedSegments, confidence, reason) {
    if (!stageDef || !Array.isArray(matchedSegments) || matchedSegments.length === 0) {
      return;
    }

    const sorted = [...matchedSegments].sort((a, b) => a.start_time - b.start_time);
    target.push({
      stage_code: stageDef.stage_code,
      stage_name: stageDef.stage_name,
      start_time: sorted[0].start_time,
      end_time: sorted[sorted.length - 1].end_time,
      confidence,
      reason,
    });
  }

  normalizeStages(stages) {
    const normalized = stages
      .filter(stage => stage && Number.isFinite(Number(stage.start_time)) && Number.isFinite(Number(stage.end_time)))
      .map(stage => ({
        ...stage,
        start_time: Number(Number(stage.start_time).toFixed(6)),
        end_time: Number(Number(stage.end_time).toFixed(6)),
      }))
      .sort((a, b) => a.start_time - b.start_time);

    return this.assignCycleMarkers(normalized);
  }

  assignCycleMarkers(stages) {
    if (!Array.isArray(stages) || stages.length < 2) {
      return Array.isArray(stages) ? stages : [];
    }

    for (let chunkSize = 1; chunkSize <= Math.floor(stages.length / 2); chunkSize++) {
      if (stages.length % chunkSize !== 0) continue;
      const cycleCount = stages.length / chunkSize;
      if (cycleCount <= 1) continue;

      const firstChunkSignature = stages
        .slice(0, chunkSize)
        .map(stage => `${stage.stage_code || ''}::${stage.stage_name || ''}`)
        .join('|');

      let repeated = true;
      for (let cycleIndex = 1; cycleIndex < cycleCount; cycleIndex++) {
        const signature = stages
          .slice(cycleIndex * chunkSize, (cycleIndex + 1) * chunkSize)
          .map(stage => `${stage.stage_code || ''}::${stage.stage_name || ''}`)
          .join('|');
        if (signature !== firstChunkSignature) {
          repeated = false;
          break;
        }
      }

      if (!repeated) continue;

      return stages.map((stage, index) => ({
        ...stage,
        cycle_index: Math.floor(index / chunkSize) + 1,
        cycle_stage_index: (index % chunkSize) + 1,
      }));
    }

    return stages;
  }

  buildUserMessage(globals, segments, events, ruleSet, appConfig, originalSegmentCount = segments.length) {
    const stageDefs = ruleSet.stages || [];

    let segText = '';
    for (const seg of segments) {
      segText += `段${seg.segment_index}: ${seg.kind}, 时间${seg.start_time}s-${seg.end_time}s, 持续${seg.duration}s, 电流均值${seg.mean_current}A, 点数${seg.point_count}, 斜率${seg.slope}, 基线比${seg.baseline_ratio}, 开始电流${seg.start_current}A, 结束电流${seg.end_current}A\n`;
    }

    let ruleText = '';
    for (const stage of stageDefs) {
      ruleText += `- ${stage.stage_code} (${stage.stage_name}): ${stage.semantic_definition || ''}\n`;
    }

    return `文件摘要:
 总点数: ${segments.reduce((s, seg) => s + seg.point_count, 0)}
 全局: 最小电流 ${globals.min_current}A, 最大电流 ${globals.max_current}A, 均值 ${globals.mean_current}A, 基线均值 ${globals.baseline_mean}A, 采样间隔${globals.sample_interval}s
   压缩段数量: 原始 ${originalSegmentCount} 段，本次送审 ${segments.length} 段

 压缩段列表:
 ${segText}
 当前规则集:
 场景说明: ${ruleSet.description || '无'}
 阶段定义:
 ${ruleText}

 请根据上述压缩段信息和规则集，识别并返回各阶段的起止时间。`;
  }

  reduceSegmentsForLlm(segments) {
    if (!Array.isArray(segments) || segments.length <= MAX_SEGMENTS_FOR_LLM) {
      return Array.isArray(segments) ? segments : [];
    }

    const keepIndices = new Set();
    const lastIndex = segments.length - 1;
    keepIndices.add(0);
    keepIndices.add(lastIndex);

    const priorityKinds = new Set(['surge', 'spike', 'drop', 'transition']);
    segments.forEach((seg, index) => {
      const baselineRatio = Number(seg.baseline_ratio || 0);
      const duration = Number(seg.duration || 0);
      const slope = Math.abs(Number(seg.slope || 0));
      if (priorityKinds.has(seg.kind) || baselineRatio >= 3 || duration >= 1.5 || slope >= 1) {
        keepIndices.add(index);
      }
    });

    if (keepIndices.size < MAX_SEGMENTS_FOR_LLM) {
      const step = Math.max(1, Math.floor(segments.length / MAX_SEGMENTS_FOR_LLM));
      for (let index = 0; index < segments.length; index += step) {
        keepIndices.add(index);
        if (keepIndices.size >= MAX_SEGMENTS_FOR_LLM) break;
      }
    }

    const sortedIndices = [...keepIndices].sort((a, b) => a - b).slice(0, MAX_SEGMENTS_FOR_LLM);
    return sortedIndices.map(index => segments[index]);
  }

  buildDefaultSystemPrompt() {
    return `你是一个电流时序数据分析专家。
基于压缩后的电流时序分段信息，识别出符合业务规则的各个阶段。
每个阶段应尽可能连续覆盖完整时间区间，不允许多个阶段的 start_time/end_time 在同一层级产生冲突。
对于不确定的阶段，请通过 confidence 字段表达置信度，并在 warnings 中说明。
你是结构化输出接口的一部分，不允许输出自然语言解释、思维链、分析过程或 markdown。`;
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
              cycle_index: { type: 'number' },
              cycle_stage_index: { type: 'number' },
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

    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      const fencedParsed = this.tryParseJson(fencedMatch[1]);
      if (fencedParsed) return fencedParsed;
    }

    const extractedJson = this.extractFirstJSONObject(text);
    if (!extractedJson) return null;

    return this.tryParseJson(extractedJson);
  }

  tryParseJson(text) {
    if (typeof text !== 'string' || !text.trim()) return null;

    try {
      let jsonStr = text.trim();
      jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  extractFirstJSONObject(text) {
    if (typeof text !== 'string') return null;

    const startIndex = text.indexOf('{');
    if (startIndex < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (ch === '\\') {
          escaped = true;
          continue;
        }

        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        depth += 1;
        continue;
      }

      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(startIndex, i + 1);
        }
      }
    }

    return null;
  }

  buildLogPreview(text, maxLen = INVALID_JSON_LOG_LIMIT) {
    if (typeof text !== 'string' || !text.trim()) return '';

    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (normalized.length <= maxLen) {
      return normalized;
    }

    return `${normalized.slice(0, maxLen)}... [truncated ${normalized.length - maxLen} chars]`;
  }

}

export default StageRecognitionWorkflowService;
