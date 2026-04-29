import logger from '../../../lib/logger.js';

const DEFAULT_FILTER_CONFIG = {
  type: 'internal_llm',
  model_id: null,
  temperature: 0.3,
};

const CHUNK_MAX_LENGTH = parseInt(process.env.TEXT_FILTER_MAX_LENGTH) || 120000;
const CONTEXT_SUMMARY_MAX_LENGTH = 2000;

function getFilterConfig(app, stateName) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.step_resources?.[stateName] || config?.step_resources?.pending_filter || DEFAULT_FILTER_CONFIG;
}

function getExtensionTables(app) {
  let config = app?.config || app?.manifest;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.extension_tables || [];
}

export const availableOutputs = [
  { key: 'text', label: 'OCR原文', type: 'string' },
];

function getFilterPrompt(app) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.prompts?.filter || '去除页码、水印、乱码、多余的空白字符，保留正文内容';
}

function splitIntoChunks(text, maxLen) {
  const paragraphs = text.split('\n\n');
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 <= maxLen) {
      current += (current ? '\n\n' : '') + para;
    } else {
      if (current) chunks.push(current);
      if (para.length > maxLen) {
        let remaining = para;
        while (remaining.length > 0) {
          chunks.push(remaining.slice(0, maxLen));
          remaining = remaining.slice(maxLen);
        }
        current = '';
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current);

  return chunks.length > 0 ? chunks : [text];
}

const CHUNK_SYSTEM_SUFFIX = `

你必须返回严格的JSON格式：
{
  "processed_part": "本轮清洗后的文本片段",
  "carried_over": "未完成的尾部内容（空字符串表示无剩余）",
  "context_summary": {
    "key_terms": {},
    "points": []
  }
}

规则：
- processed_part: 本轮已完整清洗的文本
- carried_over: 如果末尾文本不完整（如句子被截断），放到这里，会拼接到下轮输入开头
- context_summary.key_terms: 已出现的专业术语及其标准译名/写法（对象格式，键为原文术语，值为标准写法）
- context_summary.points: 已处理文本的摘要要点列表（字符串数组），总长度不超过${CONTEXT_SUMMARY_MAX_LENGTH}字符
- context_summary 会在后续轮次中提供给你，确保术语和关键信息跨块一致`;

async function filterSingleChunk(services, filterPrompt, filterConfig, chunkInput, contextSummary) {
  const promptBase = filterPrompt + CHUNK_SYSTEM_SUFFIX;

  let contextNote = '';
  if (contextSummary && (Object.keys(contextSummary.key_terms || {}).length > 0 || (contextSummary.points || []).length > 0)) {
    contextNote = `\n\n[前文上下文摘要]\n${JSON.stringify(contextSummary, null, 2)}\n请参考以上上下文保持术语和风格一致。`;
  }

  const response = await services.callLlm('filter_text_chunked', {
    instruction: promptBase,
    ocr_text: chunkInput + contextNote,
    response_format: 'json',
    model_id: filterConfig.model_id,
    temperature: filterConfig.temperature || 0.3,
  });

  let parsed;
  if (response.parsed && typeof response.parsed === 'object') {
    parsed = response.parsed;
  } else {
    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      parsed = null;
    }
  }

  if (!parsed || typeof parsed.processed_part !== 'string') {
    throw new Error('LLM返回的JSON格式无效');
  }

  return {
    processed_part: parsed.processed_part || '',
    carried_over: parsed.carried_over || '',
    context_summary: parsed.context_summary || { key_terms: {}, points: [] },
  };
}

function trimContextSummary(summary) {
  if (!summary) return { key_terms: {}, points: [] };

  const points = summary.points || [];
  const keyTerms = summary.key_terms || {};
  const trimmedPoints = [];
  let result = { key_terms: keyTerms, points: trimmedPoints };

  for (const point of points) {
    const candidate = { key_terms: keyTerms, points: [...trimmedPoints, point] };
    if (JSON.stringify(candidate).length <= CONTEXT_SUMMARY_MAX_LENGTH) {
      trimmedPoints.push(point);
    }
  }

  return { key_terms: keyTerms, points: trimmedPoints };
}

