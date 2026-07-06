/**
 * DocPipelineAdvancer - 文档处理状态推进服务（统一入口）
 *
 * 职责：
 *   1. 更新 documents.processing_status / current_stage_started_at / processing_updated_at
 *   2. 写入 doc_process_runs 运行历史
 *   3. 统一管理 processing_error_code / processing_error_message 的写入与清理
 *
 * 新 API（推荐）：
 *   const { runId } = await advancer.enterStage(documentId, 'pending_ocr', context);
 *   await advancer.finishStage(documentId, 'pending_ocr', { runId, nextStage: 'ocr_processing' });
 *   await advancer.failStage(documentId, 'ocr_processing', { runId, code: '...', message: '...' });
 *   await advancer.timeoutStage(documentId, 'ocr_processing', { runId, message: '...' });
 *   await advancer.cancelStage(documentId, 'ocr_processing', { runId, reason: '...' });
 *
 * 旧 API（向后兼容，内部委托到新 API）：
 *   await advancer.advance(documentId, 'ocr_processing');
 *   await advancer.fail(documentId, 'error_code', 'error_message');
 *   await advancer.complete(documentId);
 *   await advancer.advanceToNext(documentId);
 */

import Utils from './utils.js';
import { DOC_PROCESSING_SEQUENCE, isTerminalStatus, getNextStatus } from './doc-processing-status.js';

class DocPipelineAdvancer {
  constructor(db) {
    this.db = db;
  }

