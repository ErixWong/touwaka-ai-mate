/**
 * Document Read Service - 文档只读外观服务
 *
 * === 设计意图 ===
 * 提供文档平台的统一只读查询入口，收敛散落在多处的读取逻辑：
 * - doc.controller（直接查 model）
 * - DocumentAtomicTools（裸 SQL）
 * - document-outline-service（私有 _loadRevisionText）
 * - document-chunk-service（私有 _loadRevisionText）
 *
 * 消费方：
 * - doc.controller（HTTP API 端点）
 * - standard-mgr（进程内服务端回填流程）
 * - 沙箱工具（通过 P0-2 HTTP 端点间接消费）
 *
 * 四个缺口能力（G1-G4，见 AUDIT-ROUND1.md §3）：
 * - G1: listOutlines —— 按 revision_id 读 outline 列表
 * - G2: getSectionByOutlineId —— 按 outline_id 读 section 文本
 * - G3: getRevisionText —— 按任意 revision_id 读全文
 * - G4: resolveOutline —— outline_id 反查 document/revision 信息
 */

import logger from './logger.js';
import { getPreviewAttachmentId } from './doc-ocr-utils.js';

/**
 * 将超长单行（如 OCR 表格整行）按 maxChars 拆分为多段，切分点尽量落在 HTML 标签边界，
 * 避免从标签中间劈开。每段 ≤ maxChars。
 *
 * @param {string} line - 超长单行
 * @param {number} maxChars - 单段最大字符数
 * @returns {string[]} 拆分后的段数组
 */
function splitOversizedLine(line, maxChars) {
  const parts = [];
  let i = 0;
  while (i < line.length) {
    const hardEnd = Math.min(i + maxChars, line.length);
    let end = hardEnd;
    if (end < line.length) {
      // 仅在硬切点附近的 [hardEnd - slack, hardEnd] 窗口内找标签边界（避免密集标签产生碎片页）：
      // 优先切到 < 前（标签开始），其次切到 > 后（标签结束）；取窗口内最后一个边界让段尽量长
      const slack = Math.min(120, maxChars - 1);
      const windowStart = hardEnd - slack;
      let best = -1;
      let nextTagStart = line.lastIndexOf('<', hardEnd);
      if (nextTagStart >= windowStart) best = nextTagStart;
      let nextTagEnd = line.lastIndexOf('>', hardEnd);
      if (nextTagEnd >= windowStart && nextTagEnd + 1 <= hardEnd && (best === -1 || nextTagEnd + 1 < best)) {
        best = nextTagEnd + 1;
      }
      if (best > i) end = best;
    }
    if (end <= i) end = hardEnd; // 兜底：防止空段
    parts.push(line.slice(i, end));
    i = end;
  }
  return parts;
}

