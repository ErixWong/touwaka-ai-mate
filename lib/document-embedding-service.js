import logger from './logger.js';
import EmbeddingClient from './embedding-client.js';
import DocPipelineAdvancer from './doc-pipeline-advancer.js';
import { DB_VECTOR_DIM, adjustVectorDimension, vectorToJson } from './vector-utils.js';
import { getStageDefault } from './doc-pipeline-defaults.js';
import { getSystemSettingService } from '../server/services/system-setting.service.js';

class DocumentEmbeddingService {
  constructor(db, options = {}) {
    this.db = db;
    this.getDocPipelineConfig = options.getDocPipelineConfig || null;
    this.advancer = new DocPipelineAdvancer(db);
  }

  pickEmbeddingModel(pipelineConfig, collection, stageConfig) {
    if (stageConfig?.embedding_model_id) {
      return stageConfig.embedding_model_id;
    }
    if (collection?.embedding_model_id) {
      return collection.embedding_model_id;
    }
    return null;
  }

  async embedDocument(documentId, options = {}) {
    return this.processDocument(documentId, options);
  }

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

  async _resolveTimeoutMs(stageConfig) {
    // 优先使用阶段级配置
    if (stageConfig?.embedding_timeout_ms) {
      return stageConfig.embedding_timeout_ms;
    }

    // embedding 已归入快速超时口径（用户 2026-06-27 拍板）
    // 优先使用系统 fast_timeout
    try {
      const service = getSystemSettingService(this.db);
      const settings = await service.getAllSettings();
      const fastTimeout = settings?.timeout?.fast_timeout;
      if (typeof fastTimeout === 'number' && fastTimeout > 0) {
        return fastTimeout * 1000;
      }
    } catch {
      // ignore and fallback
    }

    // 默认 2 分钟（对应 fast_timeout 默认值）
    return 120000;
  }

  buildEmbeddingText(chunk, document, outline = null) {
    const parts = [];
    if (document?.title) parts.push(`文档：${document.title}`);
    if (outline?.title) parts.push(`章节：${outline.title}`);
    if (chunk?.title) parts.push(`分块标题：${chunk.title}`);
    if (chunk?.content) parts.push(chunk.content);
    return parts.filter(Boolean).join('\n');
  }

