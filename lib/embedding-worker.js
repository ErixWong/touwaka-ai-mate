/**
 * Embedding Worker Task - 知识点向量化后台任务（重构后版本）
 *
 * 作为 BackgroundTaskScheduler 的 任务处理器
 * 定期扫描未向量化的段落，自动生成 embedding
 * 
 * 新数据模型：
 * - kb_articles (文章)
 * - kb_sections (节)
 * - kb_paragraphs (段)
 */

import { Op } from 'sequelize';
import logger from './logger.js';
import { encoding_for_model } from 'tiktoken';

// 缓存 tokenizer 实例（避免重复加载）
let tokenizer = null;

/**
 * 获取 tokenizer 实例（懒加载）
 * 使用 cl100k_base 编码，兼容 GPT-4、 GPT-3.5-turbo、 text-embedding-ada-002
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
 * 将向量数组转换为 MariaDB VECTOR 二进制格式
 * MariaDB VECTOR 类型需要以二进制格式存储
 * @param {number[]} embedding 向量数组
 * @returns {Buffer} MariaDB VECTOR 二进制格式
 */
function toVectorBuffer(embedding) {
  if (!Array.isArray(embedding)) return null;

  // 验证数组元素都是数字
  for (let i = 0; i < embedding.length; i++) {
    if (typeof embedding[i] !== 'number' || !Number.isFinite(embedding[i])) {
      logger.error(`[EmbeddingTask] Invalid embedding value at index ${i}: ${embedding[i]}`);
      return null;
    }
  }

  // 将浮点数数组转换为二进制 Buffer (Float32Array)
  const floatArray = new Float32Array(embedding);
  return Buffer.from(floatArray.buffer);
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
 * @param {number} options.batchSize 每批处理的段落数量（默认 10）
 * @param {number} options.requestDelay API 请求间隔毫秒（默认 500，防止速率限制）
 * @returns {Function} 任务处理函数
 */
export function createEmbeddingTask(options = {}) {
  const batchSize = options.batchSize || 10;
  const requestDelay = options.requestDelay || 500; // 500ms 间隔

  // 缓存模型引用
  let models = null;

  /**
   * 确保模型已初始化
   */
  function ensureModels(db) {
    if (!models) {
      models = {
        KnowledgeBase: db.getModel('knowledge_basis'),
        KbArticle: db.getModel('kb_article'),
        KbSection: db.getModel('kb_section'),
        KbParagraph: db.getModel('kb_paragraph'),
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

    if (!model || !model.provider) {
      return null;
    }

    return {
      baseUrl: model.provider.base_url,
      apiKey: model.provider.api_key,
      modelName: model.model_name || 'text-embedding-3-small',
    };
  }

  /**
   * 生成 embedding（通过远程 API）
   */
  async function generateEmbeddingVector(text, modelId) {
    // 获取 API 配置
    const apiConfig = await getEmbeddingApiConfig(modelId);
    
    if (!apiConfig) {
      logger.warn('[EmbeddingTask] No embedding API configured for model:', modelId);
      return null;
    }

    try {
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
   * 向量化单个段落
   */
  async function vectorizeParagraph(paragraph, sectionMap, articleMap, kbMap, db) {
    const section = sectionMap.get(paragraph.section_id);
    if (!section) {
      logger.warn(`[EmbeddingTask] Section not found for paragraph ${paragraph.id}`);
      return false;
    }

    const article = articleMap.get(section.article_id);
    if (!article) {
      logger.warn(`[EmbeddingTask] Article not found for section ${section.id}`);
      return false;
    }

    const kb = kbMap.get(article.kb_id);
    if (!kb) {
      logger.warn(`[EmbeddingTask] Knowledge base not found for article ${article.id}`);
      return false;
    }

    // 构建上下文增强的文本（包含文章标题、节标题）
    const contextParts = [];
    if (article.title) contextParts.push(`文章：${article.title}`);
    if (section.title) contextParts.push(`章节：${section.title}`);
    if (paragraph.title) contextParts.push(`标题：${paragraph.title}`);
    contextParts.push(paragraph.content);
    
    const contextText = contextParts.join('\n');
    const tokenCount = countTokens(contextText);

    // 生成 embedding
    const embedding = await generateEmbeddingVector(contextText, kb.embedding_model_id);

    if (!embedding) {
      logger.warn(`[EmbeddingTask] Failed to generate embedding for paragraph ${paragraph.id}`);
      return false;
    }

    // 保存到数据库（同时更新 embedding 和 token_count）
    // 使用原始 SQL 直接插入二进制数据，避免 Sequelize 的类型转换问题
    const vectorBuffer = toVectorBuffer(embedding);
    if (!vectorBuffer) {
      logger.error(`[EmbeddingTask] Failed to convert embedding to buffer for paragraph ${paragraph.id}`);
      return false;
    }
    
    // 检查向量维度（从知识库配置获取期望维度，默认 1536）
    const expectedDim = kb.embedding_dim || 1536;
    const vectorDim = embedding.length;
    let finalBuffer = vectorBuffer;
    
    if (vectorDim !== expectedDim) {
      logger.warn(`[EmbeddingTask] Vector dimension mismatch for paragraph ${paragraph.id}: expected ${expectedDim}, got ${vectorDim}`);
      // 如果维度不匹配，尝试截断或填充
      let adjustedEmbedding;
      if (vectorDim > expectedDim) {
        adjustedEmbedding = embedding.slice(0, expectedDim);
      } else {
        adjustedEmbedding = [...embedding, ...new Array(expectedDim - vectorDim).fill(0)];
      }
      // 重新生成 buffer
      const adjustedBuffer = toVectorBuffer(adjustedEmbedding);
      if (adjustedBuffer) {
        finalBuffer = adjustedBuffer;
        logger.info(`[EmbeddingTask] Adjusted vector dimension from ${vectorDim} to ${expectedDim}`);
      }
    }
    
    // 使用 VEC_FromText 函数插入向量
    // MariaDB VECTOR 类型可以通过 JSON 数组字符串使用 VEC_FromText 转换
    try {
      const embeddingJson = JSON.stringify(finalEmbedding);
      // 将 JSON 字符串中的特殊字符转义，防止 SQL 注入
      const escapedJson = embeddingJson
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"');
      // 直接拼接 SQL，避免 Sequelize 的参数替换问题
      const sql = `UPDATE kb_paragraphs SET embedding = VEC_FromText('${escapedJson}'), token_count = ${tokenCount} WHERE id = '${paragraph.id}'`;
      await db.execute(sql);
    } catch (dbError) {
      logger.error(`[EmbeddingTask] Database error for paragraph ${paragraph.id}:`, dbError.message);
      logger.error(`[EmbeddingTask] Vector dimension:`, finalEmbedding.length, 'expected dim:', expectedDim);
      throw dbError;
    }

    logger.info(`[EmbeddingTask] Vectorized paragraph ${paragraph.id}, dim: ${embedding.length}, tokens: ${tokenCount}`);

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

  return async function embeddingTaskHandler(db) {
    ensureModels(db);

    // 静默检查，只在有实际处理时才输出日志

    try {
      // 查找未向量化的段落（embedding 为 null）
      // 注意：VECTOR 类型在 Sequelize 中无法直接使用 embedding: null 查询
      // 使用原始 SQL 查询来正确处理 VECTOR 类型的 NULL 检查
      const pendingParagraphs = await db.sequelize.query(
        `SELECT id, section_id, title, content, position, token_count, created_at, updated_at
         FROM kb_paragraphs
         WHERE embedding IS NULL AND content IS NOT NULL
         ORDER BY created_at ASC
         LIMIT ${batchSize}`,
        { type: 'SELECT' }
      );

      if (pendingParagraphs.length === 0) {
        // 没有待处理的段落，静默检查是否有需要修复状态的文章
        await fixArticleStatus(db, models);
        return;
      }

      console.log(`[EmbeddingTask] 📝 Found ${pendingParagraphs.length} pending paragraphs`);

      // 获取关联的节信息
      const sectionIds = [...new Set(pendingParagraphs.map(p => p.section_id))];

      const sections = await models.KbSection.findAll({
        where: { id: sectionIds },
        attributes: ['id', 'article_id', 'title'],
        raw: true,
      });

      const sectionMap = new Map(sections.map(s => [s.id, s]));

      // 获取关联的文章信息
      const articleIds = [...new Set(sections.map(s => s.article_id))];
      const articles = await models.KbArticle.findAll({
        where: { id: articleIds },
        attributes: ['id', 'kb_id', 'title'],
        raw: true,
      });

      const articleMap = new Map(articles.map(a => [a.id, a]));

      // 获取知识库信息（包含 embedding_model_id）
      const kbIds = [...new Set(articles.map(a => a.kb_id))];
      const knowledgeBases = await models.KnowledgeBase.findAll({
        where: { id: kbIds },
        attributes: ['id', 'embedding_model_id', 'embedding_dim'],
        raw: true,
      });

      const kbMap = new Map(knowledgeBases.map(kb => [kb.id, kb]));

      // 处理每个段落
      let successCount = 0;
      let failCount = 0;

      for (const paragraph of pendingParagraphs) {
        try {
          const success = await vectorizeParagraph(paragraph, sectionMap, articleMap, kbMap, db);
          if (success) {
            successCount++;
          } else {
            failCount++;
          }

          // 添加延迟，防止 API 速率限制
          if (requestDelay > 0) {
            await delay(requestDelay);
          }
        } catch (error) {
          logger.error(`[EmbeddingTask] Error vectorizing paragraph ${paragraph.id}:`, error);
          failCount++;
        }
      }

      console.log(`[EmbeddingTask] ✅ Vectorized ${successCount} paragraphs, failed: ${failCount}`);
      logger.info(`[EmbeddingTask] Completed: ${successCount} success, ${failCount} failed`);

      // 更新文章状态
      if (successCount > 0) {
        console.log('[EmbeddingTask] 🔄 Updating article status based on vectorization progress...');
        const affectedArticleIds = articleIds;

        // 统计每个文章的段落总数
        const totalParagraphsStats = await models.KbParagraph.findAll({
          attributes: [
            'section_id',
            [db.sequelize.fn('COUNT', db.sequelize.col('kb_paragraph.id')), 'total']
          ],
          include: [{
            model: models.KbSection,
            as: 'section',
            attributes: [],
            where: { article_id: affectedArticleIds },
          }],
          group: ['section.article_id'],
          raw: true,
        });

        // 统计每个文章的已向量化段落数（使用原始 SQL）
        const vectorizedStats = await db.sequelize.query(
          `SELECT a.id as article_id, COUNT(p.id) as vectorized
           FROM kb_articles a
           JOIN kb_sections s ON s.article_id = a.id
           JOIN kb_paragraphs p ON p.section_id = s.id
           WHERE a.id IN (?) AND p.embedding IS NOT NULL
           GROUP BY a.id`,
          {
            replacements: [affectedArticleIds],
            type: db.sequelize.QueryTypes.SELECT,
          }
        );

        // 构建统计 Map
        const totalMap = new Map(totalParagraphsStats.map(s => [s.section?.article_id, parseInt(s.total) || 0]));
        const vectorizedMap = new Map(vectorizedStats.map(s => [s.article_id, parseInt(s.vectorized) || 0]));

        // 批量更新状态
        for (const articleId of affectedArticleIds) {
          try {
            const totalParagraphs = totalMap.get(articleId) || 0;
            const vectorizedParagraphs = vectorizedMap.get(articleId) || 0;

            // 更新状态：所有段落都已向量化 → ready， 否则 → processing
            const newStatus = (vectorizedParagraphs === totalParagraphs && totalParagraphs > 0) ? 'ready' : 'processing';

            await models.KbArticle.update(
              { status: newStatus },
              { where: { id: articleId } }
            );

            console.log(`[EmbeddingTask] 📊 Article ${articleId}: ${newStatus} (${vectorizedParagraphs}/${totalParagraphs} vectorized)`);
            logger.info(`[EmbeddingTask] Updated Article ${articleId} status to ${newStatus} (${vectorizedParagraphs}/${totalParagraphs} vectorized)`);
          } catch (err) {
            console.error(`[EmbeddingTask] ❌ Failed to update Article ${articleId} status:`, err.message);
            logger.error(`[EmbeddingTask] Failed to update Article ${articleId} status:`, err.message);
          }
        }
      }
    } catch (error) {
      console.error('[EmbeddingTask] ❌ Error in embedding task:', error.message);
      logger.error('[EmbeddingTask] Error in embedding task:', error);
    }
  };
}

/**
 * 修复文章状态
 * 检查所有 processing 状态的文章，如果所有段落都已向量化，更新为 ready
 */
async function fixArticleStatus(db, models) {
  try {
    // 查找所有 processing 状态的文章
    const pendingArticles = await models.KbArticle.findAll({
      where: { status: 'processing' },
      attributes: ['id'],
      raw: true,
    });

    if (pendingArticles.length === 0) {
      return;
    }

    const pendingArticleIds = pendingArticles.map(a => a.id);

    console.log(`[EmbeddingTask] 🔧 Checking ${pendingArticles.length} pending articles for status fix...`);

    // 统计每个文章的段落总数
    const totalParagraphsStats = await models.KbParagraph.findAll({
      attributes: [
        'section_id',
        [db.sequelize.fn('COUNT', db.sequelize.col('kb_paragraph.id')), 'total']
      ],
      include: [{
        model: models.KbSection,
        as: 'section',
        attributes: [],
        where: { article_id: pendingArticleIds },
      }],
      group: ['section.article_id'],
      raw: true,
    });

    // 统计每个文章的已向量化段落数（使用原始 SQL）
    const vectorizedStats = await db.sequelize.query(
      `SELECT a.id as article_id, COUNT(p.id) as vectorized
       FROM kb_articles a
       JOIN kb_sections s ON s.article_id = a.id
       JOIN kb_paragraphs p ON p.section_id = s.id
       WHERE a.id IN (?) AND p.embedding IS NOT NULL
       GROUP BY a.id`,
      {
        replacements: [pendingArticleIds],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    // 构建统计 Map
    const totalMap = new Map(totalParagraphsStats.map(s => [s.section?.article_id, parseInt(s.total) || 0]));
    const vectorizedMap = new Map(vectorizedStats.map(s => [s.article_id, parseInt(s.vectorized) || 0]));

    // 检查并更新状态
    let fixedCount = 0;
    for (const articleId of pendingArticleIds) {
      const totalParagraphs = totalMap.get(articleId) || 0;
      const vectorizedParagraphs = vectorizedMap.get(articleId) || 0;

      // 如果所有段落都已向量化，更新状态为 ready
      if (vectorizedParagraphs === totalParagraphs && totalParagraphs > 0) {
        await models.KbArticle.update(
          { status: 'ready' },
          { where: { id: articleId } }
        );

        console.log(`[EmbeddingTask] 🔧 Fixed Article ${articleId}: processing → ready (${vectorizedParagraphs}/${totalParagraphs} vectorized)`);
        logger.info(`[EmbeddingTask] Fixed Article ${articleId} status from processing to ready`);
        fixedCount++;
      }
    }

    if (fixedCount > 0) {
      console.log(`[EmbeddingTask] ✅ Fixed ${fixedCount} article status`);
    }
  } catch (error) {
    console.error('[EmbeddingTask] ❌ Error fixing article status:', error.message);
    logger.error('[EmbeddingTask] Error fixing article status:', error);
  }
}
