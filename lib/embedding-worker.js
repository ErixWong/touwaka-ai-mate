/**
 * Embedding Worker Task - 知识点向量化后台任务
 *
 * 作为 BackgroundTaskScheduler 的任务处理器
 * 定期扫描未向量化的知识点，自动生成 embedding
 */

import { Op } from 'sequelize';
import logger from './logger.js';
import { generateEmbedding, isLocalModelAvailable } from './local-embedding.js';
import { encoding_for_model } from 'tiktoken';

// 缓存 tokenizer 实例（避免重复加载）
let tokenizer = null;

/**
 * 获取 tokenizer 实例（懒加载）
 * 使用 cl100k_base 编码，兼容 GPT-4、GPT-3.5-turbo、text-embedding-ada-002
 */
function getTokenizer() {
  if (!tokenizer) {
    try {
      tokenizer = encoding_for_model('gpt-4');
      logger.info('[EmbeddingTask] Tokenizer initialized (cl100k_base)');
    } catch (error) {
      logger.error('[EmbeddingTask] Failed to initialize tokenizer:', error.message);
    }
  }
  return tokenizer;
}

/**
 * 精确计算文本的 token 数量（使用 tiktoken）
 * @param {string} text - 文本内容
 * @returns {number} token 数
 */
function countTokens(text) {
  if (!text) return 0;
  
  const enc = getTokenizer();
  if (!enc) {
    // tokenizer 初始化失败，回退到估算
    return estimateTokens(text);
  }
  
  try {
    const tokens = enc.encode(text);
    return tokens.length;
  } catch (error) {
    logger.warn('[EmbeddingTask] Token count error, using estimate:', error.message);
    return estimateTokens(text);
  }
}

/**
 * 估算文本的 token 数量（简单估算，作为后备方案）
 * 中文约 1.5 字符/token，英文约 4 字符/token
 * @param {string} text - 文本内容
 * @returns {number} 估算的 token 数
 */
