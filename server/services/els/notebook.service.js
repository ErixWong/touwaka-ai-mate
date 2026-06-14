import logger from '../../../lib/logger.js';
import Utils from '../../../lib/utils.js';

class NotebookService {
  constructor(db) {
    this.db = db;
    this.Notebook = null;
    this.Word = null;
  }

  _ensureModels() {
    if (!this.Notebook) {
      this.Notebook = this.db.getModel('app_els_notebooks');
    }
    if (!this.Word) {
      this.Word = this.db.getModel('app_els_user_words');
    }
  }

  async list(userId) {
    this._ensureModels();
    
    const notebooks = await this.Notebook.findAll({
      where: { user_id: userId },
      order: [['language', 'ASC']],
      raw: true,
    });
    
    const result = [];
    for (const nb of notebooks) {
      const wordCount = await this.Word.count({
        where: { notebook_id: nb.id, is_mastered: false },
      });
      
      result.push({
        id: nb.id,
        language: nb.language,
        name: nb.name,
        word_count: wordCount,
        is_selected: false,
      });
    }
    
    return result;
  }

  async getById(notebookId) {
    this._ensureModels();
    
    return this.Notebook.findOne({
      where: { id: notebookId },
      raw: true,
    });
  }

  async getByLanguage(userId, language) {
    this._ensureModels();
    
    return this.Notebook.findOne({
      where: { user_id: userId, language },
      raw: true,
    });
  }

  async ensureNotebook(userId, language, name) {
    this._ensureModels();
    
    const existing = await this.getByLanguage(userId, language);
    
    if (existing) {
      return existing;
    }
    
    const notebookNames = {
      en: '英语词本',
      fr: '法语词本',
      de: '德语词本',
      ja: '日语词本',
      es: '西班牙语词本',
    };
    
    const id = Utils.newID(20);
    await this.Notebook.create({
      id,
      user_id: userId,
      language,
      name: name || notebookNames[language] || `${language}词本`,
      is_default: language === 'en',
    });
    
    logger.info(`[NotebookService] Created notebook ${id} for user ${userId}, language ${language}`);
    return this.getById(id);
  }
}

export default NotebookService;
