import fs from 'fs/promises';
import path from 'path';

import Utils from './utils.js';
import logger from './logger.js';
import DocPipelineAdvancer from './doc-pipeline-advancer.js';

const DEFAULT_PROVIDER = 'erix-mineru';
const DEFAULT_SERVER_NAME = 'erix-mineru';

const STATUS_MAP = {
  pending: 'pending',
  processing: 'processing',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'failed',
  not_found: 'failed',
  error: 'failed',
};

class DocumentOcrService {
  constructor(db, options = {}) {
    this.db = db;
    this.callMcp = options.callMcp;
    this.provider = options.provider || DEFAULT_PROVIDER;
    this.serverName = options.serverName || DEFAULT_SERVER_NAME;
    this.advancer = new DocPipelineAdvancer(db);
  }

  async submit(documentId, options = {}) {
    this.ensureCallMcp();
    const ctx = await this.loadDocumentContext(documentId);
    const existingOcrResult = await this.getLatestOcrResult(ctx.revision.id);
    if (existingOcrResult?.task_id && ['pending', 'processing', 'completed'].includes(existingOcrResult.status)) {
      logger.info(`[DocumentOcrService] Skip submit for ${documentId}: existing OCR result ${existingOcrResult.id} status=${existingOcrResult.status}`);
      if (existingOcrResult.status === 'completed') {
        return existingOcrResult;
      }
      await this.advancer.advance(documentId, 'ocr_processing');
      return existingOcrResult;
    }

    const attachment = await this.resolveSourceAttachment(ctx.document, ctx.revision, options.attachmentId);
    if (!attachment) {
      await this.markFailed(ctx, 'attachment_not_found', '未找到可用于OCR的源附件');
      throw new Error(`No source attachment found for document ${documentId}`);
    }

    const fileBase64 = await this.readAttachmentBase64(attachment);
    const result = await this.callMcp(
      this.serverName,
      'create_task_from_file',
      {
        file_base64: fileBase64,
        file_name: attachment.file_name || `document-${documentId}.bin`,
        backend: options.backend,
        lang: options.lang || 'ch',
        formula_enable: options.formulaEnable ?? true,
        table_enable: options.tableEnable ?? true,
        image_analysis: options.imageAnalysis ?? true,
      },
      options.timeoutMs || 120000,
    );

    const ocrResult = await this.ensureOcrResult(ctx);
    const normalizedStatus = this.normalizeStatus(result?.status || 'pending');
    await ocrResult.update({
      provider: this.provider,
      task_id: result?.task_id || null,
      status: normalizedStatus,
      progress: normalizedStatus === 'failed' ? -1 : 0,
      started_at: new Date(),
      error_code: normalizedStatus === 'failed' ? 'submit_failed' : null,
      error_message: normalizedStatus === 'failed' ? (result?.error || result?.message || 'OCR submit failed') : null,
      metadata: {
        ...(ocrResult.metadata || {}),
        submit_result: result,
      },
    });

    if (normalizedStatus === 'failed') {
      await this.advancer.fail(documentId, 'ocr_submit_failed', result?.error || result?.message || 'OCR submit failed');
      return ocrResult;
    }

    await this.advancer.advance(documentId, 'ocr_processing');
    return ocrResult;
  }

  async syncTaskStatus(documentId, options = {}) {
    this.ensureCallMcp();
    const ctx = await this.loadDocumentContext(documentId);
    const ocrResult = await this.ensureOcrResult(ctx);
    if (!ocrResult.task_id) {
      if (ctx.document.processing_status === 'pending_ocr') {
        logger.info(`[DocumentOcrService] OCR task missing for ${documentId}, retrying submit`);
        await this.submit(documentId, options);
        const retried = await this.ensureOcrResult(ctx);
        return { ocrResult: retried, statusResult: null, completed: false };
      }
      throw new Error(`OCR task_id missing for document ${documentId}`);
    }

    if (ocrResult.status === 'completed' && ocrResult.main_markdown_attachment_id) {
      await this.advancer.advance(documentId, 'pending_clean');
      return { ocrResult, statusResult: null, completed: true };
    }

    const statusResult = await this.callMcp(
      this.serverName,
      'get_task_status',
      { task_id: ocrResult.task_id },
      options.timeoutMs || 120000,
    );

    const normalizedStatus = this.normalizeStatus(statusResult?.status);
    await ocrResult.update({
      status: normalizedStatus,
      progress: typeof statusResult?.progress === 'number' ? statusResult.progress : ocrResult.progress,
      error_code: normalizedStatus === 'failed' ? 'task_failed' : null,
      error_message: normalizedStatus === 'failed' ? (statusResult?.error || statusResult?.message || 'OCR task failed') : null,
      completed_at: normalizedStatus === 'completed' || normalizedStatus === 'failed' ? new Date() : null,
      metadata: {
        ...(ocrResult.metadata || {}),
        last_status_result: statusResult,
      },
    });

    if (normalizedStatus === 'failed') {
      await this.advancer.fail(documentId, 'ocr_task_failed', statusResult?.error || statusResult?.message || 'OCR task failed');
      return { ocrResult, statusResult, completed: false };
    }

    if (normalizedStatus !== 'completed') {
      return { ocrResult, statusResult, completed: false };
    }

    const finalized = await this.finalizeCompletedTask(ctx, ocrResult, options);
    await this.advancer.advance(documentId, 'pending_clean');
    return { ocrResult: finalized, statusResult, completed: true };
  }

