/**
 * Document Evidence Packer - 文档证据打包器
 *
 * 在文档检索链路中作为第四层，负责：
 * - 将候选文档 + chunk 证据统一打包为稳定的 evidence packet
 * - 为上游消费者（专家编排、回答生成）提供标准化的数据结构
 * - 维护文档身份信息与证据内容的关联关系
 *
 * evidence packet 结构说明：
 * ```
 * {
 *   trace_id: string,           // 链路追踪ID
 *   strategy: string,           // 检索策略标识
 *   decision: object,           // 查询决策结果
 *   documents: [                // 候选文档列表（含证据）
 *     {
 *       document_id: string,
 *       document_title: string,
 *       doc_type: string,
 *       collection_id: string,
 *       collection_name: string,
 *       revision_no: number,
 *       relevance_score: number,
 *       candidate_confidence: string,    // 'high' | 'low'
 *       is_heuristic_fallback: boolean,  // 是否为启发式回退候选
 *       evidence: [             // 该文档内的 chunk 证据
 *         {
 *           chunk_id: string,
 *           content: string,
 *           score: number,
 *           outline_id: string,
 *           seq: number,
 *         }
 *       ]
 *     }
 *   ],
 *   meta: {
 *     total_candidates: number,
 *     total_evidence: number,
 *     max_evidence_score: number,
 *     fallback_triggered: boolean,
 *     reason_codes: string[],
 *     evidence_sufficiency: 'strong' | 'medium' | 'weak' | 'none',
 *     should_clarify: boolean,              // 是否应向用户澄清问题
 *     should_answer_conservatively: boolean, // 是否应保守回答
 *     suggested_response_mode: string,       // 建议的回答模式
 *   }
 * }
 *
 * suggested_response_mode 取值：
 * - direct_answer: 证据充分，可直接回答
 * - answer_with_citation: 有明确文档来源，回答时应引用出处
 * - candidate_list: 多候选文档冲突，应列出候选供用户确认
 * - clarify: 意图模糊或锚点不足，应澄清问题
 * - conservative_answer: 证据不足，应保守回答并说明依据有限
 * ```
 *
 * 使用方式：
 *   const packer = new DocumentEvidencePacker();
 *   const packet = packer.pack(candidates, evidenceItems, decision, traceId);
 */

import logger from './logger.js';

class DocumentEvidencePacker {
  /**
   * 打包证据
   *
   * @param {Object[]} candidates - DocumentSearchService 返回的候选文档列表
   * @param {Object[]} evidenceItems - DocRecallService 返回的 evidence items
   * @param {Object} decision - DocumentQueryDecisionService 返回的决策对象
   * @param {string} traceId - 链路追踪ID
   * @param {Object} [options={}] - 打包选项
   * @param {number} [options.maxEvidencePerDoc=5] - 每个文档最多保留的 evidence 条数
   * @param {number} [options.minEvidenceScore=0] - evidence 最低分数阈值
   * @returns {Object} evidence packet
   */
  pack(candidates, evidenceItems, decision, traceId, options = {}) {
    const {
      maxEvidencePerDoc = 5,
      minEvidenceScore = 0,
    } = options;

    const packet = {
      trace_id: traceId || this._generateTraceId(),
      strategy: 'document_first',
      decision: decision ? this._compactDecision(decision) : null,
      documents: [],
      meta: {
        total_candidates: candidates?.length || 0,
        total_evidence: 0,
        max_evidence_score: 0,
        fallback_triggered: false,
        reason_codes: [],
      },
    };

    // 1. 构建 document_id -> candidate 的索引
    const candidateMap = new Map();
    if (candidates && candidates.length > 0) {
      for (const c of candidates) {
        candidateMap.set(c.document_id, c);
      }
    }

    // 2. 按文档分组 evidence
    const evidenceByDoc = new Map();
    if (evidenceItems && evidenceItems.length > 0) {
      for (const item of evidenceItems) {
        const docId = item.document?.id;
        if (!docId) continue;

        if (!evidenceByDoc.has(docId)) {
          evidenceByDoc.set(docId, []);
        }
        evidenceByDoc.get(docId).push(item);
      }
    }

    // 3. 合并候选文档和 evidence
    const allDocIds = new Set([
      ...candidateMap.keys(),
      ...evidenceByDoc.keys(),
    ]);

    for (const docId of allDocIds) {
      const candidate = candidateMap.get(docId) || {};
      const docEvidence = evidenceByDoc.get(docId) || [];

      // 过滤和排序 evidence
      const filteredEvidence = docEvidence
        .filter(e => (e.score || 0) >= minEvidenceScore)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, maxEvidencePerDoc)
        .map(e => ({
          chunk_id: e.chunk?.id || null,
          content: e.chunk?.content || '',
          score: e.score || 0,
          outline_id: e.chunk?.outline_id || null,
          seq: e.chunk?.seq || null,
        }));

      const docEntry = {
        document_id: docId,
        document_title: candidate.document_title || '',
        doc_type: candidate.doc_type || '',
        collection_id: candidate.collection_id || '',
        collection_name: candidate.collection_name || '',
        revision_no: candidate.revision_no || null,
        relevance_score: candidate.relevance_score || 0,
        candidate_confidence: candidate.candidate_confidence || (candidate.is_heuristic_fallback ? 'low' : 'high'),
        is_heuristic_fallback: candidate.is_heuristic_fallback || false,
        evidence: filteredEvidence,
      };

      packet.documents.push(docEntry);
      packet.meta.total_evidence += filteredEvidence.length;

      // 记录最高 evidence 分数
      if (filteredEvidence.length > 0) {
        packet.meta.max_evidence_score = Math.max(
          packet.meta.max_evidence_score,
          filteredEvidence[0].score
        );
      }
    }