async function filterWithSlidingWindow(services, filterPrompt, filterConfig, ocrText) {
  const chunks = splitIntoChunks(ocrText, CHUNK_MAX_LENGTH);
  logger.info(`[text-filter] Sliding window: split into ${chunks.length} chunks`);

  const allProcessed = [];
  let carriedOver = '';
  let contextSummary = { key_terms: {}, points: [] };

  for (let i = 0; i < chunks.length; i++) {
    let nextChunk = chunks[i];
    if (carriedOver.length + nextChunk.length > CHUNK_MAX_LENGTH * 1.5) {
      const allowLen = Math.floor(CHUNK_MAX_LENGTH * 1.5) - carriedOver.length;
      logger.warn(`[text-filter] Chunk ${i + 1}: carried_over (${carriedOver.length}) + chunk (${nextChunk.length}) exceeds 1.5x limit, truncating chunk to ${allowLen}`);
      allProcessed.push(nextChunk.slice(0, Math.max(0, CHUNK_MAX_LENGTH - carriedOver.length)));
      nextChunk = nextChunk.slice(Math.max(0, CHUNK_MAX_LENGTH - carriedOver.length));
    }
    const chunkInput = carriedOver + (carriedOver ? '\n\n' : '') + nextChunk;
    logger.info(`[text-filter] Processing chunk ${i + 1}/${chunks.length}, input length=${chunkInput.length}`);

    try {
      const result = await filterSingleChunk(services, filterPrompt, filterConfig, chunkInput, contextSummary);

      allProcessed.push(result.processed_part);
      carriedOver = result.carried_over || '';
      contextSummary = trimContextSummary(result.context_summary);

      logger.info(`[text-filter] Chunk ${i + 1} done, processed=${result.processed_part.length}, carried_over=${carriedOver.length}`);
    } catch (chunkErr) {
      logger.error(`[text-filter] Chunk ${i + 1} failed: ${chunkErr.message}, appending original text`);
      allProcessed.push(chunkInput);
      carriedOver = '';
      contextSummary = { key_terms: {}, points: [] };
    }
  }

  if (carriedOver) {
    allProcessed.push(carriedOver);
  }

  return allProcessed.join('\n\n');
}

async function upsertFilteredText(services, app, recordId, filteredText) {
  const extTables = getExtensionTables(app);
  const contentConfig = extTables.find(t => t.type === 'content');
  if (contentConfig && services.callExtension) {
    logger.info(`[text-filter] Record ${recordId}: Upserting filtered_text to ${contentConfig.name}`);
    await services.callExtension(contentConfig.name, 'upsert', {
      row_id: recordId,
      filtered_text: filteredText,
    });
  }
}

export default {
  availableOutputs,
  async process(context) {
    const { record, services, app, stateName } = context;

    logger.info(`[text-filter] Processing record ${record.id}`);

    const data = record.data || {};
    const ocrText = data._ocr_text;
    if (!ocrText) {
      logger.error(`[text-filter] Record ${record.id}: No OCR text found`);
      return { success: false, error: 'No OCR text found' };
    }

    logger.info(`[text-filter] Record ${record.id}: OCR text length=${ocrText.length}`);

    const filterConfig = getFilterConfig(app, stateName || 'pending_filter');
    const filterPrompt = getFilterPrompt(app);

    logger.info(`[text-filter] Record ${record.id}: Prompt="${filterPrompt.substring(0, 200)}${filterPrompt.length > 200 ? '...' : ''}"`);

    if (ocrText.length <= CHUNK_MAX_LENGTH) {
      try {
        logger.info(`[text-filter] Record ${record.id}: Calling LLM for single-pass filtering`);
        const response = await services.callLlm('filter_text', {
          instruction: filterPrompt,
          ocr_text: ocrText,
          response_format: 'text',
          model_id: filterConfig.model_id,
          temperature: filterConfig.temperature || 0.3,
        });

        const filteredText = response.text || ocrText;
        logger.info(`[text-filter] Record ${record.id}: Filter complete, result length=${filteredText.length}, preview="${filteredText.substring(0, 200).replace(/\n/g, '\\n')}"`);

        await upsertFilteredText(services, app, record.id, filteredText);

        return {
          success: true,
          data: {
            _filtered_text: filteredText,
            _filter_note: '已过滤',
          },
        };
      } catch (e) {
        logger.error(`[text-filter] Record ${record.id}: LLM filter failed - ${e.message}, keeping original`);

        await upsertFilteredText(services, app, record.id, ocrText);

        return {
          success: true,
          data: {
            _filtered_text: ocrText,
            _filter_note: 'LLM filter failed, kept original: ' + e.message,
          },
        };
      }
    }

    try {
      logger.info(`[text-filter] Record ${record.id}: Text too long (${ocrText.length}), using sliding window`);
      const filteredText = await filterWithSlidingWindow(services, filterPrompt, filterConfig, ocrText);
      logger.info(`[text-filter] Record ${record.id}: Sliding window complete, result length=${filteredText.length}`);

      await upsertFilteredText(services, app, record.id, filteredText);

      return {
        success: true,
        data: {
          _filtered_text: filteredText,
          _filter_note: `分块过滤完成（${ocrText.length} → ${filteredText.length}）`,
        },
      };
    } catch (e) {
      logger.error(`[text-filter] Record ${record.id}: Sliding window filter failed - ${e.message}, keeping original`);

      await upsertFilteredText(services, app, record.id, ocrText);

      return {
        success: true,
        data: {
          _filtered_text: ocrText,
          _filter_note: 'Sliding window failed, kept original: ' + e.message,
        },
      };
    }
  },
};
