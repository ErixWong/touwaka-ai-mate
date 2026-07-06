/**
 * Document Search Service - 文档级候选检索服务
 *
 * 在文档检索链路中作为第二层，负责：
 * - 在用户可访问的文档范围内，返回文档级候选列表
 * - 基于文档标题、类型、标签、metadata 进行匹配
 * - 为后续文档内证据召回缩小搜索空间
 *
 * 当前实现：
 * - 基于 SQL 的标题模糊匹配 + 元数据过滤
 * - 支持 doc_type、collection、标签等多维过滤
 * - 预留全文搜索 / 向量搜索增强接口
 *
 * 使用方式：
 *   const searchService = new DocumentSearchService(db);
 *   const candidates = await searchService.search(query, { userId, doc_types, top_k });
 */

import logger from './logger.js';
import DocAccessService from './doc-access-service.js';

class DocumentSearchService {
  constructor(db) {
    this.db = db;
    this.accessService = new DocAccessService(db);
    this.models = {};
  }

  _ensureModels() {
    if (!this.models.Document) {
      this.models.Document = this.db.getModel('document');
      this.models.DocumentRevision = this.db.getModel('document_revision');
      this.models.DocumentCollection = this.db.getModel('document_collection');
      this.models.DocTag = this.db.getModel('doc_tag');
      this.models.DocDocumentTag = this.db.getModel('doc_document_tag');
    }
  }

  /**
   * 文档级候选检索
   *
   * @param {string} query - 搜索查询
   * @param {Object} options - 检索选项
   * @param {string} options.userId - 用户ID（权限验证）
   * @param {string[]} [options.doc_types] - 文档类型过滤
   * @param {string} [options.collection_id] - 指定集合ID
   * @param {string[]} [options.tag_ids] - 标签ID过滤
   * @param {number} [options.top_k=10] - 返回候选数量
   * @param {boolean} [options.include_metadata=false] - 是否返回完整 metadata
   * @returns {Promise<Object>} 候选文档列表
   */
  async search(query, options = {}) {
    const {
      userId,
      doc_types,
      collection_id,
      tag_ids,
      top_k = 10,
      include_metadata = false,
    } = options;

    this._ensureModels();

    if (!query || !query.trim()) {
      return { success: true, candidates: [], total: 0, strategy: 'empty_query' };
    }

    logger.info('[DocSearch] Starting document-level search:', {
      query_length: query?.length || 0,
      doc_types,
      collection_id,
      top_k,
    });

    try {
      // 1. 获取用户可访问的集合
      const accessibleCollectionIds = await this.accessService.getAccessibleCollectionIds(userId);
      if (!accessibleCollectionIds.length) {
        return { success: true, candidates: [], total: 0, strategy: 'no_access' };
      }

      // 2. 确定有效的集合范围
      const effectiveCollectionIds = collection_id
        ? accessibleCollectionIds.filter(id => id === collection_id)
        : accessibleCollectionIds;
      if (!effectiveCollectionIds.length) {
        return { success: true, candidates: [], total: 0, strategy: 'no_matching_collection' };
      }

      // 3. 构建查询条件
      const conditions = [
        'd.processing_status = \'ready\'',
        `d.collection_id IN (${effectiveCollectionIds.map(() => '?').join(',')})`,
        'd.current_revision_id = v.id',
      ];

      const params = [...effectiveCollectionIds];

      if (doc_types && doc_types.length > 0) {
        conditions.push(`d.doc_type IN (${doc_types.map(() => '?').join(',')})`);
        params.push(...doc_types);
      }

      // 标签过滤
      let tagJoin = '';
      if (tag_ids && tag_ids.length > 0) {
        tagJoin = `JOIN doc_document_tags dt ON d.id = dt.document_id`;
        conditions.push(`dt.tag_id IN (${tag_ids.map(() => '?').join(',')})`);
        params.push(...tag_ids);
      }

      // 4. 构建相关性评分：标题匹配 + 类型匹配
      const trimmedQuery = query.trim();
      const queryWords = trimmedQuery.split(/\s+/).filter(w => w.length > 0);

      // 标题精确匹配得分最高
      const titleExactScore = `CASE WHEN d.title = ? THEN 100 ELSE 0 END`;
      params.push(trimmedQuery);

      // 标题包含查询得分
      const titleContainsScore = `CASE WHEN d.title LIKE ? THEN 50 ELSE 0 END`;
      params.push(`%${trimmedQuery}%`);

      // 关键词部分匹配得分
      let keywordScoreParts = [];
      for (const word of queryWords) {
        if (word.length >= 2) {
          keywordScoreParts.push(`CASE WHEN d.title LIKE ? THEN 10 ELSE 0 END`);
          params.push(`%${word}%`);
        }
      }
      const keywordScore = keywordScoreParts.length > 0
        ? `(${keywordScoreParts.join(' + ')})`
        : '0';

      // metadata JSON 中包含查询词（适配 metadata 为 JSON 字符串的场景）
      const metadataScore = `CASE WHEN d.metadata LIKE ? THEN 5 ELSE 0 END`;
      params.push(`%${trimmedQuery}%`);

      const relevanceScoreExpr = `(${titleExactScore} + ${titleContainsScore} + ${keywordScore} + ${metadataScore})`;

      // 5. 执行查询
      const selectFields = [
        'd.id as document_id',
        'd.title as document_title',
        'd.doc_type',
        'd.collection_id',
        'coll.name as collection_name',
        'v.id as revision_id',
        'v.revision_no',
        'v.revision_label',
        `${relevanceScoreExpr} as relevance_score`,
      ];

      if (include_metadata) {
        selectFields.push('d.metadata');
      }

      const sql = `
        SELECT ${selectFields.join(', ')}
        FROM documents d
        JOIN document_revisions v ON d.current_revision_id = v.id
        LEFT JOIN document_collections coll ON d.collection_id = coll.id
        ${tagJoin}
        WHERE ${conditions.join(' AND ')}
        ORDER BY relevance_score DESC, d.updated_at DESC
        LIMIT ?
      `;
      params.push(top_k);

      const rows = await this.db.sequelize.query(sql, {
        replacements: params,
        type: this.db.sequelize.QueryTypes.SELECT,
      });

      // 6. 格式化候选结果
      const candidates = rows
        .filter(r => r.relevance_score > 0)
        .map(r => ({
          document_id: r.document_id,
          document_title: r.document_title,
          doc_type: r.doc_type,
          collection_id: r.collection_id,
          collection_name: r.collection_name,
          revision_id: r.revision_id,
          revision_no: r.revision_no,
          revision_label: r.revision_label,
          relevance_score: r.relevance_score,
          ...(include_metadata && r.metadata ? { metadata: r.metadata } : {}),
        }));

      // 7. 如果基于相关性的结果不足，补充同类型的最新文档作为候选
      let strategy = 'relevance_match';
      if (candidates.length === 0 && doc_types && doc_types.length > 0) {
        // 回退：返回指定类型的最新文档
        const fallbackRows = await this._fallbackLatestByType(effectiveCollectionIds, doc_types, top_k);
        candidates.push(...fallbackRows);
        strategy = 'fallback_latest_by_type';
      }

      logger.info('[DocSearch] Search completed:', {
        candidate_count: candidates.length,
        strategy,
        top_score: candidates[0]?.relevance_score || 0,
      });

      return {
        success: true,
        candidates,
        total: candidates.length,
        strategy,
      };

    } catch (error) {
      logger.error('[DocSearch] Search error:', error);
      return { success: false, message: error.message, candidates: [], total: 0 };
    }
  }

