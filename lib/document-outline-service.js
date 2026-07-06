import Utils from './utils.js';
import logger from './logger.js';
import DocPipelineAdvancer from './doc-pipeline-advancer.js';
import { getStageDefault } from './doc-pipeline-defaults.js';
import { getPreviewAttachmentId } from './doc-ocr-utils.js';
import {
  splitWithOverlap,
  mergeOutlines,
  extractTextByLineRange,
  computeTextStats,
  buildOutlinePrompt,
  parseOutlineResponse,
} from './outline-utils.js';
import { invokeWithRetry } from './message-llm-client.js';

const DEFAULT_WINDOW_SIZE = 60000;
const DEFAULT_STEP_SIZE = 40000;
const DEFAULT_MAX_LEVEL = 3;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

class DocumentOutlineService {
  constructor(db, options = {}) {
    this.db = db;
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

  async _resolveModelConfig(modelId) {
    if (modelId) {
      return await this.db.getModelConfig(modelId);
    }

    const aiModel = this.db.getModel('ai_model');
    const defaultRow = await aiModel.findOne({
      where: { is_active: true, model_type: 'text' },
      order: [['created_at', 'DESC']],
      raw: true,
      attributes: ['id'],
    });

    if (!defaultRow) {
      throw new Error(
        'No active text model found for judge normalization. ' +
        'Please configure model_id in doc_pipeline stage settings or activate a text model.'
      );
    }

    return await this.db.getModelConfig(defaultRow.id);
  }

  // ============================================================
  // 异步受理入口（供 controller 使用）
  // ============================================================

  /**
   * 提交章节提取任务（异步受理，快速返回）
   *
   * @param {string} revisionId
   * @param {object} [options]
   * @param {string} [options.userId] - 操作用户 ID
   * @returns {{ accepted, status, document_id, revision_id, processing_status }}
   */
  async submit(revisionId, options = {}) {
    const DocumentRevision = this.db.getModel('document_revision');
    const revision = await DocumentRevision.findByPk(revisionId);
    if (!revision) {
      throw new Error(`Revision not found: ${revisionId}`);
    }

    const Document = this.db.getModel('document');
    const document = await Document.findByPk(revision.document_id, {
      attributes: ['id', 'processing_status'],
    });
    if (!document) {
      throw new Error(`Document not found: ${revision.document_id}`);
    }

    // 状态校验：只允许在 pending_outline 或 error 状态启动
    const validStates = ['pending_outline', 'error'];
    if (!validStates.includes(document.processing_status)) {
      throw new Error(`Document must be in pending_outline or error state (current: ${document.processing_status})`);
    }

    // 防重入：检查是否已有同阶段 running 任务
    await this._settleStaleRunningRuns(revision.document_id);

    const alreadyRunning = await this.isRunning(revision.document_id);
    if (alreadyRunning) {
      logger.info(`[DocumentOutlineService] Submit rejected: outline already running for document ${revision.document_id}`);
      return {
        accepted: true,
        status: 'already_running',
        document_id: revision.document_id,
        revision_id: revisionId,
        processing_status: 'pending_outline',
      };
    }

    const initiatedByType = options.userId ? 'user' : 'system';
    const initiatedById = options.userId || null;

    // 显式记录阶段开始
    const { runId } = await this.advancer.enterStage(revision.document_id, 'pending_outline', {
      revision_id: revisionId,
      initiatedByType,
      initiatedById,
      message: 'Outline extraction accepted (async)',
      metadata: {
        revision_id: revisionId,
        submitted_by: options.userId || null,
      },
    });

    // 后台非阻塞执行真正的提取
    this._executeExtract(revision.document_id, revisionId, runId, options).catch(err => {
      logger.error(`[DocumentOutlineService] Background extract failed for document ${revision.document_id}: ${err.message}`);
    });

    logger.info(`[DocumentOutlineService] Submit accepted: document=${revision.document_id} revision=${revisionId} runId=${runId}`);

    return {
      accepted: true,
      status: 'accepted',
      document_id: revision.document_id,
      revision_id: revisionId,
      processing_status: 'pending_outline',
    };
  }

  /**
   * 判断指定文档是否已有 pending_outline 的 running 任务
   * @param {string} documentId
   * @returns {Promise<boolean>}
   */
  async isRunning(documentId) {
    const DocProcessRun = this.db.getModel('doc_process_run');
    const run = await DocProcessRun.findOne({
      where: {
        subject_type: 'documents',
        subject_id: documentId,
        pipeline_step: 'pending_outline',
        result_status: 'running',
      },
      raw: true,
    });
    return !!run;
  }

  async _getDocumentStatus(documentId) {
    const Document = this.db.getModel('document');
    return await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status', 'processing_error_code', 'processing_error_message'],
      raw: true,
    });
  }

  async _settleStaleRunningRuns(documentId) {
    const DocProcessRun = this.db.getModel('doc_process_run');
    const document = await this._getDocumentStatus(documentId);
    if (!document) return;

    if (document.processing_status !== 'error') return;

    const runningRuns = await DocProcessRun.findAll({
      where: {
        subject_type: 'documents',
        subject_id: documentId,
        pipeline_step: 'pending_outline',
        result_status: 'running',
      },
    });

    for (const run of runningRuns) {
      await run.update({
        result_status: 'nok',
        finished_at: new Date(),
        message: `${run.message || 'Outline extraction started'} [auto-settled after document entered error]`,
      });
    }
  }

  _summarizeResponse(response) {
    if (response == null) {
      return {
        response_type: 'nullish',
        response_length: 0,
        response_preview: null,
      };
    }

    if (typeof response === 'string') {
      return {
        response_type: 'string',
        response_length: response.length,
        response_preview: response.slice(0, 500),
      };
    }

    try {
      const serialized = JSON.stringify(response);
      return {
        response_type: Array.isArray(response) ? 'array' : 'object',
        response_length: serialized?.length || 0,
        response_preview: serialized?.slice(0, 500) || null,
      };
    } catch {
      return {
        response_type: typeof response,
        response_length: 0,
        response_preview: null,
      };
    }
  }

  // ============================================================
  // 核心执行逻辑（供 submit 后台 & extract 同步调用）
  // ============================================================

  /**
   * 后台执行章节提取（fire-and-forget 入口）
   * 由 submit() 调度，或 extract() 内联调用
   *
   * @param {string} documentId
   * @param {string} revisionId
   * @param {string} runId - enterStage 返回的 runId
   * @param {object} options
   */
  async _executeExtract(documentId, revisionId, runId, options = {}) {
    try {
      const document = await this._getDocumentStatus(documentId);
      if (!document) {
        logger.warn(`[DocumentOutlineService] Background extract skipped: document not found ${documentId}`);
        return;
      }
      if (document.processing_status !== 'pending_outline') {
        logger.warn(`[DocumentOutlineService] Background extract skipped: document ${documentId} is ${document.processing_status}, not pending_outline`);
        return;
      }

      const result = await this._doExtract(revisionId, options);

      const isPartial = result.partial || false;
      const message = isPartial
        ? `Extracted ${result.outline_count} outlines (partial: ${result.failed_chunks}/${result.total_chunks} chunks failed)`
        : `Extracted ${result.outline_count} outlines`;

      await this.advancer.finishStage(documentId, 'pending_outline', {
        runId,
        nextStage: 'pending_chunk',
        message,
        metadata: {
          outline_count: result.outline_count,
          partial: isPartial,
          failed_chunks: result.failed_chunks || 0,
          total_chunks: result.total_chunks || 1,
          revision_id: revisionId,
        },
      });

      logger.info(`[DocumentOutlineService] Extract completed: document=${documentId} outlines=${result.outline_count}`);
    } catch (error) {
      const document = await this._getDocumentStatus(documentId);
      if (!document) {
        logger.warn(`[DocumentOutlineService] Extract error ignored: document not found ${documentId}`);
        return;
      }
      if (document.processing_status !== 'pending_outline') {
        logger.warn(`[DocumentOutlineService] Extract error ignored: document ${documentId} already moved to ${document.processing_status}`);
        return;
      }

      const isTimeout = this._isTimeoutError(error);

      if (isTimeout) {
        await this.advancer.timeoutStage(documentId, 'pending_outline', {
          runId,
          message: `Outline extraction timed out: ${error.message}`,
          metadata: {
            error_summary: error.message || null,
            timeout_at: new Date().toISOString(),
            revision_id: revisionId,
          },
        });
        logger.error(`[DocumentOutlineService] Extract timeout: document=${documentId}`);
      } else {
        await this.advancer.failStage(documentId, 'pending_outline', {
          runId,
          code: 'outline_extraction_failed',
          message: error.message,
          metadata: {
            error_summary: error.message || null,
            revision_id: revisionId,
          },
        });
        logger.error(`[DocumentOutlineService] Extract failed: document=${documentId} error=${error.message}`);
      }
    }
  }

  /**
   * 同步执行章节提取（供 scheduler tick 等后台同步流程使用）
   *
   * 接入 DocPipelineAdvancer：enterStage → 执行 → finishStage/failStage/timeoutStage
   *
   * @param {string} revisionId
   * @param {object} [options]
   * @returns {{ success, outline_count, outlines, partial, failed_chunks, total_chunks }}
   */
  async extract(revisionId, options = {}) {
    const DocumentRevision = this.db.getModel('document_revision');
    const revision = await DocumentRevision.findByPk(revisionId);
    if (!revision) {
      throw new Error(`Revision not found: ${revisionId}`);
    }

    await this._settleStaleRunningRuns(revision.document_id);

    const alreadyRunning = await this.isRunning(revision.document_id);
    if (alreadyRunning) {
      logger.info(`[DocumentOutlineService] Extract skipped: outline already running for document ${revision.document_id}`);
      return {
        success: false,
        skipped: true,
        reason: 'already_running',
        outline_count: 0,
        outlines: [],
        partial: false,
        failed_chunks: 0,
        total_chunks: 0,
      };
    }

    const initiatedByType = options.initiatedByType || 'system';
    const initiatedById = options.initiatedById || null;

    // 使用 advancer 统一入口创建 run 记录
    const { runId } = await this.advancer.enterStage(revision.document_id, 'pending_outline', {
      revision_id: revisionId,
      initiatedByType,
      initiatedById,
      message: 'Outline extraction started (sync)',
      metadata: {
        revision_id: revisionId,
      },
    });

    try {
      const result = await this._doExtract(revisionId, options);

      const isPartial = result.partial || false;
      const message = isPartial
        ? `Extracted ${result.outline_count} outlines (partial: ${result.failed_chunks}/${result.total_chunks} chunks failed)`
        : `Extracted ${result.outline_count} outlines`;

      await this.advancer.finishStage(revision.document_id, 'pending_outline', {
        runId,
        nextStage: 'pending_chunk',
        message,
        metadata: {
          outline_count: result.outline_count,
          partial: isPartial,
          failed_chunks: result.failed_chunks || 0,
          total_chunks: result.total_chunks || 1,
          revision_id: revisionId,
        },
      });

      logger.info(`[DocumentOutlineService] Revision ${revisionId}: extracted ${result.outline_count} outlines`);

      return result;
    } catch (error) {
      const isTimeout = this._isTimeoutError(error);

      if (isTimeout) {
        await this.advancer.timeoutStage(revision.document_id, 'pending_outline', {
          runId,
          message: `Outline extraction timed out: ${error.message}`,
          metadata: {
            error_summary: error.message || null,
            timeout_at: new Date().toISOString(),
            revision_id: revisionId,
          },
        });
      } else {
        await this.advancer.failStage(revision.document_id, 'pending_outline', {
          runId,
          code: 'outline_extraction_failed',
          message: error.message,
          metadata: {
            error_summary: error.message || null,
            revision_id: revisionId,
          },
        });
      }

      throw error;
    }
  }

  /**
   * 执行章节提取的核心逻辑（不含状态管理，纯提取 + 持久化）
   */
  async _doExtract(revisionId, options = {}) {
    const stageConfig = await this._loadStageConfig();

    const windowSize = stageConfig.window_size || DEFAULT_WINDOW_SIZE;
    const stepSize = stageConfig.step_size || DEFAULT_STEP_SIZE;
    const maxLevel = stageConfig.max_heading_level || DEFAULT_MAX_LEVEL;
    const deduplicateTitles = stageConfig.deduplicate_titles !== false;
    const temperature = stageConfig.temperature || 0.3;
    const modelId = stageConfig.model_id || null;
    // 统一从 llm_timeout_ms 读取超时配置（不再双读 timeout_ms）
    const llmTimeoutMs = stageConfig.llm_timeout_ms || DEFAULT_TIMEOUT_MS;

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

    let outlines;
    let extractionMeta = { totalChunks: 1, failedChunks: 0 };
    const modelConfig = await this._resolveModelConfig(modelId);

    if (text.length <= windowSize) {
      logger.info(`[DocumentOutlineService] Revision ${revisionId}: single-chunk extraction`);
      outlines = await this._extractSingleChunk(modelConfig, text, maxLevel, temperature, llmTimeoutMs);
    } else {
      logger.info(`[DocumentOutlineService] Revision ${revisionId}: multi-chunk extraction (window=${windowSize}, step=${stepSize})`);
      const result = await this._extractMultiChunk(modelConfig, text, windowSize, stepSize, maxLevel, temperature, deduplicateTitles, llmTimeoutMs);
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

    // 独立事务持久化章节数据
    const saveTx = await this.db.sequelize.transaction();
    try {
      await this._saveOutlines(revisionId, enrichedOutlines, saveTx);
      await saveTx.commit();
    } catch (saveErr) {
      await saveTx.rollback();
      throw saveErr;
    }

    const isPartial = extractionMeta.failedChunks > 0;

    return {
      success: true,
      outline_count: enrichedOutlines.length,
      outlines: enrichedOutlines,
      partial: isPartial,
      failed_chunks: extractionMeta.failedChunks,
      total_chunks: extractionMeta.totalChunks,
    };
  }

  /**
   * 判断错误是否为超时类错误
   */
  _isTimeoutError(error) {
    if (!error) return false;
    const code = (error.code || '').toUpperCase();
    if (['ETIMEDOUT', 'ECONNABORTED', 'ERR_CANCELED', 'ESOCKETTIMEDOUT'].includes(code)) return true;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) return true;
    return false;
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

  async _extractSingleChunk(modelConfig, text, maxLevel, temperature, llmTimeoutMs) {
    const prompt = buildOutlinePrompt(maxLevel);
    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: text },
    ];
    const response = await invokeWithRetry(modelConfig, messages, {
      temperature,
      timeout: llmTimeoutMs,
      thinking_policy: 'disable',
      logger_prefix: '[DocumentOutlineService]',
    });

    logger.info('[DocumentOutlineService] Outline single-chunk response summary:', this._summarizeResponse(response));

    return parseOutlineResponse(response);
  }

  async _extractMultiChunk(modelConfig, text, windowSize, stepSize, maxLevel, temperature, deduplicateTitles, llmTimeoutMs) {
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
        const messages = [
          { role: 'system', content: prompt },
          { role: 'user', content: chunk.text },
        ];
        const response = await invokeWithRetry(modelConfig, messages, {
          temperature,
          timeout: llmTimeoutMs,
          thinking_policy: 'disable',
          logger_prefix: '[DocumentOutlineService]',
        });

        logger.info(`[DocumentOutlineService] Outline chunk ${i + 1} response summary:`, this._summarizeResponse(response));

        const parsed = parseOutlineResponse(response);
        if (Array.isArray(parsed)) {
          outlines = parsed;
        } else {
          failed = true;
          logger.warn(`[DocumentOutlineService] Chunk ${i + 1}: LLM returned invalid format`, this._summarizeResponse(response));
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
