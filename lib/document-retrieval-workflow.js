/**
 * Document Retrieval Workflow - 文档检索显式 workflow 层
 *
 * audit-round01 Phase 2（task-20260717-atomic-tooling-plan）：
 * 把"先试一种方式，不够再换另一种"的多步策略从胖 tool（tool-manager 三个
 * handler）正式上移到显式 workflow 层。tool-manager 收回到参数分发 + 结果
 * 标准化；chat-service 最终只消费标准化动作。
 *
 * 三个 workflow：
 *   runFindDocument   — 定位文档（metadata 先行 → 附件名兜底 → 内容桥接反查）
 *   runAnswerQuestion — 基于文档证据回答（过渡期复用 DocumentRetrievalService 作复合检索步骤）
 *   runVerifyFact     — 命题核验（复用 answer 检索核，映射 verdict）
 *
 * 标准化输出动作（审计 §8.7）：
 *   return_document_candidates        — 返回文档候选（1..N 个）
 *   answer_with_ranked_chunks         — 基于已排序证据回答
 *   ask_for_clarification             — 需要澄清
 *   decline_due_to_insufficient_evidence — 证据不足，拒绝确定性回答
 *
 * workflow 输出统一结构：
 *   {
 *     success, workflow, action,
 *     candidates | documents,            // 按 workflow 类型
 *     evidence_sufficiency, strategy, reason_codes,
 *     scoped_identity?, verdict?,        // 按 workflow 类型
 *     steps: [{ step, ...摘要 }],        // 显式步骤留痕（可审计）
 *   }
 *
 * 过渡期设计说明（写入 changelog_round01）：
 * - runAnswerQuestion 的检索核暂委托 DocumentRetrievalService.retrieve()。
 *   该复合步骤内部的 metadata→chunk 多步策略后续轮次逐步分解到原子层，
 *   本轮不重写，避免在零集成测试覆盖下重实现身份补齐/回退补充等已验证行为。
 * - runFindDocument 已完全基于原子 tool 编排（本轮迁移的主体）。
 */

import logger from './logger.js';
import DocumentAtomicTools from './document-atomic-tools.js';
import DocumentRetrievalService from './document-retrieval-service.js';
import DocAccessService from './doc-access-service.js';
import queryDecisionService from './document-query-decision-service.js';

/**
 * 标准化 workflow 输出动作
 */
export const WORKFLOW_ACTION = {
  RETURN_DOCUMENT_CANDIDATES: 'return_document_candidates',
  ANSWER_WITH_RANKED_CHUNKS: 'answer_with_ranked_chunks',
  ASK_FOR_CLARIFICATION: 'ask_for_clarification',
  DECLINE_INSUFFICIENT_EVIDENCE: 'decline_due_to_insufficient_evidence',
};

class DocumentRetrievalWorkflow {
  /**
   * @param {Object} db
   * @param {Object} configLoader
   * @param {Object} [deps={}] - 依赖注入（测试用）
   */
  constructor(db, configLoader, deps = {}) {
    this.db = db;
    this.configLoader = configLoader;
    this.atomicTools = deps.atomicTools || (db ? new DocumentAtomicTools(db, configLoader) : null);
    this.accessService = deps.accessService || (db ? new DocAccessService(db) : null);
    this.decisionService = deps.decisionService || queryDecisionService;
    // 过渡期复合检索步骤（见文件头说明）
    this.retrievalService = deps.retrievalService || (db ? new DocumentRetrievalService(db, configLoader) : null);
  }

  // ============================================================
  // 权限门（统一收口，原三个 handler 各写一遍）
  // ============================================================

  /**
   * 校验用户对指定集合的访问权（collection_id 未指定则仅返回可访问列表）
   * @returns {Promise<{allowed: boolean, accessible_ids: string[]}>}
   */
  async _checkCollectionAccess(userId, collectionId) {
    const accessibleIds = await this.accessService.getAccessibleCollectionIds(userId);
    if (!collectionId) {
      return { allowed: true, accessible_ids: accessibleIds };
    }
    return { allowed: accessibleIds.includes(collectionId), accessible_ids: accessibleIds };
  }

  // ============================================================
  // Workflow 1: find_document（本轮迁移主体，纯原子编排）
  // ============================================================

