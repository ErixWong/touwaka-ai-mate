/**
 * DocumentEmbeddingService - 文档平台向量化服务
 *
 * 职责：
 * - 加载文档，确定 embedding 模型
 * - 查询当前版本 chunks，为每个 chunk 生成向量
 * - 写回 chunk.embedding_vector / embedding_status
 * - 汇总状态，推进文档到 ready 或 error
 *
 * 使用方式：
 *   const service = new DocumentEmbeddingService(db);
 *   await service.embedDocument(documentId);
 */

import logger from './logger.js';
import EmbeddingClient from './embedding-client.js';
import { DB_VECTOR_DIM, adjustVectorDimension, vectorToJson } from './vector-utils.js';
import { getStageDefault } from './doc-pipeline-defaults.js';

class DocumentEmbeddingService {
  constructor(db, options = {}) {
    this.db = db;
    this.getDocPipelineConfig = options.getDocPipelineConfig || null;
  }

  /**
   * 加载 pending_embedding 阶段配置
   */
  async _loadStageConfig() {
    if (typeof this.getDocPipelineConfig === 'function') {
      try {
        const fullConfig = await this.getDocPipelineConfig();
        if (fullConfig && fullConfig.pending_embedding) {
          return fullConfig.pending_embedding;
        }
      } catch (err) {
        logger.warn('[DocumentEmbeddingService] Failed to load pending_embedding config, using defaults:', err.message);
      }
    }
    return getStageDefault('pending_embedding');
  }

  /**
   * 选择实际使用的 embedding model
   * 优先级：
   *   1. doc_pipeline.pending_embedding.embedding_model_id
   *   2. document_collections.embedding_model_id
   *   3. 若仍为空 → 失败
   */
  async pickEmbeddingModel(document, collection, stageConfig) {
    // 优先级 1：pipeline 配置
    if (stageConfig && stageConfig.embedding_model_id) {
      logger.info(`[DocumentEmbeddingService] Using pipeline-configured embedding model: ${stageConfig.embedding_model_id}`);
      return stageConfig.embedding_model_id;
    }

    // 优先级 2：collection 级配置
    if (collection && collection.embedding_model_id) {
      logger.info(`[DocumentEmbeddingService] Using collection embedding model: ${collection.embedding_model_id}`);
      return collection.embedding_model_id;
    }

    // 优先级 3：无模型可用
    return null;
  }

  /**
   * 加载待处理的文档
   */
  async _loadDocument(documentId) {
    const result = await this.db.query(
      `SELECT id, current_revision_id, collection_id, title, processing_status
       FROM documents
       WHERE id = ?`,
      [documentId]
    );
    return result[0] || null;
  }

  /**
   * 加载文档所属 collection
   */
  async _loadCollection(collectionId) {
    if (!collectionId) return null;
    const result = await this.db.query(
      `SELECT id, embedding_model_id FROM document_collections WHERE id = ?`,
      [collectionId]
    );
    return result[0] || null;
  }

  /**
   * 加载当前版本下待向量化的 chunks
   * 条件：revision_id = current_revision_id AND embedding_status IN ('pending', 'error')
   */
  async _loadPendingChunks(revisionId, skipEmpty = true) {
    let sql = `SELECT id, revision_id, outline_id, title, content, seq,
                      embedding_status, embedding_model_id
               FROM document_chunks
               WHERE revision_id = ?
                 AND embedding_status IN ('pending', 'error')`;
    const params = [revisionId];

    if (skipEmpty) {
      sql += ` AND content IS NOT NULL AND content != ''`;
    }

    sql += ` ORDER BY seq ASC`;

    return await this.db.query(sql, params);
  }

  /**
   * 构建 chunk 的 embedding 输入文本（轻量上下文增强）
   */
  buildEmbeddingText(chunk, document) {
    const parts = [];
    if (document && document.title) {
      parts.push(`文档标题：${document.title}`);
    }
    if (chunk.title) {
      parts.push(`分块标题：${chunk.title}`);
    }
    parts.push(`正文：${chunk.content || ''}`);
    return parts.join('\n');
  }

