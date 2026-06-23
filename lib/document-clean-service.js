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
      const precleanResult = this.precleanText(originalText, stageConfig.rules || {});
      const precleanedText = precleanResult.cleaned_text;
      const cleanedText = stageConfig.enabled === false
        ? precleanedText
        : await this.cleanWithRetry(callLlm, stageConfig, {
          precleanedText,
          modelId,
          temperature,
          llmTimeoutMs,
          chunkMaxLength,
        });

      const finalText = this.finalizeText(
        cleanedText || precleanedText || originalText,
        precleanResult.protected_blocks || [],
      );
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
        protected_table_count: (precleanResult.protected_blocks || []).length,
        protected_formula_count: (precleanResult.protected_formula_count || 0),
        updated_at: new Date().toISOString(),
      };

      await ocrResult.update({ metadata: JSON.stringify(metadata) }, { transaction });

      const Document = this.db.getModel('document');
      await Document.update({
        processing_status: 'pending_outline',
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

  async cleanWithRetry(callLlm, stageConfig, options) {
    const maxAttempts = Number(stageConfig.retry_attempts || 2) + 1;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          logger.warn(`[DocumentCleanService] Clean retry attempt ${attempt}/${maxAttempts}`);
        }
        return await this.cleanWithLlm(callLlm, stageConfig, options);
      } catch (error) {
        lastError = error;
        if (!this.isRetryableCleanError(error) || attempt === maxAttempts) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Document clean failed');
  }

  isRetryableCleanError(error) {
    const message = error?.message || String(error || '');
    return CLEAN_RETRYABLE_ERROR_PATTERNS.some(pattern => pattern.test(message));
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
    return `${userPrompt}\n\n你必须返回严格 JSON：\n{\n  "processed_part": "string",\n  "carried_over": "string",\n  "context_summary": {\n    "key_terms": {},\n    "points": []\n  }\n}\n\n规则：\n- processed_part: 本轮已清洗完成、可直接进入后续处理的正文。\n- carried_over: 若末尾内容疑似残缺、未处理完，放这里，下一轮继续。\n- context_summary: 提炼术语与上下文要点，供后续分块保持一致。\n- 任意形如 [[TABLE_BLOCK_n]] 的占位符都必须原样保留，不能改字、不能丢失、不能移动顺序。\n- 任意形如 [[FORMULA_BLOCK_n]] 或 [[FORMULA_INLINE_n]] 的占位符都必须原样保留，不能改字、不能丢失、不能移动顺序。\n- 不要输出任何 JSON 之外的内容。`;
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
    const extracted = this.extractProtectedTableBlocks(cleaned);
    const formulaExtracted = this.extractProtectedFormulaBlocks(extracted.text);
    const protectedBlocks = [...extracted.blocks, ...formulaExtracted.blocks];
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
    if (!columnCount || parsed.some(row => row.length !== columnCount)) {
      return lines.join('\n');
    }

    const normalized = [];
    normalized.push(`| ${parsed[0].join(' | ')} |`);
    normalized.push(`| ${new Array(columnCount).fill('---').join(' | ')} |`);
    for (let i = 2; i < parsed.length; i++) {
      normalized.push(`| ${parsed[i].join(' | ')} |`);
    }
    return normalized.join('\n');
  }

  parseMarkdownTableRow(line) {
    return String(line || '')
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cell => cell.trim().replace(/\s+/g, ' '));
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
}

export default DocumentCleanService;