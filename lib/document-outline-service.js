import Utils from './utils.js';
import logger from './logger.js';
import DocPipelineAdvancer from './doc-pipeline-advancer.js';
import { getStageDefault, createCallLlmFn } from './doc-pipeline-defaults.js';
import {
  splitWithOverlap,
  mergeOutlines,
  extractTextByLineRange,
  computeTextStats,
  buildOutlinePrompt,
  parseOutlineResponse,
} from './outline-utils.js';

const DEFAULT_WINDOW_SIZE = 60000;
const DEFAULT_STEP_SIZE = 40000;
const DEFAULT_MAX_LEVEL = 3;
const DEFAULT_TIMEOUT_MS = 120000;

class DocumentOutlineService {
  constructor(db, options = {}) {
    this.db = db;
    this.callLlm = options.callLlm || null;
    this.getDocPipelineConfig = options.getDocPipelineConfig || null;
    this.advancer = new DocPipelineAdvancer(db);
  }

  async _loadStageConfig() {
    if (typeof this.getDocPipelineConfig === 'function') {
      try {
        const fullConfig = await this.getDocPipelineConfig();
        if (fullConfig && fullConfig.pending_outline) {
          return fullConfig.pending_outline;
        }
      } catch (err) {
        logger.warn(`[DocumentOutlineService] Failed to load pending_outline config, using defaults:`, err.message);
      }
    }
    return getStageDefault('pending_outline');
  }

  async _resolveCallLlm() {
    if (this.callLlm) return this.callLlm;
    return createCallLlmFn(this.db);
  }

