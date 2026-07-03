/**
 * Doc Recall Service - 文档内证据召回服务
 *
 * 职责定位：在已确定候选文档范围内，进行 chunk-level 向量证据召回。
 * 这是文档检索链路中的第三层（证据层），不是总召回入口。
 *
 * 完整检索链路请使用 DocumentRetrievalService（统一编排入口）：
 *   DocumentQueryDecisionService → DocumentSearchService → DocRecallService → DocumentEvidencePacker
 *
 * 提供能力：
 * - recall(): 全库 chunk 向量召回（兼容旧链路，建议新代码走 recallWithinDocuments）
 * - recallWithinDocuments(): 在指定文档/版本范围内做 chunk 向量召回（推荐）
 * - expandContext(): 命中 chunk 后扩展上下文窗口
 * - scope 参数（knowledge | contract | department | standard）
 *
 * 使用方法：
 * const recallService = new DocRecallService(db, configLoader);
 * // 推荐：在候选文档范围内召回
 * const results = await recallService.recallWithinDocuments(query, documentIds, { top_k: 5 });
 * // 兼容：全库召回
 * const results = await recallService.recall(query, { scope: 'all', top_k: 5 });
 */

import logger from './logger.js';
import EmbeddingClient from './embedding-client.js';
import { DB_VECTOR_DIM, adjustVectorDimension, vectorToJson } from './vector-utils.js';
import DocAccessService from './doc-access-service.js';
import { getSystemSettingService } from '../server/services/system-setting.service.js';
import modelRegistry from './model-registry.js';

class DocRecallService {
  constructor(db, configLoader) {
    this.db = db;
    this.configLoader = configLoader;
    this.models = {};
  }

  ensureModels() {
    if (!this.models.DocDocument) {
      this.models.DocDocument = this.db.getModel('document');
      this.models.DocVersion = this.db.getModel('document_revision');
      this.models.DocChunk = this.db.getModel('document_chunk');
    }
  }

  /**
   * 统一召回入口
   *
   * @param {string} query - 搜索查询
   * @param {Object} options - 检索选项
   * @param {string} options.scope - 搜索范围：all | knowledge | contract | department | standard
   * @param {string[]} options.doc_types - 文档类型过滤（可选）
   * @param {number} options.top_k - 返回数量（默认 5）
   * @param {number} options.threshold - 相似度阈值（默认 0.1）
   * @param {string} options.userId - 用户ID（权限验证）
   * @param {string} options.org_id - 组织ID（可选）
   * @param {boolean} options.use_new_table - 强制使用新表（可选）
   * @returns {Promise<Object>} 检索结果
   */
  async recall(query, options = {}) {
    const {
      scope = 'all',
      doc_types,
      top_k = 5,
      threshold = 0.1,
      userId,
      org_id,
      embedding_model_id,
      collectionId,
    } = options;

    this.ensureModels();

    logger.info('[DocRecall] Starting recall:', {
      query_length: query?.length || 0,
      scope,
      top_k,
      embedding_model_id,
      collectionId,
    });

    try {
      const resolvedModelId = await this._resolveEmbeddingModelId(embedding_model_id);
      const queryEmbedding = await this.generateQueryEmbedding(query, resolvedModelId);
      if (!queryEmbedding) {
        return { success: false, message: 'Failed to generate embedding', items: [] };
      }

      const { vector: adjustedVector } = adjustVectorDimension(queryEmbedding);
      const vectorJson = vectorToJson(adjustedVector);

      return await this.recallFromNewTable(vectorJson, {
        scope, doc_types, top_k, threshold, userId, org_id, embedding_model_id: resolvedModelId, collectionId,
      });

    } catch (error) {
      logger.error('[DocRecall] Recall error:', error);
      return { success: false, message: error.message, items: [] };
    }
  }

