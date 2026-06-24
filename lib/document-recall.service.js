import logger from './logger.js';
import DocRecallService from './doc-recall-service.js';

class DocumentRecallService {
  constructor(db) {
    this.db = db;
    this.docRecallService = null;
  }

  ensureModels() {
    if (!this.docRecallService) {
      this.docRecallService = new DocRecallService(this.db, null);
    }
  }

  async recall(query, options = {}) {
    this.ensureModels();

    const {
      scope = 'all',
      doc_types,
      top_k = 5,
      threshold = 0.1,
      userId,
      embedding_model_id,
    } = options;

    if (!query || !query.trim()) {
      throw new Error('Query is required');
    }

    const result = await this.docRecallService.recall(query, {
      scope,
      doc_types,
      top_k: parseInt(top_k),
      threshold: parseFloat(threshold),
      userId,
      embedding_model_id,
    });

    if (!result.success) {
      throw new Error(result.message || 'Recall failed');
    }

    return result.items;
  }
}

export default DocumentRecallService;