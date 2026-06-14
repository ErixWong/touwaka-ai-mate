import logger from '../../lib/logger.js';

const DEFAULT_CONFIG = {
  learning: { enabled: true, default_tab: 'reading', daily_checkin_enabled: true, show_recent_history: true },
  reading: { quiz_question_count: 3, allow_sentence_tts: true, allow_full_article_tts: false, word_collect_limit_per_article: 10, show_difficulty_badge: true },
  review: { review_enabled: true, daily_review_size: 5, review_schedule_preset: 'standard', wrong_word_bucket_enabled: true, new_word_training_enabled: true },
  tts: { tts_enabled: true, tts_scope: 'word_sentence', tts_mode: 'realtime', tts_voice_options: ['female', 'male'], tts_default_speed: 1.0, tts_default_voice: 'female', tts_cache_enabled: false },
  materials: { material_source_mode: 'curated', daily_recommendation_count: 1, difficulty_range: ['A1', 'B2'] },
  ai: { quiz_generation_enabled: true, word_explanation_enabled: false, generation_mode: 'on_demand' },
  library: { allow_personal_library: true, allow_material_upload: true, allow_material_edit: true },
};

class ELSConfigService {
  constructor(db) {
    this.db = db;
    this.MiniApp = null;
    this.cache = null;
    this.cacheTime = null;
  }

  _ensureModel() {
    if (!this.MiniApp) {
      this.MiniApp = this.db.getModel('mini_app');
    }
  }

  async load() {
    this._ensureModel();

    if (this.cache && this.cacheTime && (Date.now() - this.cacheTime < 30000)) {
      return this.cache;
    }

    try {
      const app = await this.MiniApp.findOne({
        where: { app_id: 'els' },
        raw: true,
      });

      let config = {};
      if (app?.config) {
        try {
          config = typeof app.config === 'string' ? JSON.parse(app.config) : app.config;
        } catch {
          config = {};
        }
      }

      this.cache = { ...DEFAULT_CONFIG, ...config };
      this.cacheTime = Date.now();
      return this.cache;
    } catch (error) {
      logger.warn('[ELSConfig] Failed to load mini-app config, using defaults:', error.message);
      return { ...DEFAULT_CONFIG };
    }
  }

  async invalidateCache() {
    this.cache = null;
    this.cacheTime = null;
  }

  get(key, config) {
    const cfg = config || DEFAULT_CONFIG;
    const keys = key.split('.');
    let value = cfg;
    for (const k of keys) {
      if (value === undefined || value === null) return undefined;
      value = value[k];
    }
    return value;
  }

  async getQuizQuestionCount() {
    const cfg = await this.load();
    return this.get('reading.quiz_question_count', cfg) || 3;
  }

  async getDailyReviewSize() {
    const cfg = await this.load();
    return this.get('review.daily_review_size', cfg) || 5;
  }

  async getReviewSchedulePreset() {
    const cfg = await this.load();
    return this.get('review.review_schedule_preset', cfg) || 'standard';
  }

  async isWrongWordBucketEnabled() {
    const cfg = await this.load();
    return this.get('review.wrong_word_bucket_enabled', cfg) !== false;
  }

  async isTTSEnabled() {
    const cfg = await this.load();
    return this.get('tts.tts_enabled', cfg) !== false;
  }

  async getTTSVoiceOptions() {
    const cfg = await this.load();
    return this.get('tts.tts_voice_options', cfg) || ['female', 'male'];
  }

  async getTTSDefaultVoice() {
    const cfg = await this.load();
    return this.get('tts.tts_default_voice', cfg) || 'female';
  }
}

export default ELSConfigService;
export { DEFAULT_CONFIG };