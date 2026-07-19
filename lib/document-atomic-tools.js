/**
 * Document Atomic Tools - 文档检索第一批原子能力层
 *
 * audit-round01 Phase 1（task-20260717-atomic-tooling-plan）：
 * 把文档检索的"稳定一步能力"从胖 tool / 编排链路中拆出来，形成
 * 输入语义清楚、输出结构稳定、不偷做多轮策略的原子层。
 *
 * 第一批 6 个原子能力：
 *   1. searchDocumentsByMetadata   — 文档级 metadata 检索（标题/元数据 或 附件文件名，单轮，无 fallback）
 *   2. readDocumentContent         — 读取文档基本信息 + 正文（短期聚合读取，按 chunk seq 拼装）
 *   3. searchChunksInDocument      — 已知文档范围内的 chunk 向量检索
 *   4. searchChunksGlobally        — 全库 chunk 向量检索（根据内容反找证据）
 *   5. rankChunksForQuestion       — 多信号 chunk 重排（向量分 + 关键词覆盖 + 标题命中 + 锁定文档加权）
 *   6. resolveDocumentsFromChunks  — chunk → document 身份反查与聚合
 *
 * 设计原则（对应审计 §3.2 / §8）：
 * - 每个方法只做一件事，一次调用一轮检索，不在内部做 fallback / 多轮改写
 * - 多步策略（先 metadata 后 chunk、附件名兜底等）由 LLM 通过原子 tool 链自行组合（round02，
 *   原 DocumentRetrievalWorkflow 语义编排已废弃，不再存在任何隐式编排器）
 * - 输出统一 { success, ... } 结构，chunk 采用统一扁平契约（见 _normalizeChunkItem）
 * - 权限：所有涉及库检索的方法都要求 user_id，底层服务自带 DocAccessService 硬边界
 *
 * 统一 chunk 契约：
 *   { chunk_id, document_id, document_title, doc_type, collection_id,
 *     revision_id, outline_id, seq, chunk_title, content, score }
 *
 * 使用方式：
 *   const atomicTools = new DocumentAtomicTools(db, configLoader);
 *   const r = await atomicTools.searchDocumentsByMetadata({ metadata_query, user_id });
 */

import logger from './logger.js';
import DocumentSearchService from './document-search-service.js';
import DocRecallService from './doc-recall-service.js';
import DocAccessService from './doc-access-service.js';

/**
 * 第一批原子 tool 名称清单（供 workflow / 未来 tool 暴露引用）
 */
export const ATOMIC_TOOL_NAMES = [
  'search_documents_by_metadata',
  'read_document_content',
  'search_chunks_in_document',
  'search_chunks_globally',
  'rank_chunks_for_question',
  'resolve_documents_from_chunks',
];

class DocumentAtomicTools {
  /**
   * @param {Object} db - 数据库实例
   * @param {Object} configLoader - 配置加载器
   * @param {Object} [deps={}] - 依赖注入（测试用）
   * @param {Object} [deps.searchService] - DocumentSearchService 实例
   * @param {Object} [deps.recallService] - DocRecallService 实例
   * @param {Object} [deps.accessService] - DocAccessService 实例
   * @param {Object} [deps.reranker] - 可选 reranker（audit-round03 变更项 D）
   *   传入 { computeScore(chunk, signals): number } 可替换默认启发式排序
   */
  constructor(db, configLoader, deps = {}) {
    this.db = db;
    this.configLoader = configLoader;
    this.searchService = deps.searchService || (db ? new DocumentSearchService(db) : null);
    this.accessService = deps.accessService || (db ? new DocAccessService(db) : null);
    this.recallService = deps.recallService || null;
    // audit-round03 变更项 D：可替换 reranker，null 时使用默认启发式排序
    this.reranker = deps.reranker || null;
  }

  _ensureRecallService() {
    if (!this.recallService) {
      this.recallService = new DocRecallService(this.db, this.configLoader);
    }
    return this.recallService;
  }

  // ============================================================
  // 1. search_documents_by_metadata
  // ============================================================

