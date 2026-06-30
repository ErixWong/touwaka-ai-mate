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
 *
 * 审计：AUDIT-ROUND01 — 文档流水线阶段事实与运行留痕
 */

import Utils from './utils.js';
import { DOC_PROCESSING_SEQUENCE, isTerminalStatus, getNextStatus } from './doc-processing-status.js';

class DocPipelineAdvancer {
  constructor(db) {
    this.db = db;
  }

  // ============================================================
  // 内部辅助
  // ============================================================

  /**
   * 从 document 解析 revision_id
   */
  async _resolveRevisionId(documentId) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, {
      attributes: ['id', 'current_revision_id'],
      raw: true,
    });
    return doc?.current_revision_id || null;
  }

  /**
   * 关闭指定阶段的 running 记录（标记为终态）
   * 用于 stage 推进时自动收尾上一阶段的 run log
   */
  async _closeRunningStage(documentId, stage, resultStatus, message) {
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
        message: message || `Stage ${stage} completed (auto-closed by advance)`,
      }, { where: { id: run.id } });
    }
  }

  /**
   * 创建 doc_process_runs 的 start 记录，返回 runId
   */
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

  /**
   * 将指定 run 记录更新为终态
   */
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

  /**
   * 更新 documents 主表的状态字段
   */
  async _updateDocument(documentId, fields) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId);
    if (!doc) throw new Error(`Document not found: ${documentId}`);
    return await doc.update(fields);
  }

  // ============================================================
  // 新 API：统一阶段推进入口
  // ============================================================

  /**
   * 进入阶段
   *
   * - 更新 documents: processing_status / current_stage_started_at / processing_updated_at
   * - 清理 processing_error_code / processing_error_message
   * - 创建 doc_process_runs start 记录
   *
   * @param {string} documentId
   * @param {string} stage - 目标阶段（必须在 DOC_PROCESSING_SEQUENCE 中）
   * @param {object} [context]
   * @param {string} [context.revision_id] - 如已知 revision 可传入，否则从 document 解析
   * @param {string} [context.initiatedByType] - 触发来源，默认 'system'
   * @param {string} [context.initiatedById] - 触发主体 ID
   * @param {number} [context.attemptNo] - 第几次尝试，默认 1
   * @param {string} [context.message] - 运行说明
   * @param {object} [context.metadata] - 结构化上下文
   * @returns {{ documentId, stage, runId }}
   */
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

  /**
   * 阶段成功结束
   *
   * - 推进 documents 到 nextStage
   * - 更新 current_stage_started_at / processing_updated_at
   * - 将对应的 run 记录更新为 ok
   *
   * @param {string} documentId
   * @param {string} stage - 当前阶段（用于日志语义，实际推进目标是 nextStage）
   * @param {object} [result]
   * @param {string} [result.runId] - enterStage 返回的 runId
   * @param {string} [result.nextStage] - 下一阶段，默认从 processing_status 自动推断
   * @param {string} [result.message] - 结果说明
   * @param {object} [result.metadata] - 结构化结果上下文
   * @returns {{ documentId, stage, nextStage }}
   */
  async finishStage(documentId, stage, result = {}) {
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

    if (result.runId) {
      await this._finishRunRecord(
        result.runId,
        'ok',
        result.message || `Stage ${stage} completed → ${nextStage}`,
        result.metadata || null,
      );
    }

    return { documentId, stage, nextStage };
  }

  /**
   * 阶段失败
   *
   * - 设置 documents 为 error 状态
   * - 写入 processing_error_code / processing_error_message
   * - 将对应的 run 记录更新为 nok
   *
   * @param {string} documentId
   * @param {string} stage - 失败的阶段
   * @param {object} error
   * @param {string} [error.runId] - enterStage 返回的 runId
   * @param {string} [error.code] - 错误码
   * @param {string} [error.message] - 错误信息
   * @param {object} [error.metadata] - 结构化错误上下文
   * @returns {{ documentId, stage, result: 'error' }}
   */
  async failStage(documentId, stage, error = {}) {
    await this._updateDocument(documentId, {
      processing_status: 'error',
      processing_error_code: error.code || `${stage}_failed`,
      processing_error_message: error.message || null,
      processing_updated_at: new Date(),
    });

    if (error.runId) {
      await this._finishRunRecord(
        error.runId,
        'nok',
        error.message || `Stage ${stage} failed`,
        {
          ...(error.metadata || {}),
          error_code: error.code || `${stage}_failed`,
        },
      );
    }

    return { documentId, stage, result: 'error' };
  }

  /**
   * 阶段超时
   *
   * - 设置 documents 为 error 状态
   * - 错误码标记为 timeout
   * - 将对应的 run 记录更新为 nok，metadata 标记 timeout: true
   *
   * @param {string} documentId
   * @param {string} stage
   * @param {object} [context]
   * @param {string} [context.runId]
   * @param {string} [context.message]
   * @param {object} [context.metadata]
   * @returns {{ documentId, stage, result: 'timeout' }}
   */
  async timeoutStage(documentId, stage, context = {}) {
    await this._updateDocument(documentId, {
      processing_status: 'error',
      processing_error_code: `${stage}_timeout`,
      processing_error_message: context.message || `Stage ${stage} timed out`,
      processing_updated_at: new Date(),
    });

    if (context.runId) {
      await this._finishRunRecord(
        context.runId,
        'nok',
        context.message || `Stage ${stage} timed out`,
        {
          ...(context.metadata || {}),
          timeout: true,
          timeout_at: new Date().toISOString(),
        },
      );
    }

    return { documentId, stage, result: 'timeout' };
  }

  /**
   * 阶段取消
   *
   * - 设置 documents 为 error 状态
   * - 错误码标记为 cancelled
   * - 将对应的 run 记录更新为 nok，metadata 标记 cancelled: true
   *
   * @param {string} documentId
   * @param {string} stage
   * @param {object} [context]
   * @param {string} [context.runId]
   * @param {string} [context.reason] - 取消原因
   * @param {string} [context.message]
   * @param {object} [context.metadata]
   * @returns {{ documentId, stage, result: 'cancelled' }}
   */
  async cancelStage(documentId, stage, context = {}) {
    await this._updateDocument(documentId, {
      processing_status: 'error',
      processing_error_code: `${stage}_cancelled`,
      processing_error_message: context.message || `Stage ${stage} cancelled: ${context.reason || 'unknown'}`,
      processing_updated_at: new Date(),
    });

    if (context.runId) {
      await this._finishRunRecord(
        context.runId,
        'nok',
        context.message || `Stage ${stage} cancelled`,
        {
          ...(context.metadata || {}),
          cancelled: true,
          cancelled_at: new Date().toISOString(),
          cancel_reason: context.reason || null,
        },
      );
    }

    return { documentId, stage, result: 'cancelled' };
  }

  // ============================================================
  // 旧 API（向后兼容，内部委托到新 API）
  // ============================================================

  /**
   * @deprecated 使用 enterStage() 替代
   * 推进处理状态到指定阶段（自动关闭上一阶段的 running 记录）
   */
  async advance(documentId, targetStatus) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status'],
      raw: true,
    });
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    const currentStage = doc.processing_status;

    // 自动关闭当前阶段的 running 记录
    if (currentStage && DOC_PROCESSING_SEQUENCE.includes(currentStage) && currentStage !== targetStatus) {
      await this._closeRunningStage(documentId, currentStage, 'ok', `Advanced to ${targetStatus}`);
    }

    await this.enterStage(documentId, targetStatus);
    return await Document.findByPk(documentId);
  }

  /**
   * @deprecated 使用 failStage() 替代
   * 标记处理失败（自动关闭当前阶段的 running 记录）
   */
  async fail(documentId, errorCode, errorMessage) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status'],
      raw: true,
    });
    const stage = doc?.processing_status || 'unknown';

    // 自动关闭当前阶段的 running 记录
    if (stage && DOC_PROCESSING_SEQUENCE.includes(stage)) {
      await this._closeRunningStage(documentId, stage, 'nok', errorMessage || `Stage ${stage} failed`);
    }

    return await this.failStage(documentId, stage, {
      code: errorCode,
      message: errorMessage,
    });
  }

  /**
   * @deprecated 使用 finishStage() 替代
   * 标记处理完成
   */
  async complete(documentId) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status'],
      raw: true,
    });
    const stage = doc?.processing_status || 'unknown';

    // 自动关闭当前阶段的 running 记录
    if (stage && DOC_PROCESSING_SEQUENCE.includes(stage)) {
      await this._closeRunningStage(documentId, stage, 'ok', 'Processing completed');
    }

    return await this.finishStage(documentId, stage, {
      nextStage: 'ready',
      message: 'Processing completed',
    });
  }

  /**
   * @deprecated 使用 enterStage() + getNextStatus() 替代
   * 推进到状态链中的下一阶段（自动关闭当前阶段的 running 记录）
   */
  async advanceToNext(documentId) {
    const Document = this.db.getModel('document');
    const doc = await Document.findByPk(documentId, {
      attributes: ['id', 'processing_status'],
      raw: true,
    });
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    const currentStage = doc.processing_status;
    const nextStatus = getNextStatus(currentStage);
    if (!nextStatus) return doc;

    // 自动关闭当前阶段的 running 记录
    if (currentStage && DOC_PROCESSING_SEQUENCE.includes(currentStage)) {
      await this._closeRunningStage(documentId, currentStage, 'ok', `Advanced to ${nextStatus}`);
    }

    await this.enterStage(documentId, nextStatus);
    return await Document.findByPk(documentId);
  }
}

export { DOC_PROCESSING_SEQUENCE, isTerminalStatus };
export default DocPipelineAdvancer;
