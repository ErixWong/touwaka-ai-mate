import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import Database from '../lib/db.js';
import logger from '../lib/logger.js';
import AppClock from '../lib/app-clock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--task-id') result.taskId = argv[++i];
    else if (arg === '--document-id') result.documentId = argv[++i];
    else if (arg === '--delete-document') result.deleteDocument = true;
    else if (arg === '--skip-remote-cancel') result.skipRemoteCancel = true;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.taskId && !args.documentId) {
    throw new Error('Usage: node scripts/stop-stuck-ocr.js --task-id <id> | --document-id <id> [--delete-document] [--skip-remote-cancel]');
  }

  const db = new Database({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionLimit: 5,
  });

  await db.connect();
  const models = db.models;
  const DocOcrResult = models.doc_ocr_result;
  const Document = models.document;
  const DocumentRevision = models.document_revision;
  const Attachment = models.attachment;
  const DocOcrImage = models.doc_ocr_image;
  const Op = db.Op;

  try {
    const where = {};
    if (args.taskId) where.task_id = args.taskId;
    if (args.documentId) where.document_id = args.documentId;

    const ocrResult = await DocOcrResult.findOne({
      where,
      order: [['updated_at', 'DESC']],
      raw: true,
    });

    if (!ocrResult) {
      throw new Error('OCR result not found');
    }

    const document = await Document.findOne({ where: { id: ocrResult.document_id }, raw: true });
    const revision = await DocumentRevision.findOne({ where: { id: ocrResult.revision_id }, raw: true });

    let remoteCancel = { attempted: false, skipped: true };
    if (!args.skipRemoteCancel && ocrResult.task_id && ['pending', 'processing'].includes(ocrResult.status)) {
      remoteCancel = { attempted: true, skipped: false, ok: false };
      try {
        const result = await AppClock.callMcp('mineru', 'cancel_task', { task_id: ocrResult.task_id }, 30000);
        remoteCancel.ok = true;
        remoteCancel.resultType = typeof result;
      } catch (error) {
        remoteCancel.error = error.message;
      }
    }

    await db.sequelize.transaction(async (t) => {
      await DocOcrResult.update({
        status: 'failed',
        progress: -1,
        error_code: 'manually_stopped',
        error_message: 'Stopped by maintenance script',
        completed_at: new Date(),
        metadata: {
          maintenance_stop: {
            at: new Date().toISOString(),
            remoteCancel,
          },
        },
      }, {
        where: { id: ocrResult.id },
        transaction: t,
      });

      await Document.update({
        processing_status: 'error',
        processing_error_code: 'manually_stopped',
      }, {
        where: { id: ocrResult.document_id },
        transaction: t,
      });

      if (args.deleteDocument && document) {
        const attachmentIds = [
          ocrResult.main_markdown_attachment_id,
          ocrResult.raw_result_attachment_id,
          ocrResult.deliverables_manifest_attachment_id,
          ocrResult.middle_json_attachment_id,
          ocrResult.content_list_attachment_id,
          ocrResult.content_list_v2_attachment_id,
          ocrResult.model_json_attachment_id,
          ocrResult.image_manifest_attachment_id,
        ].filter(Boolean);

        await Document.update({ current_revision_id: null }, { where: { id: document.id }, transaction: t });
        await DocOcrImage.destroy({ where: { ocr_result_id: ocrResult.id }, transaction: t });
        await DocOcrResult.destroy({ where: { id: ocrResult.id }, transaction: t });
        if (revision) {
          await models.document_chunk.destroy({ where: { revision_id: revision.id }, transaction: t });
          await DocumentRevision.destroy({ where: { id: revision.id }, transaction: t });
        }
        if (attachmentIds.length > 0) {
          await Attachment.destroy({ where: { id: { [Op.in]: attachmentIds } }, transaction: t });
        }
        await models.doc_document_tag.destroy({ where: { document_id: document.id }, transaction: t });
        await Document.destroy({ where: { id: document.id }, transaction: t });
      }
    });

    console.log(JSON.stringify({
      ok: true,
      task_id: ocrResult.task_id,
      document_id: ocrResult.document_id,
      revision_id: ocrResult.revision_id,
      deleteDocument: !!args.deleteDocument,
      remoteCancel,
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  logger.error('[stop-stuck-ocr] failed', error.message);
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exit(1);
});