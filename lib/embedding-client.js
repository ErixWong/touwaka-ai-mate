/**
 * EmbeddingClient — 统一 Embedding provider 调用
 *
 * 所有需要生成 embedding 的业务路径（文档召回、知识库向量化、段落嵌入等）
 * 统一通过此客户端调用，禁止业务模块直接拼 provider URL 或自建 HTTP 请求。
 *
 * 使用方式：
 *   // 方式一：从 modelConfig 创建
 *   const client = new EmbeddingClient(modelConfig);
 *   const vector = await client.embed(text);
 *
 *   // 方式二：从环境变量创建（仅 doc-recall-service 等特殊场景）
 *   const client = EmbeddingClient.fromEnv();
 *   const vector = await client.embed(text);
 */

import logger from './logger.js';
import { normalizeBaseUrl } from './llm-url-utils.js';

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

class EmbeddingClient {
  /**
   * @param {Object} modelConfig - 完整模型配置
   * @param {string} modelConfig.base_url - provider base URL
   * @param {string} modelConfig.api_key - API key
   * @param {string} [modelConfig.model_name] - embedding 模型名
   */
  constructor(modelConfig) {
    if (!modelConfig || !modelConfig.base_url) {
      throw new Error('EmbeddingClient requires a model config with base_url');
    }
    this.baseUrl = normalizeBaseUrl(modelConfig.base_url);
    this.apiKey = modelConfig.api_key || '';
    this.modelName = modelConfig.model_name || DEFAULT_EMBEDDING_MODEL;
  }

  /**
   * 生成单个文本的 embedding 向量
   * @param {string} text - 待向量化的文本
   * @returns {Promise<number[]|null>} embedding 向量数组
   */
  async embed(text) {
    if (!text || typeof text !== 'string') {
      logger.warn('[EmbeddingClient] Skipped empty input');
      return null;
    }

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: text,
          model: this.modelName,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        logger.error('[EmbeddingClient] API error:', response.status, errorText.substring(0, 500));
        return null;
      }

      const data = await response.json();
      return data.data?.[0]?.embedding || data.embeddings?.[0] || null;
    } catch (error) {
      logger.error('[EmbeddingClient] embed error:', error.message);
      return null;
    }
  }

  /**
   * 从环境变量创建 EmbeddingClient（用于 doc-recall-service 等不从数据库读配置的场景）
   * 环境变量: EMBEDDING_API_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL
   * @returns {EmbeddingClient|null}
   */
  static fromEnv() {
    const base_url = process.env.EMBEDDING_API_URL;
    const api_key = process.env.EMBEDDING_API_KEY;

    if (!base_url || !api_key) {
      logger.warn('[EmbeddingClient] EMBEDDING_API_URL or EMBEDDING_API_KEY not set');
      return null;
    }

    return new EmbeddingClient({
      base_url,
      api_key,
      model_name: process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    });
  }

  /**
   * 从 db + modelId 创建 EmbeddingClient
   * @param {Object} db - 数据库实例
   * @param {string} modelId - embedding 模型 ID
   * @returns {Promise<EmbeddingClient|null>}
   */
  static async fromModelId(db, modelId) {
    if (!modelId) {
      logger.warn('[EmbeddingClient] No modelId provided');
      return null;
    }

    const modelConfig = await db.getModelConfig(modelId);
    if (!modelConfig) {
      logger.warn('[EmbeddingClient] Model config not found for:', modelId);
      return null;
    }

    return new EmbeddingClient(modelConfig);
  }
}

export default EmbeddingClient;
