/**
 * RAG Service - 检索增强生成服务（兼容壳层）
 *
 * 提供文档平台检索能力，将检索结果注入到对话上下文中。
 *
 * === 架构说明 ===
 * 本服务是旧"RAG/知识库"概念的兼容壳层。底层实际链路已完全切换为
 * 文档平台两阶段检索（document-first），通过 DocumentRetrievalService 编排：
 *   DocumentQueryDecision → DocumentSearch → DocRecall(evidence) → EvidencePacker
 *
 * === 主路径演进方向 ===
 * - 旧主路径：chat-service → RAGService.retrieve()（自动预检索 + ragContext 文本注入）
 * - 新主路径：LLM tool call → document_retrieval tool → evidence packet（结构化证据）
 * - 本服务在过渡期同时支持两条路径，长期逐步淡出自动预检索模式
 *
 * === 方法说明 ===
 * - retrieve(): 旧格式兼容入口，返回扁平 results[]（供自动预检索使用）
 * - retrievePacket(): 新格式入口，返回完整 evidence packet（供编排层消费）
 * - buildContextMessage(): 将旧格式 results 转为 LLM 上下文文本
 * - buildEvidenceContextMessage(): 将 evidence packet 转为结构化 LLM 上下文（新）
 *
 * 使用方式：
 *   const ragService = new RAGService(db, configLoader);
 *   // 旧路径（兼容）
 *   const result = await ragService.retrieve(query, { userId, topK: 5 });
 *   const context = ragService.buildContextMessage(result.results);
 *   // 新路径（推荐）
 *   const { packet } = await ragService.retrievePacket(query, { userId });
 *   const evidenceContext = ragService.buildEvidenceContextMessage(packet);
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

  /**
   * 构建结构化证据上下文消息（新格式，供回答编排层消费）
   *
   * 与 buildContextMessage() 不同，此方法基于 evidence packet 的结构化信息，
   * 生成包含证据充分性、建议回答模式等元信息的高质量上下文。
   *
   * @param {Object} packet - evidence packet（来自 retrievePacket() 或 document_retrieval tool）
   * @param {Object} options - 选项
   * @param {number} options.maxTokens - 最大 token 数（默认 3000）
   * @returns {string} 格式化的证据上下文消息
   */
  buildEvidenceContextMessage(packet, options = {}) {
    const { maxTokens = 3000 } = options;

    if (!packet || !packet.documents || packet.documents.length === 0) {
      return '';
    }

    const sufficiency = packet.meta?.evidence_sufficiency || 'unknown';
    const responseMode = packet.meta?.suggested_response_mode || 'direct_answer';
    const reasonCodes = packet.meta?.reason_codes || [];

    let context = '';

    // 证据概览
    context += `## 文档检索结果\n`;
    context += `- 检索策略: ${packet.strategy || 'unknown'}\n`;
    context += `- 证据充分性: ${sufficiency}\n`;

    if (responseMode === 'conservative_answer') {
      context += `- ⚠️ 建议回答模式: 保守回答（证据不足，请明确告知用户依据有限）\n`;
    } else if (responseMode === 'clarify') {
      context += `- ⚠️ 建议回答模式: 澄清问题（意图不明确，请向用户确认需求）\n`;
    } else if (responseMode === 'candidate_list') {
      context += `- ⚠️ 建议回答模式: 列出候选（多个可能文档，请先确认目标）\n`;
    } else if (responseMode === 'answer_with_citation') {
      context += `- 建议回答模式: 引用回答（请引用文档来源）\n`;
    }

    if (reasonCodes.length > 0) {
      context += `- 原因标记: ${reasonCodes.join(', ')}\n`;
    }
    context += '\n';

    // 候选文档及证据
    for (let i = 0; i < packet.documents.length; i++) {
      const doc = packet.documents[i];
      const evidenceCount = doc.evidence?.length || 0;

      context += `### 文档 ${i + 1}: ${doc.document_title || '未命名'}\n`;
      context += `- 类型: ${doc.doc_type || 'unknown'} | 集合: ${doc.collection_name || 'unknown'}\n`;
      context += `- 相关度: ${Math.round((doc.relevance_score || 0) * 100)}% | 置信度: ${doc.candidate_confidence || 'unknown'}\n`;
      context += `- 证据条数: ${evidenceCount}\n`;

      if (doc.evidence && doc.evidence.length > 0) {
        context += `\n**关键证据片段：**\n`;
        for (let j = 0; j < Math.min(doc.evidence.length, 3); j++) {
          const ev = doc.evidence[j];
          const snippet = (ev.content || '').substring(0, 400);
          context += `> [证据${j + 1}] (相关度: ${Math.round((ev.score || 0) * 100)}%)\n`;
          context += `> ${snippet}\n\n`;
        }
      }
    }

    // Token 限制
    if (context.length > maxTokens * 1.5) {
      context = context.substring(0, Math.floor(maxTokens * 1.5)) + '\n...(证据上下文已截断)';
    }

    return context;
  }
}

export default RAGService;