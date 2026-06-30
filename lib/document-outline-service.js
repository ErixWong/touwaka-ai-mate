import Utils from './utils.js';
import logger from './logger.js';
import DocPipelineAdvancer from './doc-pipeline-advancer.js';
import { getStageDefault, createCallLlmFn } from './doc-pipeline-defaults.js';
import { getPreviewAttachmentId } from './doc-ocr-utils.js';
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
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

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
    // 统一从 llm_timeout_ms 读取超时配置（不再双读 timeout_ms）
    const llmTimeoutMs = stageConfig.llm_timeout_ms || DEFAULT_TIMEOUT_MS;

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
    // subject_type 统一为 'documents'，以文档维度为主视角，revision_id 保留版本上下文
    await DocProcessRun.create({
      id: runId,
      revision_id: revisionId,
      subject_type: 'documents',
      subject_id: revision.document_id,
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

      await transaction.commit();

      const isPartial = extractionMeta.failedChunks > 0;
      const partialInfo = isPartial
        ? ` (partial: ${extractionMeta.failedChunks}/${extractionMeta.totalChunks} chunks failed)`
        : '';

      await this.advancer.finishStage(revision.document_id, 'pending_outline', {
        runId,
        nextStage: 'pending_chunk',
        message: `Extracted ${enrichedOutlines.length} outlines${partialInfo}`,
        metadata: {
          outline_count: enrichedOutlines.length,
          partial: isPartial,
          failed_chunks: extractionMeta.failedChunks,
          total_chunks: extractionMeta.totalChunks,
        },
      });

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

      await this.advancer.failStage(revision.document_id, 'pending_outline', {
        runId,
        code: 'outline_extraction_failed',
        message: error.message,
      });

      throw error;
    }
  }

  async _loadRevisionText(revision) {
    const DocOcrResult = this.db.getModel('doc_ocr_result');
    const ocrResult = await DocOcrResult.findOne({
      where: { revision_id: revision.id },
      raw: true,
    });

    // 使用统一语义读取预览稿，不再显式依赖 main_markdown_attachment_id
    const preferredAttachmentId = getPreviewAttachmentId(ocrResult);
    if (!preferredAttachmentId) {
      return null;
    }

    const Attachment = this.db.getModel('attachment');
    const attachment = await Attachment.findByPk(preferredAttachmentId, { raw: true });
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

    return outlines.map((o, index) => {
      const fromLine = Number.isInteger(o.from_line) ? o.from_line : Number.parseInt(o.from_line, 10);
      const toLineRaw = Number.isInteger(o.to_line) ? o.to_line : Number.parseInt(o.to_line, 10);
      const safeFromLine = Number.isFinite(fromLine) && fromLine > 0 ? fromLine : index + 1;
      const safeToLine = Number.isFinite(toLineRaw) && toLineRaw >= safeFromLine ? toLineRaw : safeFromLine;
      const seqCandidate = Number.isInteger(o.seq) ? o.seq : Number.parseInt(o.seq, 10);
      const safeSeq = Number.isFinite(seqCandidate) && seqCandidate >= 0 ? seqCandidate : index;
      const originalText = extractTextByLineRange(text, safeFromLine, safeToLine);
      const stats = computeTextStats(originalText);

      return {
        title: (o.title || '').trim() || `未命名章节 ${index + 1}`,
        description: o.description || '',
        seq: safeSeq,
        from_line: safeFromLine,
        to_line: safeToLine,
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

    for (const [index, o] of outlines.entries()) {
      const fromLine = Number.isInteger(o.from_line) ? o.from_line : Number.parseInt(o.from_line, 10);
      const safeFromLine = Number.isFinite(fromLine) && fromLine > 0 ? fromLine : index + 1;
      const toLine = Number.isInteger(o.to_line) ? o.to_line : Number.parseInt(o.to_line, 10);
      const safeToLine = Number.isFinite(toLine) && toLine >= safeFromLine ? toLine : safeFromLine;
      const seqCandidate = Number.isInteger(o.seq) ? o.seq : Number.parseInt(o.seq, 10);
      const safeSeq = Number.isFinite(seqCandidate) && seqCandidate >= 0 ? seqCandidate : index;
      const id = Utils.newID();
      await DocumentOutline.create({
        id,
        revision_id: revisionId,
        title: o.title,
        description: o.description,
        seq: safeSeq,
        from_line: safeFromLine,
        to_line: safeToLine,
        original_text: o.original_text,
        text_hash: o.text_hash,
        byte_count: o.byte_count,
        token_count: o.token_count,
      }, { transaction });
    }
  }
}

export default DocumentOutlineService;