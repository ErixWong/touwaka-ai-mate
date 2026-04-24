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

function getExtractPrompt(app) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.prompts?.extract || null;
}

export default {
  availableOutputs,
  async process(context) {
    const { record, app, services, stateName } = context;

    const data = record.data || {};
    const text = data._filtered_text || data._ocr_text;
    if (!text) {
      return { success: false, error: 'No text found, run OCR and filter first' };
    }

    const fields = parseFields(app);
    const extractableFields = fields.filter(f => f.ai_extractable && f.type !== 'file');
    if (extractableFields.length === 0) {
      return { success: false, error: 'No extractable fields defined' };
    }

    const fieldDefs = extractableFields
      .map(f => `- ${f.name} (${f.label}): type=${f.type}${f.required ? ', required' : ''}`)
      .join('\n');

    const extractConfig = getExtractConfig(app, stateName || 'pending_extract');
    const customPrompt = getExtractPrompt(app);

    const promptBase = customPrompt
      ? `${customPrompt}\n\n字段定义:\n${fieldDefs}`
      : `从以下文本中提取结构化元数据。\n\n字段定义:\n${fieldDefs}`;

    try {
      const response = await services.callLlm('extract_metadata', {
        instruction: promptBase,
        ocr_text: text,
        response_format: 'json',
        model_id: extractConfig.model_id,
        temperature: extractConfig.temperature || 0.3,
      });

      let metadata;
      const resultText = response.text || response.parsed || response;
      if (typeof resultText === 'string') {
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return { success: false, error: 'LLM did not return valid JSON' };
        }
        metadata = JSON.parse(jsonMatch[0]);
      } else if (typeof resultText === 'object') {
        metadata = resultText;
      } else {
        return { success: false, error: 'LLM returned unexpected format' };
      }

      const cleanMetadata = {};
      for (const field of extractableFields) {
        if (metadata[field.name] !== undefined) {
          cleanMetadata[field.name] = metadata[field.name];
        }
      }

      return {
        success: true,
        data: cleanMetadata,
      };
    } catch (e) {
      return { success: false, error: 'LLM extraction failed: ' + e.message };
    }
  },
};
