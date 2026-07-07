/**
 * RAG Service — 旧自动预检索路径兼容壳层（待最终删除）
 *
 * === 状态说明 ===
 * 旧自动预检索路径（_maybeLegacyAutoRetrieval → ragContext 字符串注入）已于 2026-07-07 退场。
 * 证据格式化职责（buildEvidenceContextMessage）已迁至 lib/evidence-formatter.js，
 * 且本模块中的重复实现已于 Round 02 删除。
 *
 * === 当前仍保留的方法（均为空壳，无调用方）===
 * - retrieve():            旧格式兼容入口 → 内部委托 DocumentRetrievalService
 * - retrievePacket():      新格式入口 → 内部委托 DocumentRetrievalService
 * - buildContextMessage():  旧文本格式化 → 仅旧自动路径使用，已无调用方
 * - _packetToFlatResults(): 内部辅助方法
 * - getLastPacket():        调试/观测用
 *
 * === 删除前提 ===
 * 上述方法均无外部调用方（2026-07-07 grep 验证），可在确认后整体删除本模块。
 * 保留原因：作为过渡期安全网，防止回退需要。建议在 Round 03 或后续任务中执行最终删除。
 */

import logger from './logger.js';
import DocumentRetrievalService from './document-retrieval-service.js';

class RAGService {
  constructor(db, configLoader) {
    this.db = db;
    this.configLoader = configLoader;
    this.retrievalService = null;
    this._lastPacket = null;  // 最近一次检索的完整 packet，供调试/观测
  }

  _ensureRetrievalService() {
    if (!this.retrievalService) {
      this.retrievalService = new DocumentRetrievalService(this.db, this.configLoader);
    }
  }

  /**
   * 检索知识库内容（主入口，兼容旧格式）
   *
   * 内部委托 DocumentRetrievalService 走 document-first 链路，
   * 将 evidence packet 转换为兼容旧格式的扁平结果列表。
   *
   * @param {string} query - 搜索查询
   * @param {Object} options - 检索选项
   * @param {number} [options.topK=5] - 返回数量
   * @param {number} [options.threshold=0.1] - 相似度阈值（用于 evidence 过滤）
   * @param {string} [options.userId] - 用户ID
   * @param {string} [options.collectionId] - 指定集合ID
   * @param {string[]} [options.docTypes] - 文档类型过滤
   * @returns {Promise<Object>} { success, results, query, total, strategy }
   */
  async retrieve(query, options = {}) {
    const { topK = 5, threshold = 0.1, userId, collectionId, docTypes } = options;

    this._ensureRetrievalService();

    try {
      const result = await this.retrievalService.retrieve(query, {
        userId,
        doc_types: docTypes,
        collection_id: collectionId,
        top_k_candidates: 10,
        top_k_evidence: topK,
        evidence_threshold: threshold,
        allow_fallback: true,
      });

      this._lastPacket = result.packet;

      // 将 document-first packet 转换为兼容旧格式的扁平结果列表
      const formattedResults = this._packetToFlatResults(result.packet);

      logger.info('[RAG] Retrieve completed:', {
        query_length: query?.length || 0,
        result_count: formattedResults.length,
        top_similarity: formattedResults[0]?.similarity || 0,
        strategy: result.strategy,
        evidence_sufficiency: result.packet?.meta?.evidence_sufficiency,
      });

      return {
        success: true,
        results: formattedResults,
        query,
        total: formattedResults.length,
        strategy: result.strategy,
      };

    } catch (error) {
      logger.error('[RAG] Retrieve error:', error);
      return { success: false, message: error.message, results: [] };
    }
  }

  /**
   * 检索并返回完整的 evidence packet（新格式，供编排层消费）
   *
   * 与 retrieve() 不同，此方法返回结构化 packet，包含：
   * - 文档身份信息
   * - 证据充分性评估
   * - 决策信息
   * - 完整的文档→证据层级关系
   *
   * @param {string} query - 搜索查询
   * @param {Object} options - 检索选项（同 retrieve()）
   * @returns {Promise<Object>} { packet, strategy, metrics }
   */
  async retrievePacket(query, options = {}) {
    const { topK = 5, threshold = 0.1, userId, collectionId, docTypes } = options;

    this._ensureRetrievalService();

    const result = await this.retrievalService.retrieve(query, {
      userId,
      doc_types: docTypes,
      collection_id: collectionId,
      top_k_candidates: 10,
      top_k_evidence: topK,
      evidence_threshold: threshold,
      allow_fallback: true,
    });

    this._lastPacket = result.packet;
    return result;
  }

  /**
   * 获取最近一次检索的完整 packet（供调试/观测）
   */
  getLastPacket() {
    return this._lastPacket;
  }

  /**
   * 将 evidence packet 转换为兼容旧格式的扁平结果列表
   */
  _packetToFlatResults(packet) {
    if (!packet || !packet.documents || packet.documents.length === 0) {
      return [];
    }

    const results = [];
    for (const doc of packet.documents) {
      if (!doc.evidence || doc.evidence.length === 0) continue;

      for (const ev of doc.evidence) {
        results.push({
          chunk_id: ev.chunk_id,
          title: doc.document_title || '',
          content: ev.content || '',
          context: '',
          similarity: ev.score || 0,
          section_id: ev.outline_id || null,
          section_title: null,
          document_id: doc.document_id,
          document_title: doc.document_title,
          collection_id: doc.collection_id || null,
          // 新增字段（供未来消费方使用）
          candidate_confidence: doc.candidate_confidence || 'high',
          is_heuristic_fallback: doc.is_heuristic_fallback || false,
        });
      }
    }

    // 按 similarity 降序排列
    results.sort((a, b) => b.similarity - a.similarity);

    return results;
  }

  /**
   * 构建 RAG 上下文消息
   *
   * @param {Array} results - 检索结果（来自 retrieve() 的 results 字段）
   * @param {Object} options - 选项
   * @param {number} options.maxTokens - 最大 token 数（默认 2000）
   * @param {string} options.style - 输出风格（default, concise, detailed）
   * @returns {string} 格式化的上下文消息
   */
  buildContextMessage(results, options = {}) {
    const { maxTokens = 2000, style = 'default' } = options;

    if (!results || results.length === 0) {
      return '';
    }

    let context = '文档检索结果:\n\n';

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const similarity = Math.round(r.similarity * 100);
      const title = r.title || '无标题';
      const content = r.content || '';
      const articleTitle = r.document_title || '';

      context += `[${i + 1}] ${title} (相似度: ${similarity}%)`;
      if (articleTitle) {
        context += `\n来源: ${articleTitle}`;
      }
      context += '\n';

      if (content) {
        if (style === 'concise') {
          context += `内容: ${content.substring(0, 300)}\n`;
        } else if (style === 'detailed') {
          context += `内容: ${content}\n`;
        } else {
          context += `内容: ${content.substring(0, 500)}\n`;
        }
      }
      context += '\n';
    }

    // 限制 token 数（简单估算：1 字符 ≈ 1.5 token）
    if (context.length > maxTokens * 1.5) {
      context = context.substring(0, Math.floor(maxTokens * 1.5)) + '\n...(上下文已截断)';
    }

    return context;
  }

  // buildEvidenceContextMessage() 已迁至 lib/evidence-formatter.js（Round 01）
  // 本模块中的重复实现已于 Round 02 删除
}

export default RAGService;