  async _resolveRevisionId(documentId) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, {
      attributes: ['id', 'current_revision_id'],
      raw: true,
    });
    return doc?.current_revision_id || null;
  }

  async _closeRunningStage(documentId, stage, resultStatus, message, metadata = null) {
    const DocProcessRun = this.db.getModel('doc_process_run');
    const run = await DocProcessRun.findOne({
      where: {
        subject_type: 'documents',
        subject_id: documentId,
        pipeline_step: stage,
        result_status: 'running',
      },
      order: [['started_at', 'DESC']],
      raw: true,
    });
    if (run) {
      await DocProcessRun.update({
        result_status: resultStatus,
        finished_at: new Date(),
        message: message || `Stage ${stage} completed (auto-closed)`,
        metadata: metadata || null,
      }, { where: { id: run.id } });
      return run.id;
    }
    return null;
  }

  async _validateStageConsistency(documentId, expectedStage, forceStageTransition = false) {
    if (forceStageTransition) return;
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status'],
      raw: true,
    });
    if (!doc) throw new Error(`Document not found: ${documentId}`);
    if (doc.processing_status !== expectedStage) {
      throw new Error(
        `Stage mismatch for document ${documentId}: expected "${expectedStage}", actual "${doc.processing_status}". ` +
        'Set forceStageTransition=true to bypass this check.'
      );
    }
  }

  async _autoCloseRunningRun(documentId, stage, resultStatus, runId, message, metadata = null) {
    if (runId) {
      await this._finishRunRecord(runId, resultStatus, message, metadata);
      return runId;
    }
    return await this._closeRunningStage(documentId, stage, resultStatus, message, metadata);
  }

  async _createRunRecord(documentId, stage, context = {}) {
    const revisionId = context.revision_id || await this._resolveRevisionId(documentId);
    const runId = Utils.newID();
    const DocProcessRun = this.db.getModel('doc_process_run');
    await DocProcessRun.create({
      id: runId,
      revision_id: revisionId,
      subject_type: 'documents',
      subject_id: documentId,
      pipeline_step: stage,
      operation: context.operation || 'start',
      initiated_by_type: context.initiatedByType || 'system',
      initiated_by_id: context.initiatedById || null,
      result_status: 'running',
      attempt_no: context.attemptNo || 1,
      message: context.message || `Entered stage: ${stage}`,
      metadata: context.metadata || null,
      started_at: new Date(),
      finished_at: null,
    });
    return runId;
  }

  async _finishRunRecord(runId, resultStatus, message, metadata = null) {
    if (!runId) return;
    const DocProcessRun = this.db.getModel('doc_process_run');
    await DocProcessRun.update({
      result_status: resultStatus,
      finished_at: new Date(),
      message: message || null,
      metadata: metadata || null,
    }, { where: { id: runId } });
  }

  async _updateDocument(documentId, fields) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId);
    if (!doc) throw new Error(`Document not found: ${documentId}`);
    return await doc.update(fields);
  }

  async enterStage(documentId, stage, context = {}) {
    if (!DOC_PROCESSING_SEQUENCE.includes(stage)) {
      throw new Error(`Invalid stage: ${stage}. Valid stages: ${DOC_PROCESSING_SEQUENCE.join(', ')}`);
    }

    const now = new Date();
    await this._updateDocument(documentId, {
      processing_status: stage,
      current_stage_started_at: now,
      processing_error_code: null,
      processing_error_message: null,
      processing_updated_at: now,
    });

    const runId = await this._createRunRecord(documentId, stage, {
      ...context,
      operation: 'start',
      message: context.message || `Entered stage: ${stage}`,
    });

    return { documentId, stage, runId };
  }

  async finishStage(documentId, stage, result = {}) {
    await this._validateStageConsistency(documentId, stage, result.forceStageTransition);

    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status'],
      raw: true,
    });
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    const nextStage = result.nextStage || getNextStatus(doc.processing_status);
    if (!nextStage) {
      throw new Error(`Cannot determine next stage from current: ${doc.processing_status}`);
    }

    const now = new Date();
    await this._updateDocument(documentId, {
      processing_status: nextStage,
      current_stage_started_at: now,
      processing_error_code: null,
      processing_error_message: null,
      processing_updated_at: now,
    });

    const message = result.message || `Stage ${stage} completed → ${nextStage}`;
    await this._autoCloseRunningRun(documentId, stage, 'ok', result.runId, message, result.metadata);

    return { documentId, stage, nextStage };
  }

  async failStage(documentId, stage, error = {}) {
    await this._validateStageConsistency(documentId, stage, error.forceStageTransition);

    await this._updateDocument(documentId, {
      processing_status: 'error',
      processing_error_code: error.code || `${stage}_failed`,
      processing_error_message: error.message || null,
      processing_updated_at: new Date(),
    });

    const message = error.message || `Stage ${stage} failed`;
    await this._autoCloseRunningRun(documentId, stage, 'nok', error.runId, message, error.metadata);

    return { documentId, stage, result: 'error' };
  }

  async timeoutStage(documentId, stage, context = {}) {
    await this._validateStageConsistency(documentId, stage, context.forceStageTransition);

    await this._updateDocument(documentId, {
      processing_status: 'error',
      processing_error_code: context.code || `${stage}_timeout`,
      processing_error_message: context.message || `Stage ${stage} timed out`,
      processing_updated_at: new Date(),
    });

    const message = context.message || `Stage ${stage} timed out`;
    await this._autoCloseRunningRun(documentId, stage, 'nok', context.runId, message, context.metadata);

    return { documentId, stage, result: 'timeout' };
  }

  async cancelStage(documentId, stage, context = {}) {
    await this._validateStageConsistency(documentId, stage, context.forceStageTransition);

    await this._updateDocument(documentId, {
      processing_status: 'error',
      processing_error_code: `${stage}_cancelled`,
      processing_error_message: context.message || `Stage ${stage} cancelled: ${context.reason || 'unknown'}`,
      processing_updated_at: new Date(),
    });

    const message = context.message || `Stage ${stage} cancelled`;
    await this._autoCloseRunningRun(documentId, stage, 'nok', context.runId, message, context.metadata);

    return { documentId, stage, result: 'cancelled' };
  }

  async advance(documentId, targetStatus, options = {}) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status'],
      raw: true,
    });
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    const currentStage = doc.processing_status;

    if (currentStage && DOC_PROCESSING_SEQUENCE.includes(currentStage) && currentStage !== targetStatus) {
      await this._closeRunningStage(documentId, currentStage, 'ok', `Advanced to ${targetStatus}`);
    }

    await this.enterStage(documentId, targetStatus);
    return await Document.findByPk(documentId);
  }

  async fail(documentId, errorCode, errorMessage, options = {}) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status'],
      raw: true,
    });
    const stage = doc?.processing_status || 'unknown';

    if (stage && DOC_PROCESSING_SEQUENCE.includes(stage)) {
      await this._closeRunningStage(documentId, stage, 'nok', errorMessage || `Stage ${stage} failed`);
    }

    return await this.failStage(documentId, stage, {
      code: errorCode,
      message: errorMessage,
    });
  }

  async complete(documentId) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status'],
      raw: true,
    });
    const stage = doc?.processing_status || 'unknown';

    if (stage && DOC_PROCESSING_SEQUENCE.includes(stage)) {
      await this._closeRunningStage(documentId, stage, 'ok', 'Processing completed');
    }

    return await this.finishStage(documentId, stage, {
      nextStage: 'ready',
      message: 'Processing completed',
    });
  }

  async advanceToNext(documentId, options = {}) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status'],
      raw: true,
    });
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    const currentStage = doc.processing_status;
    const nextStatus = getNextStatus(currentStage);
    if (!nextStatus) return doc;

    if (currentStage && DOC_PROCESSING_SEQUENCE.includes(currentStage)) {
      await this._closeRunningStage(documentId, currentStage, 'ok', `Advanced to ${nextStatus}`);
    }

    await this.enterStage(documentId, nextStatus);
    return await Document.findByPk(documentId);
  }
}

export { DOC_PROCESSING_SEQUENCE, isTerminalStatus };
export default DocPipelineAdvancer;
