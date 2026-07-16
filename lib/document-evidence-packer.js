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
   * @param {Object} [options.queryFacets] - audit-round01 P0-2: 查询切面，用于 coverage 评估
   * @returns {Object} evidence packet
   */
  pack(candidates, evidenceItems, decision, traceId, options = {}) {
    const {
      maxEvidencePerDoc = 5,
      minEvidenceScore = 0,
      strategy = 'document_first',
      queryFacets = null,
    } = options;

    const packet = {
      trace_id: traceId || this._generateTraceId(),
      strategy,
      decision: decision ? this._compactDecision(decision) : null,
      documents: [],
      meta: {
        total_candidates: candidates?.length || 0,
        total_evidence: 0,
        max_evidence_score: 0,
        fallback_triggered: false,
        backfill_triggered: false,
        backfill_doc_count: 0,
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
    const allDocIds = candidateMap.size > 0
      ? new Set([...candidateMap.keys()])
      : new Set([...evidenceByDoc.keys()]);

    for (const docId of allDocIds) {
      const candidate = candidateMap.get(docId) || {};
      const docEvidence = evidenceByDoc.get(docId) || [];

      // identity 回补：当 candidate 缺失时，从 evidence item 的 document 字段提取身份信息
      const firstEvidenceItem = docEvidence[0];
      const evDoc = firstEvidenceItem?.document;
      const hasCandidate = !!candidateMap.get(docId);
      const identityBackfilled = !hasCandidate && !!evDoc;

      if (identityBackfilled) {
        packet.meta.backfill_triggered = true;
        packet.meta.backfill_doc_count++;
      }

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

      // identity_confidence 判定
      let identityConfidence = 'unknown';
      let identitySource = 'inferred';
      if (hasCandidate && candidate.candidate_confidence === 'high') {
        identityConfidence = 'confirmed';
        identitySource = 'search_match';
      } else if (hasCandidate) {
        identityConfidence = 'probable';
        identitySource = candidate.is_heuristic_fallback ? 'fallback' : 'search_match';
      } else if (identityBackfilled) {
        identityConfidence = 'probable';
        identitySource = 'evidence_backfill';
      }

      const resolvedCandidateConfidence = this._resolveCandidateConfidence(candidate, filteredEvidence, identityBackfilled);

      const docEntry = {
        document_id: docId,
        document_title: candidate.document_title || evDoc?.document_title || '',
        doc_type: candidate.doc_type || evDoc?.doc_type || '',
        collection_id: candidate.collection_id || evDoc?.document_collection_id || '',
        collection_name: candidate.collection_name || '',
        revision_no: candidate.revision_no || evDoc?.revision_no || null,
        relevance_score: candidate.relevance_score || 0,
        candidate_confidence: resolvedCandidateConfidence,
        is_heuristic_fallback: candidate.is_heuristic_fallback || false,
        identity_confidence: identityConfidence,
        identity_source: identitySource,
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

    // 6.5 audit-round01 P0-2: 评估证据覆盖度
    const coverage = this._assessCoverage(packet, queryFacets);
    packet.meta.coverage_status = coverage.status;
    packet.meta.coverage_reason_codes = coverage.reason_codes;

    const parameterClosure = this._detectParameterEvidenceClosure(packet, queryFacets);
    packet.meta.parameter_evidence_closure = parameterClosure.matched;
    packet.meta.parameter_evidence_closure_reason_codes = parameterClosure.reasons;
    if (parameterClosure.matched) {
      packet.meta.reason_codes.push(...parameterClosure.reasons);
    }

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
      coverage: packet.meta.coverage_status,
      response_mode: packet.meta.suggested_response_mode,
      backfill_triggered: packet.meta.backfill_triggered,
      backfill_doc_count: packet.meta.backfill_doc_count,
    });

    return packet;
  }

  /**
   * 打包空结果（用于无候选或无证据场景）
   */
  packEmpty(decision, traceId, reasonCode = 'no_results', strategy = 'degrade') {
    return {
      trace_id: traceId || this._generateTraceId(),
      strategy,
      decision: decision ? this._compactDecision(decision) : null,
      documents: [],
      meta: {
        total_candidates: 0,
        total_evidence: 0,
        max_evidence_score: 0,
        fallback_triggered: false,
        backfill_triggered: false,
        backfill_doc_count: 0,
        reason_codes: [reasonCode],
        evidence_sufficiency: 'none',
        coverage_status: 'not_covered',
        coverage_reason_codes: ['no_evidence'],
        should_clarify: true,
        should_answer_conservatively: true,
        suggested_response_mode: 'conservative_answer',
      },
    };
  }

  /**
   * 打包回退结果（chunk-first 回退）
   */
  packFallback(evidenceItems, decision, traceId, candidates = []) {
    const packet = this.pack(candidates, evidenceItems, decision, traceId, {
      strategy: 'chunk_first_fallback',
    });
    packet.meta.fallback_triggered = true;
    packet.meta.reason_codes.push('fallback_to_chunk_first');
    return packet;
  }

  /**
   * audit-round01 P0-2 & audit-round02 P1-1: 评估证据覆盖度（chunk 级）
   *
   * 检查已命中的 evidence 是否真正覆盖用户问题的核心对象，
   * 而不只是同章相邻内容。与 _assessSufficiency 正交：
   * - sufficiency 回答"证据够不够多/够不够高"
   * - coverage 回答"证据有没有覆盖到问题核心对象"
   *
   * audit-round02 P1-1: 从全文拼接升级为 chunk 级命中跟踪，
   * 避免跨 chunk 误拼接导致的伪 covered。
   *
   * @param {Object} packet - evidence packet
   * @param {Object|null} queryFacets - 查询切面 { entity_terms, procedure_terms }
   * @returns {{ status: string, reason_codes: string[], entity_chunk_hits: Object, procedure_chunk_hits: Object }}
   */
  _assessCoverage(packet, queryFacets) {
    const entityTerms = queryFacets?.entity_terms || [];
    const procedureTerms = queryFacets?.procedure_terms || [];
    const reasonCodes = [];

    // 无 facets → 无法评估覆盖，默认 partial
    if (entityTerms.length === 0 && procedureTerms.length === 0) {
      return { status: 'not_evaluated', reason_codes: ['no_facets_available'], entity_chunk_hits: {}, procedure_chunk_hits: {} };
    }

    // 无证据 → 直接 not_covered
    if (packet.meta.total_evidence === 0) {
      return { status: 'not_covered', reason_codes: ['no_evidence'], entity_chunk_hits: {}, procedure_chunk_hits: {} };
    }

    // audit-round02 P1-1: chunk 级命中跟踪
    // 收集每条 evidence 的 chunk_id 和 content
    const evidenceEntries = packet.documents
      .flatMap(d => (d.evidence || []).map(e => ({
        chunk_id: e.chunk_id || `unknown_${d.document_id}`,
        content: (e.content || '').toLowerCase(),
        document_id: d.document_id,
      })));

    // entity_chunk_hits: { entity_term -> Set<chunk_id> }
    const entityChunkHits = {};
    for (const et of entityTerms) {
      const etLower = et.toLowerCase();
      const hitChunks = new Set();
      for (const entry of evidenceEntries) {
        if (entry.content.includes(etLower)) {
          hitChunks.add(entry.chunk_id);
        }
      }
      entityChunkHits[et] = [...hitChunks];
    }

    // procedure_chunk_hits: { procedure_term -> Set<chunk_id> }
    const procedureChunkHits = {};
    for (const pt of procedureTerms) {
      const ptLower = pt.toLowerCase();
      const hitChunks = new Set();
      for (const entry of evidenceEntries) {
        if (entry.content.includes(ptLower)) {
          hitChunks.add(entry.chunk_id);
        }
      }
      procedureChunkHits[pt] = [...hitChunks];
    }

    // 实体命中检查
    let entityHitCount = 0;
    const missedEntities = [];
    for (const et of entityTerms) {
      if (entityChunkHits[et]?.length > 0) {
        entityHitCount++;
      } else {
        missedEntities.push(et);
      }
    }

    // 程序词命中检查
    let procedureHitCount = 0;
    const missedProcedures = [];
    for (const pt of procedureTerms) {
      if (procedureChunkHits[pt]?.length > 0) {
        procedureHitCount++;
      } else {
        missedProcedures.push(pt);
      }
    }

    // audit-round02 P1-1: chunk 级 overlap 检查
    // 若实体与程序词命中在不同 chunk 组，不得判为 covered
    const allEntityChunkIds = new Set(
      Object.values(entityChunkHits).flat()
    );
    const allProcedureChunkIds = new Set(
      Object.values(procedureChunkHits).flat()
    );

    // chunk overlap: 实体命中 chunk ∩ 程序词命中 chunk
    const overlapChunkIds = new Set(
      [...allEntityChunkIds].filter(id => allProcedureChunkIds.has(id))
    );

    if (missedEntities.length > 0) {
      reasonCodes.push('coverage_miss_core_entity');
    }
    if (entityHitCount > 0 && procedureTerms.length > 0 && procedureHitCount === 0) {
      reasonCodes.push('coverage_miss_required_procedure');
    }
    if (entityHitCount > 0 && entityHitCount < entityTerms.length) {
      reasonCodes.push('coverage_partial_entity_match');
    }
    // audit-round02 P1-1: entity 和 procedure 不在同一 chunk → 不可判为 covered
    if (entityHitCount > 0 && procedureHitCount > 0 && overlapChunkIds.size === 0) {
      reasonCodes.push('coverage_no_chunk_overlap');
    }

    // 判定覆盖状态
    let status;
    if (entityTerms.length > 0 && entityHitCount === 0) {
      status = 'not_covered';
      if (!reasonCodes.includes('coverage_miss_core_entity')) {
        reasonCodes.push('coverage_miss_core_entity');
      }
    } else if (entityTerms.length > 0 && entityHitCount < entityTerms.length) {
      status = 'partial';
    } else if (entityTerms.length > 0 && entityHitCount === entityTerms.length) {
      // audit-round02 P1-1: 即使所有实体命中，chunk overlap 不足时降为 partial
      if (procedureTerms.length > 0 && overlapChunkIds.size === 0) {
        status = 'partial';
      } else {
        status = 'covered';
      }
    } else if (procedureTerms.length > 0 && procedureHitCount > 0) {
      status = 'partial'; // 只有程序词命中（无实体 facet）
    } else {
      status = 'not_evaluated';
    }

    return {
      status,
      reason_codes: reasonCodes,
      entity_chunk_hits: entityChunkHits,
      procedure_chunk_hits: procedureChunkHits,
    };
  }

  /**
   * 检测参数证据闭环：同一证据片段内同时出现核心实体、参数值、条款/表格锚点
   * 或明显参数问答语境。用于防止“证据已命中明确参数”却仍被误降级。
   *
   * @param {Object} packet
   * @param {Object|null} queryFacets
   * @returns {{ matched: boolean, reasons: string[], matched_document_id: string|null, matched_chunk_id: string|null }}
   */
  _detectParameterEvidenceClosure(packet, queryFacets) {
    const entityTerms = (queryFacets?.entity_terms || []).filter(Boolean);
    const attributeTerms = (queryFacets?.attribute_terms || []).filter(Boolean);
    const procedureTerms = (queryFacets?.procedure_terms || []).filter(Boolean);

    if (packet?.meta?.total_evidence === 0 || entityTerms.length === 0) {
      return { matched: false, reasons: [], matched_document_id: null, matched_chunk_id: null };
    }

    const parameterValuePattern = /(?:\b\d+(?:\.\d+)?\s*(?:min|mm|cm|m|km|g|kg|mg|℃|°C|K|V|A|W|Hz|L\/min|m3\/h|%|‰)\b|\b\d+(?:\.\d+)?\b)/i;
    const anchorPattern = /(?:表\s*\d+|第\s*\d+(?:\.\d+)+\s*[章节条款项]?|\b\d+(?:\.\d+)+\b)/i;

    const matchesEntityConcept = (contentLower, term) => {
      const normalizedTerm = String(term || '').trim().toLowerCase();
      if (!normalizedTerm) return false;
      if (contentLower.includes(normalizedTerm)) return true;

      const ipxMatch = normalizedTerm.match(/^ipx(\d+)$/i);
      if (ipxMatch) {
        const n = ipxMatch[1];
        const aliases = [
          `第二位特征数字${n}`,
          `第二位特征数字为${n}`,
          `特征数字${n}`,
          `数字${n}`,
        ];
        return aliases.some(alias => contentLower.includes(alias.toLowerCase()));
      }

      return false;
    };

    for (const doc of packet.documents || []) {
      for (const ev of doc.evidence || []) {
        const content = ev.content || '';
        const lower = content.toLowerCase();
        const entityHit = entityTerms.some(term => matchesEntityConcept(lower, term));
        if (!entityHit) continue;

        const hasParameterValue = parameterValuePattern.test(content);
        const hasAnchor = anchorPattern.test(content);
        const hasProcedureSignal = procedureTerms.length > 0
          ? procedureTerms.some(term => lower.includes(String(term).toLowerCase()))
          : false;
        const hasAttributeIntent = attributeTerms.length > 0;

        if (hasParameterValue && (hasAnchor || hasProcedureSignal || hasAttributeIntent)) {
          return {
            matched: true,
            reasons: ['parameter_evidence_closure'],
            matched_document_id: doc.document_id || null,
            matched_chunk_id: ev.chunk_id || null,
          };
        }
      }
    }

    return { matched: false, reasons: [], matched_document_id: null, matched_chunk_id: null };
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
    const coverage = packet.meta.coverage_status;
    const docCount = packet.documents.length;
    const decision = packet.decision;
    const hasParameterClosure = packet.meta.parameter_evidence_closure === true;

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

    // 参数证据闭环优先：同一证据片段已形成“实体 + 参数值 + 锚点/语境”闭环时，
    // 即使 coverage 因 facet/措辞差异被打低，也应优先进入引用回答模式。
    if (hasParameterClosure && (sufficiency === 'medium' || sufficiency === 'strong')) {
      return {
        mode: 'answer_with_citation',
        should_clarify: false,
        should_answer_conservatively: false,
      };
    }

    // audit-round01 P0-2: 覆盖不足 → 保守回答（先止错答）
    if (coverage === 'not_covered') {
      return {
        mode: 'conservative_answer',
        should_clarify: sufficiency === 'weak' || sufficiency === 'none',
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

    // audit-round01 P0-2: partial 覆盖 + 弱/中等充分性 → 保守
    if (coverage === 'partial' && (sufficiency === 'weak' || sufficiency === 'medium')) {
      if (hasParameterClosure) {
        return {
          mode: 'answer_with_citation',
          should_clarify: false,
          should_answer_conservatively: false,
        };
      }
      return {
        mode: 'conservative_answer',
        should_clarify: false,
        should_answer_conservatively: true,
      };
    }

    // 多候选文档且置信度分散 → 列候选
    if (docCount >= 3) {
      const highConfDocs = packet.documents.filter(
        d => (d.candidate_confidence === 'high' || d.candidate_confidence === 'medium') && d.evidence?.length > 0
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

    // 有明确文档来源 → 引用回答（覆盖已确认 covered 或 sufficient）
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

  _resolveCandidateConfidence(candidate = {}, filteredEvidence = [], identityBackfilled = false) {
    const relevanceScore = candidate.relevance_score || 0;
    const maxEvidenceScore = filteredEvidence[0]?.score || 0;
    const evidenceCount = filteredEvidence.length;

    if (candidate.candidate_confidence) {
      return candidate.candidate_confidence;
    }

    if (candidate.is_heuristic_fallback || identityBackfilled) {
      if (evidenceCount >= 2 && maxEvidenceScore >= 0.7) return 'medium';
      return 'low';
    }

    if (relevanceScore >= 80 && evidenceCount >= 1) return 'high';
    if (relevanceScore >= 55 || maxEvidenceScore >= 0.65) return 'medium';
    return 'low';
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
