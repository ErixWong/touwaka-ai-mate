import logger from '../../../lib/logger.js';

const DEFAULT_EXTRACT_CONFIG = {
  type: 'internal_llm',
  model_id: null,
  temperature: 0.3,
};

export const availableOutputs = [
  { key: 'text', label: 'OCR原文', type: 'string' },
  { key: 'field_definitions', label: '字段定义JSON', type: 'string' },
];

function getExtractConfig(app, stateName) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.step_resources?.[stateName] || config?.step_resources?.pending_extract || DEFAULT_EXTRACT_CONFIG;
}

function parseFields(app) {
  let fields = app?.fields;
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields); } catch { fields = []; }
  }
  return Array.isArray(fields) ? fields : [];
}

function getExtensionTables(app) {
  let config = app?.config || app?.manifest;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.extension_tables || [];
}

function getExtractPrompt(app) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.prompts?.extract || null;
}

function getExtractGuide(field) {
  const { name, label, type, required } = field;
  const guides = {
    'contract_number': '查找合同编号，通常在合同首页顶部，格式如 HT-XXX 或 合同编号：XXX',
    'party_a': '查找甲方名称，通常在合同开头，甲方：XXX',
    'parent_company': '如果甲方是子公司，推断其上级公司名称，如"联想控股子公司A"的上级公司为"联想控股"',
    'contract_amount': '查找合同总金额，通常在金额条款中，注意区分币种',
    'contract_date': '查找签订日期，格式 YYYY-MM-DD 或 YYYY年MM月DD日',
    'start_date': '查找合同开始日期，格式 YYYY-MM-DD',
    'end_date': '查找合同结束日期，格式 YYYY-MM-DD',
    'party_b': '查找乙方名称，通常在合同开头，乙方：XXX',
    'payment_terms': '查找付款条款，提取关键付款条件',
  };
  
  let guide = guides[name];
  if (!guide) {
    const typeGuides = {
      'text': `查找${label}内容`,
      'number': `查找${label}数值`,
      'date': `查找${label}，格式 YYYY-MM-DD`,
      'textarea': `提取${label}全文内容`,
    };
    guide = typeGuides[type] || `提取${label}内容`;
  }
  
  return required ? guide + '（必填）' : guide;
}

export default {
  availableOutputs,
  async process(context) {
    const { record, app, services, stateName } = context;

    logger.info(`[llm-extract] Processing record ${record.id}`);

    const data = record.data || {};
    const text = data._filtered_text || data._ocr_text;
    if (!text) {
      logger.error(`[llm-extract] Record ${record.id}: No text found`);
      return { success: false, error: 'No text found, run OCR and filter first' };
    }

    logger.info(`[llm-extract] Record ${record.id}: Text length=${text.length}`);

    const baseFields = parseFields(app).filter(f => f.ai_extractable && f.type !== 'file');
    
    const extTables = getExtensionTables(app);
    const primaryConfig = extTables.find(t => t.type === 'primary');
    
    const extFields = primaryConfig?.fields?.map(f => ({
      name: f.source || f.name,
      label: f.label || f.name,
      type: f.type.replace(/VARCHAR\(\d+\)/, 'text').replace(/DECIMAL\(.+\)/, 'number').replace(/DATE/, 'date'),
      required: f.required || false,
    })) || [];
    
    const allFields = [...baseFields, ...extFields];
    
    logger.info(`[llm-extract] Record ${record.id}: Fields to extract: ${allFields.map(f => f.name).join(', ')}`);
    
    if (allFields.length === 0) {
      logger.error(`[llm-extract] Record ${record.id}: No extractable fields defined`);
      return { success: false, error: 'No extractable fields defined' };
    }

    const fieldDefs = allFields
      .map(f => `- ${f.name} (${f.label}): type=${f.type}${f.required ? ', required' : ''}`)
      .join('\n');

    const exampleJson = allFields
      .map(f => `  "${f.name}": "${getExtractGuide(f)}"`)
      .join(',\n');

    const extractConfig = getExtractConfig(app, stateName || 'pending_extract');
    const customPrompt = getExtractPrompt(app);

    const promptBase = customPrompt
      ? `${customPrompt}\n\n字段定义:\n${fieldDefs}\n\n期望返回 JSON 格式:\n{\n${exampleJson}\n}`
      : `从以下文本中提取结构化元数据。

字段定义:
${fieldDefs}

期望返回 JSON 格式:
{
${exampleJson}
}`;

    try {
      logger.info(`[llm-extract] Record ${record.id}: Calling LLM for extraction`);
      const response = await services.callLlm('extract_metadata', {
        instruction: promptBase,
        ocr_text: text,
        response_format: 'json',
        model_id: extractConfig.model_id,
        temperature: extractConfig.temperature || 0.3,
      });

      logger.info(`[llm-extract] Record ${record.id}: LLM response received`);

      let metadata;
      const resultText = response.text || response.parsed || response;
      if (typeof resultText === 'string') {
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          logger.error(`[llm-extract] Record ${record.id}: LLM did not return valid JSON`);
          return { success: false, error: 'LLM did not return valid JSON' };
        }
        metadata = JSON.parse(jsonMatch[0]);
      } else if (typeof resultText === 'object') {
        metadata = resultText;
      } else {
        logger.error(`[llm-extract] Record ${record.id}: LLM returned unexpected format`);
        return { success: false, error: 'LLM returned unexpected format' };
      }

      const cleanMetadata = {};
      for (const field of allFields) {
        if (metadata[field.name] !== undefined) {
          cleanMetadata[field.name] = metadata[field.name];
        }
      }

      logger.info(`[llm-extract] Record ${record.id}: Extracted fields: ${Object.keys(cleanMetadata).join(', ')}`);

      const contentConfig = extTables.find(t => t.type === 'content');
      if (contentConfig && services.callExtension) {
        logger.info(`[llm-extract] Record ${record.id}: Saving to extension table ${contentConfig.name}`);
        let extractJsonStr;
        try {
          extractJsonStr = JSON.stringify(cleanMetadata);
        } catch {
          extractJsonStr = '{}';
        }
        
        await services.callExtension(contentConfig.name, 'update', {
          row_id: record.id,
          extract_prompt: promptBase,
          extract_json: extractJsonStr,
          extract_model: extractConfig.model_id || 'unknown',
          extract_at: new Date().toISOString()
        });
      }

      logger.info(`[llm-extract] Record ${record.id}: Extraction complete`);
      return {
        success: true,
        data: cleanMetadata,
      };
    } catch (e) {
      logger.error(`[llm-extract] Record ${record.id}: Extraction failed - ${e.message}`);
      return { success: false, error: 'LLM extraction failed: ' + e.message };
    }
  },
};
