/**
 * DocPipelineAdvancer - 文档处理状态推进服务
 *
 * 职责：接收外部处理器的状态报告，推进 documents.processing_status
 *
 * 使用方式：
 *   const advancer = new DocPipelineAdvancer(db);
 *   await advancer.advance(documentId, 'ocr_processing');
 */

const STATUS_SEQUENCE = [
  'pending_ocr',
  'ocr_processing',
  'pending_clean',
  'pending_metadata',
  'pending_chunk',
  'pending_embedding',
  'pending_relocate',
  'ready',
];

class DocPipelineAdvancer {
  constructor(db) {
    this.db = db;
  }

  /**
   * 推进处理状态到指定阶段
   */
  async advance(documentId, targetStatus) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId);
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    const currentIdx = STATUS_SEQUENCE.indexOf(doc.processing_status);
    const targetIdx = STATUS_SEQUENCE.indexOf(targetStatus);

    if (targetIdx === -1) throw new Error(`Invalid target status: ${targetStatus}`);
    if (targetIdx <= currentIdx) return doc;

    return await doc.update({
      processing_status: targetStatus,
      processing_updated_at: new Date(),
    });
  }

  /**
   * 标记处理失败
   */
  async fail(documentId, errorCode, errorMessage) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId);
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    return await doc.update({
      processing_status: 'error',
      processing_error_code: errorCode || null,
      processing_error_message: errorMessage || null,
      processing_updated_at: new Date(),
    });
  }

  /**
   * 标记处理完成
   */
  async complete(documentId) {
    return await this.advance(documentId, 'ready');
  }
}

export default DocPipelineAdvancer;
