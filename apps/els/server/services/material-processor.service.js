import logger from '../../../../lib/logger.js';
import Utils from '../../../../lib/utils.js';

const REJECT_KEYWORDS = ['inappropriate', 'violence', 'illegal', 'adult content'];

class MaterialProcessorService {
  constructor(db) {
    this.db = db;
    this.Material = null;
  }

  _ensureModel() {
    if (!this.Material) {
      this.Material = this.db.getModel('app_els_material');
    }
  }

  async processMaterial(materialId) {
    this._ensureModel();

    const material = await this.Material.findOne({
      where: { id: materialId, processing_status: 'processing' },
    });

    if (!material) {
      logger.warn(`[MaterialProcessor] Material ${materialId} not found or not in processing status`);
      return null;
    }

    try {
      const content = (material.content || '').toLowerCase();
      const isRejected = REJECT_KEYWORDS.some((kw) => content.includes(kw));

      if (isRejected) {
        await this.Material.update(
          {
            processing_status: 'rejected',
            status_reason: '内容包含不适合学习的敏感信息，已被系统驳回',
            quiz_status: 'pending',
          },
          { where: { id: materialId } }
        );
        logger.info(`[MaterialProcessor] Material ${materialId} rejected`);
        return { processing_status: 'rejected', status_reason: '内容包含不适合学习的敏感信息' };
      }

      await this.Material.update(
        {
          processing_status: 'ready',
          status_reason: null,
          quiz_status: 'ready',
          quiz_payload: JSON.stringify(this._generateQuizPayload(material)),
          difficulty_level: this._estimateDifficulty(material.content),
          summary: material.summary || material.content?.substring(0, 100) || null,
          cleaning_version: 'v1.0-template',
          published_at: new Date(),
        },
        { where: { id: materialId } }
      );

      logger.info(`[MaterialProcessor] Material ${materialId} processed to ready`);
      return { processing_status: 'ready', status_reason: null };
    } catch (error) {
      logger.error(`[MaterialProcessor] Failed to process material ${materialId}:`, error);
      await this.Material.update(
        {
          processing_status: 'failed',
          status_reason: `处理失败：${error.message}`,
        },
        { where: { id: materialId } }
      );
      return { processing_status: 'failed', status_reason: error.message };
    }
  }

  async reprocessAllPending() {
    this._ensureModel();

    const pendingMaterials = await this.Material.findAll({
      where: { processing_status: 'processing' },
      raw: true,
    });

    logger.info(`[MaterialProcessor] Found ${pendingMaterials.length} pending materials`);

    const results = [];
    for (const m of pendingMaterials) {
      const result = await this.processMaterial(m.id);
      results.push({ material_id: m.id, ...result });
    }

    return results;
  }

  _estimateDifficulty(content) {
    const text = content || '';
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 50) return 'A1';
    if (wordCount < 100) return 'A2';
    if (wordCount < 200) return 'B1';
    if (wordCount < 300) return 'B2';
    return 'C1';
  }

  _generateQuizPayload(material) {
    return {
      generated_at: new Date().toISOString(),
      generator: 'template-v1',
      questions: [
        {
          id: 'q1',
          type: 'single_choice',
          prompt: `What is the main idea of "${material.title}"?`,
          options: [
            this._getAnswer(material.summary || material.content),
            'An unrelated topic',
            'A complex scientific theory',
            'A personal diary entry',
          ],
        },
        {
          id: 'q2',
          type: 'single_choice',
          prompt: 'Which statement best reflects the content?',
          options: [
            'The content discusses key concepts in a structured way',
            'The content is purely fictional',
            'The content has no clear message',
            'The content is a recipe',
          ],
        },
        {
          id: 'q3',
          type: 'single_choice',
          prompt: 'What can you learn from this material?',
          options: [
            'Important knowledge about the topic',
            'Nothing useful',
            'How to cook',
            'Advanced mathematics',
          ],
        },
      ],
    };
  }

  _getAnswer(text) {
    return (text || 'The main topic').substring(0, 60);
  }
}

export default MaterialProcessorService;