  /**
   * 从新表（doc_*）检索
   */
  async recallFromNewTable(vectorJson, options) {
    const { scope, doc_types, top_k, threshold, userId, org_id, embedding_model_id, collectionId } = options;

    const safeDocTypes = this.validateDocTypes(doc_types);
    if (doc_types && doc_types.length > 0 && safeDocTypes.length === 0) {
      return { success: true, items: [], total: 0 };
    }

    const accessService = new DocAccessService(this.db);
    const accessibleCollectionIds = await accessService.getAccessibleCollectionIds(userId);
    if (!accessibleCollectionIds.length) {
      return { success: true, items: [], total: 0 };
    }

    const effectiveCollectionIds = collectionId
      ? accessibleCollectionIds.filter(id => id === collectionId)
      : accessibleCollectionIds;
    if (!effectiveCollectionIds.length) {
      return { success: true, items: [], total: 0 };
    }

    const collectionPlaceholders = effectiveCollectionIds.map(() => '?').join(',');
    const docTypeFilter = this.buildDocTypeFilter(scope, safeDocTypes);
    const collectionFilter = org_id ? 'AND coll.department_id = ?' : '';
    const accessFilter = `AND d.collection_id IN (${collectionPlaceholders})`;
    const modelFilter = embedding_model_id ? 'AND c.embedding_model_id = ?' : '';
    const params = [vectorJson];

    params.push(...effectiveCollectionIds);
    if (safeDocTypes.length > 0) params.push(...safeDocTypes);
    if (org_id) params.push(org_id);
    if (embedding_model_id) params.push(embedding_model_id);
    params.push(top_k);

    const results = await this.db.sequelize.query(`
      SELECT
        c.id as chunk_id,
        c.embedding_model_id,
        c.outline_id,
        c.title as chunk_title, c.content,
        c.seq,
        v.id as revision_id, v.revision_no, v.revision_label, v.revision_status,
        d.id as document_id, d.title as document_title, d.doc_type, d.collection_id as document_collection_id,
        VEC_DISTANCE_COSINE(c.embedding_vector, VEC_FromText(?)) as distance
      FROM document_chunks c
      JOIN document_revisions v ON c.revision_id = v.id
      JOIN documents d ON v.document_id = d.id
      LEFT JOIN document_collections coll ON d.collection_id = coll.id
      WHERE c.embedding_status = 'ready'
        AND v.revision_status = 'effective'
        AND (v.effective_from IS NULL OR v.effective_from <= CURDATE())
        AND (v.effective_to IS NULL OR v.effective_to >= CURDATE())
        AND d.processing_status = 'ready'
        ${accessFilter}
        ${modelFilter}
        ${docTypeFilter}
        ${collectionFilter}
      ORDER BY distance ASC
      LIMIT ?
    `, {
      replacements: params,
      type: this.db.sequelize.QueryTypes.SELECT,
    });

    const items = results
      .filter(r => (1 - r.distance) >= threshold)
      .map(r => ({
        score: 1 - r.distance,
        chunk: {
          id: r.chunk_id,
          outline_id: r.outline_id,
          title: r.chunk_title,
          content: r.content?.substring(0, 500),
          seq: r.seq,
        },
        revision: {
          id: r.revision_id,
          revision_no: r.revision_no,
          revision_label: r.revision_label,
          status: r.revision_status,
        },
        document: {
          id: r.document_id,
          title: r.document_title,
          doc_type: r.doc_type,
          collection_id: r.document_collection_id || null,
        },
        source: 'new_table',
      }));

    return {
      success: true,
      items,
      total: items.length,
    };
  }

  /**
   * 上下文扩展：命中 seq 后取前后各 windowSize 个 chunk
   */
  async expandContext(revisionId, centerSeq, windowSize = 2) {
    this.ensureModels();
    const chunks = await this.models.DocChunk.findAll({
      where: {
        revision_id: revisionId,
        seq: {
          [this.db.sequelize.Op.between]: [centerSeq - windowSize, centerSeq + windowSize],
        },
      },
      order: [['seq', 'ASC']],
      attributes: ['id', 'seq', 'title', 'content'],
    });
    return chunks.map(c => ({
      seq: c.seq,
      title: c.title,
      content: c.content,
    }));
  }

