import fs from 'fs/promises';
import path from 'path';

import Utils from './utils.js';
import logger from './logger.js';
import DocPipelineAdvancer from './doc-pipeline-advancer.js';
import { getStageDefault } from './doc-pipeline-defaults.js';

const DEFAULT_PROVIDER = 'mineru';
const DEFAULT_SERVER_NAME = 'mineru';
const MAX_ATTACHMENT_JSON_LENGTH = 200000;
const MAX_JSON_PREVIEW_ITEMS = 50;
const MAX_JSON_PREVIEW_OBJECT_KEYS = 50;
const MAX_SAFE_SUMMARY_DEPTH = 4;
const MAX_IMAGE_METADATA_ITEMS = 20;
const MAX_ATTACHMENT_ALT_TEXT_LENGTH = 500;
const MAX_ATTACHMENT_DESCRIPTION_LENGTH = 4000;

const STATUS_MAP = {
  pending: 'pending',
  submitted: 'pending',
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
    this.callLlm = options.callLlm || null;
    this.getDocPipelineConfig = options.getDocPipelineConfig || null;
    this.provider = options.provider || DEFAULT_PROVIDER;
    this.serverName = options.serverName || DEFAULT_SERVER_NAME;
    this.advancer = new DocPipelineAdvancer(db);
  }

  async _loadStageConfig(stageKey) {
    if (typeof this.getDocPipelineConfig === 'function') {
      try {
        const fullConfig = await this.getDocPipelineConfig();
        if (fullConfig && fullConfig[stageKey]) {
          return fullConfig[stageKey];
        }
      } catch (err) {
        logger.warn(`[DocumentOcrService] Failed to load ${stageKey} config, using defaults:`, err.message);
      }
    }
    return getStageDefault(stageKey);
  }

  _resolveMcpServer(stageConfig) {
    return stageConfig?.mcp?.server || DEFAULT_SERVER_NAME;
  }

  _resolveMcpTool(stageConfig, fallbackTool) {
    return stageConfig?.mcp?.tool || fallbackTool;
  }

  _resolveTimeout(stageConfig, fallbackMs) {
    return stageConfig?.timeout_ms || fallbackMs;
  }

  _buildMcpParams(stageConfig, inputs) {
    if (!stageConfig?.mcp) return inputs;
    const mapping = stageConfig.mcp.params_mapping || {};
    const staticParams = stageConfig.mcp.params || {};
    const result = { ...staticParams };
    for (const [inputKey, paramName] of Object.entries(mapping)) {
      if (inputs[inputKey] !== undefined) {
        result[paramName] = inputs[inputKey];
      }
    }
    return result;
  }

  _validateJudgeResult(judgeResult, stageKey, outputSchema) {
    if (!judgeResult || typeof judgeResult !== 'object') {
      return { valid: false, reason: 'result_not_object' };
    }

    const missing = [];

    if (stageKey === 'pending_ocr') {
      if (!judgeResult.task_id) missing.push('task_id');
      if (judgeResult.provider === undefined || judgeResult.provider === null) missing.push('provider');
      if (judgeResult.is_success === undefined || judgeResult.is_success === null) missing.push('is_success');
    } else if (stageKey === 'ocr_processing') {
      if (!judgeResult.status) missing.push('status');
      if (typeof judgeResult.progress !== 'number') missing.push('progress');
      if (judgeResult.is_completed === undefined || judgeResult.is_completed === null) missing.push('is_completed');
    } else if (stageKey === 'ocr_finalize') {
      if (judgeResult.is_success === undefined || judgeResult.is_success === null) missing.push('is_success');
      if (judgeResult.is_success === false) {
        logger.warn(`[DocumentOcrService] Judge reported failure for ocr_finalize: ${judgeResult.error_message || 'unknown'}`);
        return { valid: true, failed: true };
      }
    }

    if (outputSchema && typeof outputSchema === 'object') {
      const schemaKeys = Object.keys(outputSchema);
      const schemaMissing = [];
      for (const key of schemaKeys) {
        if (!(key in judgeResult)) schemaMissing.push(key);
      }
      if (schemaMissing.length > 0) {
        const isOcrCore = stageKey === 'pending_ocr' || stageKey === 'ocr_processing' || stageKey === 'ocr_finalize';
        if (isOcrCore) {
          logger.warn(`[DocumentOcrService] Judge result missing schema keys for ${stageKey}: [${schemaMissing.join(', ')}]`);
          missing.push(...schemaMissing);
        } else {
          logger.warn(`[DocumentOcrService] Judge result missing suggested schema keys for ${stageKey}: [${schemaMissing.join(', ')}]`);
        }
      }
    }

    if (missing.length > 0) {
      logger.warn(`[DocumentOcrService] Judge validation failed for ${stageKey}: missing keys [${missing.join(', ')}]`);
      return { valid: false, reason: `missing_keys: ${missing.join(',')}` };
    }

    return { valid: true };
  }

  _buildJudgePrompt(judge, mcpText) {
    let prompt = judge.prompt_template || '';
    const schema = judge.output_schema;
    if (schema && typeof schema === 'object' && Object.keys(schema).length > 0) {
      const schemaDesc = JSON.stringify(schema, null, 2);
      prompt = `${prompt}\n\n必须严格按以下 JSON Schema 输出，只返回 JSON 对象，不要包含任何额外解释文字：\n${schemaDesc}`;
    }
    return `${prompt}\n\nMCP返回结果：\n${mcpText}`;
  }

  async _runJudge(stageConfig, mcpResult, stageContext = {}) {
    const judge = stageConfig?.judge;
    if (!judge || !judge.prompt_template) return mcpResult;
    if (typeof this.callLlm !== 'function') {
      logger.warn('[DocumentOcrService] callLlm not available, skipping judge normalization');
      return mcpResult;
    }

    try {
      const mcpText = JSON.stringify(mcpResult, null, 2);
      const prompt = this._buildJudgePrompt(judge, mcpText);
      const judgeResult = await this.callLlm({
        model_id: judge.model_id || null,
        temperature: judge.temperature ?? 0.1,
        messages: [{ role: 'user', content: prompt }],
        output_schema: judge.output_schema || {},
      });

      if (judgeResult && typeof judgeResult === 'object') {
        const stageKey = stageContext?.stage || 'unknown';
        const validation = this._validateJudgeResult(judgeResult, stageKey, judge.output_schema);
        if (!validation.valid) {
          logger.warn(`[DocumentOcrService] Judge validation failed for ${stageKey}: ${validation.reason}`);
          return { ...mcpResult, _normalized: { _judge_error: validation.reason, ...judgeResult } };
        }
        if (validation.failed) {
          logger.warn(`[DocumentOcrService] Judge reported failure for ${stageKey}`);
          return { ...mcpResult, _normalized: { ...judgeResult } };
        }
        return { ...mcpResult, _normalized: judgeResult };
      }
      return mcpResult;
    } catch (err) {
      logger.warn(`[DocumentOcrService] Judge normalization failed: ${err.message}`);
      return mcpResult;
    }
  }

  async submit(documentId, options = {}) {
    this.ensureCallMcp();
    const config = await this._loadStageConfig('pending_ocr');
    const serverName = this._resolveMcpServer(config);
    const toolName = this._resolveMcpTool(config, 'create_task_from_file');
    const timeoutMs = this._resolveTimeout(config, 120000);
    const provider = config.provider_name || this.provider;

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

    const ocrResult = await this.ensureOcrResult(ctx);
    await this.advancer.advance(documentId, 'ocr_processing');

    const attachment = await this.resolveSourceAttachment(ctx.document, ctx.revision, options.attachmentId, options.userId || null);
    if (!attachment) {
      await this.markFailed(ctx, 'attachment_not_found', '未找到可用于OCR的源附件');
      throw new Error(`No source attachment found for document ${documentId}`);
    }

    const fileBase64 = await this.readAttachmentBase64(attachment);
    const mcpParams = this._buildMcpParams(config, {
      file_base64: fileBase64,
      file_name: attachment.file_name || `document-${documentId}.bin`,
      lang: options.lang || 'ch',
      formula_enable: options.formulaEnable ?? true,
      table_enable: options.tableEnable ?? true,
      image_analysis: options.imageAnalysis ?? true,
    });

    const submitToolResult = await this.callMcp(
      serverName,
      toolName,
      mcpParams,
      timeoutMs,
    );
    const result = this.extractStructuredToolResult(submitToolResult);

    const judged = await this._runJudge(config, result, { stage: 'pending_ocr' });
    const normalized = judged?._normalized || {};

    const taskId = normalized.task_id || result?.task_id || null;
    const resolvedProvider = normalized.provider || provider;
    const isSuccess = normalized.is_success !== false;
    const normalizedStatus = isSuccess ? this.normalizeStatus(result?.status || 'pending') : 'failed';
    const failMessage = !isSuccess ? (normalized.message || 'OCR submit failed') : null;

    await ocrResult.update({
      provider: resolvedProvider,
      task_id: taskId,
      status: normalizedStatus,
      progress: normalizedStatus === 'failed' ? -1 : 0,
      started_at: new Date(),
      error_code: normalizedStatus === 'failed' ? 'submit_failed' : null,
      error_message: normalizedStatus === 'failed' ? failMessage : null,
      metadata: {
        ...(ocrResult.metadata || {}),
        submit_tool_result: this.buildToolResultSummary(submitToolResult),
        submit_result: this.buildResultSummary(result),
        judge_result: judged?._normalized || null,
      },
    });

    if (normalizedStatus === 'failed') {
      await this.advancer.fail(documentId, 'ocr_submit_failed', failMessage || 'OCR submit failed');
      return ocrResult;
    }

    return ocrResult;
  }

  async syncTaskStatus(documentId, options = {}) {
    this.ensureCallMcp();
    const config = await this._loadStageConfig('ocr_processing');
    const serverName = this._resolveMcpServer(config);
    const toolName = this._resolveMcpTool(config, 'get_task_status');
    const timeoutMs = this._resolveTimeout(config, 120000);

    const ctx = await this.loadDocumentContext(documentId);
    this.ensureDocumentWritableForOcr(ctx.document);
    const ocrResult = await this.ensureOcrResult(ctx);
    if (!ocrResult.task_id) {
      logger.info(`[DocumentOcrService] OCR task missing for ${documentId}, retrying submit`);
      await this.submit(documentId, options);
      const retried = await this.ensureOcrResult(ctx);
      return { ocrResult: retried, statusResult: null, completed: false };
    }

    if (ocrResult.status === 'completed' && ocrResult.main_markdown_attachment_id) {
      await this.advancer.advance(documentId, 'pending_clean');
      return { ocrResult, statusResult: null, completed: true };
    }

    const statusToolResult = await this.callMcp(
      serverName,
      toolName,
      { task_id: ocrResult.task_id },
      timeoutMs,
    );
    await this.assertDocumentNotDeleted(documentId);
    const statusResult = this.extractStructuredToolResult(statusToolResult);
    const judged = await this._runJudge(config, statusResult, { stage: 'ocr_processing' });
    const normalized = judged?._normalized || {};

    const normalizedStatus = normalized.status ? this.normalizeStatus(normalized.status) : this.normalizeStatus(statusResult?.status);
    const progress = typeof normalized.progress === 'number' ? normalized.progress : (typeof statusResult?.progress === 'number' ? statusResult.progress : ocrResult.progress);
    const isCompleted = normalizedStatus === 'completed' || normalized.is_completed === true;
    const finalStatus = isCompleted ? 'completed' : normalizedStatus;

    await ocrResult.update({
      status: finalStatus,
      progress: isCompleted ? 100 : progress,
      error_code: finalStatus === 'failed' ? 'task_failed' : null,
      error_message: finalStatus === 'failed' ? (normalized.error_message || statusResult?.error || statusResult?.message || 'OCR task failed') : null,
      completed_at: finalStatus === 'completed' || finalStatus === 'failed' ? new Date() : null,
      metadata: {
        ...(ocrResult.metadata || {}),
        last_status_tool_result: this.buildToolResultSummary(statusToolResult),
        last_status_result: this.buildResultSummary(statusResult),
        judge_result: judged?._normalized || null,
      },
    });

    if (finalStatus === 'failed') {
      await this.advancer.fail(documentId, 'ocr_task_failed', normalized.error_message || statusResult?.error || statusResult?.message || 'OCR task failed');
      return { ocrResult, statusResult, completed: false };
    }

    if (!isCompleted) {
      return { ocrResult, statusResult, completed: false };
    }

    await this.assertDocumentNotDeleted(documentId);
    const finalized = await this.finalizeCompletedTask(ctx, ocrResult, options);
    await this.advancer.advance(documentId, 'pending_clean');
    return { ocrResult: finalized, statusResult, completed: true };
  }

  async cancelTask(documentId, options = {}) {
    this.ensureCallMcp();
    const config = await this._loadStageConfig('ocr_processing');
    const serverName = this._resolveMcpServer(config);

    const ctx = await this.loadDocumentContext(documentId);
    const ocrResult = await this.getLatestOcrResult(ctx.revision.id);

    if (!ocrResult) {
      return { cancelled: false, skipped: true, reason: 'ocr_result_not_found' };
    }

    const runningStatuses = ['pending', 'processing'];
    const result = {
      cancelled: false,
      skipped: false,
      remoteCancelAttempted: false,
      remoteCancelSucceeded: false,
      taskId: ocrResult.task_id || null,
      status: ocrResult.status || null,
    };

    if (!ocrResult.task_id || !runningStatuses.includes(ocrResult.status)) {
      await ocrResult.update({
        error_code: ocrResult.error_code || 'document_deleted',
        error_message: ocrResult.error_message || 'Document deleted by user',
        completed_at: ocrResult.completed_at || new Date(),
      });
      return { ...result, skipped: true, reason: 'task_not_running' };
    }

    try {
      result.remoteCancelAttempted = true;
      const cancelToolResult = await this.callMcp(
        serverName,
        'cancel_task',
        { task_id: ocrResult.task_id },
        options.timeoutMs || 120000,
      );
      const cancelResult = this.extractStructuredToolResult(cancelToolResult);
      result.remoteCancelSucceeded = true;
      result.cancelled = true;

      await ocrResult.update({
        status: 'failed',
        progress: -1,
        error_code: 'document_deleted',
        error_message: 'Document deleted by user',
        completed_at: new Date(),
        metadata: {
          ...(ocrResult.metadata || {}),
          cancel_tool_result: this.buildToolResultSummary(cancelToolResult),
          cancel_result: this.buildResultSummary(cancelResult),
        },
      });

      return result;
    } catch (error) {
      await ocrResult.update({
        status: 'failed',
        progress: -1,
        error_code: 'document_deleted',
        error_message: `Document deleted by user (cancel failed: ${error.message})`,
        completed_at: new Date(),
      });
      return {
        ...result,
        cancelled: false,
        remoteCancelSucceeded: false,
        cancelError: error.message,
      };
    }
  }

  async finalizeCompletedTask(ctx, ocrResult, options = {}) {
    this.ensureDocumentWritableForOcr(ctx.document);
    const config = await this._loadStageConfig('ocr_finalize');
    const serverName = this._resolveMcpServer(config);
    const timeoutMs = this._resolveTimeout(config, 120000);

    const defaultDeliverableTool = config?.default_deliverable_tool || 'get_default_deliverable';
    const listDeliverablesTool = config?.list_deliverables_tool || 'list_deliverables';
    const imageDeliverablesTool = config?.image_deliverables_tool || 'get_image_deliverables';

    const taskId = ocrResult.task_id;
    const defaultDeliverable = this.extractStructuredToolResult(
      await this.callMcp(serverName, defaultDeliverableTool, { task_id: taskId }, timeoutMs)
    );
    await this.assertDocumentNotDeleted(ctx.document.id);
    const deliverables = this.extractStructuredToolResult(
      await this.callMcp(serverName, listDeliverablesTool, { task_id: taskId }, timeoutMs)
    );
    await this.assertDocumentNotDeleted(ctx.document.id);
    const imageDeliverables = this.extractStructuredToolResult(
      await this.callMcp(serverName, imageDeliverablesTool, { task_id: taskId }, timeoutMs)
    );
    await this.assertDocumentNotDeleted(ctx.document.id);

    const judged = await this._runJudge(config, {
      default_deliverable: defaultDeliverable,
      deliverables,
      image_deliverables: this.summarizeImageDeliverables(imageDeliverables),
    }, { stage: 'ocr_finalize' });
    const normalized = judged?._normalized || {};

    const judgeExplicitFailed = normalized.is_success === false;
    const judgeMissingMain = normalized.error_message && !normalized.main_markdown;
    const mainMarkdown = normalized.main_markdown || this.extractDefaultMarkdown(defaultDeliverable);
    const normalizedImageItems = Array.isArray(normalized.image_items) ? normalized.image_items : [];
    const fallbackImageItems = Array.isArray(imageDeliverables?.items) ? imageDeliverables.items : [];
    const imageItems = normalizedImageItems.length > 0 ? normalizedImageItems : fallbackImageItems;

    const normalizedDeliverables = Array.isArray(normalized.deliverables) ? normalized.deliverables : [];
    const hasNormalizedDeliverables = normalizedDeliverables.length > 0;

    // Phase 2 预留: 按 normalized.deliverables[].download_method (inline|url|tool)
    // 执行实际下载/分发逻辑。当前阶段归一化结果仅用于结构化描述与 metadata 存储，
    // 实际二进制提取仍通过 config 中的 MCP 工具名调用原始 MCP 服务完成。

    const hasContent = mainMarkdown.trim().length > 0;
    if (judgeExplicitFailed && !hasContent) {
      logger.error(`[DocumentOcrService] Finalize judge failed and no fallback content: ${normalized.error_message || 'unknown'}`);
      await ocrResult.update({
        status: 'failed',
        progress: -1,
        error_code: 'judge_normalization_failed',
        error_message: normalized.error_message || 'Judge normalization failed with no fallback content',
        completed_at: new Date(),
        metadata: {
          ...this.toPlainObject(ocrResult.metadata),
          judge_result: judged?._normalized || null,
        },
      });
      await this.advancer.fail(ctx.document.id, 'judge_normalization_failed', normalized.error_message || 'Judge normalization failed');
      return ocrResult;
    }

    if (judgeExplicitFailed || judgeMissingMain) {
      logger.warn(`[DocumentOcrService] Judge reported issue for finalize, using fallback extraction: ${normalized.error_message || 'no main_markdown'}`);
    }

    const imageUrlMap = {};
    const imageRecords = [];

    for (let i = 0; i < imageItems.length; i++) {
      await this.assertDocumentNotDeleted(ctx.document.id);
      const item = imageItems[i];
      const normalizedDataUrl = typeof item?.data_url === 'string' ? item.data_url : null;
      const imageDataUrl = normalizedDataUrl || imageDeliverables?.images?.[item.filename] || imageDeliverables?.images?.[item.relative_path || item.filename];
      if (!imageDataUrl) continue;
      const attachment = await this.createAttachmentFromDataUrl(
        ctx.revision.id,
        ctx.revision.created_by || null,
        item.filename || 'image.png',
        imageDataUrl,
        this.truncateText(item.alt_text || '', MAX_ATTACHMENT_ALT_TEXT_LENGTH),
        this.truncateText(item.description || null, MAX_ATTACHMENT_DESCRIPTION_LENGTH)
      );
      imageUrlMap[item.relative_path || item.filename] = `/api/attachments/${attachment.id}`;
      imageRecords.push({ item, attachment, sortOrder: i });
    }

    const rewrittenMarkdown = this.rewriteMarkdownImageLinks(mainMarkdown, imageUrlMap);

    await this.assertDocumentNotDeleted(ctx.document.id);
    const rawResultAttachment = await this.createTextAttachment(ctx.revision.id, ctx.revision.created_by || null, 'ocr-raw-result.json', this.safeJsonForAttachment(defaultDeliverable), 'application/json');
    const deliverablesManifestAttachment = await this.createTextAttachment(ctx.revision.id, ctx.revision.created_by || null, 'ocr-deliverables.json', this.safeJsonForAttachment(deliverables), 'application/json');
    const imageManifestAttachment = await this.createTextAttachment(ctx.revision.id, ctx.revision.created_by || null, 'ocr-images.json', this.safeJsonForAttachment(this.summarizeImageDeliverables(imageDeliverables)), 'application/json');
    const mainMarkdownAttachment = await this.createTextAttachment(ctx.revision.id, ctx.revision.created_by || null, 'ocr-main.md', rewrittenMarkdown, 'text/markdown');

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
        ...this.toPlainObject(ocrResult.metadata),
        default_deliverable: {
          format: defaultDeliverable?.format || null,
          filename: defaultDeliverable?.filename || null,
        },
        deliverables_summary: this.buildResultSummary(deliverables),
        image_deliverables_summary: this.buildImageDeliverablesSummary(imageDeliverables),
        judge_result: judged?._normalized || null,
        normalized_deliverables: hasNormalizedDeliverables ? normalizedDeliverables : null,
        normalized_raw_payload: normalized.raw_payload || null,
      },
    });

    const DocOcrImage = this.db.getModel('doc_ocr_image');
    for (const { item, attachment, sortOrder } of imageRecords) {
      await this.assertDocumentNotDeleted(ctx.document.id);
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
        alt_text: this.truncateText(ref?.alt_text || null, MAX_ATTACHMENT_ALT_TEXT_LENGTH),
        description: this.truncateText(item.description || null, MAX_ATTACHMENT_DESCRIPTION_LENGTH),
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

  ensureDocumentWritableForOcr(document) {
    if (!document) {
      throw new Error('Document not found');
    }

    if (document.processing_error_code === 'document_deleted') {
      const error = new Error(`Document deleted: ${document.id}`);
      error.code = 'DOCUMENT_DELETED';
      throw error;
    }
  }

  async assertDocumentNotDeleted(documentId) {
    const Document = this.db.getModel('document');
    const document = await Document.findByPk(documentId, {
      attributes: ['id', 'processing_error_code'],
      raw: true,
    });

    if (!document || document.processing_error_code === 'document_deleted') {
      const error = new Error(`Document deleted: ${documentId}`);
      error.code = 'DOCUMENT_DELETED';
      throw error;
    }
  }

  async resolveSourceAttachment(document, revision, explicitAttachmentId = null, userId = null) {
    const Attachment = this.db.getModel('attachment');
    if (explicitAttachmentId) {
      const explicitAttachment = await Attachment.findByPk(explicitAttachmentId);
      if (!explicitAttachment) return null;

      const belongsToCurrentRevision = explicitAttachment.source_tag === 'doc-platform' && explicitAttachment.source_id === revision.id;
      const belongsToCurrentDocument = explicitAttachment.source_tag === 'doc-platform' && explicitAttachment.source_id === document.id;
      const belongsToCurrentUser = userId && explicitAttachment.created_by === userId;

      if (belongsToCurrentRevision || belongsToCurrentDocument || belongsToCurrentUser) {
        return explicitAttachment;
      }
      return null;
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

  async createTextAttachment(revisionId, createdBy, fileName, content, mimeType = 'text/plain') {
    return await this.createAttachmentRecord({
      revisionId,
      createdBy,
      fileName,
      mimeType,
      buffer: Buffer.from(content || '', 'utf8'),
    });
  }

  async createAttachmentFromDataUrl(revisionId, createdBy, fileName, dataUrl, altText = '', description = null) {
    const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl || '');
    if (!match) throw new Error(`Invalid data URL for ${fileName}`);
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    return await this.createAttachmentRecord({
      revisionId,
      createdBy,
      fileName,
      mimeType,
      buffer,
      altText,
      description,
    });
  }

  async createAttachmentRecord({ revisionId, createdBy = null, fileName, mimeType, buffer, altText = null, description = null }) {
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
      created_by: createdBy,
    });

    return await Attachment.findByPk(id, { raw: true });
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

  extractStructuredToolResult(result) {
    if (!result || typeof result !== 'object') {
      return result;
    }

    if (result.structuredContent && typeof result.structuredContent === 'object') {
      return this.toSafeSerializable(result.structuredContent);
    }

    if (result.content && typeof result.content === 'string') {
      try {
        return JSON.parse(result.content);
      } catch {
        return this.toSafeSerializable(result);
      }
    }

    if (Array.isArray(result.raw)) {
      const text = result.raw
        .filter(item => item?.type === 'text' && typeof item.text === 'string')
        .map(item => item.text)
        .join('\n')
        .trim();

      if (text) {
        try {
          return JSON.parse(text);
        } catch {
          return { _rawText: this.truncateText(text, 4000) };
        }
      }
    }

    return this.toSafeSerializable(result);
  }

  toSafeSerializable(value, depth = 0, seen = new WeakSet()) {
    if (value == null) return value;

    if (typeof value === 'string') {
      return this.truncateText(value, 4000);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'bigint') {
      return String(value);
    }

    if (typeof value === 'function') {
      return `[Function ${value.name || 'anonymous'}]`;
    }

    if (typeof value !== 'object') {
      return this.truncateText(String(value), 4000);
    }

    if (seen.has(value)) {
      return '[Circular]';
    }

    if (depth >= MAX_SAFE_SUMMARY_DEPTH) {
      if (Array.isArray(value)) return `[Array(${value.length})]`;
      return `[Object keys=${Object.keys(value).length}]`;
    }

    seen.add(value);

    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_JSON_PREVIEW_ITEMS)
        .map(item => this.toSafeSerializable(item, depth + 1, seen));
      if (value.length > MAX_JSON_PREVIEW_ITEMS) {
        items.push(`… ${value.length - MAX_JSON_PREVIEW_ITEMS} more items`);
      }
      return items;
    }

    const result = {};
    const entries = Object.entries(value).slice(0, MAX_JSON_PREVIEW_OBJECT_KEYS);
    for (const [key, nested] of entries) {
      result[key] = this.toSafeSerializable(nested, depth + 1, seen);
    }
    const originalKeyCount = Object.keys(value).length;
    if (originalKeyCount > MAX_JSON_PREVIEW_OBJECT_KEYS) {
      result.__truncated_keys__ = originalKeyCount - MAX_JSON_PREVIEW_OBJECT_KEYS;
    }
    return result;
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
    if (typeof value === 'object') {
      return this.toSafeSerializable(value);
    }
    return {};
  }

  normalizeError(error) {
    if (!error) {
      return { message: 'Unknown OCR error', status: 500 };
    }

    return {
      status: error.status || 500,
      message: this.truncateText(error.message || String(error), 2000),
      summary: this.toSafeSerializable(error),
    };
  }

  buildToolResultSummary(toolResult) {
    if (!toolResult || typeof toolResult !== 'object') {
      return toolResult ?? null;
    }

    const summary = {};

    if (typeof toolResult.isError === 'boolean') {
      summary.isError = toolResult.isError;
    }

    if (toolResult.structuredContent && typeof toolResult.structuredContent === 'object') {
      summary.structuredContent = this.buildResultSummary(toolResult.structuredContent);
    }

    if (typeof toolResult.content === 'string') {
      summary.content = this.truncateText(toolResult.content, 4000);
    }

    if (Array.isArray(toolResult.raw)) {
      summary.raw = toolResult.raw.slice(0, 5).map(item => {
        if (!item || typeof item !== 'object') return item;
        return {
          type: item.type || null,
          text: typeof item.text === 'string' ? this.truncateText(item.text, 4000) : undefined,
        };
      });
    }

    return summary;
  }

  buildResultSummary(result) {
    if (result == null) return null;
    if (typeof result === 'string') return this.truncateText(result, 4000);
    if (typeof result !== 'object') return result;

    const summary = {};
    const keys = [
      'task_id',
      'status',
      'progress',
      'message',
      'error',
      'format',
      'filename',
      'backend',
      'lang',
    ];

    for (const key of keys) {
      if (result[key] !== undefined) {
        summary[key] = typeof result[key] === 'string' ? this.truncateText(result[key], 1000) : result[key];
      }
    }

    if (Array.isArray(result.items)) {
      summary.item_count = result.items.length;
    }

    if (result.images && typeof result.images === 'object') {
      summary.image_count = Object.keys(result.images).length;
    }

    if (result.result !== undefined) {
      if (typeof result.result === 'string') {
        summary.result_preview = this.truncateText(result.result, 2000);
      } else if (result.result && typeof result.result === 'object') {
        summary.result_keys = Object.keys(result.result).slice(0, 20);
      }
    }

    return summary;
  }

  truncateText(text, maxLength = 1000) {
    if (typeof text !== 'string') return text;
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}…[truncated ${text.length - maxLength} chars]`;
  }

  summarizeImageDeliverables(imageDeliverables) {
    if (!imageDeliverables || typeof imageDeliverables !== 'object') return imageDeliverables;

    const images = imageDeliverables.images && typeof imageDeliverables.images === 'object'
      ? Object.keys(imageDeliverables.images).reduce((acc, key) => {
        const value = imageDeliverables.images[key];
        acc[key] = typeof value === 'string'
          ? { omitted: true, length: value.length, preview: this.truncateText(value, 120) }
          : '[non-string image payload omitted]';
        return acc;
      }, {})
      : undefined;

    return {
      ...imageDeliverables,
      item_count: Array.isArray(imageDeliverables.items) ? imageDeliverables.items.length : 0,
      images,
    };
  }

  buildImageDeliverablesSummary(imageDeliverables) {
    if (!imageDeliverables || typeof imageDeliverables !== 'object') return null;

    const items = Array.isArray(imageDeliverables.items)
      ? imageDeliverables.items.slice(0, MAX_IMAGE_METADATA_ITEMS).map(item => ({
        filename: item?.filename || null,
        media_type: item?.media_type || null,
        relative_path: item?.relative_path || null,
        referenced_in_markdown: Boolean(item?.referenced_in_markdown),
      }))
      : [];

    return {
      item_count: Array.isArray(imageDeliverables.items) ? imageDeliverables.items.length : 0,
      image_count: imageDeliverables.images && typeof imageDeliverables.images === 'object'
        ? Object.keys(imageDeliverables.images).length
        : 0,
      items,
      truncated_items: Array.isArray(imageDeliverables.items) && imageDeliverables.items.length > MAX_IMAGE_METADATA_ITEMS
        ? imageDeliverables.items.length - MAX_IMAGE_METADATA_ITEMS
        : 0,
    };
  }

  buildJsonAttachmentPayload(value) {
    const previewValue = this.sanitizeForJsonPreview(value);
    const text = JSON.stringify(previewValue, null, 2);
    if (text.length <= MAX_ATTACHMENT_JSON_LENGTH) return text;
    return JSON.stringify({
      truncated: true,
      original_length: text.length,
      preview: this.truncateText(text, MAX_ATTACHMENT_JSON_LENGTH),
    }, null, 2);
  }

  sanitizeForJsonPreview(value, depth = 0) {
    if (value == null) return value;

    if (typeof value === 'string') {
      if (/^data:[^;]+;base64,/i.test(value)) {
        return {
          omitted: true,
          kind: 'data-url',
          length: value.length,
          preview: this.truncateText(value, 120),
        };
      }
      if (value.length > MAX_ATTACHMENT_JSON_LENGTH) {
        return {
          truncated: true,
          length: value.length,
          preview: this.truncateText(value, 4000),
        };
      }
      return value;
    }

    if (typeof value !== 'object') return value;

    if (depth >= 4) {
      if (Array.isArray(value)) {
        return `[array omitted length=${value.length}]`;
      }
      return `[object omitted keys=${Object.keys(value).length}]`;
    }

    if (Array.isArray(value)) {
      return value.slice(0, MAX_JSON_PREVIEW_ITEMS).map(item => this.sanitizeForJsonPreview(item, depth + 1));
    }

    const entries = Object.entries(value).slice(0, MAX_JSON_PREVIEW_OBJECT_KEYS).map(([key, nested]) => {
      return [key, this.sanitizeForJsonPreview(nested, depth + 1)];
    });

    const result = Object.fromEntries(entries);
    const originalKeyCount = Object.keys(value).length;
    if (originalKeyCount > MAX_JSON_PREVIEW_OBJECT_KEYS) {
      result.__truncated_keys__ = originalKeyCount - MAX_JSON_PREVIEW_OBJECT_KEYS;
    }
    return result;
  }

  safeJsonForAttachment(value) {
    return this.buildJsonAttachmentPayload(value);
  }
}

export default DocumentOcrService;