  /**
   * 文档级 metadata 检索（单轮，无内部 fallback）
   *
   * @param {Object} params
   * @param {string} params.metadata_query - 文档级检索查询（标题片段、标准号、标签词等）
   * @param {string} params.user_id - 用户ID（权限硬边界）
   * @param {string} [params.collection_id] - 限定集合
   * @param {string[]} [params.doc_types] - 限定文档类型
   * @param {string[]} [params.tag_ids] - 标签过滤
   * @param {number} [params.top_k=10]
   * @param {string[]} [params.match_fields=['title','metadata']] - 匹配面：
   *   - ['title','metadata']（默认）：标题 + 元数据 SQL 匹配
   *   - ['attachment_filename']：附件文件名匹配（原 find_document 内嵌的 fallback，现由 workflow 显式编排）
   * @returns {Promise<Object>} { success, matched_by, documents[], total }
   */
  async searchDocumentsByMetadata(params = {}) {
    const {
      metadata_query,
      user_id,
      collection_id,
      doc_types,
      tag_ids,
      top_k = 10,
      match_fields = ['title', 'metadata'],
    } = params;

    if (!metadata_query || !metadata_query.trim()) {
      return { success: false, error: 'metadata_query is required', documents: [], total: 0 };
    }

    try {
      if (match_fields.length === 1 && match_fields[0] === 'attachment_filename') {
        const rows = await this.searchService.searchByAttachmentFilenames(metadata_query.trim(), {
          userId: user_id,
          doc_types,
          top_k,
          collection_id: collection_id || undefined,
        });
        return {
          success: true,
          matched_by: 'attachment_filename',
          documents: rows || [],
          total: rows?.length || 0,
        };
      }

      const result = await this.searchService.search(metadata_query.trim(), {
        userId: user_id,
        doc_types,
        collection_id: collection_id || undefined,
        tag_ids,
        top_k,
      });

      return {
        success: result.success !== false,
        matched_by: 'title_metadata',
        documents: result.candidates || [],
        total: result.total ?? (result.candidates?.length || 0),
        strategy: result.strategy,
      };
    } catch (error) {
      logger.error('[DocAtomicTools] searchDocumentsByMetadata error:', error.message);
      return { success: false, error: error.message, documents: [], total: 0 };
    }
  }

  // ============================================================
  // 2. read_document_content
  // ============================================================

