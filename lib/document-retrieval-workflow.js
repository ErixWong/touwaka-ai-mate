/**
 * Document Retrieval Workflow - 文档检索显式 workflow 层
 *
 * audit-round01 Phase 2 / audit-round02 变更项 A+B（task-20260717-atomic-tooling-plan）：
 * 把"先试一种方式，不够再换另一种"的多步策略从胖 tool（tool-manager 三个
 * handler）正式上移到显式 workflow 层。tool-manager 收回到参数分发 + 结果
 * 标准化；chat-service 最终只消费标准化动作。
 *
 * 三个 workflow：
 *   runFindDocument   — 定位文档（metadata 先行 → 附件名兜底 → 内容桥接反查）
 *   runAnswerQuestion — 基于文档证据回答（已从旧复合检索迁出，显式原子编排）
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
 * audit-round02 变更项 A（runAnswerQuestion 去复合检索）：
 * - runAnswerQuestion 已不再委托 DocumentRetrievalService.retrieve()，
 *   改为显式编排 6 步：decision → metadata_search → [chunk_fallback]
 *   → scoped_recall → evidence_packing → action_mapping。
 * - DocumentEvidencePacker 保留为内部 helper，但其输入输出在 steps[] 中可见。
 * - DocumentRetrievalService 保留但仅用于向后兼容；workflow 主链不再依赖它。
 *
 * audit-round02 变更项 B（状态模型收敛）：
 * - workflow_action 是唯一主动作信号，suggested_response_mode 降级为兼容字段。
 * - 新增状态字段映射文档（见文件末尾 §State Model）。
 */