  /**
   * 定位文档 workflow
   *
   * 显式步骤：
   *   step 1  metadata 检索（标题/元数据）
   *   step 2  附件文件名兜底（原 tool-manager 内嵌 fallback，正式上移）
   *   step 3  内容桥接反查（根据内容找文档：全库 chunk → rank → resolve）
   *   step 4  单候选 supporting evidence 补充（scoped chunk 检索）
   *
   * @param {Object} params { query, user_id, collection_id, doc_types }
   * @returns {Promise<Object>} 标准化 workflow 输出
   */
  async runFindDocument(params = {}) {
    const { query, user_id, collection_id, doc_types } = params;
    const steps = [];
    const reasonCodes = [];

    if (!query || !query.trim()) {
      return this._clarifyResult('find_document', ['empty_query'], steps);
    }

    // 权限门
    const access = await this._checkCollectionAccess(user_id, collection_id);
    if (!access.allowed) {
      steps.push({ step: 'collection_access_check', allowed: false });
      return this._clarifyResult('find_document', ['collection_not_accessible'], steps);
    }

    const hints = this.decisionService.hints(query, {});
    steps.push({ step: 'hints', intent_hint: hints.intent_hint, has_anchor: hints.has_explicit_document_anchor });

    // ---- step 1: metadata 检索 ----
    let candidates = [];
    let strategy = 'metadata_search';
    const metaResult = await this.atomicTools.searchDocumentsByMetadata({
      metadata_query: query.trim(),
      user_id,
      collection_id: collection_id || undefined,
      doc_types,
      top_k: 10,
    });
    steps.push({ step: 'search_documents_by_metadata', hit: metaResult.documents?.length || 0 });
    if (metaResult.success && metaResult.documents?.length > 0) {
      candidates = metaResult.documents;
    }

    // ---- step 2: 附件文件名兜底 ----
    if (candidates.length === 0) {
      const attachResult = await this.atomicTools.searchDocumentsByMetadata({
        metadata_query: query.trim(),
        user_id,
        collection_id: collection_id || undefined,
        doc_types,
        top_k: 5,
        match_fields: ['attachment_filename'],
      });
      steps.push({ step: 'search_by_attachment_filename', hit: attachResult.documents?.length || 0 });
      if (attachResult.success && attachResult.documents?.length > 0) {
        candidates = attachResult.documents.map(doc => ({
          ...doc,
          candidate_confidence: 'low',
          identity_confidence: 'probable',
          identity_source: 'attachment_filename_match',
          match_reason: `附件文件名匹配: ${doc.matched_attachment || ''}`,
        }));
        strategy = 'attachment_filename_fallback';
        reasonCodes.push('attachment_filename_fallback');
      }
    }

    // ---- step 3: 内容桥接反查（根据内容找文档）----
    if (candidates.length === 0 && hints.content_terms.length > 0) {
      const globalChunks = await this.atomicTools.searchChunksGlobally({
        content_query: query.trim(),
        user_id,
        collection_id: collection_id || undefined,
        doc_types,
        top_k: 8,
        threshold: 0.1,
      });
      steps.push({ step: 'search_chunks_globally', hit: globalChunks.chunks?.length || 0 });

      if (globalChunks.success && globalChunks.chunks?.length > 0) {
        const ranked = this.atomicTools.rankChunksForQuestion({
          question: query.trim(),
          chunks: globalChunks.chunks,
          top_k: 8,
        });
        const resolved = await this.atomicTools.resolveDocumentsFromChunks({
          chunks: ranked.chunks,
          aggregate: true,
        });
        steps.push({ step: 'resolve_documents_from_chunks', hit: resolved.documents?.length || 0 });

        if (resolved.success && resolved.documents?.length > 0) {
          candidates = resolved.documents.slice(0, 5).map(doc => ({
            ...doc,
            relevance_score: doc.max_chunk_score || 0,
            candidate_confidence: (doc.max_chunk_score || 0) >= 0.6 ? 'high' : 'low',
            identity_confidence: 'probable',
            identity_source: 'content_bridge',
            match_reason: '内容命中反查',
          }));
          strategy = 'content_bridge';
          reasonCodes.push('content_bridge');
        }
      }
    }

    if (candidates.length === 0) {
      reasonCodes.push('no_candidates');
      return this._clarifyResult('find_document', reasonCodes, steps, { strategy });
    }

    // ---- step 4: 单候选 supporting evidence 补充 ----
    let supportingEvidence;
    const isSingleHighConf = candidates.length === 1 && candidates[0]?.candidate_confidence === 'high';
    if (candidates.length === 1) {
      const scoped = await this.atomicTools.searchChunksInDocument({
        content_query: query.trim(),
        document_ids: [candidates[0].document_id],
        user_id,
        top_k: 3,
        threshold: 0.1,
      });
      steps.push({ step: 'search_chunks_in_document', hit: scoped.chunks?.length || 0 });
      if (scoped.success && scoped.chunks?.length > 0) {
        supportingEvidence = scoped.chunks.map(c => ({
          content: (c.content || '').substring(0, 300),
          score: c.score,
        }));
      }
    }

    // 标准化候选结构
    const finalCandidates = candidates.map((doc, idx) => ({
      document_id: doc.document_id,
      document_title: doc.best_identity_label || doc.document_title_display || doc.document_title,
      document_title_raw: (doc.best_identity_label || doc.document_title_display) ? doc.document_title : undefined,
      doc_type: doc.doc_type,
      collection_name: doc.collection_name,
      relevance_score: doc.relevance_score ?? 0,
      candidate_confidence: doc.candidate_confidence || 'low',
      identity_confidence: doc.identity_confidence || 'unknown',
      identity_source: doc.identity_source || 'search_match',
      best_identity_label: doc.best_identity_label,
      identity_label_source: doc.identity_label_source,
      attachment_filenames: doc.attachment_filenames,
      match_reason: doc.match_reason || (doc.candidate_confidence === 'high' ? '关键词匹配' : '语义相似'),
      supporting_evidence: (idx === 0 && isSingleHighConf) ? supportingEvidence : undefined,
    }));

    const result = {
      success: true,
      workflow: 'find_document',
      action: WORKFLOW_ACTION.RETURN_DOCUMENT_CANDIDATES,
      strategy,
      candidates: finalCandidates,
      total_candidates: finalCandidates.length,
      evidence_sufficiency: supportingEvidence?.length > 0 ? 'medium' : 'none',
      reason_codes: reasonCodes,
      steps,
    };

    logger.info('[DocWorkflow] find_document completed:', {
      action: result.action,
      strategy,
      candidate_count: finalCandidates.length,
      steps: steps.map(s => s.step),
    });
    return result;
  }

