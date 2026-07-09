import fs from 'fs/promises';
import path from 'path';

import Utils from './utils.js';
import logger from './logger.js';
import DocPipelineAdvancer from './doc-pipeline-advancer.js';
import { getStageDefault, normalizeStageConfig } from './doc-pipeline-defaults.js';
import { getRawAttachmentId } from './doc-ocr-utils.js';
import AttachmentService from '../server/services/attachment.service.js';
import { invokeWithRetry } from './message-llm-client.js';

const DEFAULT_CHUNK_MAX_LENGTH = 8000;
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_TEMPERATURE = 0.2;
const CLEAN_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
const CONTEXT_SUMMARY_MAX_LENGTH = 2000;
const TABLE_BLOCK_TOKEN_PREFIX = '[[TABLE_BLOCK_';
const FORMULA_BLOCK_TOKEN_PREFIX = '[[FORMULA_BLOCK_';
const FORMULA_INLINE_TOKEN_PREFIX = '[[FORMULA_INLINE_';
const CLEAN_RETRYABLE_ERROR_PATTERNS = [
  /socket hang up/i,
  /ECONNRESET/i,
  /timeout/i,
  /请求超时/i,
];

const DEFAULT_CLEAN_PROMPT = `你是文档正文清洗助手。请清洗 OCR 生成的 Markdown/纯文本正文，输出适合后续元数据提取、章节提取、文本分块的干净正文。

要求：
1. 保留正文语义，不得编造、补充事实。
2. 保留 Markdown 标题、列表、普通段落、合法图片语法（如 ![](...)）。
3. 对受保护的表格占位符（如 [[TABLE_BLOCK_1]]）必须原样保留，不得删除、改写、重排。
4. 删除非表格类 HTML/XML 标签及其结构噪声，例如 <div> <span>。
5. 对标签内仍有价值的文字，转成普通文本保留；对明显残缺、无意义的结构噪声可删除。
6. 表格内容不要改写成普通段落，也不要擅自补全缺失单元格。
7. 对受保护的公式占位符（如 [[FORMULA_BLOCK_1]]、[[FORMULA_INLINE_1]]）必须原样保留，不得删除、改写、重排。
8. 删除页码、页眉页脚、水印、乱码、无意义重复行、多余空白。
9. 保留文档中的编号、日期、联系人、附件标题等业务信息。
10. 不要输出解释，只输出 JSON。`;

const DEFAULT_CLEAN_PROMPT_NO_TABLE_PROTECT = `你是文档正文与表格清洗专家。请清洗 OCR 生成的 Markdown / HTML / 纯文本正文，输出适合后续元数据提取、章节提取、文本分块的干净正文。

要求：
1. 保留正文语义，不得编造、补充事实。
2. 保留 Markdown 标题、列表、普通段落、合法图片语法（如 ![](...)）。
3. 文档中可能存在格式错误、行列错位、表头层级混乱、合并单元格展开异常的表格。你需要尽量依据输入中已经出现的信息，恢复表格的结构可读性。
4. 对表格，只能整理结构，不能补充输入中不存在的事实，不能根据常识猜测缺失单元格内容。
5. 保留表题、表号、顶层表头、底层表头、脚注、注释、单位、编号。
6. 如果表格存在多层表头，应尽量恢复顶层表头（大类）与底层表头（实际字段）的层级关系。
7. 如果表格原本是 HTML 或 Markdown 形式，优先输出结构清晰、可读性更好的 Markdown 表格；若无法可靠转换为 Markdown，可保留为 HTML 表格，但必须尽量修复明显的结构错位。
8. 不得把表格改写成普通段落、摘要、说明文字或项目符号列表。
9. 对无法确定含义的单元格内容，原样保留，不要删除，不要改写。
10. 对受保护的公式占位符（如 [[FORMULA_BLOCK_1]]、[[FORMULA_INLINE_1]]）必须原样保留，不得删除、改写、重排。
11. 删除非表格类 HTML/XML 标签及其结构噪声，例如 <div> <span>；但不要误删表格结构本身。
12. 删除页码、页眉页脚、水印、乱码、无意义重复行、多余空白。
13. 保留文档中的编号、日期、联系人、附件标题等业务信息。
14. 如果某张表格损坏严重，无法可靠复原，则保持其原始信息顺序，只做最小必要整理，不得强行猜测或重建不存在的内容。
15. 不要输出解释，只输出 JSON。`;

class DocumentCleanService {
  constructor(db, options = {}) {
    this.db = db;
    this.getDocPipelineConfig = options.getDocPipelineConfig || null;
    this.advancer = new DocPipelineAdvancer(db);
    this.attachmentService = new AttachmentService(db);
  }

