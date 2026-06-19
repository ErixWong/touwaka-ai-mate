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
  'pending_outline',
  'pending_chunk',
  'pending_embedding',
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

  /**
   * 推进到状态链中的下一阶段
   */
  async advanceToNext(documentId) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId);
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    const currentIdx = STATUS_SEQUENCE.indexOf(doc.processing_status);
    if (currentIdx === -1) return doc;

    const nextIdx = currentIdx + 1;
    if (nextIdx >= STATUS_SEQUENCE.length) return doc;

    return await doc.update({
      processing_status: STATUS_SEQUENCE[nextIdx],
      processing_updated_at: new Date(),
    });
  }
}

export { STATUS_SEQUENCE };
export default DocPipelineAdvancer;