  // ============================================================
  // Workflow 2: answer_question
  // ============================================================

  /**
   * 基于文档证据回答问题 workflow
   *
   * 过渡期：检索核委托 DocumentRetrievalService.retrieve()（复合步骤），
   * workflow 负责权限门 + packet → 标准化动作映射。
   *
   * @param {Object} params { query, user_id, collection_id, doc_types }
   * @returns {Promise<Object>} 标准化 workflow 输出
   */
  async runAnswerQuestion(params = {}) {
    const { query, user_id, collection_id, doc_types } = params;
    const steps = [];

    if (!query || !query.trim()) {
      return this._clarifyResult('answer_question', ['empty_query'], steps);
    }

    const access = await this._checkCollectionAccess(user_id, collection_id);
    if (!access.allowed) {
      steps.push({ step: 'collection_access_check', allowed: false });
      return {
        ...this._clarifyResult('answer_question', ['collection_not_accessible'], steps),
        action: WORKFLOW_ACTION.DECLINE_INSUFFICIENT_EVIDENCE,
        documents: [],
      };
    }

    // 过渡期复合检索步骤（内部为 decision → metadata search → scoped recall → pack → fallback）
    const result = await this.retrievalService.retrieve(query.trim(), {
      userId: user_id,
      doc_types: doc_types?.length > 0 ? doc_types : undefined,
      collection_id: collection_id || undefined,
      top_k_candidates: 10,
      top_k_evidence: 5,
      evidence_threshold: 0.1,
      allow_fallback: true,
    });
    const packet = result.packet;
    steps.push({
      step: 'composite_retrieve',
      strategy: result.strategy,
      doc_count: packet?.documents?.length || 0,
      evidence_count: packet?.meta?.total_evidence || 0,
    });

    const action = this._mapPacketToAction(packet);
    const scopedConfirmed = packet?.meta?.scoped_identity_confirmed || false;

    const response = {
      success: true,
      workflow: 'answer_question',
      action,
      strategy: result.strategy,
      evidence_sufficiency: packet?.meta?.evidence_sufficiency || 'none',
      reason_codes: packet?.meta?.reason_codes || [],
      should_clarify: packet?.meta?.should_clarify || false,
      should_answer_conservatively: packet?.meta?.should_answer_conservatively || false,
      suggested_response_mode: packet?.meta?.suggested_response_mode || 'conservative_answer',
      scoped_identity: scopedConfirmed ? {
        confirmed: true,
        document_id: packet.meta.scoped_document_id,
        identity_label: packet.meta.scoped_identity_label,
        identity_source: packet.meta.scoped_identity_source,
        hint: '文档身份已通过 chunk 命中确认。如需了解更多文档元信息（完整标题、版本、附件名等），请直接使用已知的 document_id 查询，无需重新发起全局文档搜索。',
      } : { confirmed: false },
      documents: (packet?.documents || []).map(doc => ({
        document_id: doc.document_id,
        document_title: doc.document_title_display || doc.document_title,
        document_title_raw: doc.document_title_display ? doc.document_title : undefined,
        doc_type: doc.doc_type,
        collection_name: doc.collection_name,
        relevance_score: doc.relevance_score,
        candidate_confidence: doc.candidate_confidence,
        identity_confidence: doc.identity_confidence || 'unknown',
        identity_source: doc.identity_source || 'inferred',
        best_identity_label: doc.best_identity_label,
        identity_label_source: doc.identity_label_source,
        attachment_filenames: doc.attachment_filenames,
        evidence_count: doc.evidence?.length || 0,
        top_evidence: (doc.evidence || []).slice(0, 3).map(ev => ({
          content: ev.content?.substring(0, 500) || '',
          score: ev.score,
        })),
      })),
      steps,
    };

    logger.info('[DocWorkflow] answer_question completed:', {
      action,
      strategy: result.strategy,
      evidence_sufficiency: response.evidence_sufficiency,
      doc_count: response.documents.length,
    });
    return response;
  }