function estimateTokens(text) {
  if (!text) return 0;

  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;

  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

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
    const tokenCount = countTokens(point.content);

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

    // 每次任务启动时打印日志（方便调试）
    console.log('[EmbeddingTask] 🔍 Checking for pending knowledge points to vectorize...');
    logger.info('[EmbeddingTask] Checking for pending knowledge points...');

    try {
      // 查找未向量化的知识点（embedding 为 null）
      // 注意：VECTOR 类型在 Sequelize 中无法直接使用 embedding: null 查询
      // 使用原始 SQL 查询来正确处理 VECTOR 类型的 NULL 检查
      const pendingPoints = await db.sequelize.query(
        `SELECT id, knowledge_id, title, content, context, position, token_count, created_at, updated_at
         FROM knowledge_points
         WHERE embedding IS NULL AND content IS NOT NULL
         ORDER BY created_at ASC
         LIMIT ?`,
        {
          replacements: [batchSize],
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (pendingPoints.length === 0) {
        console.log('[EmbeddingTask] ✅ No pending knowledge points found');
        
        // 即使没有待向量化的知识点，也要检查并修复状态不一致的文章
        // 这可以修复之前因 VECTOR 类型查询问题导致的状态不一致
        await fixKnowledgeStatus(db, models);
        return;
      }

      console.log(`[EmbeddingTask] 📝 Found ${pendingPoints.length} points to vectorize`);
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

      console.log(`[EmbeddingTask] ✅ Batch completed: ${successCount} success, ${failCount} failed`);
      logger.info(`[EmbeddingTask] Batch completed: ${successCount} success, ${failCount} failed`);

      // 更新 Knowledge.status：根据知识点向量化状态自动更新知识状态
      if (successCount > 0) {
        console.log('[EmbeddingTask] 🔄 Updating knowledge status based on vectorization progress...');
        const affectedKnowledgeIds = [...new Set(pendingPoints.map(p => p.knowledge_id))];
        
        // 批量查询：避免 N+1 问题
        // 1. 统计每个 knowledge 的知识点总数
        const totalPointsStats = await models.KnowledgePoint.findAll({
          attributes: [
            'knowledge_id',
            [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'total']
          ],
          where: { knowledge_id: affectedKnowledgeIds },
          group: ['knowledge_id'],
          raw: true,
        });
        
        // 2. 统计每个 knowledge 的已向量化知识点数
        // 注意：VECTOR 类型在 Sequelize 中无法直接使用 embedding: { [Op.ne]: null } 查询
        // 使用原始 SQL 查询来正确处理 VECTOR 类型的 NOT NULL 检查
        const vectorizedStats = await db.sequelize.query(
          `SELECT knowledge_id, COUNT(id) as vectorized
           FROM knowledge_points
           WHERE knowledge_id IN (?) AND embedding IS NOT NULL
           GROUP BY knowledge_id`,
          {
            replacements: [affectedKnowledgeIds],
            type: db.sequelize.QueryTypes.SELECT,
          }
        );
        
        // 构建统计 Map
        const totalMap = new Map(totalPointsStats.map(s => [s.knowledge_id, parseInt(s.total) || 0]));
        const vectorizedMap = new Map(vectorizedStats.map(s => [s.knowledge_id, parseInt(s.vectorized) || 0]));
        
        // 批量更新状态
        for (const knowledgeId of affectedKnowledgeIds) {
          try {
            const totalPoints = totalMap.get(knowledgeId) || 0;
            const vectorizedPoints = vectorizedMap.get(knowledgeId) || 0;

            // 更新状态：所有知识点都已向量化 → ready，否则 → pending
            const newStatus = (vectorizedPoints === totalPoints && totalPoints > 0) ? 'ready' : 'pending';
            
            await models.Knowledge.update(
              { status: newStatus },
              { where: { id: knowledgeId } }
            );
            
            console.log(`[EmbeddingTask] 📊 Knowledge ${knowledgeId}: ${newStatus} (${vectorizedPoints}/${totalPoints} vectorized)`);
            logger.info(`[EmbeddingTask] Updated Knowledge ${knowledgeId} status to ${newStatus} (${vectorizedPoints}/${totalPoints} vectorized)`);
          } catch (err) {
            console.error(`[EmbeddingTask] ❌ Failed to update Knowledge ${knowledgeId} status:`, err.message);
            logger.error(`[EmbeddingTask] Failed to update Knowledge ${knowledgeId} status:`, err.message);
          }
        }
        console.log('[EmbeddingTask] ✅ Knowledge status update completed');
      }
    } catch (error) {
      logger.error('[EmbeddingTask] Task error:', error);
      throw error;
    }
  };
}

/**
 * 修复状态不一致的文章
 * 检查所有状态为 pending 的文章，如果知识点都已向量化则更新为 ready
 */
async function fixKnowledgeStatus(db, models) {
  try {
    // 查找所有状态为 pending 的文章
    const pendingKnowledges = await models.Knowledge.findAll({
      where: { status: 'pending' },
      attributes: ['id'],
      raw: true,
    });

    if (pendingKnowledges.length === 0) {
      return; // 没有需要修复的
    }

    console.log(`[EmbeddingTask] 🔧 Checking ${pendingKnowledges.length} pending knowledges for status fix...`);
    
    const pendingKnowledgeIds = pendingKnowledges.map(k => k.id);

    // 统计每个 knowledge 的知识点总数
    const totalPointsStats = await models.KnowledgePoint.findAll({
      attributes: [
        'knowledge_id',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'total']
      ],
      where: { knowledge_id: pendingKnowledgeIds },
      group: ['knowledge_id'],
      raw: true,
    });

    // 统计每个 knowledge 的已向量化知识点数（使用原始 SQL）
    const vectorizedStats = await db.sequelize.query(
      `SELECT knowledge_id, COUNT(id) as vectorized
       FROM knowledge_points
       WHERE knowledge_id IN (?) AND embedding IS NOT NULL
       GROUP BY knowledge_id`,
      {
        replacements: [pendingKnowledgeIds],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    // 构建统计 Map
    const totalMap = new Map(totalPointsStats.map(s => [s.knowledge_id, parseInt(s.total) || 0]));
    const vectorizedMap = new Map(vectorizedStats.map(s => [s.knowledge_id, parseInt(s.vectorized) || 0]));

    // 检查并更新状态
    let fixedCount = 0;
    for (const knowledgeId of pendingKnowledgeIds) {
      const totalPoints = totalMap.get(knowledgeId) || 0;
      const vectorizedPoints = vectorizedMap.get(knowledgeId) || 0;

      // 如果所有知识点都已向量化，更新状态为 ready
      if (vectorizedPoints === totalPoints && totalPoints > 0) {
        await models.Knowledge.update(
          { status: 'ready' },
          { where: { id: knowledgeId } }
        );
        
        console.log(`[EmbeddingTask] 🔧 Fixed Knowledge ${knowledgeId}: pending → ready (${vectorizedPoints}/${totalPoints} vectorized)`);
        logger.info(`[EmbeddingTask] Fixed Knowledge ${knowledgeId} status from pending to ready`);
        fixedCount++;
      }
    }

    if (fixedCount > 0) {
      console.log(`[EmbeddingTask] ✅ Fixed ${fixedCount} knowledge status`);
    }
  } catch (error) {
    console.error('[EmbeddingTask] ❌ Error fixing knowledge status:', error.message);
    logger.error('[EmbeddingTask] Error fixing knowledge status:', error);
  }
}

export default createEmbeddingTask;