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
   * 获取指定 outline 的 section 正文
   *
   * @param {string} outlineId - document_outlines.id
   * @returns {Promise<Object|null>} outline 对象（含 original_text），或 null
   */
  async getSectionByOutlineId(outlineId) {
    const DocumentOutline = this.db.getModel('document_outline');
    const outline = await DocumentOutline.findByPk(outlineId, { raw: true });
    return outline || null;
  }

  // ============================================================
  // G3: 按任意 revision_id 读全文
  // ============================================================

  /**
   * 获取指定 revision 的全文内容（R2-7：支持 max_chars 截断）
   *
   * @param {string} revisionId - document_revisions.id
   * @param {object} [options]
   * @param {number} [options.max_chars=20000] - 最大字符数，0=不截断
   * @returns {Promise<Object>} { text, revision, content_truncated }
   */
  async getRevisionText(revisionId, options = {}) {
    const { max_chars = 20000 } = options;

    const DocumentRevision = this.db.getModel('document_revision');
    const revision = await DocumentRevision.findByPk(revisionId, { raw: true });
    if (!revision) {
      return { text: null, revision: null, content_truncated: false };
    }

    let text = await this.loadRevisionText(revision);
    let content_truncated = false;

    if (text && max_chars > 0 && text.length > max_chars) {
      text = text.slice(0, max_chars);
      content_truncated = true;
    }

    return { text, revision, content_truncated };
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