  /**
   * 对单个 chunk 执行向量化
   */
  async embedChunk(chunk, document, modelId, stageConfig) {
    const startTime = Date.now();

    // 1. 标记为 processing
    await this.db.execute(
      `UPDATE document_chunks SET embedding_status = 'processing', updated_at = NOW() WHERE id = ?`,
      [chunk.id]
    );

    // 2. 构建输入文本
    const inputText = this.buildEmbeddingText(chunk, document);

    // 3. 创建 EmbeddingClient
    const client = await EmbeddingClient.fromModelId(this.db, modelId);
    if (!client) {
      throw new Error(`Failed to create EmbeddingClient for model: ${modelId}`);
    }

    // 4. 获取 timeout
    let timeoutMs = stageConfig?.embedding_timeout_ms || 120000;
    try {
      const { getSystemSettingService } = await import('../server/services/system-setting.service.js');
      const service = getSystemSettingService(this.db);
      const settings = await service.getAllSettings();
      if (settings?.timeout?.embedding) {
        timeoutMs = settings.timeout.embedding * 1000;
      }
    } catch {
      // 使用配置默认值
    }

    // 5. 调用 embedding
    const vector = await client.embed(inputText, timeoutMs);

    if (!vector || !Array.isArray(vector) || vector.length === 0) {
      throw new Error('Embedding returned empty or invalid vector');
    }

    // 6. 维度处理
    const { vector: vectorToStore, adjusted, originalDim } = adjustVectorDimension(vector);
    if (!vectorToStore) {
      throw new Error('Failed to adjust vector dimension');
    }

    if (adjusted) {
      logger.warn(`[DocumentEmbeddingService] Vector dimension adjusted for chunk ${chunk.id}: ${originalDim} -> ${DB_VECTOR_DIM}`);
    }

    // 7. 写回 chunk
    const vectorJson = vectorToJson(vectorToStore);
    await this.db.execute(
      `UPDATE document_chunks
       SET embedding_vector = VEC_FromText(?),
           embedding_status = 'ready',
           embedding_model_id = ?,
           embedded_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [vectorJson, modelId, chunk.id]
    );

    const elapsed = Date.now() - startTime;
    logger.info(`[DocumentEmbeddingService] Chunk ${chunk.id} embedded successfully (dim=${originalDim}, elapsed=${elapsed}ms)`);

    return { success: true, dimension: originalDim };
  }

  /**
   * 完成文档状态推进
   * - 全部 chunk 成功 → ready
   * - 任一 chunk 失败 → error
   * - 无 chunk → error (no_chunks_for_embedding)
   */
  async finalizeDocumentStatus(documentId, revisionId, results) {
    const { total, success, failed, errors } = results;

    if (total === 0) {
      // 无 chunk 异常
      await this.db.execute(
        `UPDATE documents
         SET processing_status = 'error',
             processing_error_code = 'no_chunks_for_embedding',
             processing_error_message = 'No chunks found for embedding on current revision',
             processing_updated_at = NOW()
         WHERE id = ?`,
        [documentId]
      );
      logger.warn(`[DocumentEmbeddingService] Document ${documentId}: no chunks for embedding -> error`);
      return { status: 'error', error_code: 'no_chunks_for_embedding' };
    }

    if (failed > 0) {
      // 存在失败 chunk
      const errorSummary = errors.slice(0, 5).join('; ');
      await this.db.execute(
        `UPDATE documents
         SET processing_status = 'error',
             processing_error_code = 'embedding_failed',
             processing_error_message = ?,
             processing_updated_at = NOW()
         WHERE id = ?`,
        [errorSummary || 'Some chunks failed embedding', documentId]
      );
      logger.warn(`[DocumentEmbeddingService] Document ${documentId}: ${failed}/${total} chunks failed -> error`);
      return { status: 'error', error_code: 'embedding_failed' };
    }

    // 全部成功 → ready
    await this.db.execute(
      `UPDATE documents
       SET processing_status = 'ready',
           processing_error_code = NULL,
           processing_error_message = NULL,
           processing_updated_at = NOW()
       WHERE id = ?`,
      [documentId]
    );
    logger.info(`[DocumentEmbeddingService] Document ${documentId}: all ${success}/${total} chunks embedded -> ready`);
    return { status: 'ready' };
  }

  /**
   * 主入口：对指定文档执行向量化
   * @param {string} documentId - 文档 ID
   * @param {Object} [options]
   * @param {boolean} [options.allowErrorRetry] - 是否允许从 error 状态重试
   * @returns {Promise<Object>} 处理结果
   */
  async embedDocument(documentId, options = {}) {
    const stageConfig = await this._loadStageConfig();
    const allowErrorRetry = options.allowErrorRetry !== false;

    // 1. 加载文档
    const document = await this._loadDocument(documentId);
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    // 2. 校验文档状态
    if (document.processing_status !== 'pending_embedding') {
      if (document.processing_status === 'error' && allowErrorRetry) {
        logger.info(`[DocumentEmbeddingService] Document ${documentId} in error state, retrying...`);
      } else {
        throw new Error(`Document must be in pending_embedding state (current: ${document.processing_status})`);
      }
    }

    const revisionId = document.current_revision_id;
    if (!revisionId) {
      throw new Error(`Document ${documentId} has no current_revision_id`);
    }

    logger.info(`[DocumentEmbeddingService] Starting embedding for document ${documentId}, revision ${revisionId}`);

    // 3. 加载 collection
    const collection = await this._loadCollection(document.collection_id);

    // 4. 确定 embedding model
    const modelId = await this.pickEmbeddingModel(document, collection, stageConfig);
    if (!modelId) {
      await this.db.execute(
        `UPDATE documents
         SET processing_status = 'error',
             processing_error_code = 'embedding_model_missing',
             processing_error_message = 'No embedding model configured (pipeline config or collection)',
             processing_updated_at = NOW()
         WHERE id = ?`,
        [documentId]
      );
      logger.error(`[DocumentEmbeddingService] Document ${documentId}: no embedding model -> error`);
      return {
        document_id: documentId,
        status: 'error',
        error_code: 'embedding_model_missing',
        error_message: 'No embedding model configured',
      };
    }

    logger.info(`[DocumentEmbeddingService] Using model ${modelId} for document ${documentId}`);

    // 5. 加载待向量化 chunks
    const skipEmpty = stageConfig?.skip_empty_chunks !== false;
    const chunks = await this._loadPendingChunks(revisionId, skipEmpty);
    logger.info(`[DocumentEmbeddingService] Document ${documentId}: ${chunks.length} pending chunks`);

    // 6. 逐个处理 chunk
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (const chunk of chunks) {
      try {
        await this.embedChunk(chunk, document, modelId, stageConfig);
        successCount++;
      } catch (error) {
        failCount++;
        const errorMsg = `Chunk ${chunk.id}: ${error.message}`;
        errors.push(errorMsg);
        logger.error(`[DocumentEmbeddingService] ${errorMsg}`);

        // 标记 chunk 为 error
        try {
          await this.db.execute(
            `UPDATE document_chunks
             SET embedding_status = 'error', updated_at = NOW()
             WHERE id = ?`,
            [chunk.id]
          );
        } catch (dbError) {
          logger.error(`[DocumentEmbeddingService] Failed to mark chunk ${chunk.id} as error: ${dbError.message}`);
        }
      }
    }

    // 7. 推进文档状态
    const finalStatus = await this.finalizeDocumentStatus(documentId, revisionId, {
      total: chunks.length,
      success: successCount,
      failed: failCount,
      errors,
    });

    logger.info(
      `[DocumentEmbeddingService] Document ${documentId} completed: ` +
      `${successCount}/${chunks.length} chunks OK, ` +
      `final status = ${finalStatus.status}`
    );

    return {
      document_id: documentId,
      revision_id: revisionId,
      model_id: modelId,
      total_chunks: chunks.length,
      success_count: successCount,
      fail_count: failCount,
      status: finalStatus.status,
      error_code: finalStatus.error_code || null,
    };
  }

  /**
   * 对指定 revision 的所有待处理 chunk 执行向量化
   * @param {string} revisionId - 版本 ID
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async embedRevision(revisionId, options = {}) {
    const DocumentRevision = this.db.getModel('document_revision');
    const revision = await DocumentRevision.findByPk(revisionId, { raw: true });
    if (!revision) {
      throw new Error(`Revision not found: ${revisionId}`);
    }
    return await this.embedDocument(revision.document_id, options);
  }
}

export default DocumentEmbeddingService;
