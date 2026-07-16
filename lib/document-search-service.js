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

const TOPIC_SUFFIX_HINTS = [
  '术语', '定义', '标准', '规范', '指南', '手册', '办法', '规定',
  '制度', '条例', '流程', '方案', '报告', '说明', '要求', '条件',
  '指标', '参数', '方法', '技术', '系统', '管理', '安全', '质量',
  '性能', '设计', '测试', '评估', '分析', '计算', '操作', '维护',
];

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

      // 3. 构建查询条件（WHERE 子句参数单独收集）
      const conditions = [
        'd.processing_status = \'ready\'',
        `d.collection_id IN (${effectiveCollectionIds.map(() => '?').join(',')})`,
        'd.current_revision_id = v.id',
      ];

      const whereParams = [...effectiveCollectionIds];

      if (doc_types && doc_types.length > 0) {
        conditions.push(`d.doc_type IN (${doc_types.map(() => '?').join(',')})`);
        whereParams.push(...doc_types);
      }

      // 标签过滤
      let tagJoin = '';
      if (tag_ids && tag_ids.length > 0) {
        tagJoin = `JOIN doc_document_tags dt ON d.id = dt.document_id`;
        conditions.push(`dt.tag_id IN (${tag_ids.map(() => '?').join(',')})`);
        whereParams.push(...tag_ids);
      }

      // 4. 构建相关性评分：优先围绕主题主词做 document-level recall
      // 注意：评分表达式的 ? 在 SQL SELECT 中出现在 WHERE ? 之前，
      // 因此 scoreParams 必须在 whereParams 之前
      const trimmedQuery = query.trim();
      const normalizedQuery = this._normalizeSearchQuery(trimmedQuery);
      const queryWords = this._extractQueryTerms(normalizedQuery);
      const scoreParams = [];

      // 标题精确匹配得分最高
      const titleExactScore = `CASE WHEN d.title = ? THEN 100 ELSE 0 END`;
      scoreParams.push(normalizedQuery);

      // 标题包含查询得分
      const titleContainsScore = `CASE WHEN d.title LIKE ? THEN 50 ELSE 0 END`;
      scoreParams.push(`%${normalizedQuery}%`);

      // 紧凑主题查询（去空格）命中，适配“汽车车身 术语” vs “汽车车身术语”
      const compactQuery = normalizedQuery.replace(/\s+/g, '').trim();
      const compactTitleContainsScore = compactQuery && compactQuery !== normalizedQuery
        ? `CASE WHEN d.title LIKE ? THEN 40 ELSE 0 END`
        : '0';
      if (compactQuery && compactQuery !== normalizedQuery) {
        scoreParams.push(`%${compactQuery}%`);
      }

      // 主题短语拆分匹配得分
      let keywordScoreParts = [];
      for (const word of queryWords) {
        if (word.length >= 2) {
          keywordScoreParts.push(`CASE WHEN d.title LIKE ? THEN 12 ELSE 0 END`);
          scoreParams.push(`%${word}%`);
        }
      }
      const keywordScore = keywordScoreParts.length > 0
        ? `(${keywordScoreParts.join(' + ')})`
        : '0';

      // 有序主题词同时命中时额外加分，鼓励“主题相关性先收敛”
      let phraseComboScore = '0';
      if (queryWords.length >= 2) {
        const comboParts = [];
        for (const word of queryWords.slice(0, 3)) {
          comboParts.push('d.title LIKE ?');
          scoreParams.push(`%${word}%`);
        }
        phraseComboScore = `CASE WHEN (${comboParts.join(' AND ')}) THEN 25 ELSE 0 END`;
      }

      // metadata JSON 中包含查询词（适配 metadata 为 JSON 字符串的场景）
      const metadataScore = `CASE WHEN d.metadata LIKE ? THEN 5 ELSE 0 END`;
      scoreParams.push(`%${compactQuery || normalizedQuery}%`);

      const relevanceScoreExpr = `(${titleExactScore} + ${titleContainsScore} + ${compactTitleContainsScore} + ${keywordScore} + ${phraseComboScore} + ${metadataScore})`;

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
      // 参数顺序必须与 SQL 中 ? 的出现顺序一致：SELECT 评分表达式 → WHERE 条件 → LIMIT
      const params = [...scoreParams, ...whereParams, top_k];

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
          topic_match_terms: queryWords.filter(word => r.document_title?.includes(word)),
          ...(include_metadata && r.metadata ? { metadata: r.metadata } : {}),
        }));

      const rerankedCandidates = this._rerankTopicCandidates(candidates, {
        normalizedQuery,
        compactQuery,
        queryWords,
      });

      // 7. 如果基于相关性的结果不足，补充同类型的最新文档作为候选
      let strategy = 'relevance_match';
      if (rerankedCandidates.length === 0 && doc_types && doc_types.length > 0) {
        // 回退：返回指定类型的最新文档
        const fallbackRows = await this._fallbackLatestByType(effectiveCollectionIds, doc_types, top_k);
        rerankedCandidates.push(...fallbackRows);
        strategy = 'fallback_latest_by_type';
      }

      logger.info('[DocSearch] Search completed:', {
        candidate_count: rerankedCandidates.length,
        strategy,
        top_score: rerankedCandidates[0]?.relevance_score || 0,
        normalized_query: normalizedQuery,
        compact_query: compactQuery,
        query_terms: queryWords,
      });

      return {
        success: true,
        candidates: rerankedCandidates,
        total: rerankedCandidates.length,
        strategy,
      };

    } catch (error) {
      logger.error('[DocSearch] Search error:', error);
      return { success: false, message: error.message, candidates: [], total: 0 };
    }
  }

  _normalizeSearchQuery(query) {
    return String(query || '')
      .replace(/[，。；、“”‘’：:（）()【】\[\],.!?？]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _extractQueryTerms(query) {
    const rawTerms = String(query || '').split(/\s+/).map(t => t.trim()).filter(Boolean);
    const expandedTerms = [];

    for (const term of rawTerms) {
      expandedTerms.push(term);
      if (term.length >= 4) {
        for (const suffix of TOPIC_SUFFIX_HINTS) {
          if (term.endsWith(suffix) && term.length > suffix.length) {
            const prefix = term.slice(0, -suffix.length).trim();
            if (prefix.length >= 2) {
              expandedTerms.push(prefix);
              expandedTerms.push(suffix);
            }
            break;
          }
        }
      }
    }

    return [...new Set(expandedTerms)].filter(term => term.length >= 2).slice(0, 8);
  }

  _rerankTopicCandidates(candidates, { normalizedQuery, compactQuery, queryWords }) {
    return [...candidates]
      .map(candidate => {
        const title = String(candidate.document_title || '');
        let boost = 0;

        if (compactQuery && title.includes(compactQuery)) {
          boost += 20;
        }

        if (normalizedQuery && title.includes(normalizedQuery)) {
          boost += 15;
        }

        const matchedTerms = queryWords.filter(word => title.includes(word));
        boost += matchedTerms.length * 6;

        if (matchedTerms.length >= 2) {
          boost += 10;
        }

        return {
          ...candidate,
          topic_match_terms: matchedTerms,
          topic_recall_boost: boost,
          relevance_score: (candidate.relevance_score || 0) + boost,
        };
      })
      .sort((a, b) => {
        const scoreDiff = (b.relevance_score || 0) - (a.relevance_score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return (b.topic_match_terms?.length || 0) - (a.topic_match_terms?.length || 0);
      });
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

    // 2. 按文档ID批量获取原始上传文件的 attachment 文件名
    // P1-1 (Round 02 修复): 优先通过 document_revisions → attachments(source_tag='doc-platform')
    // 获取用户上传的原始文件名（对 identity 最有意义）；不再从 OCR 产物附件获取文件名
    let attachmentMap = new Map();
    try {
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
   * @param {string} [options.collection_id] - 集合ID过滤（传入时仅在该集合内搜索，不传则搜索所有可访问集合）
   * @param {string[]} [options.doc_types] - 文档类型过滤
   * @param {number} [options.top_k=5] - 返回候选数量
   * @returns {Promise<Object[]>} 候选文档列表（含 matched_attachment）
   */
  async searchByAttachmentFilenames(query, options = {}) {
    const { userId, doc_types, top_k = 5, collection_id } = options;

    if (!query || !query.trim()) return [];

    this._ensureModels();
    const trimmedQuery = query.trim();
    const queryWords = trimmedQuery.split(/\s+/).filter(w => w.length >= 2);

    try {
      // 确定集合范围：优先使用传入的 collection_id，否则使用用户所有可访问集合
      let collectionIds;
      if (collection_id) {
        // defense-in-depth: 即使 caller 已验证，service 层再次确认 collection_id 属于当前用户
        const accessibleIds = await this.accessService.getAccessibleCollectionIds(userId);
        if (!accessibleIds.includes(collection_id)) return [];
        collectionIds = [collection_id];
      } else {
        collectionIds = await this.accessService.getAccessibleCollectionIds(userId);
        if (!collectionIds.length) return [];
      }

      const collectionPlaceholders = collectionIds.map(() => '?').join(',');
      const params = [...collectionIds];

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

      // P1-1 (Round 02 修复): 改为面向原始上传文件附件搜索，不再通过 OCR 产物附件
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
        JOIN document_revisions rev ON a.source_tag = 'doc-platform' AND a.source_id = rev.id
        JOIN documents d ON rev.document_id = d.id
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
