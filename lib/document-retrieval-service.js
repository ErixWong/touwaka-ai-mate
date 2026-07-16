/**
 * Document Retrieval Service - 文档检索统一编排入口（唯一主入口）
 *
 * **这是面向业务调用的文档检索唯一主入口。**
 * 所有需要从文档平台检索内容的调用方，均应通过本服务而非直接调用底层模块。
 *
 * 内部编排完整的 document-first 检索链路：
 *
 *   DocumentQueryDecisionService  →  查询意图决策
 *        ↓
 *   DocumentSearchService        →  文档级候选检索
 *        ↓
 *   DocRecallService             →  文档内 chunk 证据召回（scoped）
 *        ↓
 *   DocumentEvidencePacker       →  证据打包
 *        ↓
 *   (fallback / degrade)         →  受限回退与降级
 *
 * 调用路径说明：
 * - chat-service.buildEvidenceInjection() → document_retrieval tool → evidence packet（当前唯一主路径）
 * - DocController.recall() → 直接调 DocRecallService（公开 API，兼容保留）
 * - DocRecallService.recall() → chunk-first 全库搜索（仅作内部回退，不推荐业务直接调用）
 *
 * 历史说明：
 * - lib/rag-service.js（旧自动预检索兼容壳层）已于 2026-07-07 Round 04 整体删除。
 *
 * 设计原则：
 * - 默认走 document_first 路径（先定位文档，再找证据）
 * - chunk_first 作为受限回退，仅在 document_first 无结果时触发
 * - 所有回退路径必须可审计、可观测
 * - 不依赖 LLM 做检索决策
 *
 * 使用方式：
 *   const retrievalService = new DocumentRetrievalService(db, configLoader);
 *   const result = await retrievalService.retrieve(query, { userId });
 *   // result.packet 可直接传给专家编排层消费
 */

import logger from './logger.js';
import queryDecisionService from './document-query-decision-service.js';
import DocumentSearchService from './document-search-service.js';
import DocRecallService from './doc-recall-service.js';
import DocumentEvidencePacker from './document-evidence-packer.js';
import { parseDocumentQuery } from './document-query-parser.js';

const DOC_TYPE_RERANK_SIGNALS = {
  国家标准: [/\bGB\/?T?\b/i, /国家标准/, /标准/, /GB-T/i, /GB_T/i],
  行业标准: [/行业标准/, /行标/, /YY\/T/i, /HJ\s*\d/i, /DB\d/i, /QB\s*\d/i],
  合同协议: [/合同/, /协议/, /契约/, /合约/],
  制度规章: [/制度/, /办法/, /条例/, /章程/, /细则/, /规程/, /规定/],
  手册指南: [/手册/, /指南/, /说明书/, /操作指引/, /作业指导/],
  报告: [/报告/, /报表/, /分析报告/, /评估报告/],
  法律法规: [/法律/, /法规/, /法令/, /司法解释/],
  技术文档: [/技术文档/, /技术规范/, /技术方案/, /技术规格书/],
};

/**
 * 检索策略常量
 */
export const RETRIEVAL_STRATEGY = {
  DOCUMENT_FIRST: 'document_first',
  CHUNK_FIRST_FALLBACK: 'chunk_first_fallback',
  DEGRADE: 'degrade',
};

/**
 * 证据充分性
 */
export const EVIDENCE_SUFFICIENCY = {
  STRONG: 'strong',
  MEDIUM: 'medium',
  WEAK: 'weak',
  NONE: 'none',
};

class DocumentRetrievalService {
  constructor(db, configLoader) {
    this.db = db;
    this.configLoader = configLoader;
    this.decisionService = queryDecisionService;
    this.searchService = new DocumentSearchService(db);
    this.recallService = null;
    this.packer = new DocumentEvidencePacker();
    this.metrics = {
      total_retrievals: 0,
      document_first_count: 0,
      fallback_count: 0,
      degrade_count: 0,
    };
  }

  _ensureRecallService() {
    if (!this.recallService) {
      this.recallService = new DocRecallService(this.db, this.configLoader);
    }
  }

