/**
 * Embedding Worker Task - 知识点向量化后台任务
 *
 * 作为 BackgroundTaskScheduler 的任务处理器
 * 定期扫描未向量化的知识点，自动生成 embedding
 */

import { Op } from 'sequelize';
import logger from './logger.js';
import { generateEmbedding, isLocalModelAvailable } from './local-embedding.js';

/**
 * 将向量数组转换为 MariaDB VECTOR SQL 格式
 * 安全地处理特殊字符，防止 SQL 注入
 * @param {number[]} embedding 向量数组
 * @returns {string} MariaDB VECTOR SQL 格式
 */
function toVectorSQL(embedding) {
  if (!Array.isArray(embedding)) return null;

  // 验证数组元素都是数字
  for (let i = 0; i < embedding.length; i++) {
    if (typeof embedding[i] !== 'number' || !Number.isFinite(embedding[i])) {
      logger.error(`[EmbeddingTask] Invalid embedding value at index ${i}: ${embedding[i]}`);
      return null;
    }
  }

  const jsonStr = JSON.stringify(embedding);
  // 转义单引号，防止 SQL 注入
  const escapedStr = jsonStr.replace(/'/g, "''");
  return `VEC_FromText('${escapedStr}')`;
}

/**
 * 延迟函数
 * @param {number} ms 延迟毫秒数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 估算文本的 token 数量
 * 简单估算：中文约 1.5 字符/token，英文约 4 字符/token
 * @param {string} text - 文本内容
 * @returns {number} 估算的 token 数
 */
function estimateTokens(text) {
  if (!text) return 0;

  // 统计中文字符
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  // 非中文字符
  const otherChars = text.length - chineseChars;

  // 中文约 1.5 字符/token，英文约 4 字符/token
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 创建向量化任务处理器
 * @param {Object} options 配置选项
 * @param {number} options.batchSize 每批处理的知识点数量（默认 10）
 * @param {number} options.requestDelay API 请求间隔毫秒（默认 500，防止速率限制）
 * @param {number} options.maxRetries 最大重试次数（默认 3）
 * @returns {Function} 任务处理函数
 */
export function createEmbeddingTask(options = {}) {
  const batchSize = options.batchSize || 10;
  const requestDelay = options.requestDelay || 500; // 500ms 间隔
  const maxRetries = options.maxRetries || 3;

  // 缓存模型引用
  let models = null;

  /**
   * 确保模型已初始化
   */
  function ensureModels(db) {
    if (!models) {
      models = {
        KnowledgeBase: db.getModel('knowledge_base'),
        Knowledge: db.getModel('knowledge'),
        KnowledgePoint: db.getModel('knowledge_point'),
        AiModel: db.getModel('ai_model'),
        Provider: db.getModel('provider'),
      };
    }
    return models;
  }

  /**
   * 获取嵌入模型的 API 配置
   */
  async function getEmbeddingApiConfig(modelId) {
    if (!modelId || modelId === 'local') {
      return null;
    }

    const model = await models.AiModel.findOne({
      where: { id: modelId },
      include: [{
        model: models.Provider,
        as: 'provider',
        attributes: ['id', 'name', 'base_url', 'api_key'],
      }],
      raw: true,
      nest: true,
    });

    if (model?.provider) {
      return {
        baseUrl: model.provider.base_url,
        apiKey: model.provider.api_key,
        modelName: model.model_name,
      };
    }

    // 尝试从环境变量获取
    if (process.env.EMBEDDING_API_URL && process.env.EMBEDDING_API_KEY) {
      return {
        baseUrl: process.env.EMBEDDING_API_URL,
        apiKey: process.env.EMBEDDING_API_KEY,
        modelName: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      };
    }

    return null;
  }

  /**
   * 生成 embedding（支持本地模型和远程 API）
   */
  async function generateEmbeddingVector(text, modelId) {
    try {
      // 如果指定使用本地模型
      const useLocal = modelId === 'local' || !modelId || modelId.startsWith('local:');

      if (useLocal) {
        if (!isLocalModelAvailable()) {
          logger.warn('[EmbeddingTask] Local model not available');
          return null;
        }
        const embeddings = await generateEmbedding(text);
        return embeddings?.[0] || null;
      }

      // 使用远程 API
      const apiConfig = await getEmbeddingApiConfig(modelId);

      if (!apiConfig || !apiConfig.baseUrl || !apiConfig.apiKey) {
        // 尝试使用本地模型作为后备
        if (isLocalModelAvailable()) {
          logger.info('[EmbeddingTask] No API config, using local model as fallback');
          const embeddings = await generateEmbedding(text);
          return embeddings?.[0] || null;
        }
        logger.warn('[EmbeddingTask] No embedding API configured');
        return null;
      }

      const response = await fetch(apiConfig.baseUrl + '/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiConfig.apiKey}`,
        },
        body: JSON.stringify({
          input: text,
          model: apiConfig.modelName,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('[EmbeddingTask] API error:', response.status, errorText);
        return null;
      }

      const data = await response.json();
      return data.data?.[0]?.embedding || data.embeddings?.[0] || null;
    } catch (error) {
      logger.error('[EmbeddingTask] generateEmbedding error:', error);
      return null;
    }
  }

  /**
   * 向量化单个知识点
   */
  async function vectorizePoint(point, knowledgeMap, kbMap, db) {
    const knowledge = knowledgeMap.get(point.knowledge_id);
    if (!knowledge) {
      logger.warn(`[EmbeddingTask] Knowledge not found for point ${point.id}`);
      return false;
    }

    const kb = kbMap.get(knowledge.kb_id);
    if (!kb) {
      logger.warn(`[EmbeddingTask] Knowledge base not found for point ${point.id}`);
      return false;
    }

    // 构建上下文增强的文本
    const summary = knowledge.summary || '';
    const contextText = summary
      ? `[文章摘要] ${summary}\n[知识点] ${point.title || ''}\n${point.content}`
      : `${point.title ? point.title + '\n' : ''}${point.content}`;

    if (!contextText || !contextText.trim()) {
      logger.warn(`[EmbeddingTask] No content to vectorize for point ${point.id}`);
      return false;
    }

    // 生成 embedding
    const embedding = await generateEmbeddingVector(contextText, kb.embedding_model_id);

    if (!embedding) {
      logger.warn(`[EmbeddingTask] Failed to generate embedding for point ${point.id}`);
      return false;
    }

    // 计算 token 数（基于知识点内容，不包含摘要）
    const tokenCount = estimateTokens(point.content);

    // 保存到数据库（同时更新 embedding 和 token_count）
    const vectorSQL = toVectorSQL(embedding);
    await models.KnowledgePoint.update(
      {
        embedding: db.sequelize.literal(vectorSQL),
        token_count: tokenCount,
      },
      { where: { id: point.id } }
    );

    logger.info(`[EmbeddingTask] Vectorized point ${point.id}, dim: ${embedding.length}, tokens: ${tokenCount}`);

    // 更新知识库维度（如果需要）
    const actualDim = embedding.length;
    if (kb.embedding_dim !== actualDim) {
      await models.KnowledgeBase.update(
        { embedding_dim: actualDim },
        { where: { id: kb.id } }
      );
      logger.info(`[EmbeddingTask] Updated KB ${kb.id} embedding_dim to ${actualDim}`);
    }

    return true;
  }

  /**
   * 任务处理主函数
   */
  return async function embeddingTaskHandler(db) {
    ensureModels(db);

    try {
      // 查找未向量化的知识点（embedding 为 null）
      const pendingPoints = await models.KnowledgePoint.findAll({
        where: {
          embedding: null,
          content: { [Op.ne]: null }, // 必须有内容
        },
        limit: batchSize,
        order: [['created_at', 'ASC']],
        raw: true,
      });

      if (pendingPoints.length === 0) {
        return; // 没有待处理的
      }

      logger.info(`[EmbeddingTask] Found ${pendingPoints.length} points to vectorize`);

      // 获取关联的文章和知识库信息
      const knowledgeIds = [...new Set(pendingPoints.map(p => p.knowledge_id))];

      const knowledges = await models.Knowledge.findAll({
        where: { id: knowledgeIds },
        attributes: ['id', 'kb_id', 'summary'],
        raw: true,
      });

      const knowledgeMap = new Map(knowledges.map(k => [k.id, k]));

      // 获取知识库信息（包含 embedding_model_id）
      const kbIds = [...new Set(knowledges.map(k => k.kb_id))];
      const knowledgeBases = await models.KnowledgeBase.findAll({
        where: { id: kbIds },
        attributes: ['id', 'embedding_model_id', 'embedding_dim'],
        raw: true,
      });

      const kbMap = new Map(knowledgeBases.map(kb => [kb.id, kb]));

      // 逐个处理知识点（带速率限制）
      let successCount = 0;
      let failCount = 0;

      for (const point of pendingPoints) {
        try {
          const success = await vectorizePoint(point, knowledgeMap, kbMap, db);
          if (success) {
            successCount++;
          } else {
            failCount++;
          }

          // 请求间隔，防止 API 速率限制
          if (requestDelay > 0 && successCount + failCount < pendingPoints.length) {
            await delay(requestDelay);
          }
        } catch (err) {
          logger.error(`[EmbeddingTask] Failed to vectorize point ${point.id}:`, err.message);
          failCount++;
        }
      }

      logger.info(`[EmbeddingTask] Batch completed: ${successCount} success, ${failCount} failed`);
    } catch (error) {
      logger.error('[EmbeddingTask] Task error:', error);
      throw error;
    }
  };
}

export default createEmbeddingTask;