  async _loadStageConfig() {
    if (typeof this.getDocPipelineConfig === 'function') {
      try {
        const fullConfig = await this.getDocPipelineConfig(this.db);
        if (fullConfig && fullConfig.pending_clean) {
          return normalizeStageConfig({
            ...getStageDefault('pending_clean'),
            ...fullConfig.pending_clean,
          }, 'pending_clean');
        }
      } catch (err) {
        logger.warn(`[DocumentCleanService] Failed to load pending_clean config, using defaults: ${err.message}`);
      }
    }
    return normalizeStageConfig(getStageDefault('pending_clean'), 'pending_clean');
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

  async submit(documentId, options = {}) {
    const ctx = await this._loadDocumentContext(documentId);
    const document = await this._getDocumentStatus(documentId);
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    const validStates = ['pending_clean', 'error'];
    if (!validStates.includes(document.processing_status)) {
      throw new Error(`Document must be in pending_clean or error state (current: ${document.processing_status})`);
    }

    await this._settleStaleRunningRuns(documentId);

    const cooldownResult = this._checkFailureCooldown(document, options);
    if (cooldownResult.blocked) {
      logger.warn(`[DocumentCleanService] Submit throttled by failure cooldown for document ${documentId}`);
      return {
        accepted: false,
        status: 'cooldown',
        document_id: documentId,
        revision_id: ctx.revision.id,
        processing_status: document.processing_status,
        retry_after_ms: cooldownResult.retryAfterMs,
      };
    }

    const runningRun = await this._getRunningRun(documentId);
    if (runningRun) {
      logger.info(`[DocumentCleanService] Submit rejected: clean already running for document ${documentId}`);
      return {
        accepted: true,
        status: 'already_running',
        document_id: documentId,
        revision_id: ctx.revision.id,
        processing_status: 'pending_clean',
      };
    }

    const initiatedByType = options.userId ? 'user' : (options.initiatedByType || 'system');
    const initiatedById = options.userId || options.initiatedById || null;

    const { runId } = await this.advancer.enterStage(documentId, 'pending_clean', {
      revision_id: ctx.revision.id,
      initiatedByType,
      initiatedById,
      message: 'Document clean accepted (async)',
      metadata: {
        revision_id: ctx.revision.id,
        submitted_by: options.userId || null,
      },
    });

    this._executeClean(documentId, runId, options).catch(err => {
      logger.error(`[DocumentCleanService] Background clean failed for document ${documentId}: ${err.message}`);
    });

    return {
      accepted: true,
      status: 'accepted',
      document_id: documentId,
      revision_id: ctx.revision.id,
      processing_status: 'pending_clean',
    };
  }

  async _getRunningRun(documentId) {
    const DocProcessRun = this.db.getModel('doc_process_run');
    return await DocProcessRun.findOne({
      where: {
        subject_type: 'documents',
        subject_id: documentId,
        pipeline_step: 'pending_clean',
        result_status: 'running',
      },
      order: [['started_at', 'DESC']],
      raw: true,
    });
  }

  async isRunning(documentId) {
    const run = await this._getRunningRun(documentId);
    return !!run;
  }

  async _getDocumentStatus(documentId) {
    const Document = this.db.getModel('document');
    return await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status', 'processing_error_code', 'processing_error_message', 'processing_updated_at'],
      raw: true,
    });
  }

  _checkFailureCooldown(document, options = {}) {
    if (!document || document.processing_status !== 'error') {
      return { blocked: false, retryAfterMs: 0 };
    }

    if (options.force === true || options.bypassFailureCooldown === true) {
      return { blocked: false, retryAfterMs: 0 };
    }

    const errorCode = document.processing_error_code || '';
    const isCleanFailure = [
      'clean_failed',
      'clean_timeout',
      'pending_clean_failed',
      'pending_clean_timeout',
    ].includes(errorCode);
    if (!isCleanFailure) {
      return { blocked: false, retryAfterMs: 0 };
    }

    const updatedAt = document.processing_updated_at ? new Date(document.processing_updated_at).getTime() : 0;
    if (!updatedAt) {
      return { blocked: false, retryAfterMs: 0 };
    }

    const elapsedMs = Date.now() - updatedAt;
    const retryAfterMs = CLEAN_FAILURE_COOLDOWN_MS - elapsedMs;
    if (retryAfterMs > 0) {
      return { blocked: true, retryAfterMs };
    }

    return { blocked: false, retryAfterMs: 0 };
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
        pipeline_step: 'pending_clean',
        result_status: 'running',
      },
    });

    for (const run of runningRuns) {
      await run.update({
        result_status: 'nok',
        finished_at: new Date(),
        message: `${run.message || 'Document clean started'} [auto-settled after document entered error]`,
      });
    }
  }

  _isTimeoutError(error) {
    const message = error?.message || String(error || '');
    const code = error?.code || '';
    return [
      /timeout/i.test(message),
      /timed out/i.test(message),
      /请求超时/i.test(message),
      /socket hang up/i.test(message),
      /aborted/i.test(message),
      code === 'ETIMEDOUT',
      code === 'ECONNABORTED',
      code === 'ECONNRESET',
      code === 'ESOCKETTIMEDOUT',
      error?.name === 'TimeoutError',
      error?.name === 'AbortError',
    ].some(Boolean);
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

  async _executeClean(documentId, runId, options = {}) {
    try {
      const document = await this._getDocumentStatus(documentId);
      if (!document) {
        logger.warn(`[DocumentCleanService] Background clean skipped: document not found ${documentId}`);
        return;
      }
      if (document.processing_status !== 'pending_clean') {
        logger.warn(`[DocumentCleanService] Background clean skipped: document ${documentId} is ${document.processing_status}, not pending_clean`);
        return;
      }

      const result = await this.clean(documentId, {
        ...options,
        skipStageEnter: true,
        runId,
      });

      await this.advancer.finishStage(documentId, 'pending_clean', {
        runId,
        nextStage: 'pending_outline',
        message: `Document cleaned (${result.original_length} -> ${result.cleaned_length})`,
        metadata: {
          cleaned_attachment_id: result.cleaned_attachment_id,
          original_length: result.original_length,
          cleaned_length: result.cleaned_length,
        },
      });
    } catch (error) {
      const document = await this._getDocumentStatus(documentId);
      if (!document) {
        logger.warn(`[DocumentCleanService] Clean error ignored: document not found ${documentId}`);
        return;
      }
      if (document.processing_status !== 'pending_clean') {
        logger.warn(`[DocumentCleanService] Clean error ignored: document ${documentId} already moved to ${document.processing_status}`);
        return;
      }

      if (this._isTimeoutError(error)) {
        await this.advancer.timeoutStage(documentId, 'pending_clean', {
          runId,
          code: 'clean_timeout',
          message: `Document clean timed out: ${error.message}`,
          metadata: {
            error_summary: error.message || null,
            timeout_at: new Date().toISOString(),
          },
        });
      } else {
        await this.advancer.failStage(documentId, 'pending_clean', {
          runId,
          code: 'clean_failed',
          message: error.message,
          metadata: {
            error_summary: error.message || null,
          },
        });
      }
    }
  }

  async clean(documentId, options = {}) {
    const stageConfig = await this._loadStageConfig();

    const chunkMaxLength = stageConfig.chunk_max_length || DEFAULT_CHUNK_MAX_LENGTH;
    const temperature = stageConfig.temperature ?? DEFAULT_TEMPERATURE;
    const modelId = stageConfig.model_id || null;
    const llmTimeoutMs = stageConfig.llm_timeout_ms || DEFAULT_TIMEOUT_MS;

    logger.info('[DocumentCleanService] Clean timeout config:', {
      document_id: documentId,
      model_id: modelId,
      stage_timeout_ms: stageConfig.llm_timeout_ms ?? null,
      effective_timeout_ms: llmTimeoutMs,
    });

    const ctx = await this._loadDocumentContext(documentId);
    const ocrResult = await this._loadLatestOcrResult(ctx.revision.id);

    const rawAttachmentId = getRawAttachmentId(ocrResult);
    if (!rawAttachmentId) {
      throw new Error('No raw OCR markdown attachment found for cleaning');
    }

    const sourceAttachment = await this._loadAttachmentById(rawAttachmentId);
    if (!sourceAttachment?.file_path) {
      throw new Error('OCR markdown attachment file not found');
    }

    const originalText = await this._readAttachmentText(sourceAttachment.file_path);
    if (!originalText || !originalText.trim()) {
      throw new Error('OCR markdown content is empty');
    }

    let runId = options.runId || null;
    if (!options.skipStageEnter) {
      const initiatedByType = options.initiatedByType || 'system';
      const initiatedById = options.initiatedById || null;
      const enterResult = await this.advancer.enterStage(documentId, 'pending_clean', {
        revision_id: ctx.revision.id,
        initiatedByType,
        initiatedById,
        message: 'Document clean started (sync)',
        metadata: {
          revision_id: ctx.revision.id,
        },
      });
      runId = enterResult.runId;
    }

    const transaction = await this.db.sequelize.transaction();

    try {
      const skipTableProtection = options.skipTableProtection !== false;
      const precleanResult = this.precleanText(originalText, stageConfig.rules || {}, skipTableProtection);
      const precleanedText = precleanResult.cleaned_text;
      const cleanedText = stageConfig.enabled === false
        ? precleanedText
        : await this.cleanWithRetry(stageConfig, {
          precleanedText,
          modelId,
          temperature,
          llmTimeoutMs,
          chunkMaxLength,
          skipTableProtection,
        });

      const finalText = this.finalizeText(
        cleanedText || precleanedText || originalText,
        precleanResult.protected_blocks || [],
      );
      const cleanedAttachment = await this.attachmentService.createTextAttachment({
        sourceTag: 'doc-platform-ocr',
        sourceId: ctx.revision.id,
        createdBy: ctx.revision.created_by || null,
        fileName: 'cleaned-main.md',
        content: finalText,
        mimeType: 'text/markdown',
      });

      const metadata = this.toPlainObject(ocrResult.metadata);
      metadata.cleaned_markdown_attachment_id = cleanedAttachment.id;
      metadata.cleaning_summary = {
        original_length: originalText.length,
        precleaned_length: precleanedText.length,
        cleaned_length: finalText.length,
        protected_table_count: precleanResult.protected_table_count || 0,
        protected_formula_count: (precleanResult.protected_formula_count || 0),
        updated_at: new Date().toISOString(),
      };

      await ocrResult.update({ metadata: JSON.stringify(metadata) }, { transaction });
      await transaction.commit();

      if (!options.skipStageEnter) {
        await this.advancer.finishStage(documentId, 'pending_clean', {
          runId,
          nextStage: 'pending_outline',
          message: `Document cleaned (${originalText.length} -> ${finalText.length})`,
          metadata: {
            cleaned_attachment_id: cleanedAttachment.id,
            original_length: originalText.length,
            cleaned_length: finalText.length,
            protected_table_count: precleanResult.protected_table_count || 0,
            protected_formula_count: (precleanResult.protected_formula_count || 0),
          },
        });
      }

      logger.info(`[DocumentCleanService] Document ${documentId}: cleaned ${originalText.length} -> ${finalText.length}`);

      // P0-2: 清洗完成后尝试回写正式标题到 documents.title
      // 仅在当前标题为占位值（Intake xxx / Document xxx）时覆盖
      try {
        await this._tryWriteBackTitle(ctx.document, finalText);
      } catch (titleErr) {
        logger.warn(`[DocumentCleanService] Title writeback failed (non-fatal): ${titleErr.message}`);
      }

      return {
        success: true,
        cleaned_attachment_id: cleanedAttachment.id,
        original_length: originalText.length,
        cleaned_length: finalText.length,
      };
    } catch (error) {
      await transaction.rollback();

      if (!options.skipStageEnter && runId) {
        if (this._isTimeoutError(error)) {
          await this.advancer.timeoutStage(documentId, 'pending_clean', {
            runId,
            code: 'clean_timeout',
            message: `Document clean timed out: ${error.message}`,
            metadata: {
              error_summary: error.message || null,
            },
          });
        } else {
          await this.advancer.failStage(documentId, 'pending_clean', {
            runId,
            code: 'clean_failed',
            message: error.message,
            metadata: {
              error_summary: error.message || null,
            },
          });
        }
      }

      throw error;
    }
  }

  async cleanWithLlm(stageConfig, options) {
    const chunks = this.splitIntoChunks(options.precleanedText, options.chunkMaxLength);
    const allProcessed = [];
    let carriedOver = '';
    let contextSummary = { key_terms: {}, points: [] };
    const modelConfig = await this._resolveModelConfig(options.modelId);

    for (let i = 0; i < chunks.length; i++) {
      const nextChunk = chunks[i];
      const chunkInput = carriedOver ? `${carriedOver}\n\n${nextChunk}` : nextChunk;
      const result = await this.cleanSingleChunk(modelConfig, stageConfig, chunkInput, contextSummary, options);
      allProcessed.push(result.processed_part || '');
      carriedOver = result.carried_over || '';
      contextSummary = this.trimContextSummary(result.context_summary);
    }

    if (carriedOver) {
      allProcessed.push(carriedOver);
    }

    return allProcessed.join('\n\n');
  }

  async cleanWithRetry(stageConfig, options) {
    return await this.cleanWithLlm(stageConfig, options);
  }

  isRetryableCleanError(error) {
    const message = error?.message || String(error || '');
    return CLEAN_RETRYABLE_ERROR_PATTERNS.some(pattern => pattern.test(message));
  }

  async cleanSingleChunk(modelConfig, stageConfig, chunkInput, contextSummary, options) {
    const systemPrompt = this.buildPrompt(stageConfig, options);
    const contextNote = this.buildContextNote(contextSummary);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${chunkInput}${contextNote}` },
    ];

    const response = await invokeWithRetry(modelConfig, messages, {
      temperature: options.temperature,
      timeout: options.llmTimeoutMs,
      response_format: { type: 'json_object' },
      thinking_policy: 'disable',
      logger_prefix: '[DocumentCleanService]',
      output_schema: {
        processed_part: 'string',
        carried_over: 'string',
        context_summary: {
          key_terms: {},
          points: [],
        },
      },
    });

    logger.info('[DocumentCleanService] Clean chunk response summary:', this._summarizeResponse(response));

    const parsed = this.parseLlmJsonResponse(response);
    if (!parsed || typeof parsed.processed_part !== 'string') {
      throw new Error('Document clean LLM returned invalid JSON');
    }

    return {
      processed_part: parsed.processed_part || '',
      carried_over: parsed.carried_over || '',
      context_summary: parsed.context_summary || { key_terms: {}, points: [] },
    };
  }

  buildPrompt(stageConfig, options = {}) {
    const skipTableProtection = options.skipTableProtection !== false;
    const defaultPrompt = skipTableProtection
      ? DEFAULT_CLEAN_PROMPT_NO_TABLE_PROTECT
      : DEFAULT_CLEAN_PROMPT;
    const userPrompt = stageConfig.prompt_template?.trim() || defaultPrompt;
    const tableBlockRule = skipTableProtection
      ? ''
      : '- 任意形如 [[TABLE_BLOCK_n]] 的占位符都必须原样保留，不能改字、不能丢失、不能移动顺序。\n';
    return `${userPrompt}\n\n你必须返回严格 JSON：\n{\n  "processed_part": "string",\n  "carried_over": "string",\n  "context_summary": {\n    "key_terms": {},\n    "points": []\n  }\n}\n\n规则：\n- processed_part: 本轮已清洗完成、可直接进入后续处理的正文。\n- carried_over: 若末尾内容疑似残缺、未处理完，放这里，下一轮继续。\n- context_summary: 提炼术语与上下文要点，供后续分块保持一致。\n${tableBlockRule}- 任意形如 [[FORMULA_BLOCK_n]] 或 [[FORMULA_INLINE_n]] 的占位符都必须原样保留，不能改字、不能丢失、不能移动顺序。\n- 不要输出任何 JSON 之外的内容。`;
  }

  buildContextNote(contextSummary) {
    if (!contextSummary) return '';
    const hasTerms = Object.keys(contextSummary.key_terms || {}).length > 0;
    const hasPoints = Array.isArray(contextSummary.points) && contextSummary.points.length > 0;
    if (!hasTerms && !hasPoints) return '';
    return `\n\n[前文上下文摘要]\n${JSON.stringify(contextSummary, null, 2)}\n请参考以上摘要保持术语与风格一致。`;
  }

  parseLlmJsonResponse(response) {
    if (!response) return null;

    if (response._parse_failed && response._raw) {
      logger.warn('[DocumentCleanService] LLM response parse failed, attempting raw extraction, preview:',
        String(response._raw).slice(0, 300));
      const raw = String(response._raw);
      const objectMatch = raw.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try { return JSON.parse(objectMatch[0]); } catch { }
      }
      const arrayMatch = raw.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try { return JSON.parse(arrayMatch[0]); } catch { }
      }
      return null;
    }

    if (typeof response === 'object' && !Array.isArray(response)) {
      if (typeof response.processed_part === 'string') return response;
      if (typeof response.content === 'string') {
        try {
          return JSON.parse(response.content);
        } catch {
          return null;
        }
      }
    }
    if (typeof response === 'string') {
      try {
        return JSON.parse(response);
      } catch {
        return null;
      }
    }
    return null;
  }

  splitIntoChunks(text, maxLen) {
    const paragraphs = String(text || '').split('\n\n');
    const chunks = [];
    let current = '';

    for (const para of paragraphs) {
      if (current.length + para.length + 2 <= maxLen) {
        current += (current ? '\n\n' : '') + para;
      } else {
        if (current) chunks.push(current);
        if (para.length > maxLen) {
          let remaining = para;
          while (remaining.length > 0) {
            chunks.push(remaining.slice(0, maxLen));
            remaining = remaining.slice(maxLen);
          }
          current = '';
        } else {
          current = para;
        }
      }
    }

    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : [text];
  }

  trimContextSummary(summary) {
    if (!summary) return { key_terms: {}, points: [] };
    const keyTerms = summary.key_terms || {};
    const trimmedPoints = [];
    for (const point of summary.points || []) {
      const candidate = { key_terms: keyTerms, points: [...trimmedPoints, point] };
      if (JSON.stringify(candidate).length <= CONTEXT_SUMMARY_MAX_LENGTH) {
        trimmedPoints.push(point);
      }
    }
    return { key_terms: keyTerms, points: trimmedPoints };
  }

  precleanText(text, rules = {}, skipTableProtection = true) {
    let cleaned = String(text || '');

    let tableBlocks = [];
    if (!skipTableProtection) {
      const extracted = this.extractProtectedTableBlocks(cleaned);
      tableBlocks = extracted.blocks;
      cleaned = extracted.text;
    }

    const formulaExtracted = this.extractProtectedFormulaBlocks(cleaned);
    const protectedBlocks = [...tableBlocks, ...formulaExtracted.blocks];
    cleaned = formulaExtracted.text;

    cleaned = cleaned.replace(/\r\n/g, '\n');
    cleaned = cleaned.replace(/<\/(div|span|p)>/gi, '\n');
    cleaned = cleaned.replace(/<(div|span|p)(\s[^>]*)?>/gi, ' ');
    cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');

    if (rules.remove_garbled_text !== false) {
      cleaned = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
    }

    cleaned = cleaned.replace(/[ \t]+\n/g, '\n');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');

    if (rules.remove_page_number !== false) {
      cleaned = cleaned.replace(/^\s*第?\s*\d+\s*页\s*(共\s*\d+\s*页)?\s*$/gmi, '');
      cleaned = cleaned.replace(/^\s*[-—–]?\s*\d+\s*[-—–]?\s*$/gmi, '');
    }

    if (rules.remove_header_footer !== false) {
      cleaned = this.removeRepeatedEdgeLines(cleaned);
    }

    if (rules.remove_watermark !== false) {
      cleaned = cleaned.replace(/仅供内部使用|机密|保密|Confidential/gi, '');
    }

    return {
      cleaned_text: cleaned.trim(),
      protected_blocks: protectedBlocks,
      protected_table_count: tableBlocks.length,
      protected_formula_count: formulaExtracted.blocks.length,
    };
  }

  extractProtectedFormulaBlocks(text) {
    let working = String(text || '');
    const blocks = [];

    working = working.replace(/\$\$([\s\S]*?)\$\$/g, (match, formulaContent) => {
      const token = `${FORMULA_BLOCK_TOKEN_PREFIX}${blocks.length + 1}]]`;
      blocks.push({
        type: 'formula_block',
        token,
        content: this.normalizeFormulaContent(formulaContent, { block: true }),
      });
      return `\n\n${token}\n\n`;
    });

    working = working.replace(/(^|[^$])\$([^\n$]+?)\$(?!\$)/g, (match, prefix, formulaContent) => {
      const token = `${FORMULA_INLINE_TOKEN_PREFIX}${blocks.length + 1}]]`;
      blocks.push({
        type: 'formula_inline',
        token,
        content: this.normalizeFormulaContent(formulaContent, { block: false }),
      });
      return `${prefix}${token}`;
    });

    return { text: working, blocks };
  }

  normalizeFormulaContent(formulaContent, options = {}) {
    const normalized = String(formulaContent || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return options.block ? `$$${normalized}$$` : `$${normalized}$`;
  }

  extractProtectedTableBlocks(text) {
    let working = String(text || '');
    const blocks = [];

    working = working.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (match) => {
      const token = `${TABLE_BLOCK_TOKEN_PREFIX}${blocks.length + 1}]]`;
      blocks.push({ type: 'html_table', token, content: match.trim() });
      return `\n\n${token}\n\n`;
    });

    const lines = working.split('\n');
    const resultLines = [];
    let i = 0;
    while (i < lines.length) {
      if (this.isMarkdownTableHeader(lines, i)) {
        const tableLines = [lines[i], lines[i + 1]];
        i += 2;
        while (i < lines.length && this.isMarkdownTableRow(lines[i])) {
          tableLines.push(lines[i]);
          i += 1;
        }
        const token = `${TABLE_BLOCK_TOKEN_PREFIX}${blocks.length + 1}]]`;
        blocks.push({ type: 'markdown_table', token, content: tableLines.join('\n').trim() });
        resultLines.push('', token, '');
        continue;
      }
      resultLines.push(lines[i]);
      i += 1;
    }

    return { text: resultLines.join('\n'), blocks };
  }

  isMarkdownTableHeader(lines, index) {
    const header = lines[index];
    const separator = lines[index + 1];
    if (!header || !separator) return false;
    if (!this.isMarkdownTableRow(header)) return false;
    return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(separator);
  }

  isMarkdownTableRow(line) {
    if (!line) return false;
    const trimmed = line.trim();
    if (!trimmed.includes('|')) return false;
    return /^\|?.+\|.+\|?$/.test(trimmed);
  }

  removeRepeatedEdgeLines(text) {
    const lines = String(text || '').split('\n');
    if (lines.length < 6) return text;

    const head = lines.slice(0, 3).map(line => line.trim()).filter(Boolean);
    const tail = lines.slice(-3).map(line => line.trim()).filter(Boolean);
    const repeated = new Set(head.filter(line => tail.includes(line) && line.length >= 4));
    if (repeated.size === 0) return text;

    return lines.filter(line => !repeated.has(line.trim())).join('\n');
  }

  finalizeText(text, protectedBlocks = []) {
    let finalized = String(text || '');
    finalized = this.restoreProtectedBlocks(finalized, protectedBlocks);
    return finalized
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  restoreProtectedBlocks(text, protectedBlocks = []) {
    let restored = String(text || '');
    for (const block of protectedBlocks) {
      const restoredContent = this.restoreProtectedBlock(block);
      restored = restored.split(block.token).join(restoredContent);
    }
    return restored;
  }

  restoreProtectedBlock(block) {
    if (block.type === 'html_table') {
      return this.normalizeProtectedHtmlTable(block.content);
    }
    if (block.type === 'markdown_table') {
      return this.normalizeMarkdownTable(block.content);
    }
    if (block.type === 'formula_block' || block.type === 'formula_inline') {
      return block.content;
    }
    return block.content || '';
  }

  normalizeProtectedHtmlTable(html) {
    const source = String(html || '').trim();
    const markdownTable = this.tryConvertHtmlTableToMarkdown(source);
    return markdownTable || source;
  }

  normalizeMarkdownTable(table) {
    const lines = String(table || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    if (lines.length < 2) return table;

    const parsed = lines.map(line => this.parseMarkdownTableRow(line));
    const columnCount = parsed[0]?.length || 0;

    if (columnCount && parsed.every(row => row.length === columnCount)) {
      const normalized = [];
      normalized.push(`| ${parsed[0].join(' | ')} |`);
      const hasSeparator = parsed.length > 1 && this.isMarkdownSeparatorRow(lines[1]);
      const dataStart = hasSeparator ? 2 : 1;
      normalized.push(`| ${new Array(columnCount).fill('---').join(' | ')} |`);
      for (let i = dataStart; i < parsed.length; i++) {
        normalized.push(`| ${parsed[i].join(' | ')} |`);
      }
      return normalized.join('\n');
    }

    return this.repairAndBuildMarkdownTable(lines, parsed);
  }

  parseMarkdownTableRow(line) {
    return String(line || '')
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cell => cell.trim().replace(/\s+/g, ' '));
  }

  repairAndBuildMarkdownTable(lines, parsed) {
    let baseColumnCount = parsed[0]?.length || 0;
    if (baseColumnCount === 0) {
      const counts = {};
      for (const row of parsed) {
        const len = row.length;
        if (len > 0) counts[len] = (counts[len] || 1) + 1;
      }
      let maxFreq = 0;
      for (const [len, freq] of Object.entries(counts)) {
        if (freq > maxFreq) {
          maxFreq = freq;
          baseColumnCount = parseInt(len, 10);
        }
      }
    }
    if (baseColumnCount === 0) return lines.join('\n');
    const hasSeparator = parsed.length > 1 && this.isMarkdownSeparatorRow(lines[1]);
    const dataStartIndex = hasSeparator ? 2 : 1;
    const header = this.fitRowToColumnCount(parsed[0], baseColumnCount);
    const bodyRows = [];
    for (let i = dataStartIndex; i < parsed.length; i++) {
      bodyRows.push(this.fitRowToColumnCount(parsed[i], baseColumnCount));
    }
    return this.buildMarkdownTable(header, bodyRows, baseColumnCount);
  }

  isMarkdownSeparatorRow(line) {
    return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(String(line || ''));
  }

  fitRowToColumnCount(cells, targetColumnCount) {
    if (!Array.isArray(cells)) return new Array(targetColumnCount).fill('');
    if (cells.length === targetColumnCount) return [...cells];
    if (cells.length < targetColumnCount) {
      return [...cells, ...new Array(targetColumnCount - cells.length).fill('')];
    }
    const fitted = cells.slice(0, targetColumnCount - 1);
    const merged = cells.slice(targetColumnCount - 1).join(' ');
    fitted.push(merged);
    return fitted;
  }

  buildMarkdownTable(headerCells, bodyRows, columnCount) {
    const lines = [];
    lines.push(`| ${headerCells.join(' | ')} |`);
    lines.push(`| ${new Array(columnCount).fill('---').join(' | ')} |`);
    for (const row of bodyRows) {
      lines.push(`| ${row.join(' | ')} |`);
    }
    return lines.join('\n');
  }

  tryConvertHtmlTableToMarkdown(html) {
    const source = String(html || '');
    if (!source) return null;
    if (/rowspan\s*=|colspan\s*=/i.test(source)) return null;

    const rowMatches = source.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi);
    if (!rowMatches || rowMatches.length < 2) return null;

    const rows = rowMatches.map(rowHtml => this.parseHtmlTableRow(rowHtml));
    const columnCount = rows[0]?.length || 0;
    if (!columnCount || rows.some(row => row.length !== columnCount)) return null;

    const normalizedRows = rows.map(row => row.map(cell => this.decodeHtmlText(cell)));
    const header = normalizedRows[0];
    const body = normalizedRows.slice(1);
    const markdownLines = [
      `| ${header.join(' | ')} |`,
      `| ${new Array(columnCount).fill('---').join(' | ')} |`,
      ...body.map(row => `| ${row.join(' | ')} |`),
    ];
    return markdownLines.join('\n');
  }

  parseHtmlTableRow(rowHtml) {
    const cellMatches = String(rowHtml || '').match(/<(td|th)\b[^>]*>[\s\S]*?<\/\1>/gi) || [];
    return cellMatches.map(cellHtml => String(cellHtml)
      .replace(/^<(td|th)\b[^>]*>/i, '')
      .replace(/<\/(td|th)>$/i, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .trim());
  }

  decodeHtmlText(text) {
    return String(text || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  async _loadDocumentContext(documentId) {
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

  async _loadLatestOcrResult(revisionId) {
    const DocOcrResult = this.db.getModel('doc_ocr_result');
    return await DocOcrResult.findOne({
      where: { revision_id: revisionId },
      order: [['created_at', 'DESC']],
    });
  }

  async _loadAttachmentById(attachmentId) {
    const Attachment = this.db.getModel('attachment');
    return await Attachment.findByPk(attachmentId, { raw: true });
  }

  async _readAttachmentText(filePath) {
    const basePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
    const fullPath = path.resolve(basePath, filePath);
    return await fs.readFile(fullPath, 'utf8');
  }

  toPlainObject(value) {
    if (!value) return {};
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }
    if (typeof value === 'object') return { ...value };
    return {};
  }

  /**
   * P0-2: 从清洗后的文本中提取正式标题
   *
   * 提取策略：
   *   1. 优先取第一个 Markdown H1（# 标题）
   *   2. 若无 H1，取第一个非空行（排除 YAML front matter / 页码等明显非标题行）
   *   3. 标题长度控制在 200 字符以内
   *   4. 若无法提取有效标题，返回 null
   *
   * @param {string} cleanedText - 清洗后的 Markdown 文本
   * @returns {string|null} 提取的标题，或 null
   */
  _extractTitleFromCleanedText(cleanedText) {
    if (!cleanedText || !cleanedText.trim()) return null;

    const lines = cleanedText.split(/\r?\n/);

    // 策略 1：第一个 H1 标题
    for (const line of lines) {
      const h1Match = line.match(/^#\s+(.+)/);
      if (h1Match) {
        const title = h1Match[1].trim();
        if (title.length > 0 && title.length <= 200) return title;
      }
    }

    // 策略 2：第一个有意义的非空行
    const NON_TITLE_PATTERNS = [
      /^---\s*$/,                          // YAML front matter 分隔符
      /^\s*[-–—]+\s*$/,                     // 纯分隔线
      /^\d{1,4}\s*$/,                       // 纯页码
      /^第[一二三四五六七八九十\d]+页\s*$/,    // 中文页码
      /^\[?\[TABLE_BLOCK_\d+\]\]?\s*$/,     // 表格占位符
      /^\[?\[FORMULA_(BLOCK|INLINE)_\d+\]\]?\s*$/, // 公式占位符
    ];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (NON_TITLE_PATTERNS.some(p => p.test(trimmed))) continue;
      if (trimmed.length <= 200) return trimmed;
      // 长行取前 200 字符
      return trimmed.substring(0, 200);
    }

    return null;
  }

  /**
   * P0-2: 尝试将清洗后提取的标题回写到 documents.title
   *
   * 回写规则（审计 round01 约定）：
   *   - 仅覆盖占位值（Intake xxx / Document xxx）
   *   - 不覆盖用户已手动修改的标题
   *   - 不覆盖已包含中文的标题（视为已定稿）
   *   - 提取失败（null）时不执行任何操作
   *
   * @param {Object} document - Sequelize document model instance
   * @param {string} cleanedText - 清洗后的 Markdown 文本
   * @returns {Promise<void>}
   */
  async _tryWriteBackTitle(document, cleanedText) {
    const extractedTitle = this._extractTitleFromCleanedText(cleanedText);
    if (!extractedTitle) {
      logger.info('[DocumentCleanService] Title writeback skipped: no extractable title found');
      return;
    }

    const currentTitle = document.title || '';

    // 判断是否为占位值
    const isPlaceholder = /^(Intake|Document)\s+\w+/i.test(currentTitle);

    // 已包含中文 → 认为已定稿，不覆盖
    const hasChinese = /[\u4e00-\u9fff]/.test(currentTitle);

    if (!isPlaceholder && hasChinese) {
      logger.info(`[DocumentCleanService] Title writeback skipped: title already finalized "${currentTitle}"`);
      return;
    }

    if (!isPlaceholder && !hasChinese) {
      // 非占位值但也不含中文（可能是英文文档名），保守起见不覆盖
      logger.info(`[DocumentCleanService] Title writeback skipped: non-placeholder title "${currentTitle}"`);
      return;
    }

    // 占位值 → 覆盖
    await document.update({ title: extractedTitle });
    logger.info(`[DocumentCleanService] Title writeback: "${currentTitle}" -> "${extractedTitle}" for document ${document.id}`);
  }
}

export default DocumentCleanService;