  /**
   * 统一检索入口
   *
   * @param {string} query - 用户查询
   * @param {Object} options - 检索选项
   * @param {string} options.userId - 用户ID（必需，用于权限验证）
   * @param {string[]} [options.doc_types] - 文档类型过滤
   * @param {string} [options.collection_id] - 指定集合ID
   * @param {string[]} [options.tag_ids] - 标签ID过滤
   * @param {number} [options.top_k_candidates=10] - 文档候选数量
   * @param {number} [options.top_k_evidence=5] - 每个文档的 evidence 数量
   * @param {number} [options.evidence_threshold=0.1] - evidence 相似度阈值
   * @param {boolean} [options.allow_fallback=true] - 是否允许回退到 chunk-first
   * @param {Object} [options.context] - 查询上下文（传给决策服务）
   * @returns {Promise<Object>} { packet, strategy, metrics }
   */
  async retrieve(query, options = {}) {
    const {
      userId,
      doc_types,
      collection_id,
      tag_ids,
      top_k_candidates = 10,
      top_k_evidence = 5,
      evidence_threshold = 0.1,
      allow_fallback = true,
      context = {},
    } = options;

    this.metrics.total_retrievals++;

    const traceId = this._generateTraceId();
    const startTime = Date.now();

    logger.info('[DocRetrieval] Starting retrieval:', {
      trace_id: traceId,
      query_length: query?.length || 0,
      user_id: userId,
      doc_types,
      collection_id,
    });

    try {
      // ==========================================
      // 阶段 1：查询意图决策
      // ==========================================
      const parsedQuery = parseDocumentQuery(query);
      const decision = this.decisionService.analyze(query, context);
      logger.info('[DocRetrieval] Decision:', { trace_id: traceId, ...decision });

      const shouldForceDocumentFirst = this._shouldForceDocumentFirst(decision, parsedQuery);

      if (!shouldForceDocumentFirst && decision.recommended_strategy === 'chunk_first' && allow_fallback) {
        return await this._handleChunkFirstFallback(query, options, decision, traceId, startTime);
      }

      if (shouldForceDocumentFirst && decision.recommended_strategy === 'chunk_first') {
        logger.info('[DocRetrieval] chunk-first overridden by find_document document-first policy:', {
          trace_id: traceId,
          lookup_intent: parsedQuery.lookup_intent,
          topic_terms: parsedQuery.topic_terms,
          doc_type_hints: parsedQuery.doc_type_hints,
          identifier_hints: parsedQuery.identifier_hints,
        });
      }

      // 如果决策建议澄清（ambiguous + 无锚点），降级回答
      if (decision.recommended_strategy === 'clarify') {
        return this._handleDegrade(decision, traceId, startTime, 'ambiguous_query');
      }

      // ==========================================
      // 阶段 2：文档级候选检索
      // ==========================================
      let searchResult = await this.searchService.search(
        parsedQuery.cleaned_query || query,
        {
          userId,
          doc_types,
          collection_id,
          tag_ids,
          top_k: top_k_candidates,
        }
      );

      searchResult = this._applyDocTypePreferenceRerank(searchResult, parsedQuery);

      if ((!searchResult.candidates || searchResult.candidates.length === 0) && parsedQuery.identifier_hints?.length > 0) {
        searchResult = await this.searchService.search(query, {
          userId,
          doc_types,
          collection_id,
          tag_ids,
          top_k: top_k_candidates,
        });
        searchResult = this._applyDocTypePreferenceRerank(searchResult, parsedQuery);
      }

      let documentRecallRound = 1;
      let candidateQuality = this._assessCandidateQuality(searchResult.candidates || []);
      let round2Attempted = false;

      if (this._shouldTriggerRound2(searchResult.candidates || [], decision, parsedQuery)) {
        const round2Queries = this._buildRound2Queries(query, parsedQuery);
        for (const round2Query of round2Queries) {
          round2Attempted = true;
          const round2Result = await this.searchService.search(round2Query, {
            userId,
            doc_types,
            collection_id,
            tag_ids,
            top_k: top_k_candidates,
          });

          const rerankedRound2Result = this._applyDocTypePreferenceRerank(round2Result, parsedQuery);

          const round2Quality = this._assessCandidateQuality(rerankedRound2Result.candidates || []);
          if ((rerankedRound2Result.candidates?.length || 0) > 0 && this._isRound2Better(rerankedRound2Result.candidates || [], searchResult.candidates || [])) {
            searchResult = rerankedRound2Result;
            documentRecallRound = 2;
            candidateQuality = round2Quality;
            break;
          }
        }
      }

      logger.info('[DocRetrieval] Document search result:', {
        trace_id: traceId,
        candidate_count: searchResult.candidates?.length || 0,
        strategy: searchResult.strategy,
        document_recall_round: documentRecallRound,
        candidate_quality: candidateQuality,
        parser_lookup_intent: parsedQuery.lookup_intent,
        parser_topic_terms: parsedQuery.topic_terms,
        parser_doc_type_hints: parsedQuery.doc_type_hints,
        parser_identifier_hints: parsedQuery.identifier_hints,
      });

      // 无候选文档 → 回退或降级
      if (!searchResult.success || !searchResult.candidates || searchResult.candidates.length === 0) {
        if (allow_fallback && decision.anchor_strength !== 'strong') {
          logger.info('[DocRetrieval] No document candidates after document-first rounds:', {
            trace_id: traceId,
            round2_attempted: round2Attempted,
            expanded_topic_queries: parsedQuery.expanded_topic_queries || [],
          });
          return await this._handleChunkFirstFallback(query, options, decision, traceId, startTime);
        }
        return this._handleDegrade(decision, traceId, startTime, 'no_candidates', {
          document_recall_round: 0,
          candidate_quality: 'not_applicable',
        });
      }

      // ==========================================
      // 阶段 3：文档内证据召回
      // ==========================================
      this._ensureRecallService();
      const candidateDocIds = searchResult.candidates.map(c => c.document_id);
      const candidateRevIds = searchResult.candidates.map(c => c.revision_id).filter(Boolean);

      const evidenceResult = await this.recallService.recallWithinDocuments(
        {
          semantic_query: query,
          entity_terms: parsedQuery.facets?.entity_terms || [],
          procedure_terms: parsedQuery.facets?.procedure_terms || [],
          attribute_terms: parsedQuery.facets?.attribute_terms || [],
          normalized_lookup_query: parsedQuery.facets?.normalized_lookup_query || query,
        },
        candidateDocIds,
        {
        revisionIds: candidateRevIds.length > 0 ? candidateRevIds : undefined,
        top_k: top_k_evidence,
        threshold: evidence_threshold,
        userId,
      });

      logger.info('[DocRetrieval] Evidence recall result:', {
        trace_id: traceId,
        evidence_count: evidenceResult.items?.length || 0,
        top_score: evidenceResult.items?.[0]?.score || 0,
      });

      // ==========================================
      // 阶段 4：证据打包
      // ==========================================
      let packet;
      if (evidenceResult.success && evidenceResult.items?.length > 0) {
        packet = this.packer.pack(
          searchResult.candidates,
          evidenceResult.items,
          decision,
          traceId,
          { maxEvidencePerDoc: top_k_evidence, minEvidenceScore: evidence_threshold, queryFacets: parsedQuery.facets || null }
        );
      } else {
        // 有候选文档但没有证据 → 返回文档列表，标记证据不足
        packet = this.packer.pack(
          searchResult.candidates,
          [],
          decision,
          traceId,
          { queryFacets: parsedQuery.facets || null }
        );
        packet.meta.reason_codes.push('no_evidence_in_candidates');
      }

      packet.meta.document_recall_round = documentRecallRound;
      packet.meta.candidate_quality = candidateQuality;

      // ==========================================
      // 阶段 4.5：Scoped Identity Enrichment（Round 05 P0-2）
      // 当证据高度集中于单文档时，用 getDocumentInfo() 补充 attachment 文件名等身份来源
      // ==========================================
      if (packet.documents.length === 1 && packet.meta.total_evidence >= 2) {
        try {
          const soloDocId = packet.documents[0].document_id;
          const enrichedInfo = await this.searchService.getDocumentInfo([soloDocId]);
          if (enrichedInfo.length > 0) {
            const enriched = enrichedInfo[0];
            const docEntry = packet.documents[0];

            // 注入 enriched identity
            docEntry.best_identity_label = enriched.best_identity_label;
            docEntry.identity_label_source = enriched.identity_label_source;
            docEntry.attachment_filenames = enriched.attachment_filenames || [];
            docEntry.title_is_import_name = enriched.title_is_import_name || false;

            // 如果原 title 是导入名，用 best_identity_label 替换展示名
            if (enriched.title_is_import_name && enriched.best_identity_label !== enriched.document_title) {
              docEntry.document_title_display = enriched.best_identity_label;
            }

            // 标记 scoped identity
            packet.meta.scoped_identity_confirmed = true;
            packet.meta.scoped_document_id = soloDocId;
            packet.meta.scoped_identity_label = enriched.best_identity_label;
            packet.meta.scoped_identity_source = enriched.identity_label_source;
            packet.meta.reason_codes.push('scoped_identity_enriched');

            logger.info('[DocRetrieval] Scoped identity enriched (document-first):', {
              trace_id: traceId,
              doc_id: soloDocId,
              identity_label: enriched.best_identity_label,
              identity_source: enriched.identity_label_source,
              attachment_count: enriched.attachment_filenames?.length || 0,
            });
          }
        } catch (enrichErr) {
          logger.warn('[DocRetrieval] Identity enrichment failed:', enrichErr.message);
        }
      }

      // ==========================================
      // 阶段 5：证据充分性判断 → 回退/降级
      // ==========================================
      const sufficiency = packet.meta.evidence_sufficiency;
      const coverage = packet.meta.coverage_status;

      if (sufficiency === 'none' || sufficiency === 'weak') {
        // audit-round02 P0-3: coverage 不足时禁止 fallback supplement
        // "先止错答，再追求补召回"——当核心实体未命中时，补检大概率也无效
        const coverageAllowsFallback = coverage === 'covered' || coverage === 'not_evaluated';

        if (allow_fallback && decision.anchor_strength !== 'strong' && coverageAllowsFallback) {
          // 弱证据 + 非强锚点 + 覆盖可接受 → 尝试 chunk-first 回退作为补充
          const fallbackPacket = await this._tryFallbackSupplement(
            query, options, decision, traceId, packet, parsedQuery?.facets || null
          );
          if (fallbackPacket) {
            this._logMetrics(traceId, RETRIEVAL_STRATEGY.DOCUMENT_FIRST, startTime, fallbackPacket, { fallback_supplemented: true });
            return { packet: fallbackPacket, strategy: RETRIEVAL_STRATEGY.DOCUMENT_FIRST, metrics: this.metrics };
          }
        }

        // 有文档候选但证据弱 → 仍返回文档列表，标记降级
        packet.meta.reason_codes.push('weak_evidence_degrade');
        if (!coverageAllowsFallback) {
          packet.meta.reason_codes.push('fallback_blocked_by_coverage');
        }
        this.metrics.degrade_count++;
        this._logMetrics(traceId, RETRIEVAL_STRATEGY.DEGRADE, startTime, packet);
        return { packet, strategy: RETRIEVAL_STRATEGY.DEGRADE, metrics: this.metrics };
      }

      // 成功路径
      this.metrics.document_first_count++;
      this._logMetrics(traceId, RETRIEVAL_STRATEGY.DOCUMENT_FIRST, startTime, packet);
      return { packet, strategy: RETRIEVAL_STRATEGY.DOCUMENT_FIRST, metrics: this.metrics };

    } catch (error) {
      logger.error('[DocRetrieval] Unexpected error:', error);
      this._logMetrics(traceId, 'error', startTime);
      return {
        packet: this.packer.packEmpty(null, traceId, 'internal_error'),
        strategy: RETRIEVAL_STRATEGY.DEGRADE,
        metrics: this.metrics,
        error: error.message,
      };
    }
  }

