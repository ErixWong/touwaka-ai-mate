/**
 * doc-pipeline-binding-sync - 文档流水线业务 app 绑定同步辅助
 *
 * 职责：处理 contract-mgr / contract-mgr-v2 等业务 app 的 OCR 结果回填，
 * 与平台内部文档推进主链隔离。
 *
 * Phase 1 从 apps/doc-ocr-pipeline/tick/index.js 迁移而来，保留原有语义。
 */

import { getPreviewAttachmentId } from './doc-ocr-utils.js';

/**
 * 获取文档的活跃绑定
 */
async function getActiveBinding(services, documentId) {
  const rows = await services.query(
    `SELECT app_id, row_id, document_id
     FROM app_doc_bindings
     WHERE document_id = ? AND binding_status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [documentId]
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

/**
 * 读取附件文本内容
 */
async function loadAttachmentTextById(services, attachmentId) {
  if (!attachmentId) return '';
  const rows = await services.query(
    `SELECT file_path FROM attachments WHERE id = ? LIMIT 1`,
    [attachmentId]
  );
  if (!rows || rows.length === 0 || !rows[0].file_path) return '';

  const fs = await import('fs/promises');
  const path = await import('path');
  const fullPath = path.resolve(process.env.ATTACHMENT_BASE_PATH || './data/attachments', rows[0].file_path);
  return await fs.readFile(fullPath, 'utf8');
}

/**
 * OCR 提交后同步绑定 app 行
 */
async function syncDocBindingOnOcrSubmit(services, documentId, submittedResult) {
  const binding = await getActiveBinding(services, documentId);
  if (!binding) return;

  const provider = submittedResult.provider || 'mineru';
  const taskId = submittedResult.task_id || '';

  if (binding.app_id === 'contract-mgr-v2') {
    await services.execute(
      `UPDATE app_contract_mgr_v2_content SET process_step = 'ocr_submitted', ocr_task_id = ?, ocr_service = ? WHERE row_id = ?`,
      [taskId, provider, binding.row_id]
    );
    return;
  }

  if (binding.app_id === 'contract-mgr') {
    await services.execute(
      `INSERT INTO app_contract_mgr_content (row_id, process_step, ocr_service, ocr_task_id, created_at, updated_at)
       VALUES (?, 'ocr_submitted', ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE process_step = VALUES(process_step), ocr_service = VALUES(ocr_service), ocr_task_id = VALUES(ocr_task_id), updated_at = NOW()`,
      [binding.row_id, provider, taskId]
    );
  }
}

/**
 * OCR 完成后同步绑定 app 行
 */
async function syncDocBindingOnOcrCompleted(services, documentId, syncResult) {
  const binding = await getActiveBinding(services, documentId);
  if (!binding) return;

  if (!syncResult?.completed) return;

  const previewAttachmentId = getPreviewAttachmentId(syncResult.ocrResult);
  const markdownText = await loadAttachmentTextById(services, previewAttachmentId);

  const provider = syncResult.ocrResult?.provider || 'mineru';

  if (binding.app_id === 'contract-mgr-v2') {
    await services.execute(
      `UPDATE app_contract_mgr_v2_content SET process_step = 'pending_filter', ocr_text = ?, ocr_service = ?, ocr_at = NOW() WHERE row_id = ?`,
      [markdownText, provider, binding.row_id]
    );
    return;
  }

  if (binding.app_id === 'contract-mgr') {
    await services.execute(
      `INSERT INTO app_contract_mgr_content (row_id, ocr_text, ocr_service, ocr_at, process_step, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), 'pending_filter', NOW(), NOW())
       ON DUPLICATE KEY UPDATE ocr_text = VALUES(ocr_text), ocr_service = VALUES(ocr_service), ocr_at = VALUES(ocr_at), process_step = VALUES(process_step), updated_at = NOW()`,
      [binding.row_id, markdownText, provider]
    );
  }
}

export {
  syncDocBindingOnOcrSubmit,
  syncDocBindingOnOcrCompleted,
};
