import logger from '../../../../lib/logger.js';

const DEFAULT_FILTER_CONFIG = {
  type: 'internal_llm',
  model_id: null,
  temperature: 0.3,
};

const CHUNK_MAX_LENGTH = parseInt(process.env.TEXT_FILTER_MAX_LENGTH) || 120000;
const CONTEXT_SUMMARY_MAX_LENGTH = 2000;
const CONTENT_TABLE = 'app_contract_mgr_v2_content';

function normalizeText(text) {
  if (!text) return '';
  return text.replace(/\\n/g, '\n');
}

function getFilterConfig(app, stateName) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.step_resources?.[stateName] || config?.step_resources?.pending_filter || DEFAULT_FILTER_CONFIG;
}

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
  "processed_text": "本轮清洗后的完整章节内容",
  "carried_over": "末尾不完整章节的原文（未清洗）",
  "context_summary": {
    "key_terms": {},
    "points": []
  }
}

处理规则：
1. 首先识别输入中的OCR文本内容（跳过任务状态JSON、元数据等无关信息）
2. 按章节整理内容，识别章节边界（如"第一章"、"第一条"、"一、"等）
3. processed_text: 只包含本轮能完整处理的章节，末尾章节如果不完整则不放入
4. carried_over: 末尾不完整章节的原文（保持原样，不清洗），会拼接到下轮继续处理；如果末尾章节完整则为空字符串
5. context_summary: 已处理内容的关键术语和摘要，用于跨块保持一致性

注意：如果输入开头是上一轮的carried_over（原文），请完整处理该章节后，再继续处理后续内容。`;

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
      let text = response.text || '';
      text = text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      logger.warn(`[contract-v2-text-filter] JSON parse failed: ${e.message}, text preview: ${(response.text || '').substring(0, 300)}`);
      parsed = null;
    }
  }

  if (!parsed || typeof parsed.processed_text !== 'string') {
    throw new Error('LLM返回的JSON格式无效');
  }

  return {
    processed_text: parsed.processed_text || '',
    carried_over: parsed.carried_over || '',
    context_summary: parsed.context_summary || { key_terms: {}, points: [] },
  };
}

function trimContextSummary(summary) {
  if (!summary) return { key_terms: {}, points: [] };

  const points = summary.points || [];
  const keyTerms = summary.key_terms || {};
  const trimmedPoints = [];

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
  logger.info(`[contract-v2-text-filter] Sliding window: split into ${chunks.length} chunks`);

  const allProcessed = [];
  let carriedOver = '';
  let contextSummary = { key_terms: {}, points: [] };

  for (let i = 0; i < chunks.length; i++) {
    // 拼接上一轮截断的章节内容到本轮chunk开头，用换行分隔
    const chunkInput = carriedOver + (carriedOver ? '\n' : '') + chunks[i];

    try {
      const result = await filterSingleChunk(services, filterPrompt, filterConfig, chunkInput, contextSummary);
      allProcessed.push(result.processed_text);
      carriedOver = result.carried_over || '';
      contextSummary = trimContextSummary(result.context_summary);
      logger.info(`[contract-v2-text-filter] Chunk ${i + 1}/${chunks.length} done, output=${result.processed_text.length}, carried=${carriedOver.length}`);
    } catch (chunkErr) {
      logger.error(`[contract-v2-text-filter] Chunk ${i + 1} failed: ${chunkErr.message}`);
      allProcessed.push(chunkInput);
      carriedOver = '';
      contextSummary = { key_terms: {}, points: [] };
    }
  }

  // 处理最后一轮截断的内容
  if (carriedOver) {
    try {
      const result = await filterSingleChunk(services, filterPrompt, filterConfig, carriedOver, contextSummary);
      allProcessed.push(result.processed_text);
    } catch (e) {
      logger.error(`[contract-v2-text-filter] Final carried_over failed: ${e.message}`);
      allProcessed.push(carriedOver);
    }
  }

  return allProcessed.join('\n');
}

export const availableOutputs = [
  { key: 'filter_status', label: '过滤状态', type: 'string' },
];

export default {
  availableOutputs,
  async process(context) {
    const { record, services, app } = context;

    logger.info(`[contract-v2-text-filter] Processing record ${record.id}`);

    const content = await services.callExtension(CONTENT_TABLE, 'read', {
      row_id: record.id,
      fields: ['ocr_text'],
    });

    if (!content || !content.ocr_text) {
      return { success: false, error: 'No OCR text found in extension table' };
    }

    const ocrText = normalizeText(content.ocr_text);
    logger.info(`[contract-v2-text-filter] Record ${record.id}: OCR text length=${ocrText.length}`);

    const filterConfig = getFilterConfig(app, 'pending_filter');
    const filterPrompt = getFilterPrompt(app);

    let filteredText;

    if (ocrText.length <= CHUNK_MAX_LENGTH) {
      try {
        const response = await services.callLlm('filter_text', {
          instruction: filterPrompt,
          ocr_text: ocrText,
          response_format: 'text',
          model_id: filterConfig.model_id,
          temperature: filterConfig.temperature || 0.3,
        });
        filteredText = response.text || ocrText;
      } catch (e) {
        logger.error(`[contract-v2-text-filter] Record ${record.id}: LLM filter failed - ${e.message}`);
        filteredText = ocrText;
      }
    } else {
      try {
        filteredText = await filterWithSlidingWindow(services, filterPrompt, filterConfig, ocrText);
      } catch (e) {
        logger.error(`[contract-v2-text-filter] Record ${record.id}: Sliding window failed - ${e.message}`);
        filteredText = ocrText;
      }
    }

    await services.callExtension(CONTENT_TABLE, 'upsert', {
      row_id: record.id,
      filtered_text: filteredText,
      filter_at: new Date(),
    });

    logger.info(`[contract-v2-text-filter] Record ${record.id}: Complete, length=${filteredText.length}`);

    return {
      success: true,
      data: {
        _filter_done: true,
      },
    };
  },
};
