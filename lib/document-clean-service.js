import fs from 'fs/promises';
import path from 'path';

import Utils from './utils.js';
import logger from './logger.js';
import DocPipelineAdvancer from './doc-pipeline-advancer.js';
import { getStageDefault, createCallLlmFn } from './doc-pipeline-defaults.js';
import AttachmentService from '../server/services/attachment.service.js';

const DEFAULT_CHUNK_MAX_LENGTH = 8000;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_TEMPERATURE = 0.2;
const CONTEXT_SUMMARY_MAX_LENGTH = 2000;

const DEFAULT_CLEAN_PROMPT = `你是文档正文清洗助手。请清洗 OCR 生成的 Markdown/纯文本正文，输出适合后续元数据提取、章节提取、文本分块的干净正文。

要求：
1. 保留正文语义，不得编造、补充事实。
2. 保留 Markdown 标题、列表、普通段落、合法图片语法（如 ![](...)）。
3. 删除 HTML/XML 标签及其结构噪声，例如 <table> <tr> <td> <div> <span>。
4. 对标签内仍有价值的文字，转成普通文本保留；对明显残缺、无意义的结构噪声可删除。
5. 删除页码、页眉页脚、水印、乱码、无意义重复行、多余空白。
6. 保留文档中的编号、日期、联系人、附件标题等业务信息。
7. 不要输出解释，只输出 JSON。`;

class DocumentCleanService {
  constructor(db, options = {}) {
    this.db = db;
    this.callLlm = options.callLlm || null;
    this.getDocPipelineConfig = options.getDocPipelineConfig || null;
    this.advancer = new DocPipelineAdvancer(db);
    this.attachmentService = new AttachmentService(db);
  }

  async _loadStageConfig() {
    if (typeof this.getDocPipelineConfig === 'function') {
      try {
        const fullConfig = await this.getDocPipelineConfig(this.db);
        if (fullConfig && fullConfig.pending_clean) {
          return fullConfig.pending_clean;
        }
      } catch (err) {
        logger.warn(`[DocumentCleanService] Failed to load pending_clean config, using defaults: ${err.message}`);
      }
    }
    return getStageDefault('pending_clean');
  }

  async _resolveCallLlm() {
    if (this.callLlm) return this.callLlm;
    return createCallLlmFn(this.db);
  }