function decodeHtmlEntity(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtmlTags(text) {
  return decodeHtmlEntity(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function flattenHtmlTable(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(match => match[1])
    .map(rowHtml => {
      const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(cellMatch => stripHtmlTags(cellMatch[1]))
        .filter(Boolean);
      return cells;
    })
    .filter(cells => cells.length > 0);

  if (rows.length === 0) {
    return stripHtmlTags(tableHtml);
  }

  return rows
    .map(cells => `| ${cells.join(' | ')} |`)
    .join('\n');
}

function normalizeAgentReadableText(text) {
  if (!text || typeof text !== 'string') return '';

  let normalized = text.replace(/\r\n?/g, '\n');
  if (!/<table\b/i.test(normalized)) {
    return normalized;
  }

  normalized = normalized.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, match => {
    const flattened = flattenHtmlTable(match);
    return `\n[表格开始]\n${flattened}\n[表格结束]\n`;
  });

  normalized = normalized
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  return decodeHtmlEntity(normalized).trim();
}

/**
 * 读取态 section page 返回仅保留 agent 真正需要的字段，
 * 避免把整个 outline 大对象（title/原文/扩展字段）一并回传导致工具结果超过摘要阈值。
 * 这是视图层瘦身，不影响任何持久化存储。
 *
 * @param {object} outline
 * @param {object} pageData
 * @param {number} pageIndex
 * @param {boolean} hasMore
 * @param {number|null} nextOffset
 * @param {number} totalChars
 * @param {number} chunkCount
 * @returns {object}
 */
function buildSectionPageView(outline, pageData, pageIndex, hasMore, nextOffset, totalChars, chunkCount) {
  return {
    id: outline.id,
    revision_id: outline.revision_id,
    parent_id: outline.parent_id || null,
    heading: outline.heading || '',
    level: outline.level ?? null,
    seq: outline.seq ?? null,
    original_text: pageData.content,
    page_index: pageIndex,
    page_has_more: hasMore,
    page_next_offset: nextOffset,
    page_total_chars: totalChars,
    chunk_count: chunkCount,
    chunk_id: pageData.chunk_id || null,
    chunk_seq: pageData.chunk_seq ?? null,
    from_line: pageData.from_line ?? null,
    to_line: pageData.to_line ?? null,
    overlap_lines: pageData.overlap_lines ?? 0,
    split_page: pageData.split_page || false,
    sub_split: pageData.sub_split || false,
  };
}

class DocumentReadService {
  constructor(db) {
    this.db = db;
  }

  // ============================================================
  // 共享工具方法
  // ============================================================

  /**
   * 加载指定 revision 的原始全文文本
   *
   * 上提自 document-outline-service._loadRevisionText 与
   * document-chunk-service._loadRevisionText 的重复实现。
   *
   * 链路：revision_id → doc_ocr_result → getPreviewAttachmentId() → fs.readFile
   *
   * @param {Object} revision - document_revision 实例（至少含 id 字段）
   * @returns {Promise<string|null>} 全文文本，或 null
   */
  async loadRevisionText(revision) {
    const DocOcrResult = this.db.getModel('doc_ocr_result');
    const ocrResult = await DocOcrResult.findOne({
      where: { revision_id: revision.id },
      raw: true,
    });

    const preferredAttachmentId = getPreviewAttachmentId(ocrResult);
    if (!preferredAttachmentId) return null;

    const Attachment = this.db.getModel('attachment');
    const attachment = await Attachment.findByPk(preferredAttachmentId, { raw: true });
    if (!attachment || !attachment.file_path) return null;

    const fs = await import('fs/promises');
    const path = await import('path');
    const basePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
    const fullPath = path.resolve(basePath, attachment.file_path);

    return await fs.readFile(fullPath, 'utf8');
  }

  // ============================================================
  // G1: 按 revision_id 读 outline 列表
  // ============================================================

  /**
   * 获取指定 revision 的章节大纲列表
   *
   * @param {string} revisionId - document_revisions.id
   * @returns {Promise<Array>} outline 列表，按 seq 排序
   */
  async listOutlines(revisionId) {
    const DocumentOutline = this.db.getModel('document_outline');
    const outlines = await DocumentOutline.findAll({
      where: { revision_id: revisionId },
      order: [['seq', 'ASC']],
      raw: true,
    });
    return outlines;
  }

  // ============================================================
  // G2: 按 outline_id 读 section 文本
  // ============================================================

  /**
   * 获取指定 outline 的 section 正文（R16-2：chunk 翻页方案）
   *
   * 修订说明（AUDIT-ROUND16 §3 根因 B）：巨型单节（如 JLY 664F 的 4/5/6 章，
   * 单节 14k~18k 字符）用 read_section_context 整节读取会超过工具结果摘要阈值
   * （SUMMARY_THRESHOLD=5000 字符），agent 实际只"看到"章节前部，尾部引用漏洗。
   * 因此改为按 chunk 翻页：outline 下的 document_chunks 天然是内容分页单元
   * （带 from_line/to_line 与 outline 归属），每页返回 1 个 chunk，保证单页
   * 长度可控（≤4000 字符，低于摘要阈值）；超限大块（如 OCR 表格整块）按行
   * 二次切分兜底；chunk 间的行重叠（embedding 上下文连续性）在返回中标注
   * overlap_lines，提示 agent 按行号去重，避免把重叠处引用写两遍。
   *
   * @param {string} outlineId - document_outlines.id
   * @param {object} [options]
   * @param {number} [options.page=0] - chunk 页序号（0 起），每页 1 个 chunk
   * @param {number} [options.page_size=1] - 每页 chunk 数（默认 1，预留）
   * @param {number} [options.max_page_chars=4000] - 单页最大字符数（超限按行二次切分）
   * @returns {Promise<Object|null>} outline 对象（含分页切片、chunk 元信息、has_more、next_offset），或 null
   */
  async getSectionByOutlineId(outlineId, options = {}) {
    const { page = 0, page_size = 1, max_page_chars = 4000 } = options;

    const DocumentOutline = this.db.getModel('document_outline');
    const DocumentChunk = this.db.getModel('document_chunk');
    const outline = await DocumentOutline.findByPk(outlineId, { raw: true });
    if (!outline) return null;

    // 优先按 chunk 翻页：outline 下所有 chunks 按 seq 排序
    const chunks = await DocumentChunk.findAll({
      where: { outline_id: outlineId },
      order: [['seq', 'ASC']],
      raw: true,
    });

    // 无 chunk 时回落：整段返回 original_text（分页字段为空，page_has_more=false）
    if (!chunks || chunks.length === 0) {
      return buildSectionPageView(
        outline,
        { content: outline.original_text || '' },
        0,
        false,
        null,
        (outline.original_text || '').length,
        0,
      );
    }

    // 将 chunks 展平为页列表：超限大块按行二次切分，每页 ≤ max_page_chars
    const pages = [];
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const content = normalizeAgentReadableText(chunk.content || '');
      const chunkChars = content.length;

      const prevChunk = ci > 0 ? chunks[ci - 1] : null;
      // chunk 间行重叠（embedding 上下文连续性设计）：若本 chunk 起始行 <= 上一 chunk 结束行，则重叠
      const overlapLines = prevChunk
        ? Math.max(0, prevChunk.to_line - chunk.from_line + 1)
        : 0;

      if (chunkChars <= max_page_chars) {
        pages.push({
          content,
          chunk_id: chunk.id,
          chunk_seq: chunk.seq,
          from_line: chunk.from_line,
          to_line: chunk.to_line,
          overlap_lines: overlapLines,
        });
        continue;
      }

      // 超限大块：按行二次切分
      const lines = content.split('\n');
      let pageLines = [];
      let pageChars = 0;
      const flushLinePage = () => {
        if (pageLines.length === 0) return;
        pages.push({
          content: pageLines.join('\n'),
          chunk_id: chunk.id,
          chunk_seq: chunk.seq,
          from_line: chunk.from_line,
          to_line: chunk.to_line,
          overlap_lines: overlapLines,
          split_page: true,
        });
        pageLines = [];
        pageChars = 0;
      };
      for (const line of lines) {
        // 单行超长（如 OCR 表格整行无换行）：先 flush 已累积行，再按标签边界拆段成独立页
        if (line.length > max_page_chars) {
          flushLinePage();
          for (const part of splitOversizedLine(line, max_page_chars)) {
            pages.push({
              content: part,
              chunk_id: chunk.id,
              chunk_seq: chunk.seq,
              from_line: chunk.from_line,
              to_line: chunk.to_line,
              overlap_lines: overlapLines,
              split_page: true,
              sub_split: true,
            });
          }
          continue;
        }
        const lineChars = line.length + 1; // +1 for newline
        if (pageChars + lineChars > max_page_chars && pageLines.length > 0) {
          flushLinePage();
          pageLines = [line];
          pageChars = line.length;
        } else {
          pageLines.push(line);
          pageChars += lineChars;
        }
      }
      flushLinePage();
    }

    const pageIndex = Math.min(Math.max(0, page), Math.max(0, pages.length - 1));
    const current = pages[pageIndex];
    const hasMore = pageIndex < pages.length - 1;
    const chunkTotal = chunks.length;

    return buildSectionPageView(
      outline,
      current,
      pageIndex,
      hasMore,
      hasMore ? pageIndex + 1 : null,
      (outline.original_text || '').length,
      chunkTotal,
    );
  }

  // ============================================================
  // G3: 按任意 revision_id 读全文
  // ============================================================

  /**
   * 获取指定 revision 的全文内容（R2-7：支持 max_chars 截断；R16-2：支持 offset_chars 分页）
   *
   * @param {string} revisionId - document_revisions.id
   * @param {object} [options]
   * @param {number} [options.max_chars=20000] - 最大字符数，0=不截断
   * @param {number} [options.offset_chars=0] - 起始字符偏移（配合 max_chars 翻页）
   * @returns {Promise<Object>} { text, revision, content_truncated, content_offset, content_has_more, content_total_chars }
   */
  async getRevisionText(revisionId, options = {}) {
    const { max_chars = 20000, offset_chars = 0 } = options;

    const DocumentRevision = this.db.getModel('document_revision');
    const revision = await DocumentRevision.findByPk(revisionId, { raw: true });
    if (!revision) {
      return { text: null, revision: null, content_truncated: false };
    }

    const fullText = await this.loadRevisionText(revision);
    let text = fullText;
    let content_truncated = false;

    if (offset_chars > 0 && fullText && fullText.length > offset_chars) {
      text = fullText.slice(offset_chars);
    }

    if (text && max_chars > 0 && text.length > max_chars) {
      text = text.slice(0, max_chars);
      content_truncated = true;
    }

    return {
      text,
      revision,
      content_truncated,
      content_offset: offset_chars,
      content_has_more: max_chars > 0 && fullText ? fullText.length > offset_chars + max_chars : false,
      content_total_chars: fullText ? fullText.length : 0,
    };
  }

  // ============================================================
  // G4: outline_id 反查 document/revision 信息
  // ============================================================

  /**
   * 通过 outline_id 反查所属的 document 和 revision 信息
   *
   * @param {string} outlineId - document_outlines.id
   * @returns {Promise<Object|null>} { outline, revision, document } 或 null
   */
  async resolveOutline(outlineId) {
    const DocumentOutline = this.db.getModel('document_outline');
    const DocumentRevision = this.db.getModel('document_revision');
    const Document = this.db.getModel('document');

    const outline = await DocumentOutline.findByPk(outlineId, { raw: true });
    if (!outline) return null;

    const revision = await DocumentRevision.findByPk(outline.revision_id, { raw: true });
    if (!revision) return { outline, revision: null, document: null };

    const document = await Document.findByPk(revision.document_id, { raw: true });

    return { outline, revision, document };
  }
}

export default DocumentReadService;
