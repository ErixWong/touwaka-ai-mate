import logger from '../../../lib/logger.js';
import DocPipelineAdvancer from '../../../lib/doc-pipeline-advancer.js';

const MAX_BATCH_SIZE = 5;

export async function tick(context) {
  const { app, services } = context;

  if (!app) {
    return { skipped: true, reason: 'no_app' };
  }

  const documents = await services.query(
    `SELECT id, processing_status, current_revision_id
     FROM documents
     WHERE processing_status IN ('pending_ocr', 'ocr_processing', 'pending_clean', 'pending_metadata', 'pending_outline', 'pending_chunk')
       AND current_revision_id IS NOT NULL
     ORDER BY processing_updated_at ASC
     LIMIT ?`,
    [MAX_BATCH_SIZE]
  );

  if (!documents || documents.length === 0) {
    return { skipped: true, reason: 'no_pending_documents' };
  }

  let submitted = 0;
  let synced = 0;
  let skipped = 0;
  let outlineExtracted = 0;
  let chunksGenerated = 0;
  let failed = 0;

  const advancer = new DocPipelineAdvancer(context.db);

  for (const doc of documents) {
    try {
      if (doc.processing_status === 'pending_ocr') {
        const submittedResult = await services.documentOcr.submit(doc.id);
        await syncBoundAppRowOnSubmit(services, doc.id, submittedResult);
        submitted += 1;
        continue;
      }

      if (doc.processing_status === 'ocr_processing') {
        const syncResult = await services.documentOcr.syncTaskStatus(doc.id);
        await syncBoundAppRowOnSync(services, doc.id, syncResult);
        synced += 1;
        continue;
      }

      if (doc.processing_status === 'pending_clean' || doc.processing_status === 'pending_metadata') {
        await recordPassThroughRun(services, doc);
        await advancer.advanceToNext(doc.id);
        skipped += 1;
        continue;
      }

      if (doc.processing_status === 'pending_outline') {
        if (!services.documentOutline) {
          failed += 1;
          continue;
        }
        await services.documentOutline.extract(doc.current_revision_id, {
          initiatedByType: 'scheduler',
          initiatedById: null,
        });
        outlineExtracted += 1;
        continue;
      }

      if (doc.processing_status === 'pending_chunk') {
        if (!services.documentChunk) {
          failed += 1;
          continue;
        }
        await services.documentChunk.generate(doc.current_revision_id, {
          initiatedByType: 'scheduler',
          initiatedById: null,
        });
        chunksGenerated += 1;
      }
    } catch (error) {
      failed += 1;
      if (error?.code === 'DOCUMENT_DELETED') {
        logger.warn(`[doc-ocr-pipeline] document ${doc.id} skipped after deletion: ${error.message}`);
      } else {
        logger.error(`[doc-ocr-pipeline] document ${doc.id} failed: ${error.message}`);
      }
    }
  }

  return {
    success: true,
    processed: documents.length,
    submitted,
    synced,
    skipped,
    outlineExtracted,
    chunksGenerated,
    failed,
  };
}

async function syncBoundAppRowOnSubmit(services, documentId, submittedResult) {
  const binding = await getActiveBinding(services, documentId);
  if (!binding) return;

  await updateBoundAppOnSubmit(services, binding, submittedResult);
}

async function syncBoundAppRowOnSync(services, documentId, syncResult) {
  const binding = await getActiveBinding(services, documentId);
  if (!binding) return;

  if (!syncResult?.completed) return;

  const markdownText = await loadAttachmentTextById(services, syncResult.ocrResult?.main_markdown_attachment_id);

  await updateBoundAppOnCompletedSync(services, binding, syncResult, markdownText);
}

async function updateBoundAppOnSubmit(services, binding, submittedResult) {
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
      `INSERT INTO app_contract_mgr_content (row_id, process_step, file_id, created_at, updated_at)
       VALUES (?, 'ocr_submitted', NULL, NOW(), NOW())
       ON DUPLICATE KEY UPDATE process_step = VALUES(process_step), updated_at = NOW()`,
      [binding.row_id]
    );

    const data = await loadMiniAppRowData(services, binding.row_id);
    data._ocr_task_id = taskId;
    data._ocr_service = provider;
    await services.execute(`UPDATE mini_app_rows SET status = 'ocr_submitted', data = ? WHERE id = ?`, [JSON.stringify(data), binding.row_id]);
  }
}

async function updateBoundAppOnCompletedSync(services, binding, syncResult, markdownText) {
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
      `INSERT INTO app_contract_mgr_content (row_id, ocr_text, ocr_service, ocr_at, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW(), NOW())
       ON DUPLICATE KEY UPDATE ocr_text = VALUES(ocr_text), ocr_service = VALUES(ocr_service), ocr_at = VALUES(ocr_at)` ,
      [binding.row_id, markdownText, provider]
    );

    const data = await loadMiniAppRowData(services, binding.row_id);
    data._ocr_service = provider;
    await services.execute(`UPDATE mini_app_rows SET status = 'pending_filter', data = ? WHERE id = ?`, [JSON.stringify(data), binding.row_id]);
  }
}

async function loadMiniAppRowData(services, rowId) {
  const rows = await services.query(`SELECT data FROM mini_app_rows WHERE id = ? LIMIT 1`, [rowId]);
  const rawData = rows?.[0]?.data || '{}';
  try {
    return JSON.parse(rawData);
  } catch {
    return {};
  }
}

async function recordPassThroughRun(services, doc) {
  const DocProcessRun = services.getModel('doc_process_run');
  if (!DocProcessRun) return;
  const Utils = await import('../../../lib/utils.js');
  const { STATUS_SEQUENCE } = await import('../../../lib/doc-pipeline-advancer.js');
  const currentIdx = STATUS_SEQUENCE.indexOf(doc.processing_status);
  const nextStage = currentIdx >= 0 && currentIdx < STATUS_SEQUENCE.length - 1
    ? STATUS_SEQUENCE[currentIdx + 1]
    : 'next';
  await DocProcessRun.create({
    id: Utils.default.newID(),
    revision_id: doc.current_revision_id,
    subject_type: 'documents',
    subject_id: doc.id,
    pipeline_step: doc.processing_status,
    operation: 'start',
    initiated_by_type: 'scheduler',
    initiated_by_id: null,
    result_status: 'ok',
    attempt_no: 1,
    message: `Auto-passed ${doc.processing_status} → ${nextStage} (no handler)`,
    started_at: new Date(),
    finished_at: new Date(),
  });
}

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

export default { tick };