  VALID_DOC_TYPES = ['knowledge', 'contract', 'department_doc', 'standard'];

  validateDocTypes(doc_types) {
    if (!doc_types || doc_types.length === 0) return [];
    const validated = doc_types.filter(t => this.VALID_DOC_TYPES.includes(t));
    if (validated.length !== doc_types.length) {
      logger.warn('[DocRecall] Invalid doc_types filtered:', { original: doc_types, validated });
    }
    return validated;
  }

  buildDocTypeFilter(scope, doc_types) {
    if (doc_types && doc_types.length > 0) {
      const placeholders = doc_types.map(() => '?').join(',');
      return `AND d.doc_type IN (${placeholders})`;
    }
    const scopeMap = {
      'all': '',
      'knowledge': "AND d.doc_type = 'knowledge'",
      'contract': "AND d.doc_type = 'contract'",
      'department': "AND d.doc_type = 'department_doc'",
      'standard': "AND d.doc_type = 'standard'",
    };
    return scopeMap[scope] || '';
  }

  async _resolveEmbeddingModelId(modelId) {
    if (modelId) {
      return modelId;
    }

    try {
      modelRegistry.init(this.db);
      const modelConfig = await modelRegistry.getDefaultEmbeddingModelConfig();
      return modelConfig?.id || null;
    } catch (error) {
      logger.error('[DocRecall] Failed to get default embedding model:', error.message);
      return null;
    }
  }

  async _getEmbeddingClient(modelId) {
    if (modelId) {
      return await EmbeddingClient.fromModelId(this.db, modelId);
    }
    const defaultModelId = await this._resolveEmbeddingModelId(null);
    if (defaultModelId) {
      return await EmbeddingClient.fromModelId(this.db, defaultModelId);
    }
    logger.warn('[DocRecall] No embedding model available');
    return null;
  }

  async generateQueryEmbedding(query, modelId = null) {
    const client = await this._getEmbeddingClient(modelId);
    if (!client) {
      logger.warn('[DocRecall] Embedding client not available');
      return null;
    }

    try {
      return await client.embed(query);
    } catch (error) {
      logger.error('[DocRecall] Embedding generation error:', error.message);
      return null;
    }
  }

