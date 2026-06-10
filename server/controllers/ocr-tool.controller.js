import logger from '../../lib/logger.js';
import { createTask, getTask } from '../../lib/ocr-tool-store.js';
import Utils from '../../lib/utils.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function normalizeImageDataUrl(imageInput) {
  if (!imageInput || typeof imageInput !== 'string') {
    return { error: 'image is required' };
  }

  let dataUrl = imageInput.trim();
  if (!dataUrl) return { error: 'image is required' };

  if (!dataUrl.startsWith('data:image/')) {
    dataUrl = `data:image/png;base64,${dataUrl}`;
  }

  const parts = dataUrl.split(',');
  if (parts.length < 2) {
    return { error: 'invalid image data url' };
  }

  const base64 = parts[1];
  const sizeBytes = Math.ceil(base64.length * 0.75);

  return { dataUrl, sizeBytes };
}

class OcrToolController {
  constructor(db) {
    this.db = db;
  }

  async analyze(ctx) {
    try {
      const userId = ctx.state.session?.id;
      if (!userId) {
        ctx.error('Unauthorized', 401);
        return;
      }

      const { image, prompt, attachment_id, use_document_platform = false } = ctx.request.body || {};

      if (use_document_platform) {
        const created = await this.createDocumentPlatformTask({ userId, attachmentId: attachment_id, prompt });
        ctx.success(created, 'created');
        return;
      }

      const normalized = normalizeImageDataUrl(image);
      if (normalized.error) {
        ctx.error(normalized.error, 400);
        return;
      }

      if (normalized.sizeBytes > MAX_IMAGE_BYTES) {
        ctx.error('image too large', 400);
        return;
      }

      const task = createTask({
        userId,
        imageDataUrl: normalized.dataUrl,
        prompt: typeof prompt === 'string' ? prompt : '',
      });

      ctx.success({
        task_id: task.id,
        status: task.status,
      }, 'created');
    } catch (err) {
      logger.error('[OCR-Tool] analyze error:', err);
      ctx.error('analyze failed', 500);
    }
  }

  async getStatus(ctx) {
    try {
      const userId = ctx.state.session?.id;
      if (!userId) {
        ctx.error('Unauthorized', 401);
        return;
      }

      const { taskId } = ctx.params;
      const task = getTask(taskId);
      if (!task) {
        ctx.error('task not found', 404);
        return;
      }

      if (task.user_id !== userId) {
        ctx.error('forbidden', 403);
        return;
      }

      ctx.success({
        task_id: task.id,
        status: task.status,
        result: task.result,
        error: task.error,
      });
    } catch (err) {
      logger.error('[OCR-Tool] status error:', err);
      ctx.error('status query failed', 500);
    }
  }

  async getPromptPresets(ctx) {
    try {
      const result = await this.db.sequelize.query(
        "SELECT config FROM mini_apps WHERE id='ocr-tool'",
        { type: this.db.sequelize.QueryTypes.SELECT }
      );
      
      if (!result[0]?.config) {
        ctx.success({ presets: [], defaultId: 'text' });
        return;
      }

      const config = JSON.parse(result[0].config);
      const presets = config.prompt_presets || [];
      const defaultId = config.default_prompt_id || 'text';

      ctx.success({ presets, defaultId });
    } catch (err) {
      logger.error('[OCR-Tool] getPromptPresets error:', err);
      ctx.success({ presets: [], defaultId: 'text' });
    }
  }

