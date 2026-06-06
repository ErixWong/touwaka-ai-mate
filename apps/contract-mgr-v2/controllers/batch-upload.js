import Utils from '../../../lib/utils.js';

/**
 * batch_upload handler for contract-mgr-v2
 *
 * 创建 content 记录 + Doc Platform intake 绑定
 */

const DOC_TYPE = 'contract';
const DEFAULT_COLLECTION_NAME = 'contract_manager_v2';

async function ensureDefaultCollection(db) {
  const existing = await db.sequelize.query(
    `SELECT id FROM document_collections WHERE name = ? LIMIT 1`,
    { replacements: [DEFAULT_COLLECTION_NAME], type: db.sequelize.QueryTypes.SELECT }
  );
  if (existing && existing.length > 0) return existing[0].id;

  const id = Utils.newID(20);
  const userId = 'system:doc-platform';
  await db.sequelize.query(
    `INSERT INTO document_collections (id, name, owner_id, created_by, department_id, visibility, embedding_model_id)
     VALUES (?, ?, ?, ?, '', 'private', '')`,
    { replacements: [id, DEFAULT_COLLECTION_NAME, userId, userId] }
  );
  return id;
}

export async function execute(context, params) {
  const { db } = context;
  const { userId, attachmentIds } = params;

  let collectionId;
  try {
    collectionId = await ensureDefaultCollection(db);
  } catch (e) {
    collectionId = null;
  }

  const records = [];

  try {
    for (const attId of attachmentIds) {
      const attachment = await db.getModel('attachment').findByPk(attId);
      if (!attachment) continue;
      if (attachment.created_by && attachment.created_by !== userId) continue;

      const rowId = Utils.newID(20);
      const documentId = collectionId ? Utils.newID(20) : null;

      if (documentId && collectionId) {
        await db.sequelize.transaction(async (t) => {
          await db.sequelize.query(
            `INSERT INTO documents (id, collection_id, doc_type, source_system, source_ref_id, title, processing_status, created_at, updated_at)
             VALUES (?, ?, ?, 'contract-mgr-v2', ?, ?, 'pending_ocr', NOW(), NOW())`,
            { replacements: [documentId, collectionId, DOC_TYPE, rowId, attachment.file_name || 'Untitled'], transaction: t }
          );
          await db.sequelize.query(
            `INSERT INTO app_doc_bindings (id, app_id, row_id, document_id, binding_status, created_at, updated_at)
             VALUES (?, 'contract-mgr-v2', ?, ?, 'active', NOW(), NOW())`,
            { replacements: [Utils.newID(20), rowId, documentId], transaction: t }
          );
          await db.sequelize.query(
            `INSERT INTO app_contract_mgr_v2_content
            (row_id, process_step, file_id, document_id, created_at, updated_at)
            VALUES (?, 'pending_ocr', ?, ?, NOW(), NOW())`,
            { replacements: [rowId, attId, documentId], transaction: t }
          );
        }).catch(e => { throw e; });
      } else {
        await db.sequelize.query(
          `INSERT INTO app_contract_mgr_v2_content
          (row_id, process_step, file_id, created_at, updated_at)
          VALUES (?, 'pending_ocr', ?, NOW(), NOW())`,
          { replacements: [rowId, attId] }
        );
      }

      records.push({
        id: rowId,
        process_step: 'pending_ocr',
        file_id: attId,
        title: attachment.file_name || 'Unknown',
        document_id: documentId || null,
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