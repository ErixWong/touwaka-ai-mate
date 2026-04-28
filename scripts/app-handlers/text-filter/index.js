import logger from '../../../lib/logger.js';

const DEFAULT_FILTER_CONFIG = {
  type: 'internal_llm',
  model_id: null,
  temperature: 0.3,
};

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
    const maxLength = parseInt(process.env.TEXT_FILTER_MAX_LENGTH) || 50000;

    if (ocrText.length > maxLength) {
      logger.info(`[text-filter] Record ${record.id}: Text too long (${ocrText.length}), skipping filter`);
      return {
        success: true,
        data: {
          _filtered_text: ocrText,
          _filter_note: 'OCR文本过长，跳过过滤',
        },
      };
    }

    try {
      logger.info(`[text-filter] Record ${record.id}: Calling LLM for filtering`);
      const response = await services.callLlm('filter_text', {
        instruction: filterPrompt,
        ocr_text: ocrText,
        response_format: 'text',
        model_id: filterConfig.model_id,
        temperature: filterConfig.temperature || 0.3,
      });

      const filteredText = response.text || ocrText;
      logger.info(`[text-filter] Record ${record.id}: Filter complete, result length=${filteredText.length}`);
      
      const extTables = getExtensionTables(app);
      const contentConfig = extTables.find(t => t.type === 'content');
      if (contentConfig && services.callExtension) {
        logger.info(`[text-filter] Record ${record.id}: Upserting filtered_text to ${contentConfig.name}`);
        await services.callExtension(contentConfig.name, 'upsert', {
          row_id: record.id,
          filtered_text: filteredText,
        });
      }
      
      return {
        success: true,
        data: {
          _filtered_text: filteredText,
          _filter_note: '已过滤',
        },
      };
    } catch (e) {
      logger.error(`[text-filter] Record ${record.id}: LLM filter failed - ${e.message}, keeping original`);
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