  /**
   * 处理 chunk-first 回退路径
   *
   * Round 05 增强（P0-2 scoped identity confirmation）：
   * - chunk-first 命中后强制 identity backfill
   * - 当 chunks 高度集中于单文档时，标记 scoped_identity_confirmed
   * - 丰富 identity 信息（attachment 文件名等）供上层消费
   */
  async _handleChunkFirstFallback(query, options, decision, traceId, startTime) {
    logger.info('[DocRetrieval] Falling back to chunk-first:', { trace_id: traceId });

    this._ensureRecallService();
    const result = await this.recallService.recall(query, {
      scope: 'all',
      doc_types: options.doc_types,
      top_k: options.top_k_evidence || 5,
      threshold: options.evidence_threshold || 0.1,
      userId: options.userId,
      collectionId: options.collection_id,
    });

    // P0-2: chunk-first 命中后强制 identity backfill
    // 从 recall items 收集 document_id，回查文档表获取身份信息
    const items = result.items || [];
    const docIds = [...new Set(items.map(item => item.document?.id).filter(Boolean))];

    // Round 05: 检测 chunk 集中度
    const docChunkCounts = new Map();
    for (const item of items) {
      const docId = item.document?.id;
      if (docId) {
        docChunkCounts.set(docId, (docChunkCounts.get(docId) || 0) + 1);
      }
    }

    let backfillCandidates = [];
    let scopedIdentityConfirmed = false;
    let scopedDocId = null;

    if (docIds.length > 0) {
      try {
        backfillCandidates = await this.searchService.getDocumentInfo(docIds);

        // Round 05 P0-2: 检测单文档高集中度 → 触发 scoped identity confirmation
        const totalChunks = items.length;
        if (docIds.length === 1 && totalChunks >= 2) {
          // 所有 chunks 来自同一文档 → 强信号
          scopedIdentityConfirmed = true;
          scopedDocId = docIds[0];
        } else if (docIds.length >= 1 && totalChunks >= 3) {
          // 多文档但主文档占比 >= 60% → 也视为 scoped
          const topDocId = [...docChunkCounts.entries()]
            .sort((a, b) => b[1] - a[1])[0];
          const topRatio = topDocId[1] / totalChunks;
          if (topRatio >= 0.6) {
            scopedIdentityConfirmed = true;
            scopedDocId = topDocId[0];
          }
        }

        logger.info('[DocRetrieval] Chunk-first identity backfill:', {
          trace_id: traceId,
          backfill_doc_count: backfillCandidates.length,
          recall_item_doc_count: docIds.length,
          scoped_identity_confirmed: scopedIdentityConfirmed,
          scoped_doc_id: scopedDocId,
          chunk_concentration: Object.fromEntries(docChunkCounts),
        });
      } catch (backfillError) {
        logger.warn('[DocRetrieval] Identity backfill failed:', backfillError.message);
      }
    }

    const filteredBackfillCandidates = this._filterFallbackCandidates(backfillCandidates, items, scopedIdentityConfirmed, scopedDocId);

    const packet = this.packer.packFallback(
      items,
      decision,
      traceId,
      filteredBackfillCandidates,
    );

    // Round 05 P0-2: 注入 scoped identity 信号到 packet meta
    if (scopedIdentityConfirmed && scopedDocId) {
      const scopedDoc = filteredBackfillCandidates.find(c => c.document_id === scopedDocId) || backfillCandidates.find(c => c.document_id === scopedDocId);
      packet.meta.scoped_identity_confirmed = true;
      packet.meta.scoped_document_id = scopedDocId;
      packet.meta.scoped_identity_label = scopedDoc?.best_identity_label || scopedDoc?.document_title || '';
      packet.meta.scoped_identity_source = scopedDoc?.identity_label_source || 'document_title';
      packet.meta.reason_codes.push('scoped_identity_confirmed');

      // 将 enriched identity 信息注入到对应 document entry
      const docEntry = packet.documents.find(d => d.document_id === scopedDocId);
      if (docEntry && scopedDoc) {
        docEntry.best_identity_label = scopedDoc.best_identity_label;
        docEntry.identity_label_source = scopedDoc.identity_label_source;
        docEntry.attachment_filenames = scopedDoc.attachment_filenames || [];
        docEntry.title_is_import_name = scopedDoc.title_is_import_name || false;
        // 有 scoped identity 时升级 identity_confidence
        if (docEntry.identity_confidence === 'probable' && scopedIdentityConfirmed) {
          docEntry.identity_confidence = 'confirmed';
        }
      }
    }

    this.metrics.fallback_count++;
    this._logMetrics(traceId, RETRIEVAL_STRATEGY.CHUNK_FIRST_FALLBACK, startTime, packet);
    return { packet, strategy: RETRIEVAL_STRATEGY.CHUNK_FIRST_FALLBACK, metrics: this.metrics };
  }

