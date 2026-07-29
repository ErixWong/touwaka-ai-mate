import fs from 'fs/promises';
import path from 'path';
import Utils from './utils.js';
import logger from './logger.js';
import { Op } from 'sequelize';
import DocPipelineAdvancer from './doc-pipeline-advancer.js';
import { getStageDefault } from './doc-pipeline-defaults.js';
import { getPreviewAttachmentId } from './doc-ocr-utils.js';
import DocAccessService from './doc-access-service.js';
import AttachmentService from '../server/services/attachment.service.js';
import DocumentIntakeService from './document-intake.service.js';
import { normalizeLegacyStatus } from './doc-processing-status.js';
import { invokeWithRetry } from './message-llm-client.js';

const DEFAULT_PROVIDER = 'mineru';
const DEFAULT_SERVER_NAME = 'mineru';
const OCR_PRODUCT_SOURCE_TAG = 'doc-platform-ocr';
const MAX_ATTACHMENT_JSON_LENGTH = 200000;
const MAX_JSON_PREVIEW_ITEMS = 50;
const MAX_JSON_PREVIEW_OBJECT_KEYS = 50;
const MAX_SAFE_SUMMARY_DEPTH = 4;
const MAX_IMAGE_METADATA_ITEMS = 20;
const MAX_ATTACHMENT_ALT_TEXT_LENGTH = 500;
const MAX_ATTACHMENT_DESCRIPTION_LENGTH = 4000;
const SUBMIT_IN_PROGRESS_STALE_GRACE_MS = 30000;

