const DEFAULT_FILTER_CONFIG = {
  type: 'internal_llm',
  model_id: null,
  temperature: 0.3,
};

export const availableOutputs = [
  { key: 'text', label: 'OCR原文', type: 'string' },
];

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

export default {
  availableOutputs,
  async process(context) {
    const { record, services, app, stateName } = context;

    const data = record.data || {};
    const ocrText = data._ocr_text;
    if (!ocrText) {
      return { success: false, error: 'No OCR text found' };
    }

    const filterConfig = getFilterConfig(app, stateName || 'pending_filter');
    const filterPrompt = getFilterPrompt(app);

    if (ocrText.length > 50000) {
      return {
        success: true,
        data: {
          _filtered_text: ocrText,
          _filter_note: 'OCR文本过长，跳过过滤',
        },
      };
    }

    try {
      const response = await services.callLlm('filter_text', {
        instruction: filterPrompt,
        ocr_text: ocrText,
        response_format: 'text',
        model_id: filterConfig.model_id,
        temperature: filterConfig.temperature || 0.3,
      });

      const filteredText = response.text || ocrText;

      return {
        success: true,
        data: {
          _filtered_text: filteredText,
          _filter_note: '已过滤',
        },
      };
    } catch (e) {
      return {
        success: true,
        data: {
          _filtered_text: ocrText,
          _filter_note: 'LLM filter failed, kept original: ' + e.message,
        },
      };
    }
  },
};