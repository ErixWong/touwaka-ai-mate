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
   * Round 05 增强（P0-3 foundation + P0-2 支撑）：
   * - 附加 attachment 文件名作为备选身份来源（应对 titles 为 "Intake ..." 的场景）
   * - 附加 revision_label 便于按版号定位
   * - 返回 best_identity_label：优先 attachment 文件名，其次 document title
   *
   * @param {string[]} documentIds - 文档ID列表
   * @returns {Promise<Object[]>} 文档基本信息列表（含 identity_sources）
   */
  async getDocumentInfo(documentIds) {
    if (!documentIds || documentIds.length === 0) return [];

    this._ensureModels();
    const placeholders = documentIds.map(() => '?').join(',');

    // 1. 基础文档信息
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

    // 2. 按文档ID批量获取关联的 attachment 文件名
    // P1-1: 双层附件文件名查询
    //   第一层（优先）：原始上传文件附件 — source_tag='doc-platform'
    //   第二层（fallback）：OCR/Clean 产物附件 — 通过 doc_ocr_results 外键
    let attachmentMap = new Map();
    try {
      // 第一层：原始上传文件附件（用户上传的原始文件，最有意义的 identity 来源）
      const sourceAttachRows = await this.db.sequelize.query(`
        SELECT
          rev.document_id,
          a.file_name,
          a.id as attachment_id
        FROM document_revisions rev
        JOIN attachments a ON a.source_tag = 'doc-platform' AND a.source_id = rev.id
        WHERE rev.document_id IN (${placeholders})
          AND a.file_name IS NOT NULL
          AND a.file_name != ''
        ORDER BY a.created_at ASC
      `, {
        replacements: documentIds,
        type: this.db.sequelize.QueryTypes.SELECT,
      });

      for (const r of sourceAttachRows) {
        if (!attachmentMap.has(r.document_id)) {
          attachmentMap.set(r.document_id, []);
        }
        const existing = attachmentMap.get(r.document_id);
        if (!existing.includes(r.file_name)) {
          existing.push(r.file_name);
        }
      }

      // 第二层：OCR/Clean 产物附件（仅在没有原始文件附件时作为 fallback）
      const ocrAttachRows = await this.db.sequelize.query(`
        SELECT
          ocr.document_id,
          a.file_name,
          a.id as attachment_id
        FROM doc_ocr_results ocr
        JOIN attachments a ON (
          a.id = ocr.main_markdown_attachment_id
          OR a.id = ocr.raw_result_attachment_id
          OR a.id = JSON_UNQUOTE(JSON_EXTRACT(ocr.metadata, '$.cleaned_markdown_attachment_id'))
        )
        WHERE ocr.document_id IN (${placeholders})
          AND a.file_name IS NOT NULL
          AND a.file_name != ''
      `, {
        replacements: documentIds,
        type: this.db.sequelize.QueryTypes.SELECT,
      });

      // 仅在没有原始文件附件的文档上，用 OCR 产物附件文件名补位
      // 且排除纯技术文件名（ocr-*.json, ocr-main.md, cleaned-main.md 等）
      const TECHNICAL_OCR_PATTERNS = /^(ocr-|cleaned-)/i;
      for (const r of ocrAttachRows) {
        if (attachmentMap.has(r.document_id) && attachmentMap.get(r.document_id).length > 0) {
          continue; // 已有原始文件附件，跳过 OCR 产物
        }
        if (TECHNICAL_OCR_PATTERNS.test(r.file_name)) {
          continue; // 排除技术性文件名
        }
        if (!attachmentMap.has(r.document_id)) {
          attachmentMap.set(r.document_id, []);
        }
        const existing = attachmentMap.get(r.document_id);
        if (!existing.includes(r.file_name)) {
          existing.push(r.file_name);
        }
      }
    } catch (attachErr) {
      // attachment 查询失败不影响主流程
      logger.warn('[DocSearch] Attachment filename lookup failed:', attachErr.message);
    }

    // 3. 组装结果：为每个文档推断 best_identity_label
    return rows.map(r => {
      const attachmentFilenames = attachmentMap.get(r.document_id) || [];

      // best_identity_label 策略：
      // - 如果 document_title 像导入文件名（不含中文/不含语义信息），优先用 attachment 文件名
      // - 否则使用 document_title
      const titleLooksLikeIntake = this._titleLooksLikeImportName(r.document_title);
      let bestIdentityLabel = r.document_title;
      let identityLabelSource = 'document_title';

      if (titleLooksLikeIntake && attachmentFilenames.length > 0) {
        // 取最长的 attachment 文件名（通常信息最完整）
        bestIdentityLabel = attachmentFilenames.reduce((a, b) => a.length >= b.length ? a : b);
        identityLabelSource = 'attachment_filename';
      }

      return {
        document_id: r.document_id,
        document_title: r.document_title,
        doc_type: r.doc_type,
        collection_id: r.collection_id,
        collection_name: r.collection_name,
        revision_id: r.revision_id,
        revision_no: r.revision_no,
        revision_label: r.revision_label,
        // Round 05: 身份补充字段
        attachment_filenames: attachmentFilenames,
        best_identity_label: bestIdentityLabel,
        identity_label_source: identityLabelSource,
        title_is_import_name: titleLooksLikeIntake,
      };
    });
  }

  /**
   * 判断文档标题是否像导入文件名（不含中文语义信息）
   * 例如 "Intake-20240601-001"、"scan_202405.pdf" 等
   */
  _titleLooksLikeImportName(title) {
    if (!title) return true;
    // 包含中文字符 → 不太可能是纯导入名
    if (/[\u4e00-\u9fff]/.test(title)) return false;
    // 看起来像是文件名的模式
    if (/^(Intake|intake|scan|Scan|IMG|img|DOC|doc|import|imported)[-_]/i.test(title)) return true;
    // 纯数字/ASCII 短串
    if (/^[\x00-\x7F]+$/.test(title) && title.length < 30) return true;
    return false;
  }

  /**
   * 按 attachment 文件名搜索文档（Round 05 P0-3）
   *
   * 当 document-level 标题搜索 0 命中时，通过 attachment 文件名进行 fallback 搜索。
   * 典型场景：文档标题为 "Intake-xxx" 但原始上传文件名为 "GB 4785 汽车车身术语.pdf"
   *
   * @param {string} query - 搜索查询
   * @param {Object} options - 选项
   * @param {string} options.userId - 用户ID（权限验证）
   * @param {string[]} [options.doc_types] - 文档类型过滤
   * @param {number} [options.top_k=5] - 返回候选数量
   * @returns {Promise<Object[]>} 候选文档列表（含 matched_attachment）
   */
  async searchByAttachmentFilenames(query, options = {}) {
    const { userId, doc_types, top_k = 5 } = options;

    if (!query || !query.trim()) return [];

    this._ensureModels();
    const trimmedQuery = query.trim();
    const queryWords = trimmedQuery.split(/\s+/).filter(w => w.length >= 2);

    try {
      // 获取用户可访问的集合
      const accessibleCollectionIds = await this.accessService.getAccessibleCollectionIds(userId);
      if (!accessibleCollectionIds.length) return [];

      const collectionPlaceholders = accessibleCollectionIds.map(() => '?').join(',');
      const params = [...accessibleCollectionIds];

      // 构建 attachment 文件名匹配条件
      const likeConditions = [];
      // 完整查询匹配
      likeConditions.push('a.file_name LIKE ?');
      params.push(`%${trimmedQuery}%`);
      // 关键词匹配
      for (const word of queryWords) {
        likeConditions.push('a.file_name LIKE ?');
        params.push(`%${word}%`);
      }
      const likeClause = likeConditions.join(' OR ');

      let docTypeFilter = '';
      if (doc_types && doc_types.length > 0) {
        docTypeFilter = `AND d.doc_type IN (${doc_types.map(() => '?').join(',')})`;
        params.push(...doc_types);
      }

      const sql = `
        SELECT
          d.id as document_id,
          d.title as document_title,
          d.doc_type,
          d.collection_id,
          coll.name as collection_name,
          MIN(CASE WHEN a.file_name LIKE ? THEN a.file_name ELSE NULL END) as matched_attachment,
          GROUP_CONCAT(DISTINCT a.file_name SEPARATOR '||') as all_attachments,
          MAX(CASE WHEN a.file_name LIKE ? THEN 10
                   WHEN a.file_name LIKE ? THEN 5
                   ELSE 1 END) as match_priority
        FROM attachments a
        JOIN doc_ocr_results ocr ON (
          a.id = ocr.main_markdown_attachment_id
          OR a.id = ocr.raw_result_attachment_id
          OR a.id = JSON_UNQUOTE(JSON_EXTRACT(ocr.metadata, '$.cleaned_markdown_attachment_id'))
        )
        JOIN documents d ON ocr.document_id = d.id
        LEFT JOIN document_collections coll ON d.collection_id = coll.id
        WHERE d.processing_status = 'ready'
          AND d.collection_id IN (${collectionPlaceholders})
          ${docTypeFilter}
          AND (${likeClause})
        GROUP BY d.id, d.title, d.doc_type, d.collection_id, coll.name
        ORDER BY match_priority DESC, matched_attachment
        LIMIT ?
      `;
      // matched_attachment: 完整查询匹配优先, 关键词匹配次之
      params.push(`%${trimmedQuery}%`, `%${trimmedQuery}%`, `%${queryWords[0] || trimmedQuery}%`, top_k);

      const rows = await this.db.sequelize.query(sql, {
        replacements: params,
        type: this.db.sequelize.QueryTypes.SELECT,
      });

      return rows.map(r => ({
        document_id: r.document_id,
        document_title: r.document_title,
        doc_type: r.doc_type,
        collection_id: r.collection_id,
        collection_name: r.collection_name,
        relevance_score: 1,
        matched_attachment: r.matched_attachment,
        attachment_filenames: r.all_attachments ? r.all_attachments.split('||').filter(Boolean) : [],
        best_identity_label: r.matched_attachment || r.document_title,
        identity_label_source: 'attachment_filename_match',
        title_is_import_name: this._titleLooksLikeImportName(r.document_title),
        candidate_confidence: 'low',
        is_attachment_fallback: true,
      }));
    } catch (error) {
      logger.warn('[DocSearch] Attachment filename search error:', error.message);
      return [];
    }
  }
}

export default DocumentSearchService;
