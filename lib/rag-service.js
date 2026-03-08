/**
 * RAG Service - 检索增强生成服务（重构后版本）
 *
 * 提供知识库检索能力，将检索结果注入到对话上下文中。
 * 
 * 新数据模型：
 * - kb_articles (文章)
 * - kb_sections (节)
 * - kb_paragraphs (段) - 包含 embedding
 */

import logger from './logger.js';

class RAGService {
  constructor(db, configLoader) {
    this.db = db;
    this.configLoader = configLoader;
    this.KnowledgeBase = null;
    this.KbArticle = null;
    this.KbSection = null;
    this.KbParagraph = null;
  }

  /**
   * 确保模型已初始化
   */
  ensureModels() {
    if (!this.KnowledgeBase) {
      this.KnowledgeBase = this.db.getModel('knowledge_base');
      this.KbArticle = this.db.getModel('kb_article');
      this.KbSection = this.db.getModel('kb_section');
      this.KbParagraph = this.db.getModel('kb_paragraph');
    }
  }

  /**
   * RAG 检索主入口
   *
   * @param {string} query - 用户查询
   * @param {Object} options - 检索选项
   * @param {string} options.expertId - 专家ID（用于获取关联的知识库）
   * @param {string} options.kbId - 指定知识库ID（可选）
   * @param {number} options.topK - 返回数量（默认 5）
   * @param {number} options.threshold - 相似度阈值（默认 0.7）
   * @param {string} options.userId - 用户ID（权限验证）
   * @returns {Promise<Object>} 检索结果
   */
  async retrieve(query, options = {}) {
    const { expertId, kbId, topK = 5, threshold = 0.7, userId } = options;

    this.ensureModels();

    try {
      // 1. 确定要搜索的知识库
      const kbIds = await this.getTargetKbIds(expertId, kbId, userId);
      if (kbIds.length === 0) {
        return {
          success: false,
          message: 'No knowledge bases available',
          results: [],
        };
      }

      // 2. 生成查询向量
      const queryEmbedding = await this.generateQueryEmbedding(query, kbIds[0], userId);
      if (!queryEmbedding) {
        return {
          success: false,
          message: 'Failed to generate query embedding',
          results: [],
        };
      }

      // 3. 向量检索
      const results = await this.vectorSearch(queryEmbedding, kbIds, topK, threshold, userId);

      // 4. 格式化结果
      const formattedResults = results.map(r => ({
        paragraph_id: r.id,
        title: r.title,
        content: r.content,
        context: r.context,
        similarity: r.similarity,
        section_id: r.section_id,
        section_title: r.section_title,
        article_id: r.article_id,
        article_title: r.article_title,
        kb_id: r.kb_id,
        kb_name: r.kb_name,
      }));

      logger.info('[RAG] Retrieve completed:', {
        query_length: query.length,
        kb_count: kbIds.length,
        result_count: formattedResults.length,
        top_similarity: formattedResults[0]?.similarity || 0,
      });

      return {
        success: true,
        query,
        results: formattedResults,
        kb_ids: kbIds,
      };
    } catch (error) {
      logger.error('[RAG] Retrieve error:', error);
      return {
        success: false,
        message: error.message,
        results: [],
      };
    }
  }

  /**
   * 获取目标知识库ID列表
   */
  async getTargetKbIds(expertId, kbId, userId) {
    const kbIds = [];

    // 如果指定了知识库ID
    if (kbId) {
      // 验证权限
      const kb = await this.KnowledgeBase.findOne({
        where: { id: kbId, owner_id: userId },
        raw: true,
      });
      if (kb) {
        kbIds.push(parseInt(kbId));
      }
      return kbIds;
    }

    // 如果有专家ID，获取专家关联的知识库
    if (expertId) {
      const expertKbs = await this.getExpertKnowledgeBases(expertId, userId);
      kbIds.push(...expertKbs.map(kb => kb.id));
    }

    // 如果都没有，获取用户的所有知识库
    if (kbIds.length === 0) {
      const userKbs = await this.KnowledgeBase.findAll({
        where: { owner_id: userId },
        attributes: ['id'],
        raw: true,
      });
      kbIds.push(...userKbs.map(kb => kb.id));
    }

    return kbIds;
  }

  /**
   * 获取专家关联的知识库
   */
  async getExpertKnowledgeBases(expertId, userId) {
    // 从专家配置中获取关联的知识库
    // 暂时返回用户的所有知识库
    // TODO: 后续可以在专家配置中添加 knowledge_base_ids 字段
    return await this.KnowledgeBase.findAll({
      where: { owner_id: userId },
      attributes: ['id', 'name'],
      raw: true,
    });
  }

  /**
   * 生成查询向量
   */
  async generateQueryEmbedding(query, kbId, userId) {
    // 获取知识库配置（包含 embedding 模型信息）
    const kb = await this.KnowledgeBase.findOne({
      where: { id: kbId, owner_id: userId },
      raw: true,
    });

    if (!kb) {
      logger.warn('[RAG] Knowledge base not found:', kbId);
      return null;
    }

    // 调用 embedding API
    try {
      const embedding = await this.callEmbeddingApi(query, kb);
      return embedding;
    } catch (error) {
      logger.error('[RAG] Generate embedding error:', error);
      return null;
    }
  }