  async clean(documentId, options = {}) {
    const stageConfig = await this._loadStageConfig();
    const callLlm = await this._resolveCallLlm();

    const chunkMaxLength = stageConfig.chunk_max_length || DEFAULT_CHUNK_MAX_LENGTH;
    const temperature = stageConfig.temperature ?? DEFAULT_TEMPERATURE;
    const modelId = stageConfig.model_id || null;
    const llmTimeoutMs = stageConfig.llm_timeout_ms || stageConfig.timeout_ms || DEFAULT_TIMEOUT_MS;

    const initiatedByType = options.initiatedByType || 'system';
    const initiatedById = options.initiatedById || null;

    const ctx = await this._loadDocumentContext(documentId);
    const ocrResult = await this._loadLatestOcrResult(ctx.revision.id);
    if (!ocrResult?.main_markdown_attachment_id) {
      throw new Error('No OCR markdown attachment found for cleaning');
    }

    const sourceAttachment = await this._loadAttachmentById(ocrResult.main_markdown_attachment_id);
    if (!sourceAttachment?.file_path) {
      throw new Error('OCR markdown attachment file not found');
    }

    const originalText = await this._readAttachmentText(sourceAttachment.file_path);
    if (!originalText || !originalText.trim()) {
      throw new Error('OCR markdown content is empty');
    }

    const runId = Utils.newID();
    const DocProcessRun = this.db.getModel('doc_process_run');
    await DocProcessRun.create({
      id: runId,
      revision_id: ctx.revision.id,
      subject_type: 'documents',
      subject_id: documentId,
      pipeline_step: 'pending_clean',
      operation: 'start',
      initiated_by_type: initiatedByType,
      initiated_by_id: initiatedById,
      result_status: 'running',
      attempt_no: 1,
      message: 'Document clean started',
      started_at: new Date(),
      finished_at: null,
    });

    const transaction = await this.db.sequelize.transaction();

    try {
      const precleanedText = this.precleanText(originalText, stageConfig.rules || {});
      const cleanedText = stageConfig.enabled === false
        ? precleanedText
        : await this.cleanWithLlm(callLlm, stageConfig, {
          precleanedText,
          modelId,
          temperature,
          llmTimeoutMs,
          chunkMaxLength,
        });

      const finalText = this.finalizeText(cleanedText || precleanedText || originalText);
      const cleanedAttachment = await this.attachmentService.createTextAttachment({
        sourceTag: 'doc-platform',
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
        updated_at: new Date().toISOString(),
      };

      await ocrResult.update({ metadata }, { transaction });

      const Document = this.db.getModel('document');
      await Document.update({
        processing_status: 'pending_metadata',
        processing_error_code: null,
        processing_error_message: null,
        processing_updated_at: new Date(),
      }, { where: { id: documentId }, transaction });

      await DocProcessRun.update({
        result_status: 'ok',
        finished_at: new Date(),
        message: `Document cleaned (${originalText.length} -> ${finalText.length})`,
      }, { where: { id: runId }, transaction });

      await transaction.commit();

      logger.info(`[DocumentCleanService] Document ${documentId}: cleaned ${originalText.length} -> ${finalText.length}`);
      return {
        success: true,
        cleaned_attachment_id: cleanedAttachment.id,
        original_length: originalText.length,
        cleaned_length: finalText.length,
      };
    } catch (error) {
      await transaction.rollback();

      await DocProcessRun.update({
        result_status: 'nok',
        finished_at: new Date(),
        message: error.message,
      }, { where: { id: runId } });

      const Document = this.db.getModel('document');
      await Document.update({
        processing_status: 'error',
        processing_error_code: 'clean_failed',
        processing_error_message: error.message,
        processing_updated_at: new Date(),
      }, { where: { id: documentId } });

      throw error;
    }
  }

  async cleanWithLlm(callLlm, stageConfig, options) {
    const chunks = this.splitIntoChunks(options.precleanedText, options.chunkMaxLength);
    const allProcessed = [];
    let carriedOver = '';
    let contextSummary = { key_terms: {}, points: [] };

    for (let i = 0; i < chunks.length; i++) {
      const nextChunk = chunks[i];
      const chunkInput = carriedOver ? `${carriedOver}\n\n${nextChunk}` : nextChunk;
      const result = await this.cleanSingleChunk(callLlm, stageConfig, chunkInput, contextSummary, options);
      allProcessed.push(result.processed_part || '');
      carriedOver = result.carried_over || '';
      contextSummary = this.trimContextSummary(result.context_summary);
    }

    if (carriedOver) {
      allProcessed.push(carriedOver);
    }

    return allProcessed.join('\n\n');
  }

  async cleanSingleChunk(callLlm, stageConfig, chunkInput, contextSummary, options) {
    const systemPrompt = this.buildPrompt(stageConfig);
    const contextNote = this.buildContextNote(contextSummary);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${chunkInput}${contextNote}` },
    ];

    const response = await callLlm({
      model_id: options.modelId,
      temperature: options.temperature,
      timeout: options.llmTimeoutMs,
      messages,
      output_schema: {
        processed_part: 'string',
        carried_over: 'string',
        context_summary: {
          key_terms: {},
          points: [],
        },
      },
    });

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

  buildPrompt(stageConfig) {
    const userPrompt = stageConfig.prompt_template?.trim() || DEFAULT_CLEAN_PROMPT;
    return `${userPrompt}\n\n你必须返回严格 JSON：\n{\n  "processed_part": "string",\n  "carried_over": "string",\n  "context_summary": {\n    "key_terms": {},\n    "points": []\n  }\n}\n\n规则：\n- processed_part: 本轮已清洗完成、可直接进入后续处理的正文。\n- carried_over: 若末尾内容疑似残缺、未处理完，放这里，下一轮继续。\n- context_summary: 提炼术语与上下文要点，供后续分块保持一致。\n- 不要输出任何 JSON 之外的内容。`;
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

  precleanText(text, rules = {}) {
    let cleaned = String(text || '');

    cleaned = cleaned.replace(/\r\n/g, '\n');
    cleaned = cleaned.replace(/<\/(table|tr|td|div|span|p|tbody|thead|th)>/gi, '\n');
    cleaned = cleaned.replace(/<(table|tr|td|div|span|p|tbody|thead|th)(\s[^>]*)?>/gi, ' ');
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

    return cleaned.trim();
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

  finalizeText(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
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
}

export default DocumentCleanService;