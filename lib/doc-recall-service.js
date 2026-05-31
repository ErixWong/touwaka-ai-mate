/**
 * Doc Recall Service - 统一文档召回服务
 *
 * 提供统一的文档检索能力，支持：
 * - 新表（doc_documents, doc_embeddings）检索
 * - 旧表（kb_paragraphs）兼容检索
 * - 灰度开关控制
 * - scope 参数（knowledge | contract | department | standard）
 *
 * 使用方法：
 * const recallService = new DocRecallService(db, configLoader);
 * const results = await recallService.recall(query, { scope: 'all', top_k: 5 });
 */

import logger from './logger.js';
import { DB_VECTOR_DIM, adjustVectorDimension, vectorToJson } from './vector-utils.js';

class DocRecallService {
  constructor(db, configLoader) {
    this.db = db;
    this.configLoader = configLoader;
    this.models = {};
  }

  ensureModels() {
    if (!this.models.DocDocument) {
      this.models.DocDocument = this.db.getModel('doc_document');
      this.models.DocVersion = this.db.getModel('doc_version');
      this.models.DocContentUnit = this.db.getModel('doc_content_unit');
      this.models.DocEmbedding = this.db.getModel('doc_embedding');
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
    } = options;

    this.ensureModels();

    logger.info('[DocRecall] Starting recall:', {
      query_length: query?.length || 0,
      scope,
      top_k,
      embedding_model_id,
    });

    try {
      const resolvedModelId = embedding_model_id || process.env.EMBEDDING_MODEL_ID || null;
      const queryEmbedding = await this.generateQueryEmbedding(query);
      if (!queryEmbedding) {
        return { success: false, message: 'Failed to generate embedding', items: [] };
      }

      const { vector: adjustedVector } = adjustVectorDimension(queryEmbedding);
      const vectorJson = vectorToJson(adjustedVector);

      return await this.recallFromNewTable(vectorJson, {
        scope, doc_types, top_k, threshold, userId, org_id, embedding_model_id: resolvedModelId,
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
    const { scope, doc_types, top_k, threshold, userId, org_id, embedding_model_id } = options;

    const safeDocTypes = this.validateDocTypes(doc_types);
    if (doc_types && doc_types.length > 0 && safeDocTypes.length === 0) {
      return { success: true, items: [], total: 0 };
    }
    const docTypeFilter = this.buildDocTypeFilter(scope, safeDocTypes);
    const orgFilter = org_id ? 'AND d.org_id = ?' : '';
    const modelFilter = embedding_model_id ? 'AND e.embedding_model_id = ?' : '';
    const params = [vectorJson];

    if (safeDocTypes.length > 0) params.push(...safeDocTypes);
    if (org_id) params.push(org_id);
    if (embedding_model_id) params.push(embedding_model_id);
    params.push(top_k);

    const results = await this.db.sequelize.query(`
      SELECT
        e.id as embedding_id,
        e.embedding_dim,
        e.embedding_model_id,
        cu.id as unit_id, cu.title as unit_title, cu.content, cu.unit_type,
        v.id as version_id, v.version_no, v.version_label, v.version_status,
        d.id as document_id, d.title as document_title, d.doc_type,
        VEC_DISTANCE_COSINE(e.embedding_vector, VEC_FromText(?)) as distance
      FROM doc_embeddings e
      JOIN doc_content_units cu ON e.content_unit_id = cu.id
      JOIN doc_versions v ON e.version_id = v.id
      JOIN doc_documents d ON e.document_id = d.id
      WHERE e.embedding_status = 'ready'
        AND v.version_status = 'effective'
        AND (v.effective_from IS NULL OR v.effective_from <= CURDATE())
        AND (v.effective_to IS NULL OR v.effective_to >= CURDATE())
        AND d.lifecycle_status = 'active'
        ${modelFilter}
        ${docTypeFilter}
        ${orgFilter}
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
        content_unit: {
          id: r.unit_id,
          title: r.unit_title,
          content: r.content?.substring(0, 500),
          unit_type: r.unit_type,
        },
        version: {
          id: r.version_id,
          version_no: r.version_no,
          version_label: r.version_label,
          status: r.version_status,
        },
        document: {
          id: r.document_id,
          title: r.document_title,
          doc_type: r.doc_type,
        },
        source: 'new_table',
      }));

    logger.info('[DocRecall] New table recall:', {
      total_results: results.length,
      filtered_results: items.length,
      doc_types_found: [...new Set(results.map(r => r.doc_type))],
    });

    return {
      success: true,
      items,
      total: items.length,
    };
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

  VALID_DOC_TYPES = ['knowledge', 'contract', 'department_doc', 'standard'];

  validateDocTypes(doc_types) {
    if (!doc_types || doc_types.length === 0) return [];
    const validated = doc_types.filter(t => this.VALID_DOC_TYPES.includes(t));
    if (validated.length !== doc_types.length) {
      logger.warn('[DocRecall] Invalid doc_types filtered:', {
        original: doc_types,
        validated,
      });
    }
    return validated;
  }

  async generateQueryEmbedding(query) {
    const apiUrl = process.env.EMBEDDING_API_URL;
    const apiKey = process.env.EMBEDDING_API_KEY;
    const modelName = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

    if (!apiUrl || !apiKey) {
      logger.warn('[DocRecall] Embedding API not configured');
      return null;
    }

    try {
      const response = await fetch(`${apiUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ input: query, model: modelName }),
      });

      if (!response.ok) {
        logger.error('[DocRecall] Embedding API error:', response.status);
        return null;
      }

      const json = await response.json();
      return json.data?.[0]?.embedding || null;
    } catch (error) {
      logger.error('[DocRecall] Embedding generation error:', error);
      return null;
    }
  }
}

export default DocRecallService;