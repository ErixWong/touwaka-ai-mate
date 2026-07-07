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
      const decision = this.decisionService.analyze(query, context);
      logger.info('[DocRetrieval] Decision:', { trace_id: traceId, ...decision });

      // 如果决策建议走 chunk_first（纯内容探索），直接走回退路径
      if (decision.recommended_strategy === 'chunk_first') {
        return await this._handleChunkFirstFallback(query, options, decision, traceId, startTime);
      }

      // 如果决策建议澄清（ambiguous + 无锚点），降级回答
      if (decision.recommended_strategy === 'clarify') {
        return this._handleDegrade(decision, traceId, startTime, 'ambiguous_query');
      }

      // ==========================================
      // 阶段 2：文档级候选检索
      // ==========================================
      const searchResult = await this.searchService.search(query, {
        userId,
        doc_types,
        collection_id,
        tag_ids,
        top_k: top_k_candidates,
      });

      logger.info('[DocRetrieval] Document search result:', {
        trace_id: traceId,
        candidate_count: searchResult.candidates?.length || 0,
        strategy: searchResult.strategy,
      });

      // 无候选文档 → 回退或降级
      if (!searchResult.success || !searchResult.candidates || searchResult.candidates.length === 0) {
        if (allow_fallback && decision.anchor_strength !== 'strong') {
          return await this._handleChunkFirstFallback(query, options, decision, traceId, startTime);
        }
        return this._handleDegrade(decision, traceId, startTime, 'no_candidates');
      }

      // ==========================================
      // 阶段 3：文档内证据召回
      // ==========================================
      this._ensureRecallService();
      const candidateDocIds = searchResult.candidates.map(c => c.document_id);
      const candidateRevIds = searchResult.candidates.map(c => c.revision_id).filter(Boolean);

      const evidenceResult = await this.recallService.recallWithinDocuments(query, candidateDocIds, {
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
          { maxEvidencePerDoc: top_k_evidence, minEvidenceScore: evidence_threshold }
        );
      } else {
        // 有候选文档但没有证据 → 返回文档列表，标记证据不足
        packet = this.packer.pack(
          searchResult.candidates,
          [],
          decision,
          traceId
        );
        packet.meta.reason_codes.push('no_evidence_in_candidates');
      }

      // ==========================================
      // 阶段 5：证据充分性判断 → 回退/降级
      // ==========================================
      const sufficiency = packet.meta.evidence_sufficiency;

      if (sufficiency === 'none' || sufficiency === 'weak') {
        if (allow_fallback && decision.anchor_strength !== 'strong') {
          // 弱证据 + 非强锚点 → 尝试 chunk-first 回退作为补充
          const fallbackPacket = await this._tryFallbackSupplement(
            query, options, decision, traceId, packet
          );
          if (fallbackPacket) {
            this._logMetrics(traceId, RETRIEVAL_STRATEGY.DOCUMENT_FIRST, startTime, fallbackPacket, { fallback_supplemented: true });
            return { packet: fallbackPacket, strategy: RETRIEVAL_STRATEGY.DOCUMENT_FIRST, metrics: this.metrics };
          }
        }

        // 有文档候选但证据弱 → 仍返回文档列表，标记降级
        packet.meta.reason_codes.push('weak_evidence_degrade');
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

    const packet = this.packer.packFallback(
      result.items || [],
      decision,
      traceId
    );

    this.metrics.fallback_count++;
    this._logMetrics(traceId, RETRIEVAL_STRATEGY.CHUNK_FIRST_FALLBACK, startTime, packet);
    return { packet, strategy: RETRIEVAL_STRATEGY.CHUNK_FIRST_FALLBACK, metrics: this.metrics };
  }

  /**
   * 处理降级（无结果、无法回答）
   */
  _handleDegrade(decision, traceId, startTime, reasonCode) {
    logger.info('[DocRetrieval] Degrading:', { trace_id: traceId, reason: reasonCode });

    const packet = this.packer.packEmpty(decision, traceId, reasonCode);
    this.metrics.degrade_count++;
    this._logMetrics(traceId, RETRIEVAL_STRATEGY.DEGRADE, startTime, packet);
    return { packet, strategy: RETRIEVAL_STRATEGY.DEGRADE, metrics: this.metrics };
  }

  /**
   * 尝试用 chunk-first 回退补充 document-first 的结果
   * 仅在 document-first 证据不足时作为补充
   */
  async _tryFallbackSupplement(query, options, decision, traceId, existingPacket) {
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

      // 将新发现的文档追加到 packet
      const mergedPacket = this.packer.pack(
        fallbackCandidates,
        newItems,
        decision,
        traceId
      );

      // 合并原 packet 的文档
      mergedPacket.documents = [...existingPacket.documents, ...mergedPacket.documents];
      mergedPacket.meta.total_candidates = existingPacket.meta.total_candidates + mergedPacket.meta.total_candidates;
      mergedPacket.meta.total_evidence = existingPacket.meta.total_evidence + mergedPacket.meta.total_evidence;
      mergedPacket.meta.max_evidence_score = Math.max(
        existingPacket.meta.max_evidence_score,
        mergedPacket.meta.max_evidence_score
      );
      mergedPacket.meta.reason_codes.push('fallback_supplement');
      mergedPacket.meta.evidence_sufficiency = this.packer._assessSufficiency(mergedPacket);

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
    }

    logger.info('[DocRetrieval] Completed:', logEntry);
  }

  _generateTraceId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `drs_${ts}_${rand}`;
  }
}

export default DocumentRetrievalService;
