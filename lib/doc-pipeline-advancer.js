/**
 * DocPipelineAdvancer - 文档处理状态推进服务
 *
 * 职责：接收外部处理器的状态报告，推进 documents.processing_status
 *
 * 使用方式：
 *   const advancer = new DocPipelineAdvancer(db);
 *   await advancer.advance(documentId, 'ocr_processing');
 */

import { DOC_PROCESSING_SEQUENCE, isTerminalStatus } from './doc-processing-status.js';

class DocPipelineAdvancer {
  constructor(db) {
    this.db = db;
  }

  /**
   * 推进处理状态到指定阶段
   * @param {string} documentId
   * @param {string} targetStatus
   * @param {Object} [options]
   * @param {Object} [options.transaction] - 可选的事务对象
   */
  async advance(documentId, targetStatus, options = {}) {
    const { transaction } = options;
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, { transaction });
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    const currentIdx = DOC_PROCESSING_SEQUENCE.indexOf(doc.processing_status);
    const targetIdx = DOC_PROCESSING_SEQUENCE.indexOf(targetStatus);

    if (targetIdx === -1) throw new Error(`Invalid target status: ${targetStatus}`);
    if (targetIdx <= currentIdx) return doc;

    return await doc.update({
      processing_status: targetStatus,
      processing_error_code: null,
      processing_error_message: null,
      processing_updated_at: new Date(),
    }, { transaction });
  }

  /**
   * 标记处理失败
   * @param {string} documentId
   * @param {string} errorCode
   * @param {string} errorMessage
   * @param {Object} [options]
   * @param {Object} [options.transaction] - 可选的事务对象
   */
  async fail(documentId, errorCode, errorMessage, options = {}) {
    const { transaction } = options;
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, { transaction });
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    return await doc.update({
      processing_status: 'error',
      processing_error_code: errorCode || null,
      processing_error_message: errorMessage || null,
      processing_updated_at: new Date(),
    }, { transaction });
  }

  /**
   * 标记处理完成
   * @param {string} documentId
   * @param {Object} [options]
   * @param {Object} [options.transaction] - 可选的事务对象
   */
  async complete(documentId, options = {}) {
    return await this.advance(documentId, 'ready', options);
  }

  /**
   * 推进到状态链中的下一阶段
   * @param {string} documentId
   * @param {Object} [options]
   * @param {Object} [options.transaction] - 可选的事务对象
   */
  async advanceToNext(documentId, options = {}) {
    const { transaction } = options;
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, { transaction });
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    const currentIdx = DOC_PROCESSING_SEQUENCE.indexOf(doc.processing_status);
    if (currentIdx === -1) return doc;

    const nextIdx = currentIdx + 1;
    if (nextIdx >= DOC_PROCESSING_SEQUENCE.length) return doc;

    return await doc.update({
      processing_status: DOC_PROCESSING_SEQUENCE[nextIdx],
      processing_error_code: null,
      processing_error_message: null,
      processing_updated_at: new Date(),
    }, { transaction });
  }
}

export { DOC_PROCESSING_SEQUENCE, isTerminalStatus };
export default DocPipelineAdvancer;
