import LibraryService from './library.service.js';
import MaterialService from './material.service.js';
import NotebookService from './notebook.service.js';
import WordService from './word.service.js';
import ReviewService from './review.service.js';
import CheckinService from './checkin.service.js';
import PreferenceService from './preference.service.js';
import MaterialProcessorService from './material-processor.service.js';
import QuizGeneratorService from './quiz-generator.service.js';
import ELSConfigService from './config.service.js';

class ELSService {
  constructor(db) {
    this.db = db;
    this.library = new LibraryService(db);
    this.material = new MaterialService(db);
    this.notebook = new NotebookService(db);
    this.word = new WordService(db);
    this.review = new ReviewService(db);
    this.checkin = new CheckinService(db);
    this.preference = new PreferenceService(db);
    this.processor = new MaterialProcessorService(db);
    this.quiz = new QuizGeneratorService(db);
    this.config = new ELSConfigService(db);
  }

  async ensureUserSetup(userId) {
    await this.library.ensureDefaultPublicLibrary();
    await this.library.ensurePersonalLibrary(userId);
    await this.notebook.ensureNotebook(userId, 'en', '英语词本');
    await this.preference.getOrCreate(userId);
  }
  
  async ensureUserSetupWithLanguage(userId, language) {
    await this.library.ensureDefaultPublicLibrary();
    await this.library.ensurePersonalLibrary(userId);
    await this.notebook.ensureNotebook(userId, language, this._getNotebookName(language));
    await this.preference.getOrCreate(userId);
  }
  
  _getNotebookName(language) {
    const names = {
      en: '英语词本',
      fr: '法语词本',
      de: '德语词本',
      ja: '日语词本',
      es: '西班牙语词本',
    };
    return names[language] || `${language}词本`;
  }

  async resolveSelectedLibraryId(userId) {
    await this.ensureUserSetup(userId);
    const pref = await this.preference.getOrCreate(userId);
    
    if (pref.selected_library_id) {
      const library = await this.library.getById(pref.selected_library_id);
      const isAccessible = library && library.is_active &&
        (library.library_type === 'public' || library.owner_user_id === userId);
      
      if (isAccessible) {
        return pref.selected_library_id;
      }
      
      await this.preference.update(userId, { selected_library_id: null });
    }
    
    const defaultLib = await this.library.ensureDefaultPublicLibrary();
    return defaultLib.id;
  }

  async resolveSelectedNotebookId(userId) {
    await this.ensureUserSetup(userId);
    const pref = await this.preference.getOrCreate(userId);

    if (pref.selected_notebook_id) {
      const notebook = await this.notebook.getById(pref.selected_notebook_id);
      const isValid = notebook && notebook.user_id === userId;

      if (isValid) {
        return pref.selected_notebook_id;
      }

      await this.preference.update(userId, { selected_notebook_id: null });
    }

    const items = await this.notebook.list(userId);
    if (items.length > 0) return items[0].id;

    const defaultNotebook = await this.notebook.ensureNotebook(userId, 'en', '英语词本');
    return defaultNotebook.id;
  }

  async getDashboard(userId) {
    const selectedLibraryId = await this.resolveSelectedLibraryId(userId);

    const todayStatus = await this.checkin.getToday(userId);
    const library = await this.library.getById(selectedLibraryId);
    const materialCount = await this.library.getMaterialCount(selectedLibraryId, userId);
    const materials = await this.material.getRecommended(selectedLibraryId, userId);
    const notebooks = await this.notebook.list(userId);
    
    const reviewStats = {
      today_due: 0,
      new_words: 0,
      wrong_words: 0,
    };
    
    for (const nb of notebooks) {
      const words = await this.db.getModel('app_els_user_word').findAll({
        where: { notebook_id: nb.id, is_mastered: false },
        raw: true,
      });
      
      const now = new Date();
      for (const w of words) {
        if (w.next_review_at && new Date(w.next_review_at) <= now) {
          reviewStats.today_due++;
        }
        if (w.review_stage === 'D0' && !w.next_review_at) {
          reviewStats.new_words++;
        }
        if (w.is_in_wrong_bucket) {
          reviewStats.wrong_words++;
        }
      }
    }
    
    return {
      today_status: todayStatus,
      selected_library: {
        id: library?.id || selectedLibraryId,
        name: library?.name || '公共推荐库',
        material_count: materialCount,
      },
      recommended_material: materials[0] || null,
      review_stats: reviewStats,
      recent_materials: [],
    };
  }
}

export {
  LibraryService,
  MaterialService,
  NotebookService,
  WordService,
  ReviewService,
  CheckinService,
  PreferenceService,
  ELSService,
};

export default ELSService;