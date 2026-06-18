/**
 * Document Embedding Worker - 文档平台向量化后台任务
 *
 * 作为 BackgroundTaskScheduler 的任务处理器
 * 定期扫描 processing_status = 'pending_embedding' 的文档，逐文档调用 DocumentEmbeddingService
 *
 * 使用方式：
 *   import { createDocumentEmbeddingTask } from '../lib/document-embedding-worker.js';
 *   scheduler.register({
 *     name: 'document-embedding-worker',
 *     interval: 30000,
 *     handler: createDocumentEmbeddingTask({ batchSize: 3 }),
 *   });
 */

import logger from './logger.js';
import DocumentEmbeddingService from './document-embedding-service.js';
import { DOC_PIPELINE_KEYS, mergeWithDefaults } from './doc-pipeline-defaults.js';

/**
 * 创建文档向量化任务处理器
 * @param {Object} options 配置选项
 * @param {number} options.batchSize 每批处理的文档数量（默认 3）
 * @returns {Function} 任务处理函数 (db) => Promise<void>
 */
export function createDocumentEmbeddingTask(options = {}) {
  const batchSize = options.batchSize || 3;

  return async function documentEmbeddingTaskHandler(db) {
    try {
      const getDocPipelineConfig = async () => {
        const keys = DOC_PIPELINE_KEYS.map((key) => `doc_pipeline.${key}`);
        const placeholders = keys.map(() => '?').join(',');
        const rows = await db.query(
          `SELECT setting_key, setting_value
             FROM system_settings
            WHERE setting_key IN (${placeholders})`,
          keys
        );

        const stored = {};
        for (const row of rows || []) {
          const stageKey = String(row.setting_key || '').replace(/^doc_pipeline\./, '');
          try {
            stored[stageKey] = JSON.parse(row.setting_value || '{}');
          } catch {
            stored[stageKey] = {};
          }
        }

        return mergeWithDefaults(stored);
      };

      // 查询 pending_embedding 状态的文档
      const pendingDocs = await db.query(
        `SELECT id, processing_status, current_revision_id, title
         FROM documents
         WHERE processing_status = 'pending_embedding'
           AND current_revision_id IS NOT NULL
         ORDER BY processing_updated_at ASC
         LIMIT ?`,
        [batchSize]
      );

      if (!pendingDocs || pendingDocs.length === 0) {
        // 静默跳过，无待处理文档
        return;
      }

      logger.info(`[DocEmbeddingWorker] Found ${pendingDocs.length} document(s) pending embedding`);

      const embeddingService = new DocumentEmbeddingService(db, { getDocPipelineConfig });

      for (const doc of pendingDocs) {
        try {
          logger.info(`[DocEmbeddingWorker] Processing document ${doc.id} (${doc.title || 'untitled'})`);
          const result = await embeddingService.embedDocument(doc.id, { allowErrorRetry: true });
          logger.info(
            `[DocEmbeddingWorker] Document ${doc.id}: ${result.status}, ` +
            `${result.success_count}/${result.total_chunks} chunks embedded`
          );
        } catch (error) {
          logger.error(`[DocEmbeddingWorker] Failed to process document ${doc.id}: ${error.message}`);
        }
      }

      logger.info(`[DocEmbeddingWorker] Batch completed: ${pendingDocs.length} document(s) processed`);
    } catch (error) {
      logger.error('[DocEmbeddingWorker] Error in document embedding task:', error.message);
    }
  };
}
