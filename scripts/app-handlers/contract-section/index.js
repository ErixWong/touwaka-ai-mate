import logger from '../../../lib/logger.js';

export const availableOutputs = [
  { key: 'sections', label: '章节结构', type: 'array' },
  { key: 'section_count', label: '章节数量', type: 'number' },
];

export default {
  availableOutputs,
  
  async process(context) {
    const { record, services, app } = context;
    
    logger.info(`[contract-section] Processing record ${record.id}`);
    
    const data = record.data || {};
    const sections = data._sections;
    
    if (!sections) {
      logger.error(`[contract-section] Record ${record.id}: No _sections found in row.data`);
      return { success: false, error: 'No _sections found, run text-section first' };
    }
    
    const extTables = app?.config?.extension_tables || [];
    const contentTable = extTables.find(t => t.name === 'app_contract_mgr_content');
    
    if (!contentTable) {
      logger.error(`[contract-section] Record ${record.id}: app_contract_mgr_content not configured`);
      return { success: false, error: 'app_contract_mgr_content not configured' };
    }
    
    try {
      const sectionsJson = typeof sections === 'string' ? sections : JSON.stringify(sections);
      
      logger.info(`[contract-section] Record ${record.id}: Upserting sections (${sections.length || 0} items)`);
      
      await services.callExtension('app_contract_mgr_content', 'upsert', {
        row_id: record.id,
        sections: sectionsJson,
      });
      
      logger.info(`[contract-section] Record ${record.id}: Complete`);
      return {
        success: true,
        data: {
          _section_persisted: true,
          _section_persisted_at: new Date().toISOString(),
        },
      };
    } catch (e) {
      logger.error(`[contract-section] Record ${record.id}: Failed - ${e.message}`);
      return { success: false, error: 'Contract section persist failed: ' + e.message };
    }
  },
};