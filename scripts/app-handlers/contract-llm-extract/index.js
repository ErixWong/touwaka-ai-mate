import logger from '../../../lib/logger.js';

const DEFAULT_EXTRACT_CONFIG = {
  type: 'internal_llm',
  model_id: null,
  temperature: 0.3,
};

const CONTRACT_FIELDS = [
  { name: 'contract_number', label: '合同编号', guide: '查找合同编号，通常在合同首页顶部，格式如 HT-XXX 或 合同编号：XXX' },
  { name: 'party_a', label: '甲方', guide: '查找甲方名称，通常在合同开头，甲方：XXX' },
  { name: 'party_b', label: '乙方', guide: '查找乙方名称，通常在合同开头，乙方：XXX' },
  { name: 'parent_company', label: '上级公司', guide: '如果甲方是子公司，推断其上级公司名称' },
  { name: 'contract_amount', label: '合同金额', guide: '查找合同总金额，注意区分币种' },
  { name: 'contract_date', label: '签订日期', guide: '查找签订日期，格式 YYYY-MM-DD' },
];

function getExtractConfig(app, stateName) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.step_resources?.[stateName] || config?.step_resources?.pending_extract || DEFAULT_EXTRACT_CONFIG;
}

function getExtractPrompt(app) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.prompts?.extract || null;
}

export const availableOutputs = [
  { key: 'extract_status', label: '提取状态', type: 'string' },
];

export default {
  availableOutputs,
  async process(context) {
    const { record, services, app } = context;

    logger.info(`[contract-llm-extract] Processing record ${record.id}`);

    // ✅ 从扩展表读取清洗文本（不依赖mini_app_rows.data）
    const content = await services.callExtension('app_contract_mgr_content', 'read', {
      row_id: record.id,
      fields: ['filtered_text'],
    });

    if (!content || !content.filtered_text) {
      logger.error(`[contract-llm-extract] Record ${record.id}: No filtered text found in extension table`);
      return { success: false, error: 'No filtered text found in extension table' };
    }

    const text = content.filtered_text;
    logger.info(`[contract-llm-extract] Record ${record.id}: Filtered text length=${text.length}`);

    const extractConfig = getExtractConfig(app, 'pending_extract');
    const customPrompt = getExtractPrompt(app);

    const fieldDefs = CONTRACT_FIELDS.map(f => `- ${f.name} (${f.label}): ${f.guide}`).join('\n');
    const exampleJson = CONTRACT_FIELDS.map(f => `  "${f.name}": "提取值"`).join(',\n');

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
      logger.info(`[contract-llm-extract] Record ${record.id}: Calling LLM for extraction`);
      const response = await services.callLlm('extract_metadata', {
        instruction: promptBase,
        ocr_text: text,
        response_format: 'json',
        model_id: extractConfig.model_id,
        temperature: extractConfig.temperature || 0.3,
      });

      logger.info(`[contract-llm-extract] Record ${record.id}: LLM response received`);

      let metadata;
      const resultText = response.text || response.parsed || response;
      if (typeof resultText === 'string') {
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          logger.error(`[contract-llm-extract] Record ${record.id}: LLM did not return valid JSON`);
          return { success: false, error: 'LLM did not return valid JSON' };
        }
        metadata = JSON.parse(jsonMatch[0]);
      } else if (typeof resultText === 'object') {
        metadata = resultText;
      } else {
        logger.error(`[contract-llm-extract] Record ${record.id}: LLM returned unexpected format`);
        return { success: false, error: 'LLM returned unexpected format' };
      }

      // 清理元数据
      const cleanMetadata = {};
      for (const field of CONTRACT_FIELDS) {
        const value = metadata[field.name];
        if (value === undefined || value === null || value === '') continue;
        
        // 类型转换
        if (field.name === 'contract_amount') {
          const num = Number(String(value).replace(/[,，]/g, ''));
          if (!isNaN(num)) {
            cleanMetadata[field.name] = num;
          }
        } else if (field.name === 'contract_date') {
          const dateStr = String(value).replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
          if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dateStr)) {
            cleanMetadata[field.name] = dateStr;
          }
        } else {
          cleanMetadata[field.name] = value;
        }
      }

      logger.info(`[contract-llm-extract] Record ${record.id}: Extracted fields: ${Object.keys(cleanMetadata).join(', ')}`);

      // ✅ 写入rows扩展表（元数据）
      await services.callExtension('app_contract_mgr_rows', 'upsert', {
        row_id: record.id,
        ...cleanMetadata,
      });

      logger.info(`[contract-llm-extract] Record ${record.id}: Metadata saved to app_contract_mgr_rows`);

      // ✅ 写入content扩展表（提取记录）
      await services.callExtension('app_contract_mgr_content', 'upsert', {
        row_id: record.id,
        extract_json: JSON.stringify(cleanMetadata),
        extract_at: new Date(),
      });

      logger.info(`[contract-llm-extract] Record ${record.id}: Extract info saved to app_contract_mgr_content`);

      // ✅ 只返回标记（不返回元数据）
      return {
        success: true,
        data: {
          _extract_done: true,
        },
      };
    } catch (e) {
      logger.error(`[contract-llm-extract] Record ${record.id}: Extraction failed - ${e.message}`);
      return { success: false, error: 'LLM extraction failed: ' + e.message };
    }
  },
};