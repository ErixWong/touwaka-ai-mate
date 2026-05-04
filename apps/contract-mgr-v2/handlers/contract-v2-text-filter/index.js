import logger from '../../../../lib/logger.js';

const DEFAULT_FILTER_CONFIG = {
  type: 'internal_llm',
  model_id: null,
  temperature: 0.3,
};

const CHUNK_MAX_LENGTH = parseInt(process.env.TEXT_FILTER_MAX_LENGTH) || 60000;
const CONTEXT_SUMMARY_MAX_LENGTH = 2000;
const CONTENT_TABLE = 'app_contract_mgr_v2_content';

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
- context_summary.key_terms: 已出现的专业术语及其标准译名/写法
- context_summary.points: 已处理文本的摘要要点列表（字符串数组），总长度不超过${CONTEXT_SUMMARY_MAX_LENGTH}字符`;

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
    let nextChunk = chunks[i];
    if (carriedOver.length + nextChunk.length > CHUNK_MAX_LENGTH * 1.5) {
      const allowLen = Math.floor(CHUNK_MAX_LENGTH * 1.5) - carriedOver.length;
      allProcessed.push(nextChunk.slice(0, Math.max(0, CHUNK_MAX_LENGTH - carriedOver.length)));
      nextChunk = nextChunk.slice(Math.max(0, CHUNK_MAX_LENGTH - carriedOver.length));
    }
    const chunkInput = carriedOver + (carriedOver ? '\n\n' : '') + nextChunk;

    try {
      const result = await filterSingleChunk(services, filterPrompt, filterConfig, chunkInput, contextSummary);
      allProcessed.push(result.processed_part);
      carriedOver = result.carried_over || '';
      contextSummary = trimContextSummary(result.context_summary);
    } catch (chunkErr) {
      logger.error(`[contract-v2-text-filter] Chunk ${i + 1} failed: ${chunkErr.message}`);
      allProcessed.push(chunkInput);
      carriedOver = '';
      contextSummary = { key_terms: {}, points: [] };
    }
  }

  if (carriedOver) allProcessed.push(carriedOver);

  return allProcessed.join('\n\n');
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

    const ocrText = content.ocr_text;
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