function collectTruthy(values) {
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

const EXTERNAL_TO_OCR_STATUS_MAP = {
  pending: 'pending',
  submitted: 'pending',
  queued: 'pending',
  processing: 'processing',
  running: 'processing',
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
    this.getDocPipelineConfig = options.getDocPipelineConfig || null;
    this.provider = options.provider || DEFAULT_PROVIDER;
    this.serverName = options.serverName || DEFAULT_SERVER_NAME;
    this.advancer = new DocPipelineAdvancer(db);
    this.attachmentService = new AttachmentService(db);
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

  _resolveMcpTimeout(stageConfig, fallbackMs) {
    return stageConfig?.mcp_timeout_ms || fallbackMs;
  }

  _resolvePollTimeout(stageConfig, fallbackMs) {
    return stageConfig?.poll_request_timeout_ms || fallbackMs;
  }

  async _getSystemMcpTimeoutMs() {
    if (this._cachedMcpTimeoutMs && (Date.now() - this._mcpTimeoutCachedAt) < 60000) {
      return this._cachedMcpTimeoutMs;
    }
    try {
      const { getSystemSettingService } = await import('../server/services/system-setting.service.js');
      const service = getSystemSettingService(this.db);
      // MCP 请求属于快速操作，使用 fast_timeout
      // 保留对 mcp_request 的兼容映射（向后兼容）
      const settings = await service.getAllSettings();
      const fastTimeout = settings?.timeout?.fast_timeout;
      this._cachedMcpTimeoutMs = (fastTimeout || settings?.timeout?.mcp_request || 120) * 1000;
    } catch {
      this._cachedMcpTimeoutMs = 120000;
    }
    this._mcpTimeoutCachedAt = Date.now();
    return this._cachedMcpTimeoutMs;
  }

  _normalizeParamSources(stageConfig) {
    const mcp = stageConfig?.mcp;
    if (!mcp) return null;

    if (mcp.param_sources && typeof mcp.param_sources === 'object') {
      return mcp.param_sources;
    }

    if (mcp.params && typeof mcp.params === 'object') {
      const legacySources = {};
      for (const [key, value] of Object.entries(mcp.params)) {
        if (key === 'file_base64' || key === 'file_name') {
          legacySources[key] = { group: 'attachment', field: key };
        } else {
          legacySources[key] = { group: 'setting', value };
          if (key === 'lang') {
            legacySources[key].enabled = value !== null && value !== undefined;
          }
        }
      }
      return legacySources;
    }

    return null;
  }

  _buildMcpParams(stageConfig, inputs, attachmentContext = {}) {
    if (!stageConfig?.mcp) return inputs;

    const mapping = stageConfig.mcp.params_mapping || {};
    const paramSources = this._normalizeParamSources(stageConfig);

    const resolvedParams = {};

    if (paramSources) {
      for (const [internalKey, source] of Object.entries(paramSources)) {
        if (source.group === 'attachment') {
          const field = source.field || internalKey;
          if (attachmentContext[field] !== undefined) {
            resolvedParams[internalKey] = attachmentContext[field];
          }
        } else if (source.group === 'setting') {
          if (internalKey === 'lang') {
            if (source.enabled === true && source.value !== null && source.value !== undefined && source.value !== '') {
              resolvedParams[internalKey] = source.value;
            }
          } else {
            resolvedParams[internalKey] = source.value;
          }
        }
      }
    }

    for (const [inputKey, value] of Object.entries(inputs)) {
      if (value !== undefined) {
        resolvedParams[inputKey] = value;
      }
    }

    const result = {};
    for (const [internalKey, paramName] of Object.entries(mapping)) {
      if (resolvedParams[internalKey] !== undefined) {
        result[paramName] = resolvedParams[internalKey];
      }
    }

    return result;
  }

  _validateJudgeResult(judgeResult, stageKey, outputSchema) {
    if (!judgeResult || typeof judgeResult !== 'object') {
      return { valid: false, reason: 'result_not_object' };
    }

    const missing = new Set();

    if (stageKey === 'pending_ocr') {
      if (!judgeResult.task_id) missing.add('task_id');
      if (judgeResult.provider === undefined || judgeResult.provider === null) missing.add('provider');
      if (judgeResult.is_success === undefined || judgeResult.is_success === null) missing.add('is_success');
    } else if (stageKey === 'ocr_processing') {
      if (!judgeResult.status) missing.add('status');
      if (typeof judgeResult.progress !== 'number') missing.add('progress');
      if (judgeResult.is_completed === undefined || judgeResult.is_completed === null) missing.add('is_completed');
    } else if (stageKey === 'ocr_finalize') {
      if (judgeResult.is_success === undefined || judgeResult.is_success === null) missing.add('is_success');
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
        } else {
          logger.warn(`[DocumentOcrService] Judge result missing suggested schema keys for ${stageKey}: [${schemaMissing.join(', ')}]`);
        }
      }
    }

    if (missing.size > 0) {
      const missingKeys = Array.from(missing);
      logger.warn(`[DocumentOcrService] Judge validation failed for ${stageKey}: missing keys [${missingKeys.join(', ')}]`);
      return { valid: false, reason: `missing_keys: ${missingKeys.join(',')}` };
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

  serializeMetadata(value) {
    if (value === undefined) return null;
    if (value === null) return null;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return JSON.stringify({ _serialization_error: true });
    }
  }

  buildMergedMetadata(currentValue, patch = {}) {
    return this.serializeMetadata({
      ...this.toPlainObject(currentValue),
      ...patch,
    });
  }

  async tryGetImageDeliverables(serverName, toolName, taskId, timeoutMs) {
    try {
      const raw = await this.callMcp(serverName, toolName, { task_id: taskId }, timeoutMs);
      return {
        ok: true,
        raw,
        parsed: this.extractImageDeliverablesResult(raw),
        error: null,
      };
    } catch (error) {
      logger.warn(`[DocumentOcrService] get_image_deliverables degraded: ${error.message}`);
      return {
        ok: false,
        raw: null,
        parsed: { items: [], images: {} },
        error: error.message,
      };
    }
  }

  _isToolNotFoundError(error) {
    const message = String(error?.message || error || '');
    return /unknown tool|tool.*not.*found|no such tool|invalid tool|method.*not.*found/i.test(message);
  }

  _isToolNotFoundResult(result) {
    if (!result || typeof result !== 'object') return false;
    const isError = result.is_error === true || result.isError === true;
    if (!isError) return false;
    const text = typeof result.content === 'string' ? result.content : JSON.stringify(result).slice(0, 4000);
    return /unknown tool|tool.*not.*found|no such tool|invalid tool/i.test(text);
  }

  async _callSubmitToolWithFallback(serverName, toolName, mcpParams, timeoutMs) {
    const alternateSubmitTools = {
      create_task: 'create_task_from_file',
      create_task_from_file: 'create_task',
    };
    const alternate = alternateSubmitTools[toolName] || null;

    try {
      const result = await this.callMcp(serverName, toolName, mcpParams, timeoutMs);
      if (alternate && this._isToolNotFoundResult(result)) {
        logger.warn(`[DocumentOcrService] submit tool ${toolName} reported not found, retrying with ${alternate}`);
        return await this.callMcp(serverName, alternate, mcpParams, timeoutMs);
      }
      return result;
    } catch (error) {
      if (!alternate || !this._isToolNotFoundError(error)) throw error;
      logger.warn(`[DocumentOcrService] submit tool ${toolName} not available (${error.message}), retrying with ${alternate}`);
      return await this.callMcp(serverName, alternate, mcpParams, timeoutMs);
    }
  }

  _extractDeliverableArtifacts(deliverables) {
    if (deliverables && Array.isArray(deliverables.artifacts)) {
      return deliverables.artifacts;
    }
    return null;
  }

  _extractDownloadedContent(download) {
    if (!download || typeof download !== 'object') return '';
    const content = download.content;
    if (typeof content === 'string') {
      if (download.encoding === 'base64') {
        try {
          return Buffer.from(content, 'base64').toString('utf8');
        } catch {
          return '';
        }
      }
      return content;
    }
    if (typeof download.result === 'string') return download.result;
    if (download.result && typeof download.result === 'object') {
      if (typeof download.result.markdown === 'string') return download.result.markdown;
      if (typeof download.result.content === 'string') return download.result.content;
    }
    return '';
  }

  _buildDownloadedDataUrl(download, artifact) {
    if (!download || typeof download !== 'object') return null;
    const content = download.content;
    if (typeof content !== 'string' || !content) return null;
    const mediaType = download.media_type || artifact?.media_type || 'application/octet-stream';
    if (download.encoding === 'base64') {
      return `data:${mediaType};base64,${content}`;
    }
    if (/^data:/i.test(content)) return content;
    if (/^[a-z0-9+/]+={0,2}$/i.test(content.slice(0, 128).replace(/\s/g, '')) && content.length > 512) {
      return `data:${mediaType};base64,${content}`;
    }
    return null;
  }

  async _fetchV2ImageDeliverables(serverName, downloadTool, taskId, artifacts, markdownContent, timeoutMs, documentId = null) {
    const imageArtifacts = artifacts.filter(artifact => {
      if (!artifact || typeof artifact !== 'object') return false;
      if (artifact.artifact_type === 'image_file') return true;
      const mediaType = artifact.media_type || '';
      return typeof mediaType === 'string' && mediaType.startsWith('image/');
    });

    const items = [];
    const images = {};
    const errors = [];

    for (const artifact of imageArtifacts) {
      if (documentId) await this.assertDocumentNotDeleted(documentId);
      const filename = artifact.filename || null;
      const relativePath = artifact.name || filename || null;
      const item = {
        filename,
        relative_path: relativePath,
        path: artifact.download_key || null,
        media_type: artifact.media_type || null,
        referenced_in_markdown: Boolean(markdownContent && filename && markdownContent.includes(filename)),
        data_url: null,
      };

      if (!artifact.download_key) {
        errors.push(`image artifact missing download_key: ${filename || 'unknown'}`);
        items.push(item);
        continue;
      }

      try {
        const download = this.unwrapToolStructuredContent(
          await this.callMcp(serverName, downloadTool, {
            task_id: taskId,
            download_key: artifact.download_key,
            include_content: true,
          }, timeoutMs),
        );
        const dataUrl = this._buildDownloadedDataUrl(download, artifact);
        if (dataUrl) {
          item.data_url = dataUrl;
          if (relativePath) images[relativePath] = dataUrl;
          if (filename) {
            images[filename] = dataUrl;
            images[`images/${filename}`] = dataUrl;
            images[`./images/${filename}`] = dataUrl;
          }
        } else {
          errors.push(`image download has no usable content: ${filename || artifact.download_key}`);
        }
      } catch (error) {
        logger.warn(`[DocumentOcrService] v2 image download failed for ${filename || artifact.download_key}: ${error.message}`);
        errors.push(`${filename || artifact.download_key}: ${error.message}`);
      }

      items.push(item);
    }

    return {
      ok: errors.length === 0,
      raw: null,
      parsed: { items, images },
      error: errors.length > 0 ? errors.join('; ') : null,
    };
  }

  async _fetchFinalizeBundle(serverName, config, taskId, timeoutMs, documentId = null) {
    const listDeliverablesTool = config?.list_deliverables_tool || 'list_deliverables';
    const deliverables = this.extractStructuredToolResult(
      await this.callMcp(serverName, listDeliverablesTool, { task_id: taskId }, timeoutMs),
    );
    const artifacts = this._extractDeliverableArtifacts(deliverables);

    if (!artifacts) {
      const defaultDeliverableTool = config?.default_deliverable_tool || 'get_default_deliverable';
      const imageDeliverablesTool = config?.image_deliverables_tool || 'get_image_deliverables';
      const defaultDeliverable = this.extractStructuredToolResult(
        await this.callMcp(serverName, defaultDeliverableTool, { task_id: taskId }, timeoutMs),
      );
      const imageOutcome = await this.tryGetImageDeliverables(serverName, imageDeliverablesTool, taskId, timeoutMs);
      return { contract: 'legacy', defaultDeliverable, deliverables, imageOutcome };
    }

    const downloadTool = config?.download_deliverable_tool || 'download_deliverable';
    const defaultArtifact = artifacts.find(artifact => artifact?.is_default === true)
      || artifacts.find(artifact => artifact?.role === 'primary')
      || artifacts.find(artifact => artifact?.artifact_type === 'markdown')
      || null;
    if (!defaultArtifact?.download_key) {
      throw new Error(`No default markdown artifact found for task ${taskId}`);
    }

    const defaultDownload = this.unwrapToolStructuredContent(
      await this.callMcp(serverName, downloadTool, {
        task_id: taskId,
        download_key: defaultArtifact.download_key,
        include_content: true,
      }, timeoutMs),
    );
    const markdownContent = this._extractDownloadedContent(defaultDownload);
    const defaultDeliverable = {
      format: defaultDownload?.artifact_type || defaultArtifact.artifact_type || 'markdown',
      filename: defaultDownload?.filename || defaultArtifact.filename || null,
      download_key: defaultArtifact.download_key,
      result: { markdown: markdownContent, content: markdownContent },
    };

    if (documentId) await this.assertDocumentNotDeleted(documentId);
    const imageOutcome = await this._fetchV2ImageDeliverables(
      serverName,
      downloadTool,
      taskId,
      artifacts,
      markdownContent,
      timeoutMs,
      documentId,
    );

    const normalizedDeliverables = { ...deliverables, items: artifacts };
    return { contract: 'v2_artifacts', defaultDeliverable, deliverables: normalizedDeliverables, imageOutcome };
  }

  async probeGatewayTask(taskId, options = {}) {
    this.ensureCallMcp();
    const { userId = null } = options;
    const submitConfig = await this._loadStageConfig('pending_ocr');
    const serverName = submitConfig?.mcp?.server || 'mineru';
    const timeoutMs = 30000;

    const statusResult = this.unwrapToolStructuredContent(
      await this.callMcp(serverName, 'get_task_status', { task_id: taskId }, timeoutMs),
    );
    if (!statusResult || statusResult.error || !statusResult.status) {
      const err = new Error(`Gateway task not found: ${taskId}`);
      err.code = 'gateway_task_not_found';
      throw err;
    }

    let filename = null;
    try {
      const listResult = this.unwrapToolStructuredContent(
        await this.callMcp(serverName, 'list_tasks', { limit: 100 }, timeoutMs),
      );
      const tasks = Array.isArray(listResult?.result) ? listResult.result : [];
      const matched = tasks.find(task => task?.task_id === taskId);
      if (matched?.filename && matched.filename !== 'input.pdf') {
        filename = matched.filename;
      }
    } catch (error) {
      logger.warn(`[DocumentOcrService] probeGatewayTask list_tasks degraded: ${error.message}`);
    }

    let artifactName = null;
    let imageCount = 0;
    if (statusResult.status === 'completed') {
      try {
        const deliverables = this.unwrapToolStructuredContent(
          await this.callMcp(serverName, 'list_deliverables', { task_id: taskId }, timeoutMs),
        );
        const artifacts = Array.isArray(deliverables?.artifacts) ? deliverables.artifacts : [];
        const defaultArtifact = artifacts.find(artifact => artifact?.is_default === true)
          || artifacts.find(artifact => artifact?.artifact_type === 'markdown');
        artifactName = defaultArtifact?.filename || null;
        imageCount = artifacts.filter(artifact => artifact?.artifact_type === 'image_file').length;
      } catch (error) {
        logger.warn(`[DocumentOcrService] probeGatewayTask list_deliverables degraded: ${error.message}`);
      }
    }

    let existingDocument = null;
    if (userId) {
      const DocOcrResult = this.db.getModel('doc_ocr_result');
      const existingResults = await DocOcrResult.findAll({
        where: { task_id: taskId },
        order: [['created_at', 'DESC']],
        raw: true,
        limit: 20,
      });
      const Document = this.db.getModel('document');
      const access = new DocAccessService(this.db);
      for (const existing of existingResults) {
        if (!existing?.document_id) continue;
        const canRead = await access.canRead(existing.document_id, userId);
        if (!canRead) continue;
        existingDocument = await Document.findByPk(existing.document_id, {
          attributes: ['id', 'title', 'processing_status'],
          raw: true,
        });
        if (existingDocument) break;
      }
    }

    return {
      task_id: taskId,
      status: statusResult.status,
      progress: statusResult.progress ?? null,
      message: statusResult.message || null,
      filename,
      artifact_name: artifactName,
      image_count: imageCount,
      created_at: statusResult.created_at || null,
      completed_at: statusResult.completed_at || null,
      already_imported: Boolean(existingDocument),
      existing_document: existingDocument,
    };
  }

  async importGatewayTask({ taskId, collectionId, userId, title = null, revisionLabel = null, force = false }) {
    const probe = await this.probeGatewayTask(taskId, { userId });
    if (probe.status !== 'completed') {
      const err = new Error(`Gateway task is not completed (status: ${probe.status})`);
      err.code = 'gateway_task_not_completed';
      err.gatewayStatus = probe.status;
      throw err;
    }
    if (probe.already_imported && !force) {
      const err = new Error('Gateway task already imported');
      err.code = 'gateway_task_already_imported';
      err.existingDocument = probe.existing_document;
      throw err;
    }

    const documentId = Utils.newID();
    const revisionId = Utils.newID();
    const sourceRefId = Utils.newID();
    const docTitle = this.truncateText(
      (title || '').trim()
      || (probe.filename ? probe.filename.replace(/\.[^.]+$/, '') : '')
      || (probe.artifact_name ? probe.artifact_name.replace(/\.[^.]+$/, '') : '')
      || `Task ${taskId.slice(0, 8)}`,
      500,
    );
    const normalizedRevisionLabel = this.truncateText((revisionLabel || '').trim() || 'v1', 20);

    const Document = this.db.getModel('document');
    const DocumentRevision = this.db.getModel('document_revision');
    await this.db.sequelize.transaction(async transaction => {
      await Document.create({
        id: documentId,
        collection_id: collectionId,
        doc_type: 'knowledge',
        source_system: 'taskid-import',
        source_ref_id: sourceRefId,
        title: docTitle,
        processing_status: 'error',
        processing_error_code: 'gateway_import_in_progress',
        processing_error_message: null,
        current_revision_id: null,
        metadata: JSON.stringify({
          import_source: 'taskid',
          gateway_task_id: taskId,
          gateway_filename: probe.filename || null,
        }),
      }, { transaction });

      await DocumentRevision.create({
        id: revisionId,
        document_id: documentId,
        revision_no: 1,
        revision_label: normalizedRevisionLabel,
        revision_status: 'draft',
        is_current: 1,
        change_summary: 'Imported from gateway task',
        created_by: userId,
      }, { transaction });

      await Document.update({ current_revision_id: revisionId }, {
        where: { id: documentId },
        transaction,
      });
    });

    try {
      await this._importTaskArtifacts(documentId, taskId);
      await Document.update({
        processing_status: 'pending_clean',
        processing_error_code: null,
        processing_error_message: null,
        processing_updated_at: new Date(),
      }, { where: { id: documentId } });
    } catch (error) {
      await Document.update({
        processing_status: 'error',
        processing_error_code: 'gateway_import_failed',
        processing_error_message: error.message,
        processing_updated_at: new Date(),
      }, { where: { id: documentId } });
      logger.error(`[DocumentOcrService] importGatewayTask failed for ${taskId} -> ${documentId}: ${error.message}`);
      throw error;
    }

    logger.info(`[DocumentOcrService] importGatewayTask: ${taskId} -> document=${documentId} title="${docTitle}"`);
    return {
      document_id: documentId,
      revision_id: revisionId,
      title: docTitle,
      processing_status: 'pending_clean',
    };
  }

  async importGatewayTaskAsRevision({ documentId, taskId, userId, revisionLabel = null, changeSummary = null, force = false }) {
    const probe = await this.probeGatewayTask(taskId, { userId });
    if (probe.status !== 'completed') {
      const err = new Error(`Gateway task is not completed (status: ${probe.status})`);
      err.code = 'gateway_task_not_completed';
      err.gatewayStatus = probe.status;
      throw err;
    }

    const document = await this.db.getModel('document').findByPk(documentId, {
      attributes: ['id', 'title'],
      raw: true,
    });
    if (!document) {
      throw new Error('Document not found');
    }

    const intakeService = new DocumentIntakeService(this.db);
    const intakeResult = await intakeService.createIntakeRevision({
      documentId,
      attachments: [],
      userId,
      revisionLabel: revisionLabel || undefined,
      changeSummary: changeSummary || 'Imported from gateway task',
    });

    try {
      await this._importTaskArtifacts(documentId, taskId);
      await this.db.getModel('document').update({
        current_revision_id: intakeResult.revision_id,
        processing_status: 'pending_clean',
        processing_error_code: null,
        processing_error_message: null,
        processing_updated_at: new Date(),
        metadata: JSON.stringify({
          import_source: 'taskid',
          gateway_task_id: taskId,
          gateway_filename: probe.filename || null,
        }),
      }, { where: { id: documentId } });
    } catch (error) {
      await this.db.getModel('document').update({
        processing_status: 'error',
        processing_error_code: 'gateway_import_failed',
        processing_error_message: error.message,
        processing_updated_at: new Date(),
      }, { where: { id: documentId } });
      throw error;
    }

    return {
      document_id: documentId,
      revision_id: intakeResult.revision_id,
      title: document.title,
      processing_status: 'pending_clean',
    };
  }

  async _importTaskArtifacts(documentId, taskId) {
    const ctx = await this.loadDocumentContext(documentId);
    const ocrResult = await this.ensureOcrResult(ctx);
    await this._clearImportedResultArtifacts(ctx, ocrResult);
    await ocrResult.update({
      task_id: taskId,
      status: 'processing',
      progress: 90,
      error_code: null,
      error_message: null,
      metadata: this.buildMergedMetadata(ocrResult.metadata, {
        import_source: 'taskid',
        gateway_task_id: taskId,
      }),
    });

    const finalizeConfig = await this._loadStageConfig('ocr_finalize');
    const submitConfig = await this._loadStageConfig('pending_ocr');
    const serverName = submitConfig?.mcp?.server || finalizeConfig?.mcp?.server || 'mineru';
    const timeoutMs = this._resolveMcpTimeout(finalizeConfig, 300000);
    const bundle = await this._fetchFinalizeBundle(serverName, finalizeConfig, taskId, timeoutMs, documentId);
    await this._persistImportedResult(ctx, ocrResult, bundle);
  }

  async retryImportGatewayTask(documentId) {
    const ctx = await this.loadDocumentContext(documentId);
    const metadata = this.toPlainObject(ctx.document.metadata);
    const taskId = metadata.gateway_task_id;
    if (!taskId) {
      throw new Error('Document is not a gateway task import');
    }

    const probe = await this.probeGatewayTask(taskId, { userId: ctx.revision.created_by || null });
    if (probe.status !== 'completed') {
      const err = new Error(`Gateway task is not completed (status: ${probe.status})`);
      err.code = 'gateway_task_not_completed';
      err.gatewayStatus = probe.status;
      throw err;
    }

    const Document = this.db.getModel('document');
    await Document.update({
      processing_status: 'error',
      processing_error_code: 'gateway_import_in_progress',
      processing_error_message: null,
      processing_updated_at: new Date(),
    }, { where: { id: documentId } });

    try {
      await this._importTaskArtifacts(documentId, taskId);
      await Document.update({
        processing_status: 'pending_clean',
        processing_error_code: null,
        processing_error_message: null,
        processing_updated_at: new Date(),
      }, { where: { id: documentId } });
    } catch (error) {
      await Document.update({
        processing_status: 'error',
        processing_error_code: 'gateway_import_failed',
        processing_error_message: error.message,
        processing_updated_at: new Date(),
      }, { where: { id: documentId } });
      throw error;
    }

    logger.info(`[DocumentOcrService] retryImportGatewayTask: document=${documentId} task=${taskId}`);
    return { document_id: documentId, processing_status: 'pending_clean' };
  }

  async _clearImportedResultArtifacts(ctx, ocrResult) {
    if (!ocrResult) return;
    const attachmentIds = collectTruthy([
      ocrResult.main_markdown_attachment_id,
      ocrResult.raw_result_attachment_id,
      ocrResult.deliverables_manifest_attachment_id,
      ocrResult.image_manifest_attachment_id,
    ]);
    const DocOcrImage = this.db.getModel('doc_ocr_image');
    const existingImages = await DocOcrImage.findAll({
      where: { ocr_result_id: ocrResult.id },
      attributes: ['attachment_id'],
      raw: true,
    });
    for (const image of existingImages) {
      if (image.attachment_id) attachmentIds.push(image.attachment_id);
    }

    await DocOcrImage.destroy({ where: { ocr_result_id: ocrResult.id } });
    const Attachment = this.db.getModel('attachment');
    await Attachment.destroy({
      where: {
        source_tag: OCR_PRODUCT_SOURCE_TAG,
        source_id: ctx.revision.id,
      },
    });

    if (attachmentIds.length > 0 || existingImages.length > 0) {
      logger.info(`[DocumentOcrService] cleared stale imported OCR artifacts: ocr_result=${ocrResult.id} attachments=${attachmentIds.length} images=${existingImages.length}`);
    }
  }

  async _persistImportedResult(ctx, ocrResult, bundle) {
    const { defaultDeliverable, deliverables, imageOutcome } = bundle;
    const revisionId = ctx.revision.id;
    const mainMarkdown = this.extractDefaultMarkdown(defaultDeliverable);
    if (!mainMarkdown || !mainMarkdown.trim()) {
      throw new Error('Gateway task has no markdown content to import');
    }

    const imageDeliverables = imageOutcome?.parsed || { items: [], images: {} };
    const imageItems = Array.isArray(imageDeliverables.items) ? imageDeliverables.items : [];
    const imageRecords = [];
    for (let i = 0; i < imageItems.length; i++) {
      const item = imageItems[i];
      const imageDataUrl = this.resolveImageDataUrl(item, imageDeliverables);
      if (!imageDataUrl) continue;
      const attachment = await this.attachmentService.createFromDataUrl({
        sourceTag: OCR_PRODUCT_SOURCE_TAG,
        sourceId: revisionId,
        createdBy: ctx.revision.created_by || null,
        fileName: item.filename || 'image.png',
        dataUrl: imageDataUrl,
        altText: this.truncateText(item.alt_text || '', MAX_ATTACHMENT_ALT_TEXT_LENGTH),
        description: this.truncateText(item.description || null, MAX_ATTACHMENT_DESCRIPTION_LENGTH),
      });
      imageRecords.push({ item, attachment, sortOrder: i });
    }

    const imageAccessUrlMap = await this.buildImageAccessUrlMap(imageRecords, ctx.revision.created_by || null);
    const rewrittenMarkdown = this.rewriteMarkdownImageLinks(mainMarkdown, imageAccessUrlMap);

    const rawResultAttachment = await this.attachmentService.createTextAttachment({
      sourceTag: OCR_PRODUCT_SOURCE_TAG,
      sourceId: revisionId,
      createdBy: ctx.revision.created_by || null,
      fileName: 'ocr-raw-result.json',
      content: this.safeJsonForAttachment(defaultDeliverable),
      mimeType: 'application/json',
    });
    const deliverablesManifestAttachment = await this.attachmentService.createTextAttachment({
      sourceTag: OCR_PRODUCT_SOURCE_TAG,
      sourceId: revisionId,
      createdBy: ctx.revision.created_by || null,
      fileName: 'ocr-deliverables.json',
      content: this.safeJsonForAttachment(deliverables),
      mimeType: 'application/json',
    });
    const imageManifestAttachment = await this.attachmentService.createTextAttachment({
      sourceTag: OCR_PRODUCT_SOURCE_TAG,
      sourceId: revisionId,
      createdBy: ctx.revision.created_by || null,
      fileName: 'ocr-images.json',
      content: this.safeJsonForAttachment(this.buildImageDeliverablesSummary(imageDeliverables)),
      mimeType: 'application/json',
    });
    const mainMarkdownAttachment = await this.attachmentService.createTextAttachment({
      sourceTag: OCR_PRODUCT_SOURCE_TAG,
      sourceId: revisionId,
      createdBy: ctx.revision.created_by || null,
      fileName: 'ocr-main.md',
      content: rewrittenMarkdown,
      mimeType: 'text/markdown',
    });

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
      metadata: this.buildMergedMetadata(ocrResult.metadata, {
        import_source: 'taskid',
        default_deliverable: {
          format: defaultDeliverable?.format || null,
          filename: defaultDeliverable?.filename || null,
        },
        deliverables_summary: this.buildResultSummary(deliverables),
        image_deliverables_summary: this.buildImageDeliverablesSummary(imageDeliverables),
        image_deliverables_degraded: imageOutcome?.ok === false ? (imageOutcome?.error || 'degraded') : null,
      }),
    });

    const DocOcrImage = this.db.getModel('doc_ocr_image');
    for (const { item, attachment, sortOrder } of imageRecords) {
      await DocOcrImage.create({
        id: Utils.newID(32),
        ocr_result_id: ocrResult.id,
        attachment_id: attachment.id,
        filename: item.filename || null,
        media_type: item.media_type || attachment.mime_type,
        sort_order: sortOrder,
        referenced_in_markdown: item.referenced_in_markdown ? 1 : 0,
        markdown_path: item.relative_path || null,
        line_number: null,
        start_offset: null,
        end_offset: null,
        alt_text: this.truncateText(item.alt_text || null, MAX_ATTACHMENT_ALT_TEXT_LENGTH),
        description: this.truncateText(item.description || null, MAX_ATTACHMENT_DESCRIPTION_LENGTH),
      });
    }
  }

  async _runJudge(stageConfig, mcpResult, stageContext = {}) {
    const judge = stageConfig?.judge;
    if (!judge || !judge.prompt_template) return mcpResult;

    try {
      const mcpText = this.safeJsonForAttachment(mcpResult);
      const prompt = this._buildJudgePrompt(judge, mcpText);
      const modelConfig = await this._resolveJudgeModelConfig(judge.model_id || null);
      const response = await invokeWithRetry(modelConfig, [{ role: 'user', content: prompt }], {
        temperature: judge.temperature ?? 0.1,
        response_format: judge.output_schema && Object.keys(judge.output_schema).length > 0
          ? { type: 'json_object' }
          : undefined,
        thinking_policy: 'disable',
        logger_prefix: '[DocumentOcrService]',
      });
      const judgeResult = this.parseJudgeResponse(response);

      if (judgeResult && typeof judgeResult === 'object') {
        const stageKey = stageContext?.stage || 'unknown';
        const validation = this._validateJudgeResult(judgeResult, stageKey, judge.output_schema);
        if (!validation.valid) {
          logger.warn(`[DocumentOcrService] Judge validation failed for ${stageKey}: ${validation.reason}`);
          return { _normalized: { _judge_error: validation.reason, ...judgeResult } };
        }
        if (validation.failed) {
          logger.warn(`[DocumentOcrService] Judge reported failure for ${stageKey}`);
          return { _normalized: { ...judgeResult } };
        }
        return { _normalized: judgeResult };
      }
      return mcpResult;
    } catch (err) {
      logger.warn(`[DocumentOcrService] Judge normalization failed: ${err.message}`);
      return mcpResult;
    }
  }

  async _resolveJudgeModelConfig(modelId) {
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

  parseJudgeResponse(response) {
    if (!response) return null;
    if (typeof response === 'object' && !Array.isArray(response)) {
      if (typeof response.content === 'string') {
        try {
          return JSON.parse(response.content);
        } catch {
          return null;
        }
      }
      return response;
    }
    return null;
  }

  async submit(documentId, options = {}) {
    const ctx = await this.loadDocumentContext(documentId);
    const existingOcrResult = await this.getLatestOcrResult(ctx.revision.id);
    if (existingOcrResult?.task_id && ['pending', 'processing', 'completed'].includes(existingOcrResult.status)) {
      logger.info(`[DocumentOcrService] Skip submit for ${documentId}: existing OCR result ${existingOcrResult.id} status=${existingOcrResult.status}`);
      if (existingOcrResult.status === 'completed') {
        return existingOcrResult;
      }
      // 仅当文档仍在 pending_ocr 时才推进阶段，避免在 ocr_processing 等后续阶段重复推进
      if (ctx.document?.processing_status === 'pending_ocr') {
        await this.advancer.finishStage(documentId, 'pending_ocr', {
          nextStage: 'ocr_processing',
          message: 'OCR task already exists, advancing',
          metadata: {
            existing_ocr_result_id: existingOcrResult.id,
            existing_task_id: existingOcrResult.task_id,
          },
        });
      } else {
        logger.info(`[DocumentOcrService] Skip stage advance for ${documentId}: already at ${ctx.document?.processing_status}`);
      }
      return existingOcrResult;
    }

    const ocrResult = await this.ensureOcrResult(ctx);

    const submitState = await this.getSubmitInProgressState(ocrResult);
    if (submitState.active) {
      logger.info(`[DocumentOcrService] Submit already in progress for ${documentId}: ocr_result=${ocrResult.id}`);
      return ocrResult;
    }

    if (submitState.stale) {
      logger.warn(`[DocumentOcrService] Clearing stale submit_in_progress for ${documentId}: ocr_result=${ocrResult.id}`);
      await this.clearSubmitInProgress(ocrResult, {
        submit_recovered_at: new Date().toISOString(),
        submit_recovered_reason: 'stale_submit_in_progress',
      });
      await ocrResult.reload();
    }

    await ocrResult.update({
      provider: this.provider,
      status: 'pending',
      progress: 0,
      started_at: new Date(),
      completed_at: null,
      error_code: null,
      error_message: null,
      metadata: this.buildMergedMetadata(ocrResult.metadata, {
        submit_in_progress: true,
        submit_requested_at: new Date().toISOString(),
      }),
    });

    this.scheduleSubmitTask(documentId, ocrResult.id, options);

    return ocrResult;
  }

  scheduleSubmitTask(documentId, ocrResultId, options = {}) {
    setImmediate(() => {
      this.executeSubmitTask(documentId, ocrResultId, options).catch(error => {
        logger.error(`[DocumentOcrService] background submit failed for ${documentId}: ${error.message}`);
      });
    });
  }

  async executeSubmitTask(documentId, ocrResultId, options = {}) {
    this.ensureCallMcp();
    const ocrResult = await this.getOcrResultById(ocrResultId);
    if (!ocrResult) {
      logger.warn(`[DocumentOcrService] Skip background submit for ${documentId}: OCR result ${ocrResultId} not found`);
      return null;
    }

    let ctx = null;
    let taskCreated = false;
    let runId = null;

    try {
      await ocrResult.reload();
      const queuedSubmitState = await this.getSubmitInProgressState(ocrResult);
      if (!queuedSubmitState.active || this.isCancelledOcrResult(ocrResult)) {
        logger.info(`[DocumentOcrService] Skip background submit for ${documentId}: submit no longer active`);
        return ocrResult;
      }

      const config = await this._loadStageConfig('pending_ocr');
      const serverName = this._resolveMcpServer(config);
      const toolName = this._resolveMcpTool(config, 'create_task_from_file');
      const timeoutMs = this._resolveMcpTimeout(config, await this._getSystemMcpTimeoutMs());
      const provider = config.provider_name || this.provider;

      ctx = await this.loadDocumentContext(documentId);
      await ocrResult.reload();
      const activeSubmitState = await this.getSubmitInProgressState(ocrResult);
      if (ocrResult.task_id || !activeSubmitState.active || this.isCancelledOcrResult(ocrResult, ctx.document)) {
        logger.info(`[DocumentOcrService] Skip background submit for ${documentId}: OCR result ${ocrResult.id} already has task_id=${ocrResult.task_id}`);
        return ocrResult;
      }

      // 显式记录 OCR submit 阶段开始
      const enterResult = await this.advancer.enterStage(documentId, 'pending_ocr', {
        revision_id: ctx.revision.id,
        message: 'OCR submit started',
        metadata: {
          ocr_result_id: ocrResultId,
          provider,
        },
      });
      runId = enterResult.runId;

      const attachment = await this.resolveSourceAttachment(ctx.document, ctx.revision, options.attachmentId, options.userId || null);
      if (!attachment) {
        throw new Error(`No source attachment found for document ${documentId}`);
      }

      const fileBase64 = await this.readAttachmentBase64(attachment);
      const attachmentContext = {
        file_base64: fileBase64,
        file_name: attachment.file_name || `document-${documentId}.bin`,
      };

      const runtimeOverrides = {};
      if (options.lang !== undefined) runtimeOverrides.lang = options.lang;
      if (options.formulaEnable !== undefined) runtimeOverrides.formula_enable = options.formulaEnable;
      if (options.tableEnable !== undefined) runtimeOverrides.table_enable = options.tableEnable;
      if (options.imageAnalysis !== undefined) runtimeOverrides.image_analysis = options.imageAnalysis;

      const mcpParams = this._buildMcpParams(config, runtimeOverrides, attachmentContext);

      const submitToolResult = await this._callSubmitToolWithFallback(
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
      const normalizedStatus = isSuccess ? this.normalizeOcrResultStatus(result?.status || 'pending') : 'failed';
      const failMessage = !isSuccess ? (normalized.message || 'OCR submit failed') : null;

      await ocrResult.reload();
      if (this.isCancelledOcrResult(ocrResult, ctx.document)) {
        logger.info(`[DocumentOcrService] Ignore submit result for cancelled document ${documentId}: ocr_result=${ocrResult.id}`);
        await this.clearSubmitInProgress(ocrResult, {
          submit_post_cancel_result: this.buildResultSummary(result),
        });
        return ocrResult;
      }

      logger.info(`[DocumentOcrService] submit result: document=${documentId} ocr_result=${ocrResult.id} task_id=${taskId || 'null'} status=${normalizedStatus} provider=${resolvedProvider}`);

      const persisted = await this.updateOcrResultIfNotCancelled(ocrResult, {
        provider: resolvedProvider,
        task_id: taskId,
        status: normalizedStatus,
        progress: normalizedStatus === 'failed' ? -1 : 0,
        started_at: new Date(),
        error_code: normalizedStatus === 'failed' ? 'submit_failed' : null,
        error_message: normalizedStatus === 'failed' ? failMessage : null,
        metadata: this.buildMergedMetadata(ocrResult.metadata, {
          submit_in_progress: false,
          submit_tool_result: this.buildToolResultSummary(submitToolResult),
          submit_result: this.buildResultSummary(result),
          judge_result: judged?._normalized || null,
        }),
      });
      if (!persisted) {
        logger.info(`[DocumentOcrService] Skip submit persistence for cancelled document ${documentId}: ocr_result=${ocrResult.id}`);
        return ocrResult;
      }
      taskCreated = Boolean(taskId);

      if (normalizedStatus === 'failed') {
        await this.advancer.failStage(documentId, 'pending_ocr', {
          runId,
          code: 'ocr_submit_failed',
          message: failMessage || 'OCR submit failed',
          metadata: {
            task_id: taskId,
            provider: resolvedProvider,
            judge_result: judged?._normalized || null,
          },
        });
        return ocrResult;
      }

      if (!taskId) {
        const missingTaskMessage = normalized.message || result?.message || result?.error || 'OCR submit missing task_id';
        await ocrResult.update({
          status: 'failed',
          progress: -1,
          error_code: 'submit_missing_task_id',
          error_message: missingTaskMessage,
          completed_at: new Date(),
          metadata: this.buildMergedMetadata(ocrResult.metadata, {
            submit_in_progress: false,
            submit_missing_task_id: true,
          }),
        });
        await this.advancer.failStage(documentId, 'pending_ocr', {
          runId,
          code: 'ocr_submit_failed',
          message: missingTaskMessage,
        });
        return ocrResult;
      }

      await this.advancer.finishStage(documentId, 'pending_ocr', {
        runId,
        nextStage: 'ocr_processing',
        message: `OCR task created: ${taskId}`,
        metadata: {
          task_id: taskId,
          provider: resolvedProvider,
        },
      });

      return ocrResult;
    } catch (error) {
      const normalizedError = this.normalizeError(error);

      if (taskCreated || ocrResult.task_id) {
        await ocrResult.update({
          metadata: this.buildMergedMetadata(ocrResult.metadata, {
            submit_in_progress: false,
            submit_post_task_error: normalizedError.summary || normalizedError.message,
          }),
        });
        throw error;
      }

      await ocrResult.update({
        status: 'failed',
        progress: -1,
        error_code: ocrResult.error_code || 'ocr_submit_failed',
        error_message: normalizedError.message,
        completed_at: new Date(),
        metadata: this.buildMergedMetadata(ocrResult.metadata, {
          submit_in_progress: false,
          last_error: normalizedError.summary || normalizedError.message,
        }),
      });

      if (ctx) {
        if (normalizedError.isTimeout) {
          await this.advancer.timeoutStage(documentId, 'pending_ocr', {
            runId,
            message: `OCR submit timed out: ${normalizedError.message}`,
            metadata: {
              error_summary: normalizedError.summary || null,
              timeout_at: new Date().toISOString(),
            },
          });
        } else {
          await this.advancer.failStage(documentId, 'pending_ocr', {
            runId,
            code: 'ocr_submit_failed',
            message: normalizedError.message,
            metadata: {
              error_summary: normalizedError.summary || null,
            },
          });
        }
      }

      throw error;
    }
  }

  async syncTaskStatus(documentId, options = {}) {
    this.ensureCallMcp();
    const config = await this._loadStageConfig('ocr_processing');
    const serverName = this._resolveMcpServer(config);
    const toolName = this._resolveMcpTool(config, 'get_task_status');
    const timeoutMs = this._resolvePollTimeout(config, await this._getSystemMcpTimeoutMs());

    const ctx = await this.loadDocumentContext(documentId);
    this.ensureDocumentWritableForOcr(ctx.document);
    const ocrResult = await this.ensureOcrResult(ctx);
    if (!ocrResult.task_id) {
      const submitState = await this.getSubmitInProgressState(ocrResult);
      if (submitState.active) {
        logger.info(`[DocumentOcrService] sync waiting for background submit: document=${documentId} ocr_result=${ocrResult.id}`);
        return { ocrResult, statusResult: null, completed: false };
      }

      if (submitState.stale) {
        logger.warn(`[DocumentOcrService] sync clearing stale submit flag: document=${documentId} ocr_result=${ocrResult.id}`);
        await this.clearSubmitInProgress(ocrResult, {
          submit_recovered_at: new Date().toISOString(),
          submit_recovered_reason: 'stale_submit_in_progress_sync',
        });
        await ocrResult.reload();
      }

      logger.info(`[DocumentOcrService] OCR task missing for ${documentId}, retrying submit`);
      const retried = await this.submit(documentId, options);
      return { ocrResult: retried, statusResult: null, completed: false };
    }

    logger.info(`[DocumentOcrService] sync start: document=${documentId} ocr_result=${ocrResult.id} task_id=${ocrResult.task_id} local_status=${ocrResult.status}`);

    // 使用统一语义判断完成态（优先 cleaned_markdown，兼容 main_markdown）
    const previewAttachmentId = getPreviewAttachmentId(ocrResult);
    if (ocrResult.status === 'completed' && previewAttachmentId) {
      await this.advancer.finishStage(documentId, 'ocr_processing', {
        nextStage: 'pending_clean',
        message: 'OCR already completed (preview available)',
        metadata: {
          ocr_result_id: ocrResult.id,
          task_id: ocrResult.task_id,
          already_completed: true,
        },
      });
      return { ocrResult, statusResult: null, completed: true };
    }

    // 显式记录 OCR 同步阶段开始
    const { runId } = await this.advancer.enterStage(documentId, 'ocr_processing', {
      revision_id: ctx.revision.id,
      message: 'OCR sync started',
      metadata: {
        ocr_result_id: ocrResult.id,
        task_id: ocrResult.task_id,
      },
    });

    let statusToolResult;
    try {
      statusToolResult = await this.callMcp(
        serverName,
        toolName,
        { task_id: ocrResult.task_id },
        timeoutMs,
      );
    } catch (mcpError) {
      const normalizedMcpError = this.normalizeError(mcpError);
      const isTimeout = normalizedMcpError.isTimeout;

      logger.error(`[DocumentOcrService] sync MCP call failed: document=${documentId} task_id=${ocrResult.task_id} isTimeout=${isTimeout} error=${normalizedMcpError.message}`);

      await ocrResult.update({
        status: 'failed',
        progress: -1,
        error_code: isTimeout ? 'sync_timeout' : 'sync_failed',
        error_message: normalizedMcpError.message,
        completed_at: new Date(),
        metadata: this.buildMergedMetadata(ocrResult.metadata, {
          last_error: normalizedMcpError.summary || normalizedMcpError.message,
          mcp_error_at: new Date().toISOString(),
        }),
      });

      if (isTimeout) {
        await this.advancer.timeoutStage(documentId, 'ocr_processing', {
          runId,
          message: `OCR sync MCP timed out: ${normalizedMcpError.message}`,
          metadata: {
            task_id: ocrResult.task_id,
            provider: serverName,
            timeout_at: new Date().toISOString(),
            error_summary: normalizedMcpError.summary || null,
          },
        });
      } else {
        await this.advancer.failStage(documentId, 'ocr_processing', {
          runId,
          code: 'ocr_sync_mcp_failed',
          message: normalizedMcpError.message,
          metadata: {
            task_id: ocrResult.task_id,
            error_summary: normalizedMcpError.summary || null,
          },
        });
      }

      return { ocrResult, statusResult: null, completed: false };
    }

    await this.assertDocumentNotDeleted(documentId);
    const statusResult = this.extractStructuredToolResult(statusToolResult);
    const judged = await this._runJudge(config, statusResult, { stage: 'ocr_processing' });
    const normalized = judged?._normalized || {};

    const normalizedStatus = normalized.status
      ? this.normalizeOcrResultStatus(normalized.status)
      : this.normalizeOcrResultStatus(statusResult?.status);
    const progress = typeof normalized.progress === 'number' ? normalized.progress : (typeof statusResult?.progress === 'number' ? statusResult.progress : ocrResult.progress);
    const isCompleted = normalizedStatus === 'completed' || normalized.is_completed === true;
    const finalStatus = isCompleted ? 'completed' : normalizedStatus;

    logger.info(`[DocumentOcrService] sync result: document=${documentId} ocr_result=${ocrResult.id} task_id=${ocrResult.task_id} remote_status=${statusResult?.status || 'unknown'} normalized_status=${finalStatus} progress=${progress}`);

    await ocrResult.update({
      status: finalStatus,
      progress: isCompleted ? 100 : progress,
      error_code: finalStatus === 'failed' ? 'task_failed' : null,
      error_message: finalStatus === 'failed' ? (normalized.error_message || statusResult?.error || statusResult?.message || 'OCR task failed') : null,
      completed_at: finalStatus === 'completed' || finalStatus === 'failed' ? new Date() : null,
      metadata: this.buildMergedMetadata(ocrResult.metadata, {
        last_status_tool_result: this.buildToolResultSummary(statusToolResult),
        last_status_result: this.buildResultSummary(statusResult),
        judge_result: judged?._normalized || null,
      }),
    });

    if (finalStatus === 'failed') {
      await this.advancer.failStage(documentId, 'ocr_processing', {
        runId,
        code: 'ocr_task_failed',
        message: normalized.error_message || statusResult?.error || statusResult?.message || 'OCR task failed',
        metadata: {
          task_id: ocrResult.task_id,
          remote_status: statusResult?.status || null,
        },
      });
      return { ocrResult, statusResult, completed: false };
    }

    if (!isCompleted) {
      return { ocrResult, statusResult, completed: false };
    }

    await this.assertDocumentNotDeleted(documentId);
    const finalized = await this.finalizeCompletedTask(ctx, ocrResult, options);
    await this.advancer.finishStage(documentId, 'ocr_processing', {
      runId,
      nextStage: 'pending_clean',
      message: 'OCR completed and deliverables finalized',
      metadata: {
        ocr_result_id: ocrResult.id,
        task_id: ocrResult.task_id,
      },
    });
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
        status: 'failed',
        progress: -1,
        error_code: ocrResult.error_code || 'document_deleted',
        error_message: ocrResult.error_message || 'Document deleted by user',
        completed_at: ocrResult.completed_at || new Date(),
        metadata: this.buildMergedMetadata(ocrResult.metadata, {
          submit_in_progress: false,
          cancel_reason: 'task_not_running',
          cancelled_at: new Date().toISOString(),
        }),
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
        metadata: this.buildMergedMetadata(ocrResult.metadata, {
          submit_in_progress: false,
          cancel_tool_result: this.buildToolResultSummary(cancelToolResult),
          cancel_result: this.buildResultSummary(cancelResult),
          cancelled_at: new Date().toISOString(),
        }),
      });

      return result;
    } catch (error) {
      await ocrResult.update({
        status: 'failed',
        progress: -1,
        error_code: 'document_deleted',
        error_message: `Document deleted by user (cancel failed: ${error.message})`,
        completed_at: new Date(),
        metadata: this.buildMergedMetadata(ocrResult.metadata, {
          submit_in_progress: false,
          cancelled_at: new Date().toISOString(),
          cancel_error: this.truncateText(error.message || String(error), 500),
        }),
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
    const timeoutMs = this._resolveMcpTimeout(config, await this._getSystemMcpTimeoutMs());
    const revisionId = ctx.revision.id;

    const taskId = ocrResult.task_id;
    logger.info(`[DocumentOcrService] finalize start: document=${ctx.document.id} revision=${revisionId} task=${taskId}`);
    const bundle = await this._fetchFinalizeBundle(serverName, config, taskId, timeoutMs, ctx.document.id);
    const defaultDeliverable = bundle.defaultDeliverable;
    logger.info(`[DocumentOcrService] finalize default deliverable loaded: format=${defaultDeliverable?.format || 'unknown'} filename=${defaultDeliverable?.filename || 'unknown'} contract=${bundle.contract}`);
    await this.assertDocumentNotDeleted(ctx.document.id);
    const deliverables = bundle.deliverables;
    logger.info(`[DocumentOcrService] finalize deliverables loaded: items=${Array.isArray(deliverables?.items) ? deliverables.items.length : 0} contract=${bundle.contract}`);
    await this.assertDocumentNotDeleted(ctx.document.id);
    const imageDeliverablesOutcome = bundle.imageOutcome;
    const imageDeliverables = imageDeliverablesOutcome.parsed;
    await this.assertDocumentNotDeleted(ctx.document.id);
    const imageDeliverableSummary = this.summarizeImageDeliverables(imageDeliverables);
    logger.info(`[DocumentOcrService] finalize image deliverables loaded: items=${imageDeliverableSummary?.item_count || 0} image_map_present=${imageDeliverableSummary?.image_map_present === true} degraded=${imageDeliverablesOutcome.ok ? 'false' : 'true'}`);

    const judged = await this._runJudge(config, {
      default_deliverable: defaultDeliverable,
      deliverables,
      image_deliverables: imageDeliverableSummary,
    }, { stage: 'ocr_finalize' });
    logger.info('[DocumentOcrService] finalize judge completed');
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
        metadata: this.buildMergedMetadata(ocrResult.metadata, {
          judge_result: judged?._normalized || null,
        }),
      });
      await this.advancer.failStage(ctx.document.id, 'ocr_processing', {
        code: 'judge_normalization_failed',
        message: normalized.error_message || 'Judge normalization failed',
      });
      return ocrResult;
    }

    if (judgeExplicitFailed || judgeMissingMain) {
      logger.warn(`[DocumentOcrService] Judge reported issue for finalize, using fallback extraction: ${normalized.error_message || 'no main_markdown'}`);
    }

    const imageUrlMap = {};
    const imageRecords = [];
    logger.info(`[DocumentOcrService] finalize image persistence start: image_items=${imageItems.length}`);

    for (let i = 0; i < imageItems.length; i++) {
      await this.assertDocumentNotDeleted(ctx.document.id);
      const item = imageItems[i];
      const imageDataUrl = this.resolveImageDataUrl(item, imageDeliverables);
      if (!imageDataUrl) {
        logger.warn(`[DocumentOcrService] finalize image skipped: no data_url resolved filename=${item?.filename || 'unknown'} relative_path=${item?.relative_path || 'unknown'}`);
        continue;
      }
      const attachment = await this.attachmentService.createFromDataUrl({
        sourceTag: OCR_PRODUCT_SOURCE_TAG,
        sourceId: revisionId,
        createdBy: ctx.revision.created_by || null,
        fileName: item.filename || 'image.png',
        dataUrl: imageDataUrl,
        altText: this.truncateText(item.alt_text || '', MAX_ATTACHMENT_ALT_TEXT_LENGTH),
        description: this.truncateText(item.description || null, MAX_ATTACHMENT_DESCRIPTION_LENGTH),
      });
      imageRecords.push({ item, attachment, sortOrder: i });
    }
    logger.info(`[DocumentOcrService] finalize image persistence done: persisted=${imageRecords.length}`);

    const imageAccessUrlMap = await this.buildImageAccessUrlMap(imageRecords, ctx.revision.created_by || null);
    for (const [key, value] of Object.entries(imageAccessUrlMap)) {
      imageUrlMap[key] = value;
    }

    const rewrittenMarkdown = this.rewriteMarkdownImageLinks(mainMarkdown, imageUrlMap);
    logger.info(`[DocumentOcrService] finalize markdown rewritten: lines=${this.countLines(rewrittenMarkdown)}`);

    await this.assertDocumentNotDeleted(ctx.document.id);
    const rawResultAttachment = await this.attachmentService.createTextAttachment({
      sourceTag: OCR_PRODUCT_SOURCE_TAG,
      sourceId: ctx.revision.id,
      createdBy: ctx.revision.created_by || null,
      fileName: 'ocr-raw-result.json',
      content: this.safeJsonForAttachment(defaultDeliverable),
      mimeType: 'application/json',
    });
    const deliverablesManifestAttachment = await this.attachmentService.createTextAttachment({
      sourceTag: OCR_PRODUCT_SOURCE_TAG,
      sourceId: ctx.revision.id,
      createdBy: ctx.revision.created_by || null,
      fileName: 'ocr-deliverables.json',
      content: this.safeJsonForAttachment(deliverables),
      mimeType: 'application/json',
    });
    const imageManifestAttachment = await this.attachmentService.createTextAttachment({
      sourceTag: OCR_PRODUCT_SOURCE_TAG,
      sourceId: ctx.revision.id,
      createdBy: ctx.revision.created_by || null,
      fileName: 'ocr-images.json',
      content: this.safeJsonForAttachment(imageDeliverableSummary),
      mimeType: 'application/json',
    });
    const mainMarkdownAttachment = await this.attachmentService.createTextAttachment({
      sourceTag: OCR_PRODUCT_SOURCE_TAG,
      sourceId: ctx.revision.id,
      createdBy: ctx.revision.created_by || null,
      fileName: 'ocr-main.md',
      content: rewrittenMarkdown,
      mimeType: 'text/markdown',
    });

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
      metadata: this.buildMergedMetadata(ocrResult.metadata, {
        default_deliverable: {
          format: defaultDeliverable?.format || null,
          filename: defaultDeliverable?.filename || null,
        },
        deliverables_summary: this.buildResultSummary(deliverables),
        image_deliverables_summary: this.buildImageDeliverablesSummary(imageDeliverables),
        image_deliverables_degraded: imageDeliverablesOutcome.ok ? null : imageDeliverablesOutcome.error,
        judge_result: judged?._normalized || null,
        normalized_deliverables: hasNormalizedDeliverables ? normalizedDeliverables : null,
        normalized_raw_payload: normalized.raw_payload || null,
      }),
    });
    logger.info('[DocumentOcrService] finalize OCR result updated');

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

    logger.info(`[DocumentOcrService] finalize completed: document=${ctx.document.id} revision=${revisionId} images=${imageRecords.length}`);

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

  async getOcrResultById(ocrResultId) {
    if (!ocrResultId) return null;
    const DocOcrResult = this.db.getModel('doc_ocr_result');
    return await DocOcrResult.findByPk(ocrResultId);
  }

  async getSubmitInProgressState(ocrResult) {
    if (!ocrResult) return { active: false, stale: false, requestedAt: null };
    const metadata = this.toPlainObject(ocrResult.metadata);
    if (metadata.submit_in_progress !== true) {
      return { active: false, stale: false, requestedAt: null };
    }

    const requestedAtRaw = metadata.submit_requested_at || ocrResult.updated_at || ocrResult.started_at || null;
    const requestedAtMs = requestedAtRaw ? Date.parse(requestedAtRaw) : Number.NaN;
    const timeoutMs = await this._getSystemMcpTimeoutMs();
    const staleAfterMs = timeoutMs + SUBMIT_IN_PROGRESS_STALE_GRACE_MS;
    const stale = Number.isNaN(requestedAtMs) || (Date.now() - requestedAtMs) > staleAfterMs;

    return {
      active: !stale,
      stale,
      requestedAt: requestedAtRaw,
    };
  }

  async clearSubmitInProgress(ocrResult, patch = {}) {
    if (!ocrResult) return;
    await ocrResult.update({
      metadata: this.buildMergedMetadata(ocrResult.metadata, {
        submit_in_progress: false,
        ...patch,
      }),
    });
  }

  async updateOcrResultIfNotCancelled(ocrResult, values) {
    if (!ocrResult?.id) return false;
    const DocOcrResult = this.db.getModel('doc_ocr_result');
    const [affectedRows] = await DocOcrResult.update(values, {
      where: {
        id: ocrResult.id,
        [Op.or]: [
          { status: { [Op.ne]: 'failed' } },
          { error_code: { [Op.ne]: 'document_deleted' } },
          { error_code: null },
        ],
      },
    });

    if (!affectedRows) {
      await ocrResult.reload();
      return false;
    }

    await ocrResult.reload();
    return true;
  }

  isCancelledOcrResult(ocrResult, document = null) {
    if (document?.processing_error_code === 'document_deleted') {
      return true;
    }

    if (!ocrResult) return false;
    return ocrResult.status === 'failed' && ocrResult.error_code === 'document_deleted';
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

  normalizeOcrResultStatus(status) {
    const normalized = normalizeLegacyStatus(status);
    return EXTERNAL_TO_OCR_STATUS_MAP[normalized] || 'failed';
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

  async buildImageAccessUrlMap(imageRecords = [], userId = null) {
    if (!Array.isArray(imageRecords) || imageRecords.length === 0) {
      return {};
    }

    const imageUrlMap = {};
    const sourceKeys = new Map();

    for (const record of imageRecords) {
      const attachment = record?.attachment;
      if (!attachment) continue;

      const accessLevel = attachment.access_level || 'private';
      if (accessLevel === 'public') {
        const publicUrl = `/attach/public/${attachment.id}`;
        if (record.item?.relative_path) imageUrlMap[record.item.relative_path] = publicUrl;
        if (record.item?.filename) imageUrlMap[record.item.filename] = publicUrl;
        continue;
      }

      const sourceTag = attachment.source_tag;
      const sourceId = attachment.source_id;
      if (!sourceTag || !sourceId || !userId) continue;
      sourceKeys.set(`${sourceTag}:${sourceId}`, { sourceTag, sourceId });
    }

    const tokenBySourceKey = new Map();
    for (const [key, group] of sourceKeys.entries()) {
      try {
        const tokenResult = await this.attachmentService.generateToken(group.sourceTag, group.sourceId, userId);
        tokenBySourceKey.set(key, tokenResult?.token || null);
      } catch (error) {
        logger.warn(`[DocumentOcrService] Failed to generate image token for ${key}: ${error.message}`);
      }
    }

    for (const record of imageRecords) {
      const attachment = record?.attachment;
      if (!attachment) continue;
      const accessLevel = attachment.access_level || 'private';
      if (accessLevel === 'public') continue;

      const token = tokenBySourceKey.get(`${attachment.source_tag}:${attachment.source_id}`);
      if (!token) continue;
      const tokenUrl = `/attach/t/${token}/${attachment.id}`;
      if (record.item?.relative_path) imageUrlMap[record.item.relative_path] = tokenUrl;
      if (record.item?.filename) imageUrlMap[record.item.filename] = tokenUrl;
    }

    return imageUrlMap;
  }

  countLines(text) {
    if (!text) return 0;
    return text.split(/\r?\n/).length;
  }

  async createTextAttachment(revisionId, createdBy, fileName, content, mimeType = 'text/plain') {
    return await this.attachmentService.createTextAttachment({
      sourceTag: OCR_PRODUCT_SOURCE_TAG,
      sourceId: revisionId,
      createdBy,
      fileName,
      content,
      mimeType,
    });
  }

  async createAttachmentFromDataUrl(revisionId, createdBy, fileName, dataUrl, altText = '', description = null) {
    return await this.attachmentService.createFromDataUrl({
      sourceTag: OCR_PRODUCT_SOURCE_TAG,
      sourceId: revisionId,
      createdBy,
      fileName,
      dataUrl,
      altText,
      description,
    });
  }

  async createAttachmentRecord({ revisionId, createdBy = null, fileName, mimeType, buffer, altText = null, description = null }) {
    return await this.attachmentService.createFromBuffer({
      sourceTag: OCR_PRODUCT_SOURCE_TAG,
      sourceId: revisionId,
      createdBy,
      fileName,
      mimeType,
      buffer,
      altText,
      description,
    });
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
      metadata: this.buildMergedMetadata(ocrResult.metadata, {
        submit_in_progress: false,
        last_error: {
          code: errorCode,
          message: errorMessage,
          at: new Date().toISOString(),
        },
      }),
    });
    // 从 document 当前状态推断所在阶段（pending_ocr / ocr_processing），failStage 自带一致性校验但 force 跳过以兼容
    const stage = ctx.document?.processing_status || 'ocr_processing';
    await this.advancer.failStage(ctx.document.id, stage, {
      code: errorCode,
      message: errorMessage,
      forceStageTransition: true,
    });
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

  extractImageDeliverablesResult(result) {
    const source = this.unwrapToolStructuredContent(result);
    if (!source || typeof source !== 'object') {
      return source;
    }

    const items = Array.isArray(source.items)
      ? source.items.map(item => this.normalizeImageDeliverableItem(item))
      : [];

    const images = source.images && typeof source.images === 'object'
      ? source.images
      : {};

    return {
      items,
      images,
    };
  }

  unwrapToolStructuredContent(result) {
    if (!result || typeof result !== 'object') {
      return result;
    }

    if (result.structuredContent && typeof result.structuredContent === 'object') {
      return result.structuredContent;
    }

    if (result.content && typeof result.content === 'string') {
      try {
        return JSON.parse(result.content);
      } catch {
        return result;
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

    return result;
  }

  normalizeImageDeliverableItem(item) {
    if (!item || typeof item !== 'object') return {};

    return {
      filename: item.filename || null,
      relative_path: item.relative_path || null,
      path: item.path || null,
      media_type: item.media_type || null,
      referenced_in_markdown: Boolean(item.referenced_in_markdown),
      description: typeof item.description === 'string' ? this.truncateText(item.description, MAX_ATTACHMENT_DESCRIPTION_LENGTH) : null,
      alt_text: typeof item.alt_text === 'string' ? this.truncateText(item.alt_text, MAX_ATTACHMENT_ALT_TEXT_LENGTH) : null,
      data_url: typeof item.data_url === 'string' ? item.data_url : null,
      references: Array.isArray(item.references)
        ? item.references.slice(0, 5).map(ref => ({
          markdown_path: ref?.markdown_path || null,
          line_number: ref?.line_number || null,
          start_offset: ref?.start_offset || null,
          end_offset: ref?.end_offset || null,
          alt_text: typeof ref?.alt_text === 'string' ? this.truncateText(ref.alt_text, MAX_ATTACHMENT_ALT_TEXT_LENGTH) : null,
        }))
        : [],
    };
  }

  resolveImageDataUrl(item, imageDeliverables) {
    const normalizedDataUrl = typeof item?.data_url === 'string' ? item.data_url : null;
    if (normalizedDataUrl) return normalizedDataUrl;

    const imageMap = imageDeliverables?.images && typeof imageDeliverables.images === 'object'
      ? imageDeliverables.images
      : null;
    if (!imageMap) return null;

    const candidates = [
      item?.filename,
      item?.relative_path,
      item?.path,
      item?.relative_path ? String(item.relative_path).replace(/^\.\//, '') : null,
      item?.filename ? `images/${item.filename}` : null,
      item?.filename ? `./images/${item.filename}` : null,
      item?.path ? String(item.path).replace(/^\.\//, '') : null,
    ].filter(Boolean);

    for (const key of candidates) {
      const value = imageMap[key];
      if (typeof value === 'string' && /^data:/i.test(value)) {
        return value;
      }
    }

    const imageEntries = Object.entries(imageMap);
    const fallbackEntry = imageEntries.find(([key, value]) => {
      if (typeof value !== 'string' || !/^data:/i.test(value)) return false;
      return candidates.some(candidate => String(key).endsWith(String(candidate)));
    });

    return fallbackEntry?.[1] || null;
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
      return '[Object omitted at max depth]';
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
    const sampled = this.sampleObjectEntries(value, MAX_JSON_PREVIEW_OBJECT_KEYS);
    const entries = sampled.entries;
    for (const [key, nested] of entries) {
      result[key] = this.toSafeSerializable(nested, depth + 1, seen);
    }
    if (sampled.truncated) {
      result.__truncated_keys__ = true;
    }
    if (sampled.enumeration_failed) {
      result.__enumeration_failed__ = sampled.error_message || true;
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
      return { message: 'Unknown OCR error', status: 500, isTimeout: false };
    }

    const summary = error instanceof Error
      ? {
          name: error.name,
          message: this.truncateText(error.message || String(error), 2000),
          code: error.code || null,
          status: error.status || null,
        }
      : this.toSafeSerializable(error);

    const isTimeout = this._isTimeoutError(error);

    return {
      status: error.status || 500,
      message: this.truncateText(error.message || String(error), 2000),
      summary,
      isTimeout,
    };
  }

  /**
   * 判断错误是否为超时类错误
   * 覆盖常见的 MCP/HTTP 超时模式：ETIMEDOUT、ECONNABORTED、ERR_CANCELED
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

  buildToolResultSummary(toolResult) {
    if (!toolResult || typeof toolResult !== 'object') {
      return toolResult ?? null;
    }

    try {
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
    } catch (error) {
      return {
        summary_error: this.truncateText(error.message || String(error), 500),
        fallback: this.toSafeSerializable(toolResult),
      };
    }
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
      const sampledImages = this.sampleObjectEntries(result.images, MAX_JSON_PREVIEW_OBJECT_KEYS + 1);
      summary.image_count = sampledImages.entries.length;
      if (sampledImages.truncated) {
        summary.image_count_truncated = true;
      }
      if (sampledImages.enumeration_failed) {
        summary.image_count_unavailable = sampledImages.error_message || true;
      }
    }

    if (result.result !== undefined) {
      if (typeof result.result === 'string') {
        summary.result_preview = this.truncateText(result.result, 2000);
      } else if (result.result && typeof result.result === 'object') {
        const sampledResult = this.sampleObjectEntries(result.result, 20);
        summary.result_keys = sampledResult.entries.map(([key]) => key);
        if (sampledResult.truncated) {
          summary.result_keys_truncated = true;
        }
        if (sampledResult.enumeration_failed) {
          summary.result_keys_unavailable = sampledResult.error_message || true;
        }
      }
    }

    return summary;
  }

  truncateText(text, maxLength = 1000) {
    if (typeof text !== 'string') return text;
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}…[truncated ${text.length - maxLength} chars]`;
  }

  sampleObjectEntries(value, limit = MAX_JSON_PREVIEW_OBJECT_KEYS) {
    if (!value || typeof value !== 'object') {
      return { entries: [], truncated: false, enumeration_failed: false };
    }

    const entries = [];
    let truncated = false;

    try {
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (entries.length >= limit) {
          truncated = true;
          break;
        }
        entries.push([key, value[key]]);
      }
      return { entries, truncated, enumeration_failed: false };
    } catch (error) {
      return {
        entries,
        truncated: true,
        enumeration_failed: true,
        error_message: this.truncateText(error.message || String(error), 500),
      };
    }
  }

  summarizeImageDeliverables(imageDeliverables) {
    if (!imageDeliverables || typeof imageDeliverables !== 'object') return imageDeliverables;

    const items = Array.isArray(imageDeliverables.items) ? imageDeliverables.items : [];
    const imageMap = imageDeliverables.images && typeof imageDeliverables.images === 'object'
      ? imageDeliverables.images
      : null;
    const imageSamples = items.slice(0, MAX_IMAGE_METADATA_ITEMS).map(item => {
      const imageKey = item?.filename || item?.relative_path || null;
      const imageValue = imageKey && imageMap ? (imageMap[imageKey] || imageMap[item?.relative_path || '']) : null;
      return {
        filename: item?.filename || null,
        relative_path: item?.relative_path || null,
        media_type: item?.media_type || null,
        referenced_in_markdown: Boolean(item?.referenced_in_markdown),
        data_url_present: typeof item?.data_url === 'string',
        image_map_hit: typeof imageValue === 'string',
        image_preview: typeof imageValue === 'string'
          ? { omitted: true, length: imageValue.length, preview: this.truncateText(imageValue, 120) }
          : undefined,
      };
    });

    return {
      item_count: items.length,
      items: imageSamples,
      truncated_items: items.length > MAX_IMAGE_METADATA_ITEMS ? items.length - MAX_IMAGE_METADATA_ITEMS : 0,
      image_map_present: Boolean(imageMap),
      image_map_sampled_via_items: Boolean(imageMap),
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
      image_map_present: Boolean(imageDeliverables.images && typeof imageDeliverables.images === 'object'),
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
      return '[object omitted at max depth]';
    }

    if (Array.isArray(value)) {
      return value.slice(0, MAX_JSON_PREVIEW_ITEMS).map(item => this.sanitizeForJsonPreview(item, depth + 1));
    }

    const sampled = this.sampleObjectEntries(value, MAX_JSON_PREVIEW_OBJECT_KEYS);
    const entries = sampled.entries.map(([key, nested]) => {
      return [key, this.sanitizeForJsonPreview(nested, depth + 1)];
    });

    const result = Object.fromEntries(entries);
    if (sampled.truncated) {
      result.__truncated_keys__ = true;
    }
    if (sampled.enumeration_failed) {
      result.__enumeration_failed__ = sampled.error_message || true;
    }
    return result;
  }

  safeJsonForAttachment(value) {
    return this.buildJsonAttachmentPayload(value);
  }
}

export default DocumentOcrService;