  /**
   * 读取文档基本信息 + 正文内容（短期聚合读取职责，见审计 §8.3）
   *
   * 正文按当前版本 chunk seq 顺序拼装。暂不拆 get_document_by_id /
   * list_document_sections / get_chunks_by_document，出现结构级需求后再细拆。
   *
   * @param {Object} params
   * @param {string} params.document_id - 文档ID
   * @param {string} params.user_id - 用户ID（权限硬边界）
   * @param {boolean} [params.include_chunks=false] - 是否返回 chunk 列表
   * @param {number} [params.max_chars=20000] - 正文最大字符数
   * @returns {Promise<Object>} { success, document, content, content_truncated, total_chunks, chunks? }
   */
  async readDocumentContent(params = {}) {
    const { document_id, user_id, include_chunks = false, max_chars = 20000 } = params;

    if (!document_id) {
      return { success: false, error: 'document_id is required' };
    }

    try {
      const infoRows = await this.searchService.getDocumentInfo([document_id]);
      if (!infoRows || infoRows.length === 0) {
        return { success: false, error: 'document_not_found' };
      }
      const docInfo = infoRows[0];

      // 权限硬边界：文档所在集合必须在用户可访问范围内
      const accessibleIds = await this.accessService.getAccessibleCollectionIds(user_id);
      if (!accessibleIds.includes(docInfo.collection_id)) {
        return { success: false, error: 'access_denied' };
      }

      const chunkRows = await this.db.sequelize.query(`
        SELECT c.id as chunk_id, c.outline_id, c.title as chunk_title, c.content, c.seq
        FROM document_chunks c
        JOIN document_revisions v ON c.revision_id = v.id
        JOIN documents d ON v.document_id = d.id
        WHERE d.id = ? AND d.current_revision_id = v.id
        ORDER BY c.seq ASC
      `, {
        replacements: [document_id],
        type: this.db.sequelize.QueryTypes.SELECT,
      });

      let content = '';
      let truncated = false;
      for (const row of chunkRows) {
        if (!row.content) continue;
        if (content.length + row.content.length + 1 > max_chars) {
          content += row.content.substring(0, Math.max(0, max_chars - content.length));
          truncated = true;
          break;
        }
        content += (content ? '\n' : '') + row.content;
      }

      const response = {
        success: true,
        document: docInfo,
        content,
        content_truncated: truncated,
        total_chunks: chunkRows.length,
      };
      if (include_chunks) {
        response.chunks = chunkRows.map(r => ({
          chunk_id: r.chunk_id,
          outline_id: r.outline_id,
          chunk_title: r.chunk_title,
          content: r.content,
          seq: r.seq,
        }));
      }
      return response;
    } catch (error) {
      logger.error('[DocAtomicTools] readDocumentContent error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // 3. search_chunks_in_document
  // ============================================================

  /**
   * 已知文档范围内的 chunk 向量检索（"根据文档找内容"的原子步骤）
   *
   * @param {Object} params
   * @param {string} params.content_query - 内容检索查询
   * @param {string[]} params.document_ids - 目标文档ID列表
   * @param {string[]} [params.revision_ids] - 指定版本（不传用 current revision）
   * @param {string} params.user_id - 用户ID
   * @param {number} [params.top_k=5]
   * @param {number} [params.threshold=0.1]
   * @returns {Promise<Object>} { success, chunks[], total }
   */
  async searchChunksInDocument(params = {}) {
    const { content_query, document_ids, revision_ids, user_id, top_k = 5, threshold = 0.1 } = params;

    if (!content_query || !content_query.trim()) {
      return { success: false, error: 'content_query is required', chunks: [], total: 0 };
    }
    if (!document_ids || document_ids.length === 0) {
      return { success: true, chunks: [], total: 0, reason: 'no_target_documents' };
    }

    try {
      const recall = this._ensureRecallService();
      const result = await recall.recallWithinDocuments(content_query.trim(), document_ids, {
        revisionIds: revision_ids?.length > 0 ? revision_ids : undefined,
        top_k,
        threshold,
        userId: user_id,
      });

      if (!result.success) {
        return { success: false, error: result.message || 'recall_failed', chunks: [], total: 0 };
      }
      const chunks = (result.items || []).map(item => this._normalizeChunkItem(item));
      return { success: true, chunks, total: chunks.length };
    } catch (error) {
      logger.error('[DocAtomicTools] searchChunksInDocument error:', error.message);
      return { success: false, error: error.message, chunks: [], total: 0 };
    }
  }

  // ============================================================
  // 4. search_chunks_globally
  // ============================================================

  /**
   * 全库 chunk 向量检索（"根据内容找文档/找证据"的原子步骤）
   *
   * 与 searchChunksInDocument 语义完全不同，禁止合并（审计 §8.4）。
   *
   * @param {Object} params
   * @param {string} params.content_query - 内容检索查询
   * @param {string} params.user_id - 用户ID
   * @param {string} [params.collection_id] - 限定集合
   * @param {string[]} [params.doc_types] - 限定文档类型
   * @param {number} [params.top_k=5]
   * @param {number} [params.threshold=0.1]
   * @returns {Promise<Object>} { success, chunks[], total }
   */
  async searchChunksGlobally(params = {}) {
    const { content_query, user_id, collection_id, doc_types, top_k = 5, threshold = 0.1 } = params;

    if (!content_query || !content_query.trim()) {
      return { success: false, error: 'content_query is required', chunks: [], total: 0 };
    }

    try {
      const recall = this._ensureRecallService();
      const result = await recall.recall(content_query.trim(), {
        scope: 'all',
        doc_types,
        top_k,
        threshold,
        userId: user_id,
        collectionId: collection_id || undefined,
      });

      if (!result.success) {
        return { success: false, error: result.message || 'recall_failed', chunks: [], total: 0 };
      }
      const chunks = (result.items || []).map(item => this._normalizeChunkItem(item));
      return { success: true, chunks, total: chunks.length };
    } catch (error) {
      logger.error('[DocAtomicTools] searchChunksGlobally error:', error.message);
      return { success: false, error: error.message, chunks: [], total: 0 };
    }
  }

  // ============================================================
  // 5. rank_chunks_for_question
  // ============================================================

  /**
   * 多信号 chunk 重排（同步纯函数，不做 IO）
   *
   * 信号构成（审计 §8.5：不应只按原召回顺序透传）：
   * - vector_score：召回向量相似度（0-1）
   * - keyword_coverage：问题关键词在 chunk 内容中的覆盖率（0-1）
   * - title_hit：chunk 所属文档标题 / chunk 标题是否命中问题关键词（0 或 1）
   * - locked_bonus：chunk 是否来自已锁定文档（0 或 1）
   *
   * rank_score = 0.6*vector + 0.25*coverage + 0.1*title_hit + 0.05*locked_bonus
   *
   * @param {Object} params
   * @param {string} params.question - 用户问题
   * @param {Object[]} params.chunks - 统一 chunk 契约数组
   * @param {string[]} [params.locked_document_ids=[]] - 已锁定文档（workflow 已确认目标文档时传入）
   * @param {number} [params.top_k] - 截断数量（不传则全量返回）
   * @returns {Object} { success, chunks[]（含 rank_score / rank_signals，降序）, total }
   */
  rankChunksForQuestion(params = {}) {
    const { question, chunks, locked_document_ids = [], top_k } = params;

    if (!Array.isArray(chunks)) {
      return { success: false, error: 'chunks must be an array', chunks: [], total: 0 };
    }
    if (chunks.length === 0) {
      return { success: true, chunks: [], total: 0 };
    }

    const terms = this._extractTerms(question || '');
    const lockedSet = new Set(locked_document_ids);

    // audit-round03 变更项 D：信号计算与评分解耦，支持可替换 reranker
    const computeSignals = (chunk) => {
      const content = chunk.content || '';
      const vectorScore = Math.max(0, Math.min(1, chunk.score || 0));

      let coverage = 0;
      if (terms.length > 0) {
        let totalWeight = 0;
        let hitWeight = 0;
        for (const t of terms) {
          totalWeight += t.weight;
          if (content.includes(t.text)) hitWeight += t.weight;
        }
        coverage = totalWeight > 0 ? hitWeight / totalWeight : 0;
      }

      const titleText = `${chunk.document_title || ''} ${chunk.chunk_title || ''}`;
      const titleHit = terms.some(t => titleText.includes(t.text)) ? 1 : 0;
      const lockedBonus = lockedSet.has(chunk.document_id) ? 1 : 0;

      return { vector_score: vectorScore, keyword_coverage: Math.round(coverage * 100) / 100, title_hit: titleHit, locked_bonus: lockedBonus };
    };

    const ranked = chunks.map(chunk => {
      const signals = computeSignals(chunk);

      // 默认启发式公式（可被 reranker 替换）
      const rankScore = this.reranker?.computeScore
        ? this.reranker.computeScore(chunk, signals)
        : (0.6 * signals.vector_score + 0.25 * signals.keyword_coverage + 0.1 * signals.title_hit + 0.05 * signals.locked_bonus);

      return {
        ...chunk,
        rank_score: Math.round(rankScore * 10000) / 10000,
        rank_signals: signals,
      };
    }).sort((a, b) => b.rank_score - a.rank_score);

    const finalChunks = typeof top_k === 'number' && top_k > 0 ? ranked.slice(0, top_k) : ranked;
    return { success: true, chunks: finalChunks, total: finalChunks.length };
  }

  // ============================================================
  // 6. resolve_documents_from_chunks
  // ============================================================

  /**
   * chunk → document 身份反查与聚合（连接两类检索面的关键步骤，审计 §8.6）
   *
   * @param {Object} params
   * @param {Object[]} params.chunks - 统一 chunk 契约数组（须含 document_id）
   * @param {boolean} [params.aggregate=true] - 是否输出按文档聚合视图（chunk_count / max_score / top_chunk）
   * @returns {Promise<Object>} { success, documents[], total }
   */
  async resolveDocumentsFromChunks(params = {}) {
    const { chunks, aggregate = true } = params;

    if (!Array.isArray(chunks)) {
      return { success: false, error: 'chunks must be an array', documents: [], total: 0 };
    }

    const docIds = [...new Set(chunks.map(c => c.document_id).filter(Boolean))];
    if (docIds.length === 0) {
      return { success: true, documents: [], total: 0 };
    }

    try {
      const infoRows = await this.searchService.getDocumentInfo(docIds);
      const infoById = new Map(infoRows.map(r => [r.document_id, r]));

      const documents = docIds.map(docId => {
        const info = infoById.get(docId) || { document_id: docId };
        const docChunks = chunks.filter(c => c.document_id === docId);
        const entry = { ...info };
        if (aggregate) {
          const sorted = [...docChunks].sort((a, b) => (b.score || 0) - (a.score || 0));
          entry.chunk_count = docChunks.length;
          entry.max_chunk_score = sorted[0]?.score || 0;
          entry.top_chunk = sorted[0]
            ? { chunk_id: sorted[0].chunk_id, content: (sorted[0].content || '').substring(0, 300), score: sorted[0].score }
            : null;
        }
        return entry;
      }).sort((a, b) => (b.max_chunk_score || 0) - (a.max_chunk_score || 0));

      return { success: true, documents, total: documents.length };
    } catch (error) {
      logger.error('[DocAtomicTools] resolveDocumentsFromChunks error:', error.message);
      return { success: false, error: error.message, documents: [], total: 0 };
    }
  }

  // ============================================================
  // 内部辅助
  // ============================================================

  /**
   * 将 DocRecallService item 归一化为统一扁平 chunk 契约
   */
  _normalizeChunkItem(item) {
    return {
      chunk_id: item.chunk?.id || null,
      document_id: item.document?.id || null,
      document_title: item.document?.title || '',
      doc_type: item.document?.doc_type || '',
      collection_id: item.document?.collection_id || null,
      revision_id: item.revision?.id || null,
      outline_id: item.chunk?.outline_id || null,
      seq: item.chunk?.seq ?? null,
      chunk_title: item.chunk?.title || '',
      content: item.chunk?.content || '',
      score: item.score || 0,
    };
  }

  /**
   * 简易关键词抽取（用于 rank 覆盖率信号）
   *
   * audit-round02 变更项 E：优化中文覆盖策略，减少 2 字滑窗噪声
   * - ASCII 词直接切分（长度>=2）
   * - 中文连续串整体保留
   * - 中文串 > 6 字：额外做 3 字滑窗（原 2 字滑窗噪声过多）
   * - 覆盖率计算时对短 CJK term（长度<=2）降权 0.5
   */
  _extractTerms(text) {
    if (!text) return [];
    const terms = [];

    const asciiWords = text.match(/[A-Za-z0-9][A-Za-z0-9./-]*/g) || [];
    for (const w of asciiWords) {
      if (w.length >= 2) terms.push({ text: w, weight: 1.0 });
    }

    const cjkRuns = text.match(/[\u4e00-\u9fff]+/g) || [];
    for (const run of cjkRuns) {
      if (run.length >= 2) {
        // 完整 run 保留（权重 1.0）
        terms.push({ text: run, weight: 1.0 });
      }
      // > 6 字才做滑窗，滑窗大小 3（减少短词噪声）
      if (run.length > 6) {
        for (let i = 0; i + 3 <= run.length; i++) {
          terms.push({ text: run.substring(i, i + 3), weight: 0.7 });
        }
      }
    }

    return terms;
  }
}

export default DocumentAtomicTools;