  /**
   * 调用 Embedding API
   */
  async callEmbeddingApi(text, kb) {
    const https = require('https');
    const http = require('http');

    // 从环境变量或知识库配置获取 embedding 配置
    const apiUrl = process.env.EMBEDDING_API_URL;
    const apiKey = process.env.EMBEDDING_API_KEY;
    const modelName = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

    if (!apiUrl || !apiKey) {
      throw new Error('Embedding API not configured');
    }

    const url = new URL(apiUrl);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const requestBody = JSON.stringify({
      input: text,
      model: modelName,
    });

    return new Promise((resolve, reject) => {
      const req = httpModule.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}/embeddings`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(requestBody),
        },
        timeout: 30000,
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`Embedding API error: ${res.statusCode}`));
              return;
            }
            const json = JSON.parse(body);
            const embedding = json.data?.[0]?.embedding;
            if (!embedding) {
              reject(new Error('No embedding in response'));
              return;
            }
            resolve(embedding);
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Embedding API timeout'));
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * 向量搜索
   */
  async vectorSearch(queryEmbedding, kbIds, topK, threshold, userId) {
    const results = [];

    for (const kbId of kbIds) {
      // 获取该知识库的所有带向量的段落
      const paragraphs = await this.getParagraphsWithEmbedding(kbId, userId);

      for (const paragraph of paragraphs) {
        try {
          const embedding = JSON.parse(paragraph.embedding.toString());
          const similarity = this.cosineSimilarity(queryEmbedding, embedding);

          if (similarity >= threshold) {
            results.push({
              ...paragraph,
              similarity,
            });
          }
        } catch (error) {
          // 跳过解析失败的向量
        }
      }
    }

    // 按相似度排序
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, topK);
  }

  /**
   * 获取带向量的段落
   */
  async getParagraphsWithEmbedding(kbId, userId) {
    // 验证权限
    const kb = await this.KnowledgeBase.findOne({
      where: { id: kbId, owner_id: userId },
      raw: true,
    });

    if (!kb) {
      return [];
    }

    // 获取文章
    const articles = await this.KbArticle.findAll({
      where: { kb_id: kbId },
      attributes: ['id', 'title'],
      raw: true,
    });

    const articleMap = new Map(articles.map(a => [a.id, a.title]));

    // 获取节
    const sections = await this.KbSection.findAll({
      where: { article_id: articles.map(a => a.id) },
      attributes: ['id', 'article_id', 'title'],
      raw: true,
    });

    const sectionMap = new Map(sections.map(s => [s.id, { article_id: s.article_id, title: s.title }]));

    // 使用原始 SQL 获取带向量的段落（因为 VECTOR 类型需要特殊处理）
    const paragraphs = await this.db.sequelize.query(
      `SELECT p.id, p.section_id, p.title, p.content, p.embedding
       FROM kb_paragraphs p
       JOIN kb_sections s ON p.section_id = s.id
       JOIN kb_articles a ON s.article_id = a.id
       WHERE a.kb_id = :kbId AND p.embedding IS NOT NULL`,
      {
        replacements: { kbId },
        type: this.db.sequelize.QueryTypes.SELECT,
      }
    );

    // 格式化结果
    return paragraphs.map(p => {
      const sectionInfo = sectionMap.get(p.section_id) || { article_id: null, title: 'Unknown' };
      const articleTitle = articleMap.get(sectionInfo.article_id) || 'Unknown';

      return {
        ...p,
        section_title: sectionInfo.title,
        article_id: sectionInfo.article_id,
        article_title: articleTitle,
        kb_id: kbId,
        kb_name: kb.name,
      };
    });
  }

  /**
   * 余弦相似度计算
   */
  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * 构建 RAG 上下文消息
   *
   * @param {Array} results - 检索结果
   * @param {Object} options - 选项
   * @param {number} options.maxTokens - 最大 token 数（默认 2000）
   * @param {string} options.style - 输出风格（default, concise, detailed）
   * @returns {string} 格式化的上下文消息
   */
  buildContextMessage(results, options = {}) {
    const { maxTokens = 2000, style = 'default' } = options;

    if (!results || results.length === 0) {
      return '';
    }

    const parts = [];

    // 添加上下文标题
    if (style === 'detailed') {
      parts.push('## 相关知识库内容\n');
      parts.push('以下是从知识库中检索到的相关内容，请参考这些信息回答用户问题：\n');
    } else {
      parts.push('[知识库检索结果]\n');
    }

    let totalTokens = 0;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const content = this.formatResult(r, style);
      const tokens = this.estimateTokens(content);

      if (totalTokens + tokens > maxTokens) {
        break;
      }

      parts.push(content);
      totalTokens += tokens;
    }

    if (style === 'detailed') {
      parts.push('\n---\n请基于以上知识库内容回答用户问题。如果知识库内容与问题不相关，请忽略并基于你的知识回答。');
    }

    return parts.join('\n');
  }

  /**
   * 格式化单个检索结果
   */
  formatResult(result, style) {
    if (style === 'concise') {
      return `【${result.title || '段落'}】${result.content.substring(0, 300)}${result.content.length > 300 ? '...' : ''}`;
    }

    if (style === 'detailed') {
      return `
### ${result.title || '段落'}
> 来源：${result.kb_name} > ${result.article_title} > ${result.section_title}
> 相关度：${(result.similarity * 100).toFixed(1)}%

${result.content}

${result.context ? `*上下文：${result.context}*` : ''}
`;
    }

    // default style
    return `【${result.kb_name} > ${result.article_title} > ${result.section_title}】
${result.title ? `标题：${result.title}\n` : ''}${result.content}
${result.context ? `(上下文: ${result.context})` : ''}

---`;
  }

  /**
   * 估算 token 数量
   */
  estimateTokens(text) {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }
}

export default RAGService;