  async processDocument(documentId) {
    const stageConfig = await this._loadStageConfig();
    const timeoutMs = await this._resolveTimeoutMs(stageConfig);

    const Document = this.db.getModel('document');
    const DocumentCollection = this.db.getModel('document_collection');
    const DocumentChunk = this.db.getModel('document_chunk');
    const DocumentOutline = this.db.getModel('document_outline');

    const document = await Document.findByPk(documentId, {
      attributes: ['id', 'title', 'collection_id', 'current_revision_id', 'processing_status'],
      raw: true,
    });
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    if (document.processing_status !== 'pending_embedding' && document.processing_status !== 'error') {
      return { success: false, skipped: true, reason: `invalid_status:${document.processing_status}` };
    }

    if (!document.current_revision_id) {
      await this.advancer.fail(documentId, 'embedding_revision_missing', 'Current revision is missing');
      return { success: false, skipped: false, reason: 'revision_missing' };
    }

    const collection = document.collection_id
      ? await DocumentCollection.findByPk(document.collection_id, {
        attributes: ['id', 'embedding_model_id'],
        raw: true,
      })
      : null;

    const modelId = stageConfig?.embedding_model_id || collection?.embedding_model_id || null;
    if (!modelId) {
      await this.advancer.fail(documentId, 'embedding_model_missing', 'No embedding model configured for this document collection');
      return { success: false, skipped: false, reason: 'embedding_model_missing' };
    }

    const client = await EmbeddingClient.fromModelId(this.db, modelId);
    if (!client) {
      await this.advancer.fail(documentId, 'embedding_client_init_failed', `Failed to initialize embedding client for model ${modelId}`);
      return { success: false, skipped: false, reason: 'embedding_client_init_failed' };
    }

    const chunks = await DocumentChunk.findAll({
      where: {
        revision_id: document.current_revision_id,
        embedding_status: ['pending', 'error'],
      },
      attributes: ['id', 'outline_id', 'title', 'content', 'embedding_status'],
      order: [['seq', 'ASC']],
      raw: true,
    });

    if (!chunks.length) {
      await this.advancer.fail(documentId, 'no_chunks_for_embedding', 'No document chunks found for embedding');
      return { success: false, skipped: false, reason: 'no_chunks_for_embedding' };
    }

    const outlineIds = [...new Set(chunks.map(chunk => chunk.outline_id).filter(Boolean))];
    const outlines = outlineIds.length > 0
      ? await DocumentOutline.findAll({
        where: { id: outlineIds },
        attributes: ['id', 'title'],
        raw: true,
      })
      : [];
    const outlineMap = new Map(outlines.map(outline => [outline.id, outline]));

    let successCount = 0;
    for (const chunk of chunks) {
      const content = String(chunk.content || '').trim();
      if (stageConfig.skip_empty_chunks !== false && !content) {
        await this.db.execute(
          'UPDATE document_chunks SET embedding_status = ?, embedding_model_id = ?, embedded_at = COALESCE(embedded_at, ?), updated_at = ? WHERE id = ?',
          ['ready', modelId, new Date(), new Date(), chunk.id],
        );
        successCount += 1;
        continue;
      }

      const text = this.buildEmbeddingText(chunk, document, outlineMap.get(chunk.outline_id) || null).trim();
      if (!text) {
        await this.db.execute(
          'UPDATE document_chunks SET embedding_status = ?, embedding_model_id = ?, embedded_at = COALESCE(embedded_at, ?), updated_at = ? WHERE id = ?',
          ['ready', modelId, new Date(), new Date(), chunk.id],
        );
        successCount += 1;
        continue;
      }

      try {
        await this.db.execute(
          'UPDATE document_chunks SET embedding_status = ?, embedding_model_id = ?, updated_at = ? WHERE id = ?',
          ['processing', modelId, new Date(), chunk.id],
        );

        const embedding = await client.embed(text, timeoutMs);
        if (!embedding) {
          throw new Error(`Embedding provider returned empty vector for chunk ${chunk.id}`);
        }

        const { vector: vectorToStore, adjusted, originalDim, message } = adjustVectorDimension(embedding);
        if (!vectorToStore) {
          throw new Error(`Invalid embedding vector for chunk ${chunk.id}`);
        }

        if (adjusted) {
          logger.warn(`[DocumentEmbeddingService] Vector dimension mismatch for chunk ${chunk.id}: DB requires ${DB_VECTOR_DIM}, got ${originalDim}`);
          logger.info(`[DocumentEmbeddingService] ${message}`);
        }

        await this.db.execute(
          'UPDATE document_chunks SET embedding_vector = VEC_FromText(?), embedding_status = ?, embedding_model_id = ?, embedded_at = ?, updated_at = ? WHERE id = ?',
          [vectorToJson(vectorToStore), 'ready', modelId, new Date(), new Date(), chunk.id],
        );
        successCount += 1;
      } catch (error) {
        await this.db.execute(
          'UPDATE document_chunks SET embedding_status = ?, embedding_model_id = ?, updated_at = ? WHERE id = ?',
          ['error', modelId, new Date(), chunk.id],
        );
        await this.advancer.fail(documentId, 'embedding_failed', error.message);
        logger.error(`[DocumentEmbeddingService] Failed to embed chunk ${chunk.id}: ${error.message}`);
        return {
          success: false,
          skipped: false,
          reason: 'embedding_failed',
          failed_chunk_id: chunk.id,
          success_count: successCount,
          total_chunks: chunks.length,
        };
      }
    }

    await this.advancer.complete(documentId);

    logger.info(`[DocumentEmbeddingService] Document ${documentId} embedded: ${successCount}/${chunks.length}`);
    return {
      success: true,
      skipped: false,
      success_count: successCount,
      total_chunks: chunks.length,
      status: 'ready',
    };
  }
}

export default DocumentEmbeddingService;