  /**
   * 在指定文档范围内进行 chunk 向量召回（document-first 链路的核心方法）
   *
   * 与 recall() 的区别：
   * - recall() 在全库范围内做 chunk 向量搜索（chunk-first）
   * - recallWithinDocuments() 在指定的候选文档/版本范围内做 chunk 向量搜索（document-first）
   *
   * @param {string} query - 搜索查询
   * @param {string[]} documentIds - 候选文档ID列表
   * @param {Object} options - 检索选项
   * @param {string[]} [options.revisionIds] - 可选，指定版本ID（不传则使用文档的 current_revision）
   * @param {number} [options.top_k=5] - 返回数量
   * @param {number} [options.threshold=0.1] - 相似度阈值
   * @param {string} [options.userId] - 用户ID（权限验证）
   * @param {string} [options.embedding_model_id] - 指定 embedding 模型
   * @returns {Promise<Object>} 检索结果 { success, items, total }
   */
  async recallWithinDocuments(query, documentIds, options = {}) {
    const {
      revisionIds,
      top_k = 5,
      threshold = 0.1,
      userId,
      embedding_model_id,
    } = options;

    this.ensureModels();

    if (!query || !query.trim()) {
      return { success: false, message: 'Query is required', items: [] };
    }

    if (!documentIds || documentIds.length === 0) {
      return { success: true, items: [], total: 0, strategy: 'no_candidates' };
    }

    logger.info('[DocRecall] recallWithinDocuments:', {
      query_length: query?.length || 0,
      candidate_count: documentIds.length,
      top_k,
    });

    try {
      const resolvedModelId = await this._resolveEmbeddingModelId(embedding_model_id);
      const queryEmbedding = await this.generateQueryEmbedding(query, resolvedModelId);
      if (!queryEmbedding) {
        return { success: false, message: 'Failed to generate embedding', items: [] };
      }

      const { vector: adjustedVector } = adjustVectorDimension(queryEmbedding);
      const vectorJson = vectorToJson(adjustedVector);

      // 构建文档范围过滤
      const docPlaceholders = documentIds.map(() => '?').join(',');
      const params = [vectorJson, ...documentIds];

      // 版本过滤：如果指定了 revisionIds，使用精确匹配；否则使用 current_revision
      let revisionFilter;
      if (revisionIds && revisionIds.length > 0) {
        const revPlaceholders = revisionIds.map(() => '?').join(',');
        revisionFilter = `AND v.id IN (${revPlaceholders})`;
        params.push(...revisionIds);
      } else {
        revisionFilter = 'AND v.is_current = 1';
      }

      // embedding 模型过滤
      const modelFilter = resolvedModelId ? 'AND c.embedding_model_id = ?' : '';
      if (resolvedModelId) params.push(resolvedModelId);

      // 权限验证（可选）
      let accessFilter = '';
      if (userId) {
        const accessService = new DocAccessService(this.db);
        const accessibleCollectionIds = await accessService.getAccessibleCollectionIds(userId);
        if (!accessibleCollectionIds.length) {
          return { success: true, items: [], total: 0, strategy: 'no_access' };
        }
        const accessPlaceholders = accessibleCollectionIds.map(() => '?').join(',');
        accessFilter = `AND d.collection_id IN (${accessPlaceholders})`;
        params.push(...accessibleCollectionIds);
      }

      params.push(top_k);

      const results = await this.db.sequelize.query(`
        SELECT
          c.id as chunk_id,
          c.embedding_model_id,
          c.outline_id,
          c.title as chunk_title, c.content,
          c.seq,
          v.id as revision_id, v.revision_no, v.revision_label, v.revision_status,
          d.id as document_id, d.title as document_title, d.doc_type, d.collection_id as document_collection_id,
          VEC_DISTANCE_COSINE(c.embedding_vector, VEC_FromText(?)) as distance
        FROM document_chunks c
        JOIN document_revisions v ON c.revision_id = v.id
        JOIN documents d ON v.document_id = d.id
        WHERE c.embedding_status = 'ready'
          AND v.revision_status = 'effective'
          AND (v.effective_from IS NULL OR v.effective_from <= CURDATE())
          AND (v.effective_to IS NULL OR v.effective_to >= CURDATE())
          AND d.processing_status = 'ready'
          AND d.id IN (${docPlaceholders})
          ${revisionFilter}
          ${modelFilter}
          ${accessFilter}
        ORDER BY distance ASC
        LIMIT ?
      `, {
        replacements: params,
        type: this.db.sequelize.QueryTypes.SELECT,
      });

      const items = results
        .filter(r => (1 - r.distance) >= threshold)
        .map(r => ({
          score: 1 - r.distance,
          chunk: {
            id: r.chunk_id,
            outline_id: r.outline_id,
            title: r.chunk_title,
            content: r.content?.substring(0, 500),
            seq: r.seq,
          },
          revision: {
            id: r.revision_id,
            revision_no: r.revision_no,
            revision_label: r.revision_label,
            status: r.revision_status,
          },
          document: {
            id: r.document_id,
            title: r.document_title,
            doc_type: r.doc_type,
            collection_id: r.document_collection_id || null,
          },
          source: 'evidence_recall',
        }));

      logger.info('[DocRecall] recallWithinDocuments completed:', {
        candidate_count: documentIds.length,
        evidence_count: items.length,
        top_score: items[0]?.score || 0,
      });

      return {
        success: true,
        items,
        total: items.length,
        strategy: 'document_scoped',
        searched_document_ids: documentIds,
      };

    } catch (error) {
      logger.error('[DocRecall] recallWithinDocuments error:', error);
      return { success: false, message: error.message, items: [] };
    }
  }
}

export default DocRecallService;
