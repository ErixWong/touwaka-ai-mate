/**
 * job-context-builder - 为 doc-pipeline-worker 构造运行上下文
 *
 * 职责：将 worker 所需的平台能力（db, services）从 AppClock 依赖中解耦，
 * 使 doc-pipeline-worker 可以在 ClockCore 的 internal job 模型下独立运行。
 *
 * Phase 1 只构造 doc-pipeline-worker 所需的最小上下文。
 */

import DocumentOcrService from '../document-ocr-service.js';
import DocumentCleanService from '../document-clean-service.js';
import DocumentOutlineService from '../document-outline-service.js';
import DocumentChunkService from '../document-chunk-service.js';
import DocumentEmbeddingService from '../document-embedding-service.js';
import logger from '../logger.js';

/**
 * 为 doc-pipeline-worker 构造完整的服务上下文
 *
 * @param {Object} db - Database 实例
 * @param {Object} [options]
 * @param {Function} [options.callMcp] - MCP 调用函数
 * @param {Function} [options.callLlm] - LLM 调用函数
 * @returns {Object} { query, execute, getModel, documentOcr, documentClean, documentOutline, documentChunk, documentEmbedding }
 */
function buildDocPipelineContext(db, options = {}) {
  const sequelize = db.sequelize;

  const documentOcr = new DocumentOcrService(db, {
    callMcp: options.callMcp,
    callLlm: options.callLlm,
    getDocPipelineConfig: options.getDocPipelineConfig,
  });

  const documentClean = new DocumentCleanService(db);
  const documentOutline = new DocumentOutlineService(db);
  const documentChunk = new DocumentChunkService(db);
  const documentEmbedding = new DocumentEmbeddingService(db);

  return {
    query: (sql, params) => sequelize.query(sql, { replacements: params, type: sequelize.QueryTypes.SELECT }),
    execute: (sql, params) => sequelize.query(sql, { replacements: params }),
    getModel: (name) => db.getModel(name),
    documentOcr,
    documentClean,
    documentOutline,
    documentChunk,
    documentEmbedding,
  };
}

export { buildDocPipelineContext };