  async extract(revisionId, options = {}) {
    const stageConfig = await this._loadStageConfig();
    const callLlm = await this._resolveCallLlm();

    const windowSize = stageConfig.window_size || DEFAULT_WINDOW_SIZE;
    const stepSize = stageConfig.step_size || DEFAULT_STEP_SIZE;
    const maxLevel = stageConfig.max_heading_level || DEFAULT_MAX_LEVEL;
    const deduplicateTitles = stageConfig.deduplicate_titles !== false;
    const temperature = stageConfig.temperature || 0.3;
    const modelId = stageConfig.model_id || null;
    const llmTimeoutMs = stageConfig.llm_timeout_ms || null;

    const initiatedByType = options.initiatedByType || 'system';
    const initiatedById = options.initiatedById || null;

    const DocumentRevision = this.db.getModel('document_revision');
    const revision = await DocumentRevision.findByPk(revisionId);
    if (!revision) {
      throw new Error(`Revision not found: ${revisionId}`);
    }

    const text = await this._loadRevisionText(revision);
    if (!text) {
      throw new Error('No text content available for outline extraction');
    }

    const totalLines = text.split('\n').length;
    logger.info(`[DocumentOutlineService] Revision ${revisionId}: text length=${text.length}, lines=${totalLines}`);

    const runId = Utils.newID();
    const DocProcessRun = this.db.getModel('doc_process_run');
    await DocProcessRun.create({
      id: runId,
      revision_id: revisionId,
      subject_type: 'document_revisions',
      subject_id: revisionId,
      pipeline_step: 'pending_outline',
      operation: 'start',
      initiated_by_type: initiatedByType,
      initiated_by_id: initiatedById,
      result_status: 'running',
      attempt_no: 1,
      message: 'Outline extraction started',
      started_at: new Date(),
      finished_at: null,
    });

    const transaction = await this.db.sequelize.transaction();

    try {
      let outlines;
      let extractionMeta = { totalChunks: 1, failedChunks: 0 };

      if (text.length <= windowSize) {
        logger.info(`[DocumentOutlineService] Revision ${revisionId}: single-chunk extraction`);
        outlines = await this._extractSingleChunk(callLlm, text, maxLevel, temperature, modelId, llmTimeoutMs);
      } else {
        logger.info(`[DocumentOutlineService] Revision ${revisionId}: multi-chunk extraction (window=${windowSize}, step=${stepSize})`);
        const result = await this._extractMultiChunk(callLlm, text, windowSize, stepSize, maxLevel, temperature, modelId, deduplicateTitles, llmTimeoutMs);
        outlines = result.outlines;
        extractionMeta = result.meta;
      }

      if (!Array.isArray(outlines)) {
        throw new Error('Outline extraction returned invalid result (not an array)');
      }

      if (outlines.length === 0 && text.length > 100) {
        throw new Error('Outline extraction returned empty result for non-empty document');
      }

      if (extractionMeta.failedChunks > 0) {
        const failRatio = extractionMeta.failedChunks / extractionMeta.totalChunks;
        if (failRatio > 0.3) {
          throw new Error(`Too many chunk extraction failures (${extractionMeta.failedChunks}/${extractionMeta.totalChunks}), aborting`);
        }
        logger.warn(`[DocumentOutlineService] Revision ${revisionId}: partial extraction with ${extractionMeta.failedChunks} failed chunks`);
      }

      const enrichedOutlines = this._enrichOutlines(outlines, text);

      await this._saveOutlines(revisionId, enrichedOutlines, transaction);

      const Document = this.db.getModel('document');
      await Document.update(
        { processing_status: 'pending_chunk', processing_updated_at: new Date() },
        { where: { id: revision.document_id }, transaction }
      );

      const isPartial = extractionMeta.failedChunks > 0;
      const partialInfo = isPartial
        ? ` (partial: ${extractionMeta.failedChunks}/${extractionMeta.totalChunks} chunks failed)`
        : '';

      await DocProcessRun.update(
        {
          result_status: isPartial ? 'partial' : 'ok',
          finished_at: new Date(),
          message: `Extracted ${enrichedOutlines.length} outlines${partialInfo}`,
        },
        { where: { id: runId }, transaction }
      );

      await transaction.commit();

      logger.info(`[DocumentOutlineService] Revision ${revisionId}: extracted ${enrichedOutlines.length} outlines, status -> pending_chunk${partialInfo}`);

      return {
        success: true,
        outline_count: enrichedOutlines.length,
        outlines: enrichedOutlines,
        partial: isPartial,
        failed_chunks: extractionMeta.failedChunks,
        total_chunks: extractionMeta.totalChunks,
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
          processing_error_code: 'outline_extraction_failed',
          processing_error_message: error.message,
          processing_updated_at: new Date(),
        },
        { where: { id: revision.document_id } }
      );

      throw error;
    }
  }

  async _loadRevisionText(revision) {
    const DocOcrResult = this.db.getModel('doc_ocr_result');
    const ocrResult = await DocOcrResult.findOne({
      where: { revision_id: revision.id },
      raw: true,
    });

    if (!ocrResult || !ocrResult.main_markdown_attachment_id) {
      return null;
    }

    const Attachment = this.db.getModel('attachment');
    const attachment = await Attachment.findByPk(ocrResult.main_markdown_attachment_id, { raw: true });
    if (!attachment || !attachment.file_path) {
      return null;
    }

    const fs = await import('fs/promises');
    const path = await import('path');
    const basePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
    const fullPath = path.resolve(basePath, attachment.file_path);

    return await fs.readFile(fullPath, 'utf8');
  }

  async _extractSingleChunk(callLlm, text, maxLevel, temperature, modelId, llmTimeoutMs) {
    const prompt = buildOutlinePrompt(maxLevel);
    const callOpts = {
      model_id: modelId,
      temperature,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: text },
      ],
    };
    if (llmTimeoutMs) callOpts.timeout = llmTimeoutMs;
    const response = await callLlm(callOpts);

    return parseOutlineResponse(response);
  }

  async _extractMultiChunk(callLlm, text, windowSize, stepSize, maxLevel, temperature, modelId, deduplicateTitles, llmTimeoutMs) {
    const chunks = splitWithOverlap(text, windowSize, stepSize);
    const chunkData = [];
    let failedChunks = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      let outlines = [];
      let failed = false;

      try {
        const hint = i === 0
          ? '这是文档前半部分'
          : `这是文档第 ${i + 1} 段（共 ${chunks.length} 段），注意去重`;

        const prompt = buildOutlinePrompt(maxLevel) + `\n\n提示：${hint}`;
        const callOpts = {
          model_id: modelId,
          temperature,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: chunk.text },
          ],
        };
        if (llmTimeoutMs) callOpts.timeout = llmTimeoutMs;
        const response = await callLlm(callOpts);

        const parsed = parseOutlineResponse(response);
        if (Array.isArray(parsed)) {
          outlines = parsed;
        } else {
          failed = true;
          logger.warn(`[DocumentOutlineService] Chunk ${i + 1}: LLM returned invalid format`);
        }
      } catch (err) {
        failed = true;
        logger.warn(`[DocumentOutlineService] Chunk ${i + 1} extraction failed: ${err.message}`);
      }

      if (failed) {
        failedChunks++;
      }

      chunkData.push({
        outlines,
        lineOffset: chunk.lineOffset,
      });
    }

    const outlines = mergeOutlines(chunkData, { deduplicateTitles });

    return {
      outlines,
      meta: {
        totalChunks: chunks.length,
        failedChunks,
      },
    };
  }

  _enrichOutlines(outlines, text) {
    if (!Array.isArray(outlines)) return [];

    return outlines.map(o => {
      const originalText = extractTextByLineRange(text, o.from_line, o.to_line);
      const stats = computeTextStats(originalText);

      return {
        title: o.title,
        description: o.description || '',
        seq: o.seq,
        from_line: o.from_line,
        to_line: o.to_line,
        original_text: originalText,
        text_hash: stats.textHash,
        byte_count: stats.byteCount,
        token_count: stats.tokenCount,
      };
    });
  }

  async _saveOutlines(revisionId, outlines, transaction) {
    const DocumentOutline = this.db.getModel('document_outline');

    await DocumentOutline.destroy({ where: { revision_id: revisionId }, transaction });

    for (const o of outlines) {
      const id = Utils.newID();
      await DocumentOutline.create({
        id,
        revision_id: revisionId,
        title: o.title,
        description: o.description,
        seq: o.seq,
        from_line: o.from_line,
        to_line: o.to_line,
        original_text: o.original_text,
        text_hash: o.text_hash,
        byte_count: o.byte_count,
        token_count: o.token_count,
      }, { transaction });
    }
  }
}

export default DocumentOutlineService;