  /**
   * 回退：返回指定类型的最新文档
   */
  async _fallbackLatestByType(collectionIds, docTypes, limit) {
    try {
      const placeholders = collectionIds.map(() => '?').join(',');
      const typePlaceholders = docTypes.map(() => '?').join(',');
      const rows = await this.db.sequelize.query(`
        SELECT
          d.id as document_id, d.title as document_title, d.doc_type,
          d.collection_id, coll.name as collection_name,
          v.id as revision_id, v.revision_no, v.revision_label,
          1 as relevance_score
        FROM documents d
        JOIN document_revisions v ON d.current_revision_id = v.id
        LEFT JOIN document_collections coll ON d.collection_id = coll.id
        WHERE d.processing_status = 'ready'
          AND d.collection_id IN (${placeholders})
          AND d.doc_type IN (${typePlaceholders})
          AND d.current_revision_id = v.id
        ORDER BY d.updated_at DESC
        LIMIT ?
      `, {
        replacements: [...collectionIds, ...docTypes, limit],
        type: this.db.sequelize.QueryTypes.SELECT,
      });

      return rows.map(r => ({
        document_id: r.document_id,
        document_title: r.document_title,
        doc_type: r.doc_type,
        collection_id: r.collection_id,
        collection_name: r.collection_name,
        revision_id: r.revision_id,
        revision_no: r.revision_no,
        revision_label: r.revision_label,
        relevance_score: 0,
        candidate_confidence: 'low',
        is_heuristic_fallback: true,
      }));
    } catch (error) {
      logger.warn('[DocSearch] Fallback query error:', error.message);
      return [];
    }
  }

  /**
   * 按文档ID批量获取文档基本信息
   * 用于在 evidence recall 阶段补充文档身份信息
   *
   * @param {string[]} documentIds - 文档ID列表
   * @returns {Promise<Object[]>} 文档基本信息列表
   */
  async getDocumentInfo(documentIds) {
    if (!documentIds || documentIds.length === 0) return [];

    this._ensureModels();
    const placeholders = documentIds.map(() => '?').join(',');
    const rows = await this.db.sequelize.query(`
      SELECT
        d.id as document_id, d.title as document_title, d.doc_type,
        d.collection_id, coll.name as collection_name,
        v.id as revision_id, v.revision_no, v.revision_label
      FROM documents d
      JOIN document_revisions v ON d.current_revision_id = v.id
      LEFT JOIN document_collections coll ON d.collection_id = coll.id
      WHERE d.id IN (${placeholders})
    `, {
      replacements: documentIds,
      type: this.db.sequelize.QueryTypes.SELECT,
    });

    return rows.map(r => ({
      document_id: r.document_id,
      document_title: r.document_title,
      doc_type: r.doc_type,
      collection_id: r.collection_id,
      collection_name: r.collection_name,
      revision_id: r.revision_id,
      revision_no: r.revision_no,
      revision_label: r.revision_label,
    }));
  }
}

export default DocumentSearchService;
