/**
 * RAG Service - 检索增强生成服务
 *
 * 提供知识库检索能力，将检索结果注入到对话上下文中。
 * 已切换到统一文档平台 (DocRecallService)
 */

import logger from './logger.js';
import DocRecallService from './doc-recall-service.js';

class RAGService {
  constructor(db, configLoader) {
    this.db = db;
    this.configLoader = configLoader;
    this.docRecallService = null;
  }

  ensureModels() {
    if (!this.docRecallService) {
      this.docRecallService = new DocRecallService(this.db, this.configLoader);
    }
  }

  async retrieve(query, options = {}) {
    const { topK = 5, threshold = 0.7, userId } = options;

    this.ensureModels();

    try {
      const result = await this.docRecallService.recall(query, {
        scope: 'knowledge',
        top_k: topK,
        threshold,
        userId,
      });

      if (!result.success || !result.items) {
        return { success: false, message: result.message || 'Recall failed', results: [] };
      }

      const formattedResults = result.items.map(item => ({
        paragraph_id: item.content_unit?.id,
        title: item.content_unit?.title || item.document?.title,
        content: item.content_unit?.content,
        context: '',
        similarity: item.score,
        section_id: null,
        section_title: null,
        article_id: item.document?.id,
        article_title: item.document?.title,
        kb_id: item.document?.id,
        kb_name: item.document?.title,
      }));

      logger.info('[RAG] Retrieve completed:', {
        query_length: query.length,
        result_count: formattedResults.length,
        top_similarity: formattedResults[0]?.similarity || 0,
      });

      return {
        success: true,
        results: formattedResults,
        query,
        total: formattedResults.length,
      };

    } catch (error) {
      logger.error('[RAG] Retrieve error:', error);
      return { success: false, message: error.message, results: [] };
    }
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

    let context = 'RAG Results:\n\n';

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const similarity = Math.round(r.similarity * 100);
      const title = r.title || '无标题';
      const content = r.content || '';
      const articleTitle = r.article_title || '';

      context += `[${i + 1}] ${title} (相似度: ${similarity}%)`;
      if (articleTitle) {
        context += `\n来源: ${articleTitle}`;
      }
      context += '\n';

      if (content) {
        if (style === 'concise') {
          context += `内容: ${content.substring(0, 300)}\n`;
        } else if (style === 'detailed') {
          context += `内容: ${content}\n`;
        } else {
          context += `内容: ${content.substring(0, 500)}\n`;
        }
      }
      context += '\n';
    }

    // 限制 token 数（简单估算：1 字符 ≈ 1.5 token）
    if (context.length > maxTokens * 1.5) {
      context = context.substring(0, Math.floor(maxTokens * 1.5)) + '\n...(上下文已截断)';
    }

    return context;
  }
}

export default RAGService;