  _filterFallbackCandidates(candidates = [], items = [], scopedIdentityConfirmed = false, scopedDocId = null) {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];

    const evidenceCountByDoc = new Map();
    let maxEvidenceScoreByDoc = new Map();

    for (const item of items || []) {
      const docId = item.document?.id;
      if (!docId) continue;
      evidenceCountByDoc.set(docId, (evidenceCountByDoc.get(docId) || 0) + 1);
      maxEvidenceScoreByDoc.set(docId, Math.max(maxEvidenceScoreByDoc.get(docId) || 0, item.score || 0));
    }

    const enriched = candidates.map(candidate => {
      const docId = candidate.document_id;
      const evidenceCount = evidenceCountByDoc.get(docId) || 0;
      const maxEvidenceScore = maxEvidenceScoreByDoc.get(docId) || 0;
      const relevanceScore = candidate.relevance_score || 0;
      const fallbackScore = evidenceCount * 20 + maxEvidenceScore * 100 + relevanceScore * 0.1;
      return {
        ...candidate,
        fallback_evidence_count: evidenceCount,
        fallback_max_evidence_score: maxEvidenceScore,
        fallback_rank_score: fallbackScore,
      };
    }).filter(candidate => candidate.fallback_evidence_count > 0);

    if (scopedIdentityConfirmed && scopedDocId) {
      return enriched
        .filter(candidate => candidate.document_id === scopedDocId)
        .sort((a, b) => (b.fallback_rank_score || 0) - (a.fallback_rank_score || 0));
    }