import logger from './logger.js';
import DocumentAtomicTools from './document-atomic-tools.js';
import DocumentEvidencePacker from './document-evidence-packer.js';
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
    // 证据打包器保留为内部 helper（audit-round02 变更项 A：packer 不再藏在 retrieve() 黑盒内）
    this.packer = deps.packer || new DocumentEvidencePacker();
    // audit-round03 变更项 E：retrievalService 已从主链完全退出，不再保留
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
  // Workflow 2: answer_question（audit-round02 变更项 A：从旧复合检索迁出）
  // ============================================================

  /**
   * 基于文档证据回答问题 workflow
   *
   * 显式步骤（6 步，替代旧 DocumentRetrievalService.retrieve() 黑盒）：
   *   step 1  decision — 查询意图分析
   *   step 2  metadata_search — 文档级候选检索
   *   step 3  chunk_fallback — 无候选时全局 chunk 回退
   *   step 4  scoped_recall — 候选文档内 chunk 证据召回
   *   step 5  evidence_packing — 证据打包（DocumentEvidencePacker helper）
   *   step 6  action_mapping — packet → 标准化动作映射
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

    // ---- step 1: decision（查询意图分析）----
    const decision = this.decisionService.analyze(query.trim(), {});
    const hints = this.decisionService.hints(query.trim(), {});
    steps.push({
      step: 'decision',
      recommended_strategy: decision.recommended_strategy,
      intent: decision.intent,
      has_anchor: hints.has_explicit_document_anchor,
    });

    // 如果决策建议澄清（ambiguous + 无锚点），提前返回
    if (decision.recommended_strategy === 'clarify') {
      return this._buildAnswerResponse({
        packet: this.packer.packEmpty(decision, this._traceId(), 'ambiguous_query', 'degrade'),
        strategy: 'degrade',
        steps,
      });
    }

    // ---- step 2: metadata_search（文档级候选检索）----
    let candidates = [];
    let strategy = 'document_first';
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

    // ---- step 3: chunk_fallback（无候选时全局 chunk 回退）----
    if (candidates.length === 0) {
      strategy = 'chunk_first_fallback';
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
        const resolved = await this.atomicTools.resolveDocumentsFromChunks({
          chunks: globalChunks.chunks,
          aggregate: true,
        });
        steps.push({ step: 'resolve_documents_from_chunks', hit: resolved.documents?.length || 0 });

        if (resolved.success && resolved.documents?.length > 0) {
          candidates = resolved.documents.map(doc => ({
            document_id: doc.document_id,
            document_title: doc.document_title,
            doc_type: doc.doc_type,
            collection_id: doc.collection_id,
            collection_name: doc.collection_name,
            relevance_score: doc.max_chunk_score || 0,
            candidate_confidence: (doc.max_chunk_score || 0) >= 0.6 ? 'high' : 'low',
          }));
        }
      }

      // 回退也无结果 → 降级
      if (candidates.length === 0) {
        return this._buildAnswerResponse({
          packet: this.packer.packEmpty(decision, this._traceId(), 'no_candidates', 'degrade'),
          strategy: 'degrade',
          steps,
        });
      }
    }

    // ---- step 4: scoped_recall（候选文档内 chunk 证据召回）----
    let evidenceItems = [];
    if (candidates.length > 0) {
      const docIds = candidates.map(c => c.document_id);
      const scopedResult = await this.atomicTools.searchChunksInDocument({
        content_query: query.trim(),
        document_ids: docIds,
        user_id,
        top_k: 5,
        threshold: 0.1,
      });
      steps.push({ step: 'search_chunks_in_document', hit: scopedResult.chunks?.length || 0 });

      if (scopedResult.success && scopedResult.chunks?.length > 0) {
        evidenceItems = scopedResult.chunks;
      }
    }

    // ---- step 5: evidence_packing（证据打包，packer 作为内部 helper）----
    // 将原子 chunk 契约转换为 packer 兼容格式
    const packerItems = evidenceItems.map(chunk => ({
      chunk: { id: chunk.chunk_id, content: chunk.content, outline_id: chunk.outline_id, seq: chunk.seq },
      document: { id: chunk.document_id, document_title: chunk.document_title, doc_type: chunk.doc_type, document_collection_id: chunk.collection_id, revision_no: chunk.revision_id },
      score: chunk.score,
    }));

    const traceId = this._traceId();
    const packet = this.packer.pack(
      candidates,
      packerItems,
      decision,
      traceId,
      { maxEvidencePerDoc: 5, minEvidenceScore: 0.1 }
    );
    steps.push({
      step: 'evidence_packing',
      total_evidence: packet.meta.total_evidence,
      max_score: packet.meta.max_evidence_score,
      sufficiency: packet.meta.evidence_sufficiency,
      response_mode: packet.meta.suggested_response_mode,
    });

    // ---- step 6: action_mapping ----（packet → 标准化动作映射）
    return this._buildAnswerResponse({ packet, strategy, steps, traceId });
  }

  /**
   * 构建 answer_question 标准化响应（audit-round02 变更项 A：抽取公共响应构造逻辑）
   */
  _buildAnswerResponse({ packet, strategy, steps, traceId }) {
    const action = this._mapPacketToAction(packet);
    const scopedConfirmed = packet?.meta?.scoped_identity_confirmed || false;

    const response = {
      success: true,
      workflow: 'answer_question',
      action,
      strategy,
      evidence_sufficiency: packet?.meta?.evidence_sufficiency || 'none',
      reason_codes: packet?.meta?.reason_codes || [],
      should_clarify: packet?.meta?.should_clarify || false,
      should_answer_conservatively: packet?.meta?.should_answer_conservatively || false,
      // suggested_response_mode 降级为兼容字段（audit-round02 变更项 B）
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
      strategy,
      evidence_sufficiency: response.evidence_sufficiency,
      doc_count: response.documents.length,
      steps: steps.map(s => s.step),
    });
    return response;
  }

  _traceId() {
    return `wf_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
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
   * packet → 标准化动作映射（audit-round02 变更项 B：状态模型收敛）
   *
   * 映射优先级：evidence_sufficiency > doc_count > mode（优先使用客观指标，mode 仅作兜底）
   *
   *   证据充分性状态   | 文档数 | → 动作
   *   -----------------|--------|------
   *   strong/medium    | ≥1     | answer_with_ranked_chunks
   *   weak             | ≥3     | return_document_candidates（多候选冲突）
   *   weak             | 1-2    | answer_with_ranked_chunks（可用但弱）
   *   none             | 0      | decline_due_to_insufficient_evidence
   *   -                | -      | clarify / decline（由 mode 兜底）
   */
  _mapPacketToAction(packet) {
    const mode = packet?.meta?.suggested_response_mode || 'conservative_answer';
    const sufficiency = packet?.meta?.evidence_sufficiency || 'none';
    const totalEvidence = packet?.meta?.total_evidence || 0;
    const docCount = packet?.documents?.length || 0;

    // 优先基于客观充分性判断
    if (sufficiency === 'strong' || sufficiency === 'medium') {
      return WORKFLOW_ACTION.ANSWER_WITH_RANKED_CHUNKS;
    }
    if (sufficiency === 'weak' && docCount >= 3) {
      return WORKFLOW_ACTION.RETURN_DOCUMENT_CANDIDATES;
    }
    if (sufficiency === 'weak' && docCount >= 1) {
      return WORKFLOW_ACTION.ANSWER_WITH_RANKED_CHUNKS;
    }
    if (sufficiency === 'none' && docCount === 0) {
      return WORKFLOW_ACTION.DECLINE_INSUFFICIENT_EVIDENCE;
    }

    // mode 兜底（兼容旧 suggested_response_mode）
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

// ============================================================
// 状态模型收敛文档（audit-round02 变更项 B）
// ============================================================
//
// 三层状态体系：
//
// ┌──────────────────────────────────────────────────────┐
// │ L1: 检索策略状态 (strategy)                          │
// │   document_first | chunk_first_fallback | degrade    │
// │   含义：本次检索走的是哪条路径                        │
// ├──────────────────────────────────────────────────────┤
// │ L2: 证据充分性状态 (evidence_sufficiency)             │
// │   strong | medium | weak | none                      │
// │   含义：证据的客观质量评估                            │
// ├──────────────────────────────────────────────────────┤
// │ L3: 回答动作状态 (action / WORKFLOW_ACTION)           │
// │   return_document_candidates                         │
// │   answer_with_ranked_chunks                          │
// │   ask_for_clarification                              │
// │   decline_due_to_insufficient_evidence                │
// │   含义：上游消费者（tool-manager/chat-service）应执行的│
// │         最终动作。这是唯一主动作信号。                 │
// └──────────────────────────────────────────────────────┘
//
// 兼容字段（仅保留用于下游过渡，不应在新代码中作为主分支判断依据）：
//   suggested_response_mode — 旧 answer mode（clarify/candidate_list/...）
//     映射关系：L3 action 为主，mode 仅作降级参考
//   should_clarify / should_answer_conservatively — 旧布尔标记
//     这些状态已编码到 L3 action 中，保留布尔字段仅用于兼容
//   reason_codes — 诊断码数组（主动作 + 附加信号）
//
// 状态新增规则（audit-round02 §9.4）：
//   新增任何状态字段前必须回答：
//   1. 属于 L1/L2/L3 哪一层？
//   2. 是否与已有字段重复语义？
//   3. 是否只是兼容字段，未来是否可删除？

export default DocumentRetrievalWorkflow;