  async createDocumentPlatformTask({ userId, attachmentId, prompt }) {
    if (!attachmentId) {
      throw new Error('attachment_id is required when use_document_platform is true');
    }

    const Attachment = this.db.getModel('attachment');
    const MiniAppRow = this.db.getModel('mini_app_row');
    const MiniAppFile = this.db.getModel('mini_app_file');
    const attachment = await Attachment.findByPk(attachmentId);
    if (!attachment) {
      throw new Error('attachment not found');
    }
    if (attachment.created_by && attachment.created_by !== userId) {
      throw new Error('attachment access denied');
    }

    const existingBinding = await this.db.sequelize.query(
      `SELECT b.row_id, b.document_id
       FROM app_doc_bindings b
       INNER JOIN mini_app_files f ON f.record_id = b.row_id AND f.app_id = 'ocr-tool'
       WHERE b.app_id = 'ocr-tool' AND b.binding_status = 'active' AND f.attachment_id = ?
       ORDER BY b.created_at DESC
       LIMIT 1`,
      { replacements: [attachmentId], type: this.db.sequelize.QueryTypes.SELECT }
    );

    if (existingBinding && existingBinding.length > 0) {
      const existingTask = createTask({
        userId,
        imageDataUrl: '',
        prompt: typeof prompt === 'string' ? prompt : '',
        documentId: existingBinding[0].document_id,
        attachmentId,
      });
      return {
        task_id: existingTask.id,
        status: existingTask.status,
        document_id: existingBinding[0].document_id,
        record_id: existingBinding[0].row_id,
        reused: true,
      };
    }

    const collectionId = await this.ensureOcrToolCollection();
    const rowId = Utils.newID(32);
    const documentId = Utils.newID(32);
    const revisionId = Utils.newID(32);

    await this.db.sequelize.transaction(async (t) => {
      await MiniAppRow.create({
        id: rowId,
        app_id: 'ocr-tool',
        user_id: userId,
        title: attachment.file_name || 'OCR Task',
        data: JSON.stringify({
          prompt: typeof prompt === 'string' ? prompt : '',
          _doc_document_id: documentId,
        }),
        status: 'pending_ocr',
      }, { transaction: t });

      await MiniAppFile.create({
        id: Utils.newID(32),
        record_id: rowId,
        app_id: 'ocr-tool',
        attachment_id: attachmentId,
        field_name: 'image',
      }, { transaction: t });

      await this.db.sequelize.query(
        `INSERT INTO documents (id, collection_id, current_revision_id, doc_type, source_system, source_ref_id, title, processing_status, metadata, created_at, updated_at)
         VALUES (?, ?, NULL, 'knowledge', 'ocr-tool', ?, ?, 'pending_ocr', ?, NOW(), NOW())`,
        {
          replacements: [
            documentId,
            collectionId,
            rowId,
            attachment.file_name || 'OCR Task',
            JSON.stringify({ app_id: 'ocr-tool', record_id: rowId, attachment_id: attachmentId }),
          ],
          transaction: t,
        }
      );

      await this.db.sequelize.query(
        `INSERT INTO document_revisions (id, document_id, revision_no, revision_label, revision_status, is_current, created_by, change_summary, created_at, updated_at)
         VALUES (?, ?, 1, 'v1', 'draft', 1, ?, 'Initial OCR tool revision', NOW(), NOW())`,
        { replacements: [revisionId, documentId, userId], transaction: t }
      );

      await this.db.sequelize.query(
        `UPDATE documents SET current_revision_id = ? WHERE id = ?`,
        { replacements: [revisionId, documentId], transaction: t }
      );

      await this.db.sequelize.query(
        `INSERT INTO app_doc_bindings (id, app_id, row_id, document_id, binding_status, created_at, updated_at)
         VALUES (?, 'ocr-tool', ?, ?, 'active', NOW(), NOW())`,
        { replacements: [Utils.newID(20), rowId, documentId], transaction: t }
      );

      await Attachment.update(
        { source_tag: 'doc-platform', source_id: documentId.slice(0, 20) },
        { where: { id: attachmentId }, transaction: t }
      );
    });

    const task = createTask({
      userId,
      imageDataUrl: '',
      prompt: typeof prompt === 'string' ? prompt : '',
      documentId,
      attachmentId,
    });

    return {
      task_id: task.id,
      status: task.status,
      document_id: documentId,
      revision_id: revisionId,
      record_id: rowId,
    };
  }

  async ensureOcrToolCollection() {
    const rows = await this.db.sequelize.query(
      `SELECT id FROM document_collections WHERE name = 'ocr_tool' LIMIT 1`,
      { type: this.db.sequelize.QueryTypes.SELECT }
    );
    if (rows && rows.length > 0) return rows[0].id;

    const id = Utils.newID(20);
    await this.db.sequelize.query(
      `INSERT INTO document_collections (id, name, owner_id, created_by, department_id, visibility, embedding_model_id)
       VALUES (?, 'ocr_tool', ?, ?, '', 'private', '')`,
      { replacements: [id, userIdFallback(), userIdFallback()] }
    );
    return id;
  }
}

function userIdFallback() {
  return 'system:doc-platform';
}

export default OcrToolController;