    // 4. 按 relevance_score 排序文档
    packet.documents.sort((a, b) => b.relevance_score - a.relevance_score);

    // 5. 记录回退信息
    if (candidates && candidates.length > 0 && (candidates[0].is_heuristic_fallback || candidates[0].is_fallback)) {
      packet.meta.fallback_triggered = true;
      packet.meta.reason_codes.push('fallback_latest_by_type');
    }

    if (decision?.reason_codes) {
      packet.meta.reason_codes.push(...decision.reason_codes);
    }

    // 6. 评估证据充分性
    packet.meta.evidence_sufficiency = this._assessSufficiency(packet);

    // 7. 推导回答模式建议
    const responseMode = this._deriveResponseMode(packet);
    packet.meta.should_clarify = responseMode.should_clarify;
    packet.meta.should_answer_conservatively = responseMode.should_answer_conservatively;
    packet.meta.suggested_response_mode = responseMode.mode;

    logger.info('[DocEvidencePacker] Packet built:', {
      trace_id: packet.trace_id,
      doc_count: packet.documents.length,
      evidence_count: packet.meta.total_evidence,
      max_score: packet.meta.max_evidence_score,
      sufficiency: packet.meta.evidence_sufficiency,
      response_mode: packet.meta.suggested_response_mode,
    });

    return packet;
  }

  /**
   * 打包空结果（用于无候选或无证据场景）
   */
  packEmpty(decision, traceId, reasonCode = 'no_results') {
    return {
      trace_id: traceId || this._generateTraceId(),
      strategy: 'document_first',
      decision: decision ? this._compactDecision(decision) : null,
      documents: [],
      meta: {
        total_candidates: 0,
        total_evidence: 0,
        max_evidence_score: 0,
        fallback_triggered: false,
        reason_codes: [reasonCode],
        evidence_sufficiency: 'none',
        should_clarify: true,
        should_answer_conservatively: true,
        suggested_response_mode: 'conservative_answer',
      },
    };
  }

  /**
   * 打包回退结果（chunk-first 回退）
   */
  packFallback(evidenceItems, decision, traceId) {
    const packet = this.pack([], evidenceItems, decision, traceId);
    packet.strategy = 'chunk_first_fallback';
    packet.meta.fallback_triggered = true;
    packet.meta.reason_codes.push('fallback_to_chunk_first');
    return packet;
  }

  /**
   * 评估证据充分性
   */
  _assessSufficiency(packet) {
    if (packet.meta.total_evidence === 0) return 'none';
    if (packet.meta.max_evidence_score >= 0.8 && packet.meta.total_evidence >= 3) return 'strong';
    if (packet.meta.max_evidence_score >= 0.6 && packet.meta.total_evidence >= 1) return 'medium';
    return 'weak';
  }

  /**
   * 推导回答模式建议
   *
   * 根据 evidence packet 的状态，推导出建议的回答模式。
   * 这是检索层向回答层传递的结构化建议，不替代回答层的最终决策。
   *
   * @param {Object} packet - evidence packet
   * @returns {{ mode: string, should_clarify: boolean, should_answer_conservatively: boolean }}
   */
  _deriveResponseMode(packet) {
    const sufficiency = packet.meta.evidence_sufficiency;
    const docCount = packet.documents.length;
    const decision = packet.decision;

    // 意图不明确 → 澄清
    if (decision?.recommended_strategy === 'clarify') {
      return {
        mode: 'clarify',
        should_clarify: true,
        should_answer_conservatively: false,
      };
    }

    // 无证据 → 保守回答
    if (sufficiency === 'none') {
      return {
        mode: 'conservative_answer',
        should_clarify: true,
        should_answer_conservatively: true,
      };
    }

    // 弱证据 → 保守回答
    if (sufficiency === 'weak') {
      return {
        mode: 'conservative_answer',
        should_clarify: false,
        should_answer_conservatively: true,
      };
    }

    // 多候选文档且置信度分散 → 列候选
    if (docCount >= 3) {
      const highConfDocs = packet.documents.filter(
        d => d.candidate_confidence === 'high' && d.evidence?.length > 0
      );
      // 多个高置信度文档 → 可能存在冲突，列出候选
      if (highConfDocs.length >= 2) {
        return {
          mode: 'candidate_list',
          should_clarify: false,
          should_answer_conservatively: false,
        };
      }
    }

    // 有明确文档来源 → 引用回答
    if (sufficiency === 'strong' || sufficiency === 'medium') {
      return {
        mode: 'answer_with_citation',
        should_clarify: false,
        should_answer_conservatively: false,
      };
    }

    // 默认：直接回答（证据单薄但可用）
    return {
      mode: 'direct_answer',
      should_clarify: false,
      should_answer_conservatively: false,
    };
  }

  /**
   * 精简决策对象，去除冗余字段
   */
  _compactDecision(decision) {
    return {
      intent: decision.intent,
      anchor_strength: decision.anchor_strength,
      confidence: decision.confidence,
      recommended_strategy: decision.recommended_strategy,
      reason_codes: decision.reason_codes,
    };
  }

  /**
   * 生成链路追踪ID
   */
  _generateTraceId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `dev_${ts}_${rand}`;
  }
}

export default DocumentEvidencePacker;