    return enriched
      .filter(candidate => candidate.fallback_max_evidence_score >= 0.35 || candidate.fallback_evidence_count >= 2)
      .sort((a, b) => (b.fallback_rank_score || 0) - (a.fallback_rank_score || 0))
      .slice(0, 3);
  }

  /**
   * 处理降级（无结果、无法回答）
   */
  _handleDegrade(decision, traceId, startTime, reasonCode, metaOverrides = {}) {
    logger.info('[DocRetrieval] Degrading:', { trace_id: traceId, reason: reasonCode });

    const packet = this.packer.packEmpty(decision, traceId, reasonCode, RETRIEVAL_STRATEGY.DEGRADE);
    packet.meta.document_recall_round = metaOverrides.document_recall_round ?? 0;
    packet.meta.candidate_quality = metaOverrides.candidate_quality ?? 'not_applicable';
    this.metrics.degrade_count++;
    this._logMetrics(traceId, RETRIEVAL_STRATEGY.DEGRADE, startTime, packet);
    return { packet, strategy: RETRIEVAL_STRATEGY.DEGRADE, metrics: this.metrics };
  }

  /**
   * 尝试用 chunk-first 回退补充 document-first 的结果
   * 仅在 document-first 证据不足时作为补充
   */
  async _tryFallbackSupplement(query, options, decision, traceId, existingPacket, queryFacets = null) {
    try {
      this._ensureRecallService();
      const result = await this.recallService.recall(query, {
        scope: 'all',
        doc_types: options.doc_types,
        top_k: options.top_k_evidence || 5,
        threshold: options.evidence_threshold || 0.1,
        userId: options.userId,
        collectionId: options.collection_id,
      });

      if (!result.success || !result.items || result.items.length === 0) {
        return null;
      }

      // 过滤掉已在候选文档中的结果
      const existingDocIds = new Set(existingPacket.documents.map(d => d.document_id));
      const newItems = result.items.filter(item => !existingDocIds.has(item.document?.id));

      if (newItems.length === 0) return null;

      // P1-3: 补齐 fallback evidence 的文档身份信息
      // evidence item 自带的 document 字段可能不完整，需查库补齐
      const newDocIds = [...new Set(newItems.map(item => item.document?.id).filter(Boolean))];
      let fallbackCandidates = [];
      if (newDocIds.length > 0) {
        fallbackCandidates = await this.searchService.getDocumentInfo(newDocIds);
      }

      // audit-round02 P0-4: 传入 queryFacets 以在 fallback packet 上计算 coverage
      const mergedPacket = this.packer.pack(
        fallbackCandidates,
        newItems,
        decision,
        traceId,
        { queryFacets }
      );

      // 合并原 packet 的文档
      mergedPacket.documents = [...existingPacket.documents, ...mergedPacket.documents];
      mergedPacket.meta.total_candidates = existingPacket.meta.total_candidates + mergedPacket.meta.total_candidates;
      mergedPacket.meta.total_evidence = existingPacket.meta.total_evidence + mergedPacket.meta.total_evidence;
      mergedPacket.meta.max_evidence_score = Math.max(
        existingPacket.meta.max_evidence_score,
        mergedPacket.meta.max_evidence_score
      );
      mergedPacket.meta.backfill_triggered = existingPacket.meta.backfill_triggered || mergedPacket.meta.backfill_triggered;
      mergedPacket.meta.backfill_doc_count = existingPacket.meta.backfill_doc_count + mergedPacket.meta.backfill_doc_count;
      mergedPacket.meta.reason_codes.push('fallback_supplement');
      mergedPacket.meta.evidence_sufficiency = this.packer._assessSufficiency(mergedPacket);

      // audit-round02 P0-4: merge 后重新评估 coverage 与 response mode
      if (queryFacets) {
        const mergedCoverage = this.packer._assessCoverage(mergedPacket, queryFacets);
        mergedPacket.meta.coverage_status = mergedCoverage.status;
        mergedPacket.meta.coverage_reason_codes = [
          ...new Set([...mergedPacket.meta.coverage_reason_codes, ...mergedCoverage.reason_codes]),
        ];
        const mergedMode = this.packer._deriveResponseMode(mergedPacket);
        mergedPacket.meta.suggested_response_mode = mergedMode.mode;
        mergedPacket.meta.should_clarify = mergedMode.should_clarify;
        mergedPacket.meta.should_answer_conservatively = mergedMode.should_answer_conservatively;
      }

      return mergedPacket;
    } catch (error) {
      logger.warn('[DocRetrieval] Fallback supplement error:', error.message);
      return null;
    }
  }

  /**
   * 获取检索指标
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * 重置指标
   */
  resetMetrics() {
    this.metrics = {
      total_retrievals: 0,
      document_first_count: 0,
      fallback_count: 0,
      degrade_count: 0,
    };
  }

  _logMetrics(traceId, strategy, startTime, packet = null, extra = {}) {
    const latency = Date.now() - startTime;
    const logEntry = {
      trace_id: traceId,
      final_strategy: strategy,
      latency_ms: latency,
      metrics: this.metrics,
      ...extra,
    };

    // P2-1: 结构化日志字段，便于 PM/开发/QA 复盘
    if (packet) {
      logEntry.decision_intent = packet.decision?.intent || null;
      logEntry.decision_anchor_strength = packet.decision?.anchor_strength || null;
      logEntry.candidate_count = packet.meta?.total_candidates ?? 0;
      logEntry.evidence_count = packet.meta?.total_evidence ?? 0;
      logEntry.fallback_triggered = packet.meta?.fallback_triggered || false;
      logEntry.evidence_sufficiency = packet.meta?.evidence_sufficiency || 'unknown';
      logEntry.reason_codes = packet.meta?.reason_codes || [];
      // P0-5: identity 可观测性
      logEntry.backfill_triggered = packet.meta?.backfill_triggered || false;
      logEntry.backfill_doc_count = packet.meta?.backfill_doc_count ?? 0;
      logEntry.document_recall_round = packet.meta?.document_recall_round ?? 0;
      logEntry.candidate_quality = packet.meta?.candidate_quality ?? 'not_applicable';
      logEntry.identity_distribution = packet.documents
        ? packet.documents.map(d => ({ id: d.document_id, confidence: d.identity_confidence, source: d.identity_source }))
        : [];
    }

    logger.info('[DocRetrieval] Completed:', logEntry);
  }

  _generateTraceId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `drs_${ts}_${rand}`;
  }

  _assessCandidateQuality(candidates = []) {
    if (!candidates.length) return 'not_applicable';
    const top1 = candidates[0]?.relevance_score || 0;
    const top2 = candidates[1]?.relevance_score || 0;
    if (top1 >= 80) return 'good';
    if (top1 >= 50 && (top1 - top2) >= 10) return 'good';
    if (top1 >= 50) return 'marginal';
    return 'weak';
  }

  _shouldTriggerRound2(candidates = [], decision, parsedQuery = null) {
    if (!candidates.length) {
      return Boolean(parsedQuery?.expanded_topic_queries?.length);
    }
    if (decision?.anchor_strength === 'strong') return false;
    const top1 = candidates[0]?.relevance_score || 0;
    if (top1 < 50) return true;
    if (parsedQuery?.doc_type_hints?.length) {
      const hasTypeMatch = candidates.some(candidate => this._docMatchesAnyTypeHint(candidate, parsedQuery.doc_type_hints));
      if (!hasTypeMatch) return true;
    }
    return false;
  }

  _isRound2Better(round2Candidates = [], round1Candidates = []) {
    if ((round1Candidates?.length || 0) === 0 && (round2Candidates?.length || 0) > 0) {
      return true;
    }
    const top1Round2 = round2Candidates[0]?.relevance_score || 0;
    const top1Round1 = round1Candidates[0]?.relevance_score || 0;
    return top1Round2 > top1Round1;
  }

  _buildRound2Queries(query, parsedQuery = null) {
    const queries = [];
    const normalizedRaw = String(query || '').trim();
    const stripped = normalizedRaw.replace(/国标|标准|文件|文档/g, ' ').replace(/\s+/g, ' ').trim();
    if (stripped && stripped !== normalizedRaw) queries.push(stripped);

    if (parsedQuery?.cleaned_query && !queries.includes(parsedQuery.cleaned_query) && parsedQuery.cleaned_query !== normalizedRaw) {
      queries.push(parsedQuery.cleaned_query);
    }

    const compactCleaned = parsedQuery?.cleaned_query?.replace(/\s+/g, '').trim();
    if (compactCleaned && !queries.includes(compactCleaned) && compactCleaned !== normalizedRaw) {
      queries.push(compactCleaned);
    }

    for (const q of (parsedQuery?.expanded_topic_queries || [])) {
      if (q && !queries.includes(q) && q !== normalizedRaw) {
        queries.push(q);
      }
    }

    const topicTerms = parsedQuery?.topic_terms || [];
    if (topicTerms.length >= 2) {
      for (let i = 1; i < topicTerms.length; i++) {
        const suffix = topicTerms.slice(i).join(' ').trim();
        if (suffix && !queries.includes(suffix) && suffix !== normalizedRaw) {
          queries.push(suffix);
        }
      }
    }

    return queries.length > 0 ? queries : [normalizedRaw];
  }

  _shouldForceDocumentFirst(decision, parsedQuery) {
    if (decision?.recommended_strategy === 'document_first' || decision?.recommended_strategy === 'document_first_with_fallback') {
      return true;
    }

    if (parsedQuery?.lookup_intent) return true;
    if ((parsedQuery?.identifier_hints?.length || 0) > 0) return true;
    if ((parsedQuery?.topic_terms?.length || 0) > 0 && (parsedQuery?.doc_type_hints?.length || 0) > 0) return true;
    return false;
  }

  _applyDocTypePreferenceRerank(searchResult, parsedQuery) {
    if (!searchResult?.candidates?.length || !(parsedQuery?.doc_type_hints?.length)) {
      return searchResult;
    }

    const rerankedCandidates = [...searchResult.candidates]
      .map(candidate => {
        const typeBoost = this._calculateDocTypeBoost(candidate, parsedQuery.doc_type_hints);
        return {
          ...candidate,
          doc_type_preference_boost: typeBoost,
          relevance_score: (candidate.relevance_score || 0) + typeBoost,
        };
      })
      .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));

    return {
      ...searchResult,
      candidates: rerankedCandidates,
      strategy: `${searchResult.strategy || 'relevance_match'}+doc_type_rerank`,
    };
  }

  _calculateDocTypeBoost(candidate, docTypeHints = []) {
    let boost = 0;
    for (const hint of docTypeHints) {
      if (this._docMatchesTypeHint(candidate, hint)) {
        boost = Math.max(boost, 18);
      }
    }
    return boost;
  }

  _docMatchesAnyTypeHint(candidate, docTypeHints = []) {
    return docTypeHints.some(hint => this._docMatchesTypeHint(candidate, hint));
  }

  _docMatchesTypeHint(candidate, hint) {
    const patterns = DOC_TYPE_RERANK_SIGNALS[hint] || [];
    if (!patterns.length) return false;

    const haystacks = [
      candidate?.document_title,
      candidate?.best_identity_label,
      candidate?.doc_type,
      ...(candidate?.attachment_filenames || []),
    ].filter(Boolean);

    return haystacks.some(text => patterns.some(pattern => pattern.test(String(text))));
  }
}

export default DocumentRetrievalService;
