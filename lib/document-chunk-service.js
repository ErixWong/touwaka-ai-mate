import Utils from './utils.js';
import logger from './logger.js';
import DocPipelineAdvancer from './doc-pipeline-advancer.js';
import { getStageDefault } from './doc-pipeline-defaults.js';
import { buildChunksFromOutlines, computeChunkStats } from './chunk-utils.js';

class DocumentChunkService {
  constructor(db, options = {}) {
    this.db = db;
    this.getDocPipelineConfig = options.getDocPipelineConfig || null;
    this.advancer = new DocPipelineAdvancer(db);
  }

  async _loadStageConfig() {
    if (typeof this.getDocPipelineConfig === 'function') {
      try {
        const fullConfig = await this.getDocPipelineConfig();
        if (fullConfig && fullConfig.pending_chunk) {
          return fullConfig.pending_chunk;
        }
      } catch (err) {
        logger.warn(`[DocumentChunkService] Failed to load pending_chunk config, using defaults:`, err.message);
      }
    }
    return getStageDefault('pending_chunk');
  }

  async generate(revisionId, options = {}) {
    const stageConfig = await this._loadStageConfig();

    const maxLength = stageConfig.max_length || 1000;
    const overlapLength = stageConfig.overlap_length || 100;
    const keepHeading = stageConfig.keep_heading !== false;
    const mergeSmallChunks = stageConfig.merge_small_chunks || false;

    const initiatedByType = options.initiatedByType || 'system';
    const initiatedById = options.initiatedById || null;

    const DocumentRevision = this.db.getModel('document_revision');
    const revision = await DocumentRevision.findByPk(revisionId);
    if (!revision) throw new Error(`Revision not found: ${revisionId}`);

    const doc = await this._loadDocument(revision.document_id);
    if (!doc) throw new Error('Document not found');

    if (doc.processing_status !== 'pending_chunk' && doc.processing_status !== 'error') {
      throw new Error(`Document must be in pending_chunk or error state (current: ${doc.processing_status})`);
    }

    const outlines = await this._loadOutlines(revisionId);
    if (!outlines || outlines.length === 0) {
      throw new Error('No outlines found for this revision');
    }

    const text = await this._loadRevisionText(revision);
    if (!text) throw new Error('No text content available for chunk generation');

    const runId = Utils.newID();
    const DocProcessRun = this.db.getModel('doc_process_run');
    await DocProcessRun.create({
      id: runId,
      revision_id: revisionId,
      subject_type: 'document_revisions',
      subject_id: revisionId,
      pipeline_step: 'pending_chunk',
      operation: 'start',
      initiated_by_type: initiatedByType,
      initiated_by_id: initiatedById,
      result_status: 'running',
      attempt_no: 1,
      message: 'Chunk generation started',
      started_at: new Date(),
      finished_at: null,
    });

    const transaction = await this.db.sequelize.transaction();

    try {
      const rawChunks = buildChunksFromOutlines(text, outlines, {
        maxLength,
        overlapLength,
        keepHeading,
        mergeSmallChunks,
      });

      const enrichedChunks = rawChunks.map(c => {
        const stats = computeChunkStats(c.content);
        return {
          ...c,
          text_hash: stats.textHash,
          byte_count: stats.byteCount,
          token_count: stats.tokenCount,
        };
      });

      await this._saveChunks(revisionId, enrichedChunks, transaction);

      const Document = this.db.getModel('document');
      await Document.update(
        {
          processing_status: 'pending_embedding',
          processing_error_code: null,
          processing_error_message: null,
          processing_updated_at: new Date(),
        },
        { where: { id: revision.document_id }, transaction }
      );

      await DocProcessRun.update(
        {
          result_status: 'ok',
          finished_at: new Date(),
          message: `Generated ${enrichedChunks.length} chunks from ${outlines.length} outlines`,
        },
        { where: { id: runId }, transaction }
      );

      await transaction.commit();

      logger.info(`[DocumentChunkService] Revision ${revisionId}: generated ${enrichedChunks.length} chunks, status -> pending_embedding`);

      return {
        success: true,
        chunk_count: enrichedChunks.length,
        outline_count: outlines.length,
        chunks: enrichedChunks,
      };
    } catch (error) {
      await transaction.rollback();

      await DocProcessRun.update(
        {
          result_status: 'nok',
          finished_at: new Date(),
          message: error.message,
        },
        { where: { id: runId } }
      );

      const Document = this.db.getModel('document');
      await Document.update(
        {
          processing_status: 'error',
          processing_error_code: 'chunk_generation_failed',
          processing_error_message: error.message,
          processing_updated_at: new Date(),
        },
        { where: { id: revision.document_id } }
      );

      throw error;
    }
  }

  async _loadDocument(documentId) {
    const Document = this.db.getModel('document');
    return await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status'],
      raw: true,
    });
  }

  async _loadOutlines(revisionId) {
    const DocumentOutline = this.db.getModel('document_outline');
    return await DocumentOutline.findAll({
      where: { revision_id: revisionId },
      order: [['seq', 'ASC']],
      raw: true,
    });
  }

  async _loadRevisionText(revision) {
    const DocOcrResult = this.db.getModel('doc_ocr_result');
    const ocrResult = await DocOcrResult.findOne({
      where: { revision_id: revision.id },
      raw: true,
    });

    if (!ocrResult || !ocrResult.main_markdown_attachment_id) return null;

    const Attachment = this.db.getModel('attachment');
    const attachment = await Attachment.findByPk(ocrResult.main_markdown_attachment_id, { raw: true });
    if (!attachment || !attachment.file_path) return null;

    const fs = await import('fs/promises');
    const path = await import('path');
    const basePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
    const fullPath = path.resolve(basePath, attachment.file_path);

    return await fs.readFile(fullPath, 'utf8');
  }

  async _saveChunks(revisionId, chunks, transaction) {
    const DocumentChunk = this.db.getModel('document_chunk');

    await DocumentChunk.destroy({ where: { revision_id: revisionId }, transaction });

    for (const c of chunks) {
      const id = Utils.newID();
      await DocumentChunk.create({
        id,
        revision_id: revisionId,
        outline_id: c.outline_id,
        title: c.title,
        content: c.content,
        seq: c.seq,
        from_line: c.from_line,
        to_line: c.to_line,
        text_hash: c.text_hash,
        byte_count: c.byte_count,
        token_count: c.token_count,
        embedding_status: 'pending',
      }, { transaction });
    }
  }
}

export default DocumentChunkService;