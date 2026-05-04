import logger from '../../../../lib/logger.js';
import { parseLlmResponse, extractKeyParts, getStepResource, getPrompt } from '../shared.js';

const DEFAULT_EXTRACT_CONFIG = {
  type: 'internal_llm',
  model_id: null,
  temperature: 0.3,
};

const CONTENT_TABLE = 'app_contract_mgr_v2_content';
const ROWS_TABLE = 'app_contract_mgr_v2_rows';
const EXTRACT_MAX_INPUT_CHARS = 60000;

const CONTRACT_FIELDS = [
  { name: 'contract_number', label: '合同编号', guide: '查找合同编号，通常在合同首页顶部，格式如 HT-XXX 或 合同编号：XXX' },
  { name: 'party_a', label: '甲方', guide: '查找甲方名称，通常在合同开头，甲方：XXX' },
  { name: 'party_b', label: '乙方', guide: '查找乙方名称，通常在合同开头，乙方：XXX' },
  { name: 'parent_company', label: '上级公司', guide: '如果甲方是子公司，推断其上级公司名称' },
  { name: 'contract_amount', label: '合同金额', guide: '查找合同总金额，注意区分币种' },
  { name: 'contract_date', label: '签订日期', guide: '查找签订日期，格式 YYYY-MM-DD' },
];

function getExtractConfig(app, stateName) {
  return getStepResource(app, stateName, getStepResource(app, 'pending_extract', DEFAULT_EXTRACT_CONFIG));
}

function getExtractPrompt(app) {
  return getPrompt(app, 'extract');
}

function buildPrompt(customPrompt, fieldDefs, exampleJson, partHint) {
  const base = customPrompt
    ? `${customPrompt}\n\n字段定义:\n${fieldDefs}\n\n期望返回 JSON 格式:\n{\n${exampleJson}\n}`
    : `从以下文本中提取结构化元数据。

字段定义:
${fieldDefs}

期望返回 JSON 格式:
{
${exampleJson}
}`;
  return partHint ? base + `\n\n注意：${partHint}` : base;
}

function mergeMetadata(partialResults) {
  const merged = {};
  for (const result of partialResults) {
    if (!result) continue;
    for (const field of CONTRACT_FIELDS) {
      const value = result[field.name];
      if (value === undefined || value === null || value === '') continue;
      if (merged[field.name] === undefined) {
        merged[field.name] = value;
      }
    }
  }
  return merged;
}

function cleanMetadata(metadata) {
  const cleaned = {};
  for (const field of CONTRACT_FIELDS) {
    const value = metadata[field.name];
    if (value === undefined || value === null || value === '') continue;

    if (field.name === 'contract_amount') {
      const num = Number(String(value).replace(/[,，]/g, ''));
      if (!isNaN(num)) cleaned[field.name] = num;
    } else if (field.name === 'contract_date') {
      const dateStr = String(value).replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
      if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dateStr)) cleaned[field.name] = dateStr;
    } else {
      cleaned[field.name] = value;
    }
  }
  return cleaned;
}

export const availableOutputs = [
  { key: 'extract_status', label: '提取状态', type: 'string' },
];

export default {
  availableOutputs,
  async process(context) {
    const { record, services, app } = context;

    logger.info(`[contract-v2-llm-extract] Processing record ${record.id}`);

    const content = await services.callExtension(CONTENT_TABLE, 'read', {
      row_id: record.id,
      fields: ['filtered_text'],
    });

    if (!content || !content.filtered_text) {
      return { success: false, error: 'No filtered text found in extension table' };
    }

    const text = content.filtered_text;
    logger.info(`[contract-v2-llm-extract] Record ${record.id}: Filtered text length=${text.length}`);

    const extractConfig = getExtractConfig(app, 'pending_extract');
    const customPrompt = getExtractPrompt(app);

    const fieldDefs = CONTRACT_FIELDS.map(f => `- ${f.name} (${f.label}): ${f.guide}`).join('\n');
    const exampleJson = CONTRACT_FIELDS.map(f => `  "${f.name}": "提取值"`).join(',\n');

    try {
      let metadata;

      if (text.length <= EXTRACT_MAX_INPUT_CHARS) {
        const promptBase = buildPrompt(customPrompt, fieldDefs, exampleJson);
        const response = await services.callLlm('extract_metadata', {
          instruction: promptBase,
          ocr_text: text,
          response_format: 'json',
          model_id: extractConfig.model_id,
          temperature: extractConfig.temperature || 0.3,
        });
        metadata = parseLlmResponse(response);
        if (!metadata) return { success: false, error: 'LLM did not return valid JSON' };
      } else {
        logger.info(`[contract-v2-llm-extract] Record ${record.id}: Text too long (${text.length} chars), using segmented extraction`);
        const parts = extractKeyParts(text);
        const partialResults = [];

        const prompts = [
          { text: parts.head, hint: '这是合同开头部分，重点提取合同编号、甲方、乙方' },
          { text: parts.amountPart, hint: '这是合同金额相关部分，重点提取合同金额' },
          { text: parts.tail, hint: '这是合同末尾部分，重点提取签订日期' },
        ];

        for (const part of prompts) {
          if (!part.text || part.text.trim().length === 0) continue;
          const promptBase = buildPrompt(customPrompt, fieldDefs, exampleJson, part.hint);
          try {
            const response = await services.callLlm('extract_metadata_segment', {
              instruction: promptBase,
              ocr_text: part.text.substring(0, EXTRACT_MAX_INPUT_CHARS),
              response_format: 'json',
              model_id: extractConfig.model_id,
              temperature: extractConfig.temperature || 0.3,
            });
            const parsed = parseLlmResponse(response);
            if (parsed) partialResults.push(parsed);
          } catch (segErr) {
            logger.warn(`[contract-v2-llm-extract] Segment extraction failed: ${segErr.message}`);
          }
        }

        metadata = mergeMetadata(partialResults);
        if (Object.keys(metadata).length === 0) {
          return { success: false, error: 'Segmented extraction produced no results' };
        }
      }

      const finalMetadata = cleanMetadata(metadata);
      logger.info(`[contract-v2-llm-extract] Record ${record.id}: Extracted fields: ${Object.keys(finalMetadata).join(', ') || '(none)'}`);

      await services.callExtension(ROWS_TABLE, 'upsert', {
        row_id: record.id,
        ...finalMetadata,
      });

      await services.callExtension(CONTENT_TABLE, 'upsert', {
        row_id: record.id,
        extract_json: JSON.stringify(finalMetadata),
        extract_model: extractConfig.model_id || null,
        extract_temperature: extractConfig.temperature || 0.3,
        extract_at: new Date(),
      });

      return {
        success: true,
        data: {
          _extract_done: true,
        },
      };
    } catch (e) {
      logger.error(`[contract-v2-llm-extract] Record ${record.id}: ${e.message}`);
      return { success: false, error: 'LLM extraction failed: ' + e.message };
    }
  },
};
