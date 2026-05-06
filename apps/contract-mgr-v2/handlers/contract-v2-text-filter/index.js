import logger from '../../../../lib/logger.js';
import { splitIntoChunks, parseLlmResponse, getStepResource, getPrompt, buildLlmParams } from '../shared.js';

const DEFAULT_CHUNK_MAX_LENGTH = parseInt(process.env.TEXT_FILTER_MAX_LENGTH) || 50000;
const DEFAULT_FILTER_CONFIG = {
  type: 'internal_llm',
  model_id: null,
  temperature: 0.3,
};
const CONTENT_TABLE = 'app_contract_mgr_v2_content';

const JSON_FORMAT_PROMPT = `

你必须返回严格的JSON格式：
{
  "processed_text": "本轮清洗后的完整章节内容",
  "carried_over": "末尾不完整章节的原文（未清洗）"
}

处理规则：
1. 识别输入中的OCR文本内容（跳过任务状态JSON、元数据等无关信息）
2. 按章节整理内容，识别章节边界（如"第一章"、"第一条"、"一、"等）
3. processed_text: 只包含本轮能完整处理的章节，末尾不完整的章节不放入
4. carried_over: 末尾不完整章节的原文（保持原样不清洗），会拼接到下轮继续处理；末尾完整则为空字符串

注意：如果输入开头是上一轮的carried_over（原文），请完整处理该章节后，再继续处理后续内容。`;

function getFilterConfig(app) {
  return getStepResource(app, 'pending_filter', DEFAULT_FILTER_CONFIG);
}

function getFilterPrompt(app) {
  return getPrompt(app, 'filter', '去除页码、水印、乱码、多余的空白字符，保留正文内容');
}

async function filterChunk(services, filterPrompt, filterConfig, chunkInput) {
  const response = await services.callLlm('filter_text', {
    instruction: filterPrompt + JSON_FORMAT_PROMPT,
    ocr_text: chunkInput,
    response_format: 'json',
    ...buildLlmParams(filterConfig),
  });

  const parsed = parseLlmResponse(response);

  if (!parsed || typeof parsed.processed_text !== 'string') {
    throw new Error('LLM返回的JSON格式无效');
  }

  return {
    processed_text: parsed.processed_text || '',
    carried_over: parsed.carried_over || '',
  };
}

async function filterWithSlidingWindow(services, filterPrompt, filterConfig, ocrText) {
  const maxLen = filterConfig.chunk_max_length || DEFAULT_CHUNK_MAX_LENGTH;
  const chunks = splitIntoChunks(ocrText, maxLen);
  logger.info(`[contract-v2-text-filter] Sliding window: split into ${chunks.length} chunks`);

  const allProcessed = [];
  let carriedOver = '';

  for (let i = 0; i < chunks.length; i++) {
    const chunkInput = carriedOver + (carriedOver ? '\n' : '') + chunks[i];

    try {
      const result = await filterChunk(services, filterPrompt, filterConfig, chunkInput);
      allProcessed.push(result.processed_text);
      carriedOver = result.carried_over;
      logger.info(`[contract-v2-text-filter] Chunk ${i + 1}/${chunks.length} done, output=${result.processed_text.length}, carried=${carriedOver.length}`);
    } catch (chunkErr) {
      logger.error(`[contract-v2-text-filter] Chunk ${i + 1} failed: ${chunkErr.message}`);
      allProcessed.push(`<!-- FILTER_FAILED: chunk ${i + 1} -->\n${chunkInput}`);
      carriedOver = '';
    }
  }

  if (carriedOver) {
    try {
      const result = await filterChunk(services, filterPrompt, filterConfig, carriedOver);
      allProcessed.push(result.processed_text);
    } catch (e) {
      logger.error(`[contract-v2-text-filter] Final carried_over failed: ${e.message}`);
      allProcessed.push(`<!-- FILTER_FAILED: final carried_over -->\n${carriedOver}`);
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

    const ocrText = content.ocr_text;
    logger.info(`[contract-v2-text-filter] Record ${record.id}: OCR text length=${ocrText.length}`);

    const filterConfig = getFilterConfig(app);
    const filterPrompt = getFilterPrompt(app);
    const maxLen = filterConfig.chunk_max_length || DEFAULT_CHUNK_MAX_LENGTH;

    let filteredText;

    if (ocrText.length <= maxLen) {
      try {
        const response = await services.callLlm('filter_text', {
          instruction: filterPrompt + JSON_FORMAT_PROMPT,
          ocr_text: ocrText,
          response_format: 'json',
          ...buildLlmParams(filterConfig),
        });
        const parsed = parseLlmResponse(response);
        filteredText = (parsed && parsed.processed_text) || ocrText;
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
