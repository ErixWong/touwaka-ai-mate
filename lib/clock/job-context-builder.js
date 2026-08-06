/**
 * job-context-builder — Internal Job 上下文构造器
 *
 * 职责：将 worker 所需的平台能力（db, services）从 AppClock 依赖中解耦，
 * 使 doc-pipeline-worker 可以在 ClockCore 的 internal job 模型下独立运行。
 *
 * ## 上下文协议 (Internal Job Context Protocol)
 *
 * 每个 internal job 的 handler 接收 context 对象，由调用方（ClockCore / 兼容层）注入。
 * doc-pipeline-worker 的 handler 期望 context 包含：
 *
 * ```
 * context.services = {
 *   query(sql, params)     → Promise<Array>      // SELECT 查询
 *   execute(sql, params)   → Promise<Result>      // INSERT/UPDATE/DELETE
 *   getModel(name)         → Sequelize Model      // 获取 ORM 模型
 *   documentOcr            → DocumentOcrService   // OCR 提交/同步
 *   documentClean          → DocumentCleanService // 文本清洗
 *   documentOutline        → DocumentOutlineService  // 大纲提取
 *   documentChunk          → DocumentChunkService    // 分块生成
 *   documentEmbedding      → DocumentEmbeddingService // 向量化
 * }
 * ```
 *
 * ## 依赖注入来源
 *
 * | 能力               | Phase 1 来源                          | 后续方向             |
 * |--------------------|---------------------------------------|----------------------|
 * | callMcp            | 平台级 McpToolCaller 注入             | 保持独立注入         |
 * | callLlm            | null（各 service 自行调用 createCallLlmFn） | 统一 LLM 工厂       |
 * | getDocPipelineConfig | systemSettingService.getDocPipelineConfig | 保持不变           |
 *
 * ## 扩展指南
 *
 * 后续新增 internal job 时：
 * 1. 定义该 job 的 context.services 最小字段集合
 * 2. 在本模块中新增对应的 buildXxxContext() 工厂函数
 * 3. 保持 { query, execute, getModel } 作为所有 job 的公共基底
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
 * @param {Function} [options.callMcp] - MCP 调用函数，由平台级 McpToolCaller 注入
 * @param {Function} [options.callLlm] - LLM 调用函数，Phase 1 各 service 自行解析
 * @param {Function} [options.getDocPipelineConfig] - 获取 doc pipeline 配置
 * @returns {Object} services — 见上述上下文协议
 */
function buildDocPipelineContext(db, options = {}) {
  const sequelize = db.sequelize;

  const documentOcr = new DocumentOcrService(db, {
    callMcp: options.callMcp,
    callLlm: options.callLlm,
    getDocPipelineConfig: options.getDocPipelineConfig,
  });

  const documentClean = new DocumentCleanService(db, {
    getDocPipelineConfig: options.getDocPipelineConfig,
  });
  const documentOutline = new DocumentOutlineService(db, {
    getDocPipelineConfig: options.getDocPipelineConfig,
  });
  const documentChunk = new DocumentChunkService(db, {
    getDocPipelineConfig: options.getDocPipelineConfig,
  });
  const documentEmbedding = new DocumentEmbeddingService(db, {
    getDocPipelineConfig: options.getDocPipelineConfig,
  });

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