  // ============================================================
  // Workflow 3: verify_fact
  // ============================================================

  /**
   * 命题核验 workflow（复用 answer 检索核，映射 verdict）
   *
   * @param {Object} params { query, user_id, collection_id, doc_types }
   * @returns {Promise<Object>} 标准化 workflow 输出（含 verdict）
   */
  async runVerifyFact(params = {}) {
    const core = await this.runAnswerQuestion(params);

    const sufficiency = core.evidence_sufficiency || 'none';
    const verdict = (sufficiency === 'strong' || sufficiency === 'medium')
      ? 'supported'
      : 'insufficient_evidence';

    // 收集支持证据（当前不支持 contradicted 判定，能力诚实性声明保留）
    const supportingEvidence = [];
    if (verdict === 'supported') {
      for (const doc of (core.documents || [])) {
        for (const ev of (doc.top_evidence || [])) {
          supportingEvidence.push({
            content: ev.content,
            document_id: doc.document_id,
            document_title: doc.document_title,
            score: ev.score,
          });
        }
      }
    }

    return {
      ...core,
      workflow: 'verify_fact',
      action: verdict === 'supported'
        ? WORKFLOW_ACTION.ANSWER_WITH_RANKED_CHUNKS
        : WORKFLOW_ACTION.DECLINE_INSUFFICIENT_EVIDENCE,
      verdict,
      contradicted_available: false,
      supporting_evidence: supportingEvidence.slice(0, 5),
      contradicting_evidence: [],
      related_documents: (core.documents || []).map(d => ({
        document_id: d.document_id,
        document_title: d.document_title,
      })),
    };
  }

  // ============================================================
  // 内部：动作映射与通用结果
  // ============================================================

  /**
   * packet → 标准化动作映射（最小状态模型收敛的第一步）
   *
   * 映射规则：
   * - suggested_response_mode candidate_list → return_document_candidates
   * - clarify → ask_for_clarification
   * - conservative_answer 且完全无证据 → decline_due_to_insufficient_evidence
   * - 其余（含弱证据 conservative / answer_with_citation / direct_answer）→ answer_with_ranked_chunks
   */
  _mapPacketToAction(packet) {
    const mode = packet?.meta?.suggested_response_mode || 'conservative_answer';
    const totalEvidence = packet?.meta?.total_evidence || 0;
    const docCount = packet?.documents?.length || 0;

    if (mode === 'candidate_list') return WORKFLOW_ACTION.RETURN_DOCUMENT_CANDIDATES;
    if (mode === 'clarify') return WORKFLOW_ACTION.ASK_FOR_CLARIFICATION;
    if (mode === 'conservative_answer' && totalEvidence === 0 && docCount === 0) {
      return WORKFLOW_ACTION.DECLINE_INSUFFICIENT_EVIDENCE;
    }
    return WORKFLOW_ACTION.ANSWER_WITH_RANKED_CHUNKS;
  }

  /**
   * 通用澄清结果
   */
  _clarifyResult(workflow, reasonCodes, steps, extra = {}) {
    return {
      success: true,
      workflow,
      action: WORKFLOW_ACTION.ASK_FOR_CLARIFICATION,
      strategy: extra.strategy || 'none',
      candidates: [],
      total_candidates: 0,
      evidence_sufficiency: 'none',
      reason_codes: reasonCodes,
      should_clarify: true,
      steps,
      ...extra,
    };
  }
}

export default DocumentRetrievalWorkflow;
