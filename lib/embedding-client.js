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
import { withEmbeddingSlot } from './llm-concurrency.js';

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
   * @param {number} [timeoutMs] - 请求超时（毫秒），未传则无超时
   * @returns {Promise<number[]|null>} embedding 向量数组
   */
  async embed(text, timeoutMs) {
    if (!text || typeof text !== 'string') {
      logger.warn('[EmbeddingClient] Skipped empty input');
      return null;
    }

    try {
      // 闸门包住 fetch + 读取响应体的完整生命周期；超时计时器**移到槽内**启动，
      // 使超时只覆盖真实上游请求，不再把等待并发槽的排队时间算进去（否则重活占满闸时
      // 轻请求会“排队到超时”被误杀）。响应体在槽内读完，避免提前释锁后体未取完。
      const data = await withEmbeddingSlot(async () => {
        const controller = timeoutMs ? new AbortController() : null;
        const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
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
            ...(controller ? { signal: controller.signal } : {}),
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            logger.error('[EmbeddingClient] API error:', response.status, errorText.substring(0, 500));
            throw new Error(`Embedding API ${response.status}: ${errorText.substring(0, 500) || 'unknown upstream error'}`);
          }

          return await response.json();
        } finally {
          if (timer) clearTimeout(timer);
        }
      });

      return data.data?.[0]?.embedding || data.embeddings?.[0] || null;
    } catch (error) {
      if (error instanceof Error && !error.message.includes('aborted')) {
        logger.error('[EmbeddingClient] embed error:', error.message);
        throw error;
      }
      logger.error('[EmbeddingClient] embed error:', error.message);
      return null;
    }
  }

  /**
   * 批量嵌入（OpenAI 兼容数组入参）：把每请求开销摊到每块上。
   * 实测上游劣化窗口单发频繁超时，而 20 条批量 45-70s 可回——吞吐差一个数量级。
   * 返回与入参对齐的向量数组（无向量的位置为 null）；非中止类错误抛出。
   * 批量请求超时下限 15 分钟：一路死等到返回为止——提前 abort 再重发只会把
   * 同一批在队列里叠成双份（后端不会因为断连放弃已收下的活，实测教训）。
   */
  async embedMany(texts, timeoutMs) {
    const list = (Array.isArray(texts) ? texts : []).map((t) => String(t || '').trim());
    if (list.length === 0) return [];
    if (list.length === 1) {
      const single = await this.embed(list[0], timeoutMs);
      return [single];
    }
    const effectiveTimeoutMs = Math.max(Number(timeoutMs) || 0, 900000);

    try {
      const data = await withEmbeddingSlot(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
        try {
          const response = await fetch(`${this.baseUrl}/embeddings`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              input: list,
              model: this.modelName,
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            logger.error('[EmbeddingClient] Batch API error:', response.status, errorText.substring(0, 500));
            throw new Error(`Embedding API ${response.status}: ${errorText.substring(0, 500) || 'unknown upstream error'}`);
          }

          return await response.json();
        } finally {
          clearTimeout(timer);
        }
      });

      const rows = Array.isArray(data?.data) ? data.data
        : (Array.isArray(data?.embeddings) ? data.embeddings : []);
      const out = new Array(list.length).fill(null);
      rows.forEach((row, pos) => {
        const idx = Number.isInteger(row?.index) ? row.index : pos;
        if (idx >= 0 && idx < out.length) out[idx] = row?.embedding ?? null;
      });
      return out;
    } catch (error) {
      logger.error(`[EmbeddingClient] Batch embed (${list.length} inputs) failed:`, error.message);
      throw error;
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
