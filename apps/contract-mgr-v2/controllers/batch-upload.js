import Utils from '../../../lib/utils.js';

/**
 * batch_upload handler for contract-mgr-v2
 * 
 * 使用独立的 content 表管理状态，而非通用的 mini_app_rows
 */

export async function execute(context, params) {
  const { db } = context;
  const { userId, attachmentIds } = params;
  
  const records = [];
  
  try {
    for (const attId of attachmentIds) {
      const attachment = await db.getModel('attachment').findByPk(attId);
      if (!attachment) continue;
      if (attachment.created_by && attachment.created_by !== userId) continue;
      
      const rowId = Utils.newID(20);
      
      await db.sequelize.query(`
        INSERT INTO app_contract_mgr_v2_content 
        (row_id, process_step, file_id, created_at, updated_at)
        VALUES (?, 'pending_ocr', ?, NOW(), NOW())
      `, { replacements: [rowId, attId] });
      
      records.push({
        id: rowId,
        process_step: 'pending_ocr',
        file_id: attId,
        title: attachment.file_name || 'Unknown',
      });
    }
    
    return {
      upload_time: new Date().toISOString(),
      count: records.length,
      records,
    };
  } catch (error) {
    throw new Error(`batch_upload handler failed: ${error.message}`);
  }
}

export default { execute };