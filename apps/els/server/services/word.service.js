import logger from '../../../../lib/logger.js';
import Utils from '../../../../lib/utils.js';

class WordService {
  constructor(db) {
    this.db = db;
    this.Word = null;
    this.Notebook = null;
    this.Material = null;
    this.Library = null;
  }

  _ensureModels() {
    if (!this.Word) {
      this.Word = this.db.getModel('app_els_user_word');
    }
    if (!this.Notebook) {
      this.Notebook = this.db.getModel('app_els_notebook');
    }
    if (!this.Material) {
      this.Material = this.db.getModel('app_els_material');
    }
    if (!this.Library) {
      this.Library = this.db.getModel('app_els_library');
    }
  }

  async getById(wordId) {
    this._ensureModels();
    
    return this.Word.findOne({
      where: { id: wordId },
      raw: true,
    });
  }

  async collect(userId, payload) {
    this._ensureModels();
    
    const material = await this.Material.findOne({
      where: { id: payload.material_id },
      raw: true,
    });
    
    if (!material) {
      const error = new Error('材料不存在');
      error.code = 'ELS_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    
    if (material.processing_status !== 'ready') {
      const error = new Error('当前材料暂不可学习，无法加词');
      error.code = 'ELS_INVALID_STATUS';
      error.status = 409;
      throw error;
    }
    
    const library = await this.Library.findOne({
      where: { id: material.library_id },
      raw: true,
    });
    
    if (!library) {
      const error = new Error('材料所属学习库不存在');
      error.code = 'ELS_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    
    if (library.library_type === 'personal' && library.owner_user_id !== userId) {
      const error = new Error('无权对该材料的词语进行操作');
      error.code = 'ELS_FORBIDDEN';
      error.status = 403;
      throw error;
    }
    
    let notebook = await this.Notebook.findOne({
      where: { user_id: userId, language: material.language },
      raw: true,
    });
    
    if (!notebook) {
      const notebookNames = {
        en: '英语词本',
        fr: '法语词本',
        de: '德语词本',
        ja: '日语词本',
        es: '西班牙语词本',
      };
      
      const notebookId = Utils.newID(20);
      await this.Notebook.create({
        id: notebookId,
        user_id: userId,
        language: material.language,
        name: notebookNames[material.language] || `${material.language}词本`,
        is_default: material.language === 'en',
      });
      
      notebook = await this.Notebook.findOne({
        where: { id: notebookId },
        raw: true,
      });
      
      logger.info(`[WordService] Auto-created notebook ${notebookId} for user ${userId}, language ${material.language}`);
    }
    
    const existing = await this.Word.findOne({
      where: {
        notebook_id: notebook.id,
        material_id: payload.material_id,
        word_text: payload.word_text,
      },
      raw: true,
    });
    
    if (existing) {
      logger.info(`[WordService] Word ${payload.word_text} already exists for user ${userId}`);
      return {
        word: {
          id: existing.id,
          word_text: existing.word_text,
          meaning: existing.meaning,
          phonetic: existing.phonetic,
          tts: {
            available: true,
            mode: 'realtime',
            voices: ['female', 'male'],
            default_voice: 'female',
          },
          sentence: existing.example_sentence || payload.sentence,
          notebook_id: existing.notebook_id,
          language: existing.language,
          review_stage: existing.review_stage,
        },
        already_exists: true,
      };
    }
    
    const id = Utils.newID(20);
    
    await this.Word.create({
      id,
      user_id: userId,
      notebook_id: notebook.id,
      material_id: payload.material_id,
      language: material.language,
      word_text: payload.word_text,
      meaning: '释义待补充',
      phonetic: null,
      example_sentence: payload.sentence,
      source_sentence: payload.sentence,
      review_stage: 'D0',
      next_review_at: null,
      wrong_count: 0,
      consecutive_correct_count: 0,
      is_in_wrong_bucket: false,
      is_mastered: false,
    });
    
    logger.info(`[WordService] Collected word ${payload.word_text} for user ${userId}`);
    
    return {
      word: {
        id,
        word_text: payload.word_text,
        meaning: '释义待补充',
        phonetic: null,
        tts: {
          available: true,
          mode: 'realtime',
          voices: ['female', 'male'],
          default_voice: 'female',
        },
        sentence: payload.sentence,
        notebook_id: notebook.id,
        language: material.language,
        review_stage: 'D0',
      },
      already_exists: false,
    };
  }

  async getDetail(wordId, userId) {
    this._ensureModels();
    
    const word = await this.getById(wordId);
    
    if (!word) {
      return null;
    }
    
    if (word.user_id !== userId) {
      const error = new Error('无权查看该词条');
      error.code = 'ELS_FORBIDDEN';
      error.status = 403;
      throw error;
    }
    
    return {
      id: word.id,
      word_text: word.word_text,
      meaning: word.meaning,
      phonetic: word.phonetic,
      tts: {
        available: true,
        mode: 'realtime',
        voices: ['female', 'male'],
        default_voice: 'female',
      },
      notebook_id: word.notebook_id,
      language: word.language,
      example_sentence: word.example_sentence,
      review_stage: word.review_stage,
      next_review_at: word.next_review_at,
      wrong_count: word.wrong_count,
    };
  }
}

export default WordService;
