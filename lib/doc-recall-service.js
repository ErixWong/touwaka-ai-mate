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
      query_preview: typeof query === 'string' ? query.substring(0, 120) : null,
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
    if (embedding_model_id) params.push(embedding_model_id);
    if (safeDocTypes.length > 0) params.push(...safeDocTypes);
    if (org_id) params.push(org_id);
    params.push(top_k);

    const mainRecallSql = `
      SELECT *
      FROM (
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
          AND d.processing_status = 'ready'
          AND d.current_revision_id = v.id
          ${accessFilter}
          ${modelFilter}
          ${docTypeFilter}
          ${collectionFilter}
      ) scored
      WHERE scored.distance IS NOT NULL
      ORDER BY scored.distance ASC
      LIMIT ?
    `;

    const results = await this.db.sequelize.query(mainRecallSql, {
      replacements: params,
      type: this.db.sequelize.QueryTypes.SELECT,
    });

    if (results.length === 0) {
      try {
        const diagnoseBaseParams = [];
        diagnoseBaseParams.push(...effectiveCollectionIds);
        if (embedding_model_id) diagnoseBaseParams.push(embedding_model_id);
        if (safeDocTypes.length > 0) diagnoseBaseParams.push(...safeDocTypes);
        if (org_id) diagnoseBaseParams.push(org_id);

        const candidateCountSql = `
          SELECT COUNT(*) AS candidate_count
          FROM document_chunks c
          JOIN document_revisions v ON c.revision_id = v.id
          JOIN documents d ON v.document_id = d.id
          LEFT JOIN document_collections coll ON d.collection_id = coll.id
          WHERE c.embedding_status = 'ready'
            AND d.processing_status = 'ready'
            AND d.current_revision_id = v.id
            ${accessFilter}
            ${modelFilter}
            ${docTypeFilter}
            ${collectionFilter}
        `;

        const [candidateCountRow] = await this.db.sequelize.query(candidateCountSql, {
          replacements: diagnoseBaseParams,
          type: this.db.sequelize.QueryTypes.SELECT,
        });

        const directTop10Sql = `
          SELECT
            c.id as chunk_id,
            d.id as document_id,
            d.title as document_title,
            d.doc_type,
            VEC_DISTANCE_COSINE(c.embedding_vector, VEC_FromText(?)) as distance
          FROM document_chunks c
          JOIN document_revisions v ON c.revision_id = v.id
          JOIN documents d ON v.document_id = d.id
          LEFT JOIN document_collections coll ON d.collection_id = coll.id
          WHERE c.embedding_status = 'ready'
            AND d.processing_status = 'ready'
            AND d.current_revision_id = v.id
            ${accessFilter}
            ${modelFilter}
            ${docTypeFilter}
            ${collectionFilter}
          ORDER BY distance ASC
          LIMIT 10
        `;

        const diagnoseRows = await this.db.sequelize.query(directTop10Sql, {
          replacements: [vectorJson, ...diagnoseBaseParams],
          type: this.db.sequelize.QueryTypes.SELECT,
        });

        const [sameConnectionCandidateCountRow] = await this.db.sequelize.query(candidateCountSql, {
          replacements: diagnoseBaseParams,
          type: this.db.sequelize.QueryTypes.SELECT,
          raw: true,
        });

        const sameConnectionTop10Rows = await this.db.sequelize.query(directTop10Sql, {
          replacements: [vectorJson, ...diagnoseBaseParams],
          type: this.db.sequelize.QueryTypes.SELECT,
          raw: true,
        });

        const sameConnectionMainRows = await this.db.sequelize.query(mainRecallSql, {
          replacements: params,
          type: this.db.sequelize.QueryTypes.SELECT,
          raw: true,
        });

        logger.warn('[DocRecall] Zero-result diagnostics:', {
          diagnostics_version: '2026-07-06-r2-same-connection-probe',
          scope,
          collectionId,
          userId,
          accessible_collection_count: accessibleCollectionIds.length,
          accessible_collection_ids: accessibleCollectionIds.slice(0, 20),
          effective_collection_count: effectiveCollectionIds.length,
          effective_collection_ids: effectiveCollectionIds,
          safe_doc_types: safeDocTypes,
          org_id: org_id || null,
          resolved_embedding_model_id: embedding_model_id,
          main_sql_param_count: params.length,
          diagnose_param_count: diagnoseBaseParams.length,
          main_sql_params_preview: params.map((value, index) => ({
            index,
            type: Array.isArray(value) ? 'array' : typeof value,
            value: typeof value === 'string'
              ? (value.length > 180 ? `${value.slice(0, 180)}...` : value)
              : value,
            length: typeof value === 'string' || Array.isArray(value) ? value.length : null,
          })),
          diagnose_params_preview: diagnoseBaseParams.map((value, index) => ({
            index,
            type: Array.isArray(value) ? 'array' : typeof value,
            value,
            length: typeof value === 'string' || Array.isArray(value) ? value.length : null,
          })),
          candidate_count_before_distance_filter: candidateCountRow?.candidate_count || 0,
          direct_top10_count: Array.isArray(diagnoseRows) ? diagnoseRows.length : 0,
          same_connection_candidate_count: sameConnectionCandidateCountRow?.candidate_count || 0,
          same_connection_direct_top10_count: Array.isArray(sameConnectionTop10Rows) ? sameConnectionTop10Rows.length : 0,
          same_connection_main_count: Array.isArray(sameConnectionMainRows) ? sameConnectionMainRows.length : 0,
          direct_top10_preview: Array.isArray(diagnoseRows) ? diagnoseRows.slice(0, 5).map(row => ({
            chunk_id: row.chunk_id,
            document_id: row.document_id,
            document_title: row.document_title,
            doc_type: row.doc_type,
            distance: row.distance,
            score: row.distance == null ? null : 1 - row.distance,
          })) : [],
          same_connection_direct_top10_preview: Array.isArray(sameConnectionTop10Rows) ? sameConnectionTop10Rows.slice(0, 5).map(row => ({
            chunk_id: row.chunk_id,
            document_id: row.document_id,
            document_title: row.document_title,
            doc_type: row.doc_type,
            distance: row.distance,
            score: row.distance == null ? null : 1 - row.distance,
          })) : [],
          same_connection_main_preview: Array.isArray(sameConnectionMainRows) ? sameConnectionMainRows.slice(0, 5).map(row => ({
            chunk_id: row.chunk_id,
            document_id: row.document_id,
            distance: row.distance,
            score: row.distance == null ? null : 1 - row.distance,
            embedding_model_id: row.embedding_model_id,
          })) : [],
        });
      } catch (diagnoseError) {
        logger.warn('[DocRecall] Zero-result diagnostics failed:', {
          error: diagnoseError.message,
          scope,
          collectionId,
          userId,
          resolved_embedding_model_id: embedding_model_id,
        });
      }
    }

    logger.info('[DocRecall] Raw recall candidates before threshold:', {
      scope,
      collectionId,
      userId,
      accessible_collection_count: accessibleCollectionIds.length,
      effective_collection_count: effectiveCollectionIds.length,
      effective_collection_ids: effectiveCollectionIds,
      safe_doc_types: safeDocTypes,
      requested_top_k: top_k,
      threshold,
      resolved_embedding_model_id: embedding_model_id,
      raw_count: results.length,
      vector_json_length: typeof vectorJson === 'string' ? vectorJson.length : null,
      top_scores: results.slice(0, 5).map(r => ({
        chunk_id: r.chunk_id,
        document_id: r.document_id,
        distance: r.distance,
        score: 1 - r.distance,
        embedding_model_id: r.embedding_model_id,
      })),
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
   * audit-round01 P1-2: 支持 query_plan 对象输入，传递结构化 facets
   *
   * @param {string|Object} query - 搜索查询字符串，或 query_plan 对象
   * @param {string[]} documentIds - 候选文档ID列表
   * @param {Object} options - 检索选项
   * @param {string[]} [options.revisionIds] - 可选，指定版本ID
   * @param {number} [options.top_k=5] - 返回数量
   * @param {number} [options.threshold=0.1] - 相似度阈值
   * @param {string} [options.userId] - 用户ID（权限验证）
   * @param {string} [options.embedding_model_id] - 指定 embedding 模型
   * @param {boolean} [options.enable_rerank=true] - 是否启用 hybrid rerank
   * @returns {Promise<Object>} 检索结果 { success, items, total }
   */
  async recallWithinDocuments(query, documentIds, options = {}) {
    const {
      revisionIds,
      top_k = 5,
      threshold = 0.1,
      userId,
      embedding_model_id,
      enable_rerank = true,
    } = options;

    // audit-round01 P1-2: 兼容 string 和 query_plan 双输入
    const semanticQuery = typeof query === 'string' ? query : (query.semantic_query || query.raw_query || '');
    // audit-round02 P0-2: 统一提取 query_plan，兼容 { query_plan: {...} } 嵌套和顶层平铺
    // audit-round03 P1-3: { query_plan: {...} } 嵌套已废弃，主链改为扁平传递 { entity_terms, procedure_terms, ... }
    //  保留此兼容提取以支持可能的旧调用方，新代码应直接使用顶层字段。
    // audit-round04 P2-1: 兼容路径退场计划
    //  - 保留原因：确保非主链调用方（如 tool/skill 直接调用 recallWithinDocuments）不会因扁平化而断裂
    //  - 移除时机：下一轮 expert-retrieval 审计放行后，确认无其他 caller 传递 query_plan 嵌套格式
    //  - 验证条件：grep 全仓 `query_plan` 无出现在构建 { semantic_query, query_plan } 对象处（主链已扁平）
    //  - 移除方法：删除三元判断中的 query.query_plan 分支，queryPlan 直接取 query（已是扁平格式）
    const queryPlan = typeof query === 'object'
      ? (query.query_plan && typeof query.query_plan === 'object' ? query.query_plan : query)
      : { raw_query: query, semantic_query: query };

    this.ensureModels();

    if (!documentIds || documentIds.length === 0) {
      return { success: true, items: [], total: 0, strategy: 'no_candidates' };
    }

    logger.info('[DocRecall] recallWithinDocuments:', {
      query_length: semanticQuery?.length || 0,
      query_preview: typeof semanticQuery === 'string' ? semanticQuery.substring(0, 120) : null,
      candidate_count: documentIds.length,
      top_k,
      enable_rerank,
    });

    try {
      const resolvedModelId = await this._resolveEmbeddingModelId(embedding_model_id);
      const queryEmbedding = await this.generateQueryEmbedding(semanticQuery, resolvedModelId);
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

      // audit-round01 P0-1: 取 wider candidate set 供 hybrid rerank
      const rerankPoolSize = enable_rerank ? Math.max(top_k * 4, 20) : top_k;
      params.push(rerankPoolSize);

      const results = await this.db.sequelize.query(`
        SELECT *
        FROM (
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
            AND d.processing_status = 'ready'
            AND d.id IN (${docPlaceholders})
            AND d.current_revision_id = v.id
            ${revisionFilter}
            ${modelFilter}
            ${accessFilter}
        ) scored
        WHERE scored.distance IS NOT NULL
        ORDER BY scored.distance ASC
        LIMIT ?
      `, {
        replacements: params,
        type: this.db.sequelize.QueryTypes.SELECT,
      });

      if (results.length === 0) {
        logger.warn('[DocRecall] Zero document-scoped results diagnostics:', {
          userId: userId || null,
          candidate_document_count: documentIds.length,
          candidate_revision_count: revisionIds?.length || 0,
          resolved_embedding_model_id: resolvedModelId,
          access_filter_enabled: Boolean(userId),
        });
      }

      logger.info('[DocRecall] Raw document-scoped candidates before threshold:', {
        candidate_count: documentIds.length,
        requested_top_k: top_k,
        threshold,
        resolved_embedding_model_id: resolvedModelId,
        raw_count: results.length,
        vector_json_length: typeof vectorJson === 'string' ? vectorJson.length : null,
        top_scores: results.slice(0, 5).map(r => ({
          chunk_id: r.chunk_id,
          document_id: r.document_id,
          distance: r.distance,
          score: 1 - r.distance,
          embedding_model_id: r.embedding_model_id,
        })),
      });

      const items = results
        .filter(r => (1 - r.distance) >= threshold)
        .map(r => ({
          _raw: { distance: r.distance, chunk_title: r.chunk_title, content: r.content },
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

      // audit-round01 P0-1: Hybrid rerank
      let finalItems = items;
      const rerankDebug = [];
      if (enable_rerank && items.length > 0) {
        const rerankResult = this._hybridRerank(items, queryPlan);
        finalItems = rerankResult.items.slice(0, top_k);
        for (const entry of rerankResult.debug.slice(0, 5)) {
          rerankDebug.push(entry);
        }
      } else {
        finalItems = items.slice(0, top_k);
      }

      // 清理内部 _raw 字段
      finalItems = finalItems.map(({ _raw, ...rest }) => rest);

      logger.info('[DocRecall] recallWithinDocuments completed:', {
        candidate_count: documentIds.length,
        evidence_count: finalItems.length,
        raw_count: items.length,
        top_score: finalItems[0]?.score || 0,
        rerank_applied: enable_rerank && items.length > 0,
        rerank_debug: rerankDebug,
      });

      return {
        success: true,
        items: finalItems,
        total: finalItems.length,
        strategy: 'document_scoped',
        searched_document_ids: documentIds,
      };

    } catch (error) {
      logger.error('[DocRecall] recallWithinDocuments error:', error);
      return { success: false, message: error.message, items: [] };
    }
  }

  /**
   * Hybrid Rerank（audit-round01 P0-1）
   *
   * 在纯向量相似度之上，叠加实体命中、程序词、结构锚点的综合打分。
   * 权重可配置、打分可审计——每个证据 item 产出 rerank_debug 子分数。
   *
   * @param {Object[]} items - 原始向量召回结果（已映射）
   * @param {Object} queryPlan - 查询计划（含 entity_terms, procedure_terms）
   * @returns {{ items: Object[], debug: Object[] }}
   */
  _hybridRerank(items, queryPlan) {
    const entityTerms = queryPlan.entity_terms || [];
    const procedureTerms = queryPlan.procedure_terms || [];
    const WEIGHTS = {
      semantic: 0.45,
      entity: 0.30,
      procedure: 0.15,
      structural: 0.10,
    };

    const debug = [];

    const reranked = items.map((item, idx) => {
      const content = (item._raw?.content || item.chunk?.content || '').toLowerCase();
      const title = (item._raw?.chunk_title || item.chunk?.title || '').toLowerCase();
      const combinedText = title + ' ' + content;
      const seq = item.chunk?.seq || 0;

      // entity_exact_match_score
      let entityScore = 0;
      const matchedEntities = [];
      if (entityTerms.length > 0) {
        let hits = 0;
        for (const et of entityTerms) {
          const etLower = et.toLowerCase();
          if (combinedText.includes(etLower)) {
            hits++;
            matchedEntities.push(et);
          }
        }
        entityScore = Math.min(hits / entityTerms.length, 1.0);
      }

      // procedure_term_match_score
      let procedureScore = 0;
      const matchedProcedures = [];
      if (procedureTerms.length > 0) {
        let hits = 0;
        for (const pt of procedureTerms) {
          if (combinedText.includes(pt.toLowerCase())) {
            hits++;
            matchedProcedures.push(pt);
          }
        }
        procedureScore = Math.min(hits / Math.max(procedureTerms.length, 1), 1.0);
      }

      // structural_anchor_score — chapter/section proximity heuristics
      let structuralScore = 0.5; // neutral default
      // 章节锚点检测：内容中的章节编号（如 14.2.5）
      const sectionPattern = /\b\d+\.\d+(?:\.\d+)?\b/;
      if (sectionPattern.test(combinedText)) {
        // 如果 entity 也匹配了数字编码（如 14.2.5、IPX5），则大幅加分
        if (entityTerms.some(et => /\d/.test(et) && combinedText.includes(et.toLowerCase()))) {
          structuralScore = 1.0;
        } else {
          structuralScore = 0.8;
        }
      }
      // 表格标题/条款关键词加分
      if (/\b(?:表|表格|条款|附录|附图)\b/.test(combinedText)) {
        structuralScore = Math.max(structuralScore, 0.7);
      }
      // seq 信息：低 seq 的概述性 chunk 略降权
      if (seq <= 2 && !sectionPattern.test(combinedText)) {
        structuralScore = Math.min(structuralScore, 0.4);
      }

      const semanticScore = item.score || 0;
      const finalScore =
        WEIGHTS.semantic * semanticScore +
        WEIGHTS.entity * entityScore +
        WEIGHTS.procedure * procedureScore +
        WEIGHTS.structural * structuralScore;

      const rankDebug = {
        chunk_id: item.chunk?.id,
        semantic: Math.round(semanticScore * 100) / 100,
        entity: Math.round(entityScore * 100) / 100,
        procedure: Math.round(procedureScore * 100) / 100,
        structural: Math.round(structuralScore * 100) / 100,
        final: Math.round(finalScore * 100) / 100,
        matched_entities: matchedEntities,
        matched_procedures: matchedProcedures,
      };
      debug.push(rankDebug);

      return {
        ...item,
        score: finalScore,
        _rerank: rankDebug,
      };
    });

    // 按 finalScore 降序重排
    reranked.sort((a, b) => b.score - a.score);

    return { items: reranked, debug };
  }
}

export default DocRecallService;
