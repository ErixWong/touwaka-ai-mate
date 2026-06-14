import logger from '../../../lib/logger.js';

class QuizGeneratorService {
  constructor(db) {
    this.db = db;
    this.Material = null;
  }

  _ensureModel() {
    if (!this.Material) {
      this.Material = this.db.getModel('app_els_materials');
    }
  }

  async generateForMaterial(materialId) {
    this._ensureModel();

    const material = await this.Material.findOne({
      where: { id: materialId, processing_status: 'ready' },
      raw: true,
    });

    if (!material) {
      return null;
    }

    if (material.quiz_payload) {
      try {
        return JSON.parse(material.quiz_payload);
      } catch {
        // regenerate below
      }
    }

    return this._buildTemplateQuiz(material);
  }

  async getQuestions(materialId, questionCount = 3) {
    this._ensureModel();

    const material = await this.Material.findOne({
      where: { id: materialId, processing_status: 'ready', quiz_status: 'ready' },
      raw: true,
    });

    if (!material) {
      return { material_id: materialId, questions: [] };
    }

    const quiz = await this.generateForMaterial(materialId);
    const questions = (quiz?.questions || []).slice(0, questionCount);

    return {
      material_id: materialId,
      questions,
    };
  }

  _buildTemplateQuiz(material) {
    const words = this._extractKeyWords(material.content);
    const summary = material.summary || material.content?.substring(0, 100) || '';
    const title = material.title || 'this article';

    return {
      material_id: material.id,
      questions: [
        {
          id: 'q1',
          type: 'single_choice',
          prompt: `What is the main idea of "${title}"?`,
          options: [
            summary.substring(0, 50),
            'Something completely unrelated',
            'A historical event not mentioned',
            'An unrelated scientific discovery',
          ],
        },
        words.length > 0 ? {
          id: 'q2',
          type: 'single_choice',
          prompt: `What does "${words[0]}" most likely mean?`,
          options: [
            'A key concept from the article',
            'An unrelated word meaning',
            'A mathematical term',
            'A cooking ingredient',
          ],
        } : {
          id: 'q2',
          type: 'single_choice',
          prompt: 'Which action helps learning?',
          options: ['Reading regularly', 'Never practicing', 'Ignoring feedback', 'Avoiding challenges'],
        },
        {
          id: 'q3',
          type: 'single_choice',
          prompt: 'What can you take away from this material?',
          options: [
            'Practical knowledge about the topic',
            'Nothing useful at all',
            'Only entertainment value',
            'It is purely fictional',
          ],
        },
      ],
    };
  }

  _extractKeyWords(content) {
    if (!content) return [];
    const commonWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
      'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each', 'every',
      'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
      'only', 'own', 'same', 'than', 'too', 'very', 'just', 'about', 'also',
      'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
    ]);

    const words = content
      .replace(/[^a-zA-Z\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 4 && !commonWords.has(w.toLowerCase()));

    const unique = [...new Set(words)];
    return unique.slice(0, 5);
  }
}

export default QuizGeneratorService;
