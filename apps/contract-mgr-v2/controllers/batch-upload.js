import Utils from '../../../lib/utils.js';

/**
 * batch_upload handler for contract-mgr-v2
 *
 * 创建 content 记录 + Doc Platform intake 绑定
 */

const DOC_TYPE = 'contract';
const DEFAULT_COLLECTION_NAME = 'contract_manager_v2';

async function getUserDepartmentId(db, userId) {
  const User = db.getModel('user');
  const user = await User.findOne({
    where: { id: userId },
    attributes: ['department_id'],
    raw: true,
  });
  return user?.department_id || null;
}

async function ensureDefaultCollection(db, userId) {
  const existing = await db.sequelize.query(
    `SELECT id FROM document_collections WHERE name = ? AND owner_id = ? LIMIT 1`,
    { replacements: [DEFAULT_COLLECTION_NAME, userId], type: db.sequelize.QueryTypes.SELECT }
  );
  if (existing && existing.length > 0) return existing[0].id;

  const departmentId = await getUserDepartmentId(db, userId);
  if (!departmentId) {
    throw new Error('user department_id is required to create contract OCR collection');
  }

  const id = Utils.newID(20);
  try {
    await db.sequelize.query(
      `INSERT INTO document_collections (id, name, owner_id, created_by, department_id, visibility, embedding_model_id)
       VALUES (?, ?, ?, ?, ?, 'private', '')`,
      { replacements: [id, DEFAULT_COLLECTION_NAME, userId, userId, departmentId] }
    );
    return id;
  } catch (error) {
    const retryRows = await db.sequelize.query(
      `SELECT id FROM document_collections WHERE name = ? AND owner_id = ? LIMIT 1`,
      { replacements: [DEFAULT_COLLECTION_NAME, userId], type: db.sequelize.QueryTypes.SELECT }
    );
    if (retryRows && retryRows.length > 0) return retryRows[0].id;
    throw error;
  }
}

export async function execute(context, params) {
  const { db } = context;
  const { userId, attachmentIds } = params;

  const collectionId = await ensureDefaultCollection(db, userId);

  const records = [];

  try {
    for (const attId of attachmentIds) {
      const attachment = await db.getModel('attachment').findByPk(attId);
      if (!attachment) continue;
      if (attachment.created_by !== userId) continue;

      const rowId = Utils.newID(20);
      const contentId = Utils.newID(20);
      const documentId = Utils.newID(20);
      const revisionId = Utils.newID(20);

      await db.sequelize.transaction(async (t) => {
        await db.sequelize.query(
          `INSERT INTO documents (id, collection_id, current_revision_id, doc_type, source_system, source_ref_id, title, processing_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'contract-mgr-v2', ?, ?, 'pending_ocr', NOW(), NOW())`,
          { replacements: [documentId, collectionId, revisionId, DOC_TYPE, rowId, attachment.file_name || 'Untitled'], transaction: t }
        );
        await db.sequelize.query(
          `INSERT INTO document_revisions (id, document_id, revision_no, revision_label, revision_status, is_current, created_by, change_summary, created_at, updated_at)
           VALUES (?, ?, 1, 'v1', 'draft', 1, ?, 'Initial contract-mgr-v2 revision', NOW(), NOW())`,
          { replacements: [revisionId, documentId, userId], transaction: t }
        );
        await db.sequelize.query(
          `INSERT INTO app_doc_bindings (id, app_id, row_id, document_id, binding_status, created_at, updated_at)
           VALUES (?, 'contract-mgr-v2', ?, ?, 'active', NOW(), NOW())`,
          { replacements: [Utils.newID(20), rowId, documentId], transaction: t }
        );
        await db.sequelize.query(
          `INSERT INTO app_contract_mgr_v2_content
          (row_id, content_id, process_step, file_id, document_id, created_at, updated_at)
          VALUES (?, ?, 'pending_ocr', ?, ?, NOW(), NOW())`,
          { replacements: [rowId, contentId, attId, documentId], transaction: t }
        );
        await db.getModel('attachment').update(
          { source_tag: 'doc-platform', source_id: revisionId },
          { where: { id: attId }, transaction: t }
        );
      });

      records.push({
        id: rowId,
        content_id: contentId,
        process_step: 'pending_ocr',
        file_id: attId,
        title: attachment.file_name || 'Unknown',
        document_id: documentId,
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
