import logger from '../../../lib/logger.js';

export const availableOutputs = [
  { key: 'extract_data', label: '提取数据', type: 'object' },
  { key: 'extract_json', label: '原始JSON', type: 'string' },
];

const CONTRACT_FIELDS = {
  rows: ['contract_number', 'party_a', 'parent_company', 'contract_amount', 'contract_date'],
  content: ['extract_prompt', 'extract_json', 'extract_model', 'extract_temperature', 'extract_at'],
};

function getContractRowData(extractData) {
  const row = { row_id: extractData.row_id };
  for (const f of CONTRACT_FIELDS.rows) {
    if (extractData[f] !== undefined && extractData[f] !== null && extractData[f] !== '') {
      row[f] = extractData[f];
    }
  }
  return row;
}

function getContractContentData(extractData) {
  const content = { row_id: extractData.row_id };
  if (extractData._extract_prompt) content.extract_prompt = extractData._extract_prompt;
  if (extractData._extract_json) content.extract_json = extractData._extract_json;
  if (extractData._extract_model) content.extract_model = extractData._extract_model;
  if (extractData._extract_temperature) content.extract_temperature = extractData._extract_temperature;
  if (extractData._extract_at) content.extract_at = extractData._extract_at;
  return content;
}

export default {
  availableOutputs,
  
  async process(context) {
    const { record, services, app } = context;
    
    logger.info(`[contract-extract] Processing record ${record.id}`);
    
    const data = record.data || {};
    const extractData = data._extract_data;
    
    if (!extractData) {
      logger.error(`[contract-extract] Record ${record.id}: No _extract_data found in row.data`);
      return { success: false, error: 'No _extract_data found, run llm-extract first' };
    }
    
    const extTables = app?.config?.extension_tables || [];
    const rowsTable = extTables.find(t => t.name === 'app_contract_mgr_rows');
    const contentTable = extTables.find(t => t.name === 'app_contract_mgr_content');
    
    if (!rowsTable || !contentTable) {
      logger.error(`[contract-extract] Record ${record.id}: Extension tables not configured`);
      return { success: false, error: 'Extension tables not configured' };
    }
    
    try {
      const rowData = getContractRowData({ ...extractData, row_id: record.id });
      
      if (Object.keys(rowData).length > 1) {
        logger.info(`[contract-extract] Record ${record.id}: Upserting to app_contract_mgr_rows`);
        await services.callExtension('app_contract_mgr_rows', 'upsert', rowData);
      }
      
      const contentData = getContractContentData({
        ...extractData,
        row_id: record.id,
        _extract_prompt: data._extract_prompt,
        _extract_json: data._extract_json,
        _extract_model: data._extract_model,
        _extract_temperature: data._extract_temperature,
        _extract_at: data._extract_at || new Date(),
      });
      
      if (Object.keys(contentData).length > 1) {
        logger.info(`[contract-extract] Record ${record.id}: Upserting to app_contract_mgr_content`);
        await services.callExtension('app_contract_mgr_content', 'upsert', contentData);
      }
      
      logger.info(`[contract-extract] Record ${record.id}: Complete`);
      return {
        success: true,
        data: {
          _persisted: true,
          _persisted_at: new Date().toISOString(),
        },
      };
    } catch (e) {
      logger.error(`[contract-extract] Record ${record.id}: Failed - ${e.message}`);
      return { success: false, error: 'Contract extract persist failed: ' + e.message };
    }
  },
};