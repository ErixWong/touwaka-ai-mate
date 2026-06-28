import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

// 先加载环境变量，确保 ATTACHMENT_BASE_PATH 能正确读取
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

// 懒加载：附件目录路径在使用时才解析（避免在 dotenv.config() 之前计算）
function getAttachmentBasePath() {
  const basePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
  return path.resolve(basePath);
}

import Database from '../lib/db.js';
import logger from '../lib/logger.js';
import AppClock from '../lib/app-clock.js';
import { collectOcrAttachmentIds } from '../lib/doc-ocr-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    // 事务外预先缓存所有待删附件 ID 和文件路径（确保事务提交后删盘时能拿到数据）
    // 注意：必须在事务开始前或事务内删除数据库记录前缓存
    let allAttachmentIds = [];
    let attachmentFiles = [];
    if (args.deleteDocument && document) {
      // 统一收集所有 OCR 相关附件 ID（使用单一事实源）
      const ocrAttachmentIds = collectOcrAttachmentIds(ocrResult, { includeAll: true });
      const ocrImages = await DocOcrImage.findAll({
        where: { ocr_result_id: ocrResult.id },
        attributes: ['attachment_id'],
        raw: true,
      });
      const ocrImageIds = ocrImages.map(item => item.attachment_id).filter(Boolean);
      
      // 合并并去重，形成单一删除集合
      allAttachmentIds = [...new Set([...ocrAttachmentIds, ...ocrImageIds])];
      
      // 从数据库查询文件路径（此时数据库记录尚在）
      attachmentFiles = allAttachmentIds.length > 0
        ? await Attachment.findAll({
            where: { id: { [Op.in]: allAttachmentIds } },
            attributes: ['id', 'file_path'],
            raw: true,
          })
        : [];
    }

    // 执行事务：更新状态 + 删除数据库记录
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
        // 清理 document_revision 的 current_revision_id 引用
        await Document.update({ current_revision_id: null }, { where: { id: document.id }, transaction: t });
        // 删除 OCR 图片、OCR 结果（数据库记录）
        await DocOcrImage.destroy({ where: { ocr_result_id: ocrResult.id }, transaction: t });
        await DocOcrResult.destroy({ where: { id: ocrResult.id }, transaction: t });
        // 删除关联的 revision 和 chunk
        if (revision) {
          await models.document_chunk.destroy({ where: { revision_id: revision.id }, transaction: t });
          await DocumentRevision.destroy({ where: { id: revision.id }, transaction: t });
        }
        // 删除附件记录（使用事务前缓存的 ID 列表，避免重复查询）
        if (allAttachmentIds.length > 0) {
          await Attachment.destroy({ where: { id: { [Op.in]: allAttachmentIds } }, transaction: t });
        }
        // 删除文档标签和文档本身
        await models.doc_document_tag.destroy({ where: { document_id: document.id }, transaction: t });
        await Document.destroy({ where: { id: document.id }, transaction: t });
      }
    }); // 事务结束

    // 事务提交后，根据事务前缓存的文件路径删除磁盘文件
    let deletedCount = 0;
    let failedCount = 0;
    if (args.deleteDocument && document && attachmentFiles.length > 0) {
      for (const att of attachmentFiles) {
        if (!att.file_path) continue;
        const fullPath = path.join(getAttachmentBasePath(), att.file_path);
        try {
          await fs.unlink(fullPath);
          deletedCount += 1;
        } catch (err) {
          if (err.code !== 'ENOENT') {
            failedCount += 1;
            logger.warn(`[stop-stuck-ocr] Failed to delete file: ${fullPath}`, err.message);
          }
        }
      }
      logger.info(`[stop-stuck-ocr] File cleanup: to_delete=${attachmentFiles.length}, deleted=${deletedCount}, failed=${failedCount}`);
    }

    console.log(JSON.stringify({
      ok: true,
      task_id: ocrResult.task_id,
      document_id: ocrResult.document_id,
      revision_id: ocrResult.revision_id,
      deleteDocument: !!args.deleteDocument,
      file_cleanup: args.deleteDocument ? { to_delete: attachmentFiles.length, deleted: deletedCount, failed: failedCount } : null,
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