  async finalizeCompletedTask(ctx, ocrResult, options = {}) {
    const taskId = ocrResult.task_id;
    const defaultDeliverable = await this.callMcp(this.serverName, 'get_default_deliverable', { task_id: taskId }, options.timeoutMs || 120000);
    const deliverables = await this.callMcp(this.serverName, 'list_deliverables', { task_id: taskId }, options.timeoutMs || 120000);
    const imageDeliverables = await this.callMcp(this.serverName, 'get_image_deliverables', { task_id: taskId }, options.timeoutMs || 120000);

    const mainMarkdown = this.extractDefaultMarkdown(defaultDeliverable);
    const imageItems = Array.isArray(imageDeliverables?.items) ? imageDeliverables.items : [];
    const imageUrlMap = {};
    const imageRecords = [];

    for (let i = 0; i < imageItems.length; i++) {
      const item = imageItems[i];
      const imageDataUrl = imageDeliverables?.images?.[item.filename];
      if (!imageDataUrl) continue;
      const attachment = await this.createAttachmentFromDataUrl(ctx.revision.id, item.filename, imageDataUrl, item.alt_text || '', item.description || null);
      imageUrlMap[item.relative_path] = `/api/attachments/${attachment.id}`;
      imageRecords.push({ item, attachment, sortOrder: i });
    }

    const rewrittenMarkdown = this.rewriteMarkdownImageLinks(mainMarkdown, imageUrlMap);

    const rawResultAttachment = await this.createTextAttachment(ctx.revision.id, 'ocr-raw-result.json', JSON.stringify(defaultDeliverable, null, 2), 'application/json');
    const deliverablesManifestAttachment = await this.createTextAttachment(ctx.revision.id, 'ocr-deliverables.json', JSON.stringify(deliverables, null, 2), 'application/json');
    const imageManifestAttachment = await this.createTextAttachment(ctx.revision.id, 'ocr-images.json', JSON.stringify(imageDeliverables, null, 2), 'application/json');
    const mainMarkdownAttachment = await this.createTextAttachment(ctx.revision.id, 'ocr-main.md', rewrittenMarkdown, 'text/markdown');

    await ocrResult.update({
      status: 'completed',
      progress: 100,
      main_markdown_attachment_id: mainMarkdownAttachment.id,
      raw_result_attachment_id: rawResultAttachment.id,
      deliverables_manifest_attachment_id: deliverablesManifestAttachment.id,
      image_manifest_attachment_id: imageManifestAttachment.id,
      image_count: imageRecords.length,
      line_count: this.countLines(rewrittenMarkdown),
      completed_at: new Date(),
      error_code: null,
      error_message: null,
      metadata: {
        ...(ocrResult.metadata || {}),
        default_deliverable: {
          format: defaultDeliverable?.format || null,
          filename: defaultDeliverable?.filename || null,
        },
      },
    });

    const DocOcrImage = this.db.getModel('doc_ocr_image');
    for (const { item, attachment, sortOrder } of imageRecords) {
      const ref = Array.isArray(item.references) && item.references.length > 0 ? item.references[0] : null;
      await DocOcrImage.create({
        id: Utils.newID(32),
        ocr_result_id: ocrResult.id,
        attachment_id: attachment.id,
        filename: item.filename || null,
        media_type: item.media_type || attachment.mime_type,
        sort_order: sortOrder,
        referenced_in_markdown: item.referenced_in_markdown ? 1 : 0,
        markdown_path: ref?.markdown_path || item.relative_path || null,
        line_number: ref?.line_number || null,
        start_offset: ref?.start_offset || null,
        end_offset: ref?.end_offset || null,
        alt_text: ref?.alt_text || null,
        description: item.description || null,
      });
    }

    return ocrResult;
  }

  async ensureOcrResult(ctx) {
    const DocOcrResult = this.db.getModel('doc_ocr_result');
    let ocrResult = await this.getLatestOcrResult(ctx.revision.id);

    if (!ocrResult) {
      ocrResult = await DocOcrResult.create({
        id: Utils.newID(32),
        document_id: ctx.document.id,
        revision_id: ctx.revision.id,
        provider: this.provider,
        status: 'pending',
        progress: 0,
        started_at: new Date(),
        metadata: null,
      });
    }

    return ocrResult;
  }

  async getLatestOcrResult(revisionId) {
    const DocOcrResult = this.db.getModel('doc_ocr_result');
    return await DocOcrResult.findOne({
      where: { revision_id: revisionId },
      order: [['created_at', 'DESC']],
    });
  }

  async loadDocumentContext(documentId) {
    const Document = this.db.getModel('document');
    const DocumentRevision = this.db.getModel('document_revision');
    const document = await Document.findByPk(documentId);
    if (!document) throw new Error(`Document not found: ${documentId}`);

    let revision = null;
    if (document.current_revision_id) {
      revision = await DocumentRevision.findByPk(document.current_revision_id);
    }
    if (!revision) {
      revision = await DocumentRevision.findOne({
        where: { document_id: documentId },
        order: [['revision_no', 'DESC']],
      });
    }
    if (!revision) throw new Error(`Document revision not found: ${documentId}`);
    return { document, revision };
  }

  async resolveSourceAttachment(document, revision, explicitAttachmentId = null) {
    const Attachment = this.db.getModel('attachment');
    if (explicitAttachmentId) {
      return await Attachment.findByPk(explicitAttachmentId);
    }

    const candidates = await Attachment.findAll({
      where: {
        source_tag: 'doc-platform',
        source_id: revision.id,
      },
      order: [['created_at', 'DESC']],
    });

    if (candidates.length > 0) return candidates[0];

    const docCandidates = await Attachment.findAll({
      where: {
        source_tag: 'doc-platform',
        source_id: document.id,
      },
      order: [['created_at', 'DESC']],
    });
    return docCandidates[0] || null;
  }

  normalizeStatus(status) {
    return STATUS_MAP[status] || 'failed';
  }

  extractDefaultMarkdown(defaultDeliverable) {
    const result = defaultDeliverable?.result;
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      if (typeof result.markdown === 'string') return result.markdown;
      if (typeof result.content === 'string') return result.content;
    }
    return '';
  }

  rewriteMarkdownImageLinks(markdown, imageUrlMap = {}) {
    if (!markdown) return '';
    let rewritten = markdown;
    for (const [relativePath, attachmentUrl] of Object.entries(imageUrlMap)) {
      const escaped = relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rewritten = rewritten.replace(new RegExp(`\\((?:\\./)?${escaped}\\)`, 'g'), `(${attachmentUrl})`);
    }
    return rewritten;
  }

  countLines(text) {
    if (!text) return 0;
    return text.split(/\r?\n/).length;
  }

  async createTextAttachment(revisionId, fileName, content, mimeType = 'text/plain') {
    return await this.createAttachmentRecord({
      revisionId,
      fileName,
      mimeType,
      buffer: Buffer.from(content || '', 'utf8'),
    });
  }

  async createAttachmentFromDataUrl(revisionId, fileName, dataUrl, altText = '', description = null) {
    const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl || '');
    if (!match) throw new Error(`Invalid data URL for ${fileName}`);
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    return await this.createAttachmentRecord({
      revisionId,
      fileName,
      mimeType,
      buffer,
      altText,
      description,
    });
  }

  async createAttachmentRecord({ revisionId, fileName, mimeType, buffer, altText = null, description = null }) {
    const Attachment = this.db.getModel('attachment');
    const id = Utils.newID(20);
    const extName = path.extname(fileName || '').slice(1) || this.mimeToExt(mimeType);
    const relativePath = this.buildAttachmentRelativePath(id, extName);
    const fullPath = path.join(this.getAttachmentBasePath(), relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);

    await Attachment.create({
      id,
      source_tag: 'doc-platform',
      source_id: revisionId,
      file_name: fileName || null,
      ext_name: extName || null,
      mime_type: mimeType,
      file_size: buffer.length,
      file_path: relativePath,
      alt_text: altText || null,
      description: description || null,
      created_by: 'system:doc-platform',
    });

    return await Attachment.findByPk(id);
  }

  async readAttachmentBase64(attachment) {
    const fullPath = path.join(this.getAttachmentBasePath(), attachment.file_path);
    const buffer = await fs.readFile(fullPath);
    return buffer.toString('base64');
  }

  buildAttachmentRelativePath(id, extName = '') {
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}/${id}${extName ? `.${extName}` : ''}`;
  }

  getAttachmentBasePath() {
    const basePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
    return path.resolve(basePath);
  }

  mimeToExt(mimeType) {
    const map = {
      'text/markdown': 'md',
      'application/json': 'json',
      'text/plain': 'txt',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    };
    return map[mimeType] || 'bin';
  }

  async markFailed(ctx, errorCode, errorMessage) {
    const ocrResult = await this.ensureOcrResult(ctx);
    await ocrResult.update({
      status: 'failed',
      progress: -1,
      error_code: errorCode,
      error_message: errorMessage,
      completed_at: new Date(),
    });
    await this.advancer.fail(ctx.document.id, errorCode, errorMessage);
  }

  ensureCallMcp() {
    if (typeof this.callMcp !== 'function') {
      throw new Error('DocumentOcrService requires callMcp function');
    }
  }
}

export default DocumentOcrService;