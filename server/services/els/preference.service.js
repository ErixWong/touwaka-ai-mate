import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';

class PreferenceService {
  constructor(db) {
    this.db = db;
    this.Preference = null;
  }

  _ensureModel() {
    if (!this.Preference) {
      this.Preference = this.db.getModel('app_els_user_preferences');
    }
  }

  async getOrCreate(userId) {
    this._ensureModel();
    
    let pref = await this.Preference.findOne({
      where: { user_id: userId },
      raw: true,
    });
    
    if (!pref) {
      const id = Utils.newID(20);
      await this.Preference.create({
        id,
        user_id: userId,
        selected_library_id: null,
        selected_notebook_id: null,
        default_tts_voice: 'female',
        default_tts_speed: 1.0,
        daily_goal_reading: 1,
        daily_goal_review: 5,
      });
      
      pref = await this.Preference.findOne({
        where: { user_id: userId },
        raw: true,
      });
      
      logger.info(`[PreferenceService] Created preferences for user ${userId}`);
    }
    
    return pref;
  }

  async update(userId, updates) {
    this._ensureModel();
    
    const pref = await this.Preference.findOne({ where: { user_id: userId } });
    
    if (!pref) {
      await this.getOrCreate(userId);
    }
    
    const allowedFields = [
      'selected_library_id',
      'selected_notebook_id',
      'default_tts_voice',
      'default_tts_speed',
      'daily_goal_reading',
      'daily_goal_review',
      'metadata',
    ];
    
    const filteredUpdates = {};
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    }
    
    if (Object.keys(filteredUpdates).length > 0) {
      await this.Preference.update(filteredUpdates, { where: { user_id: userId } });
      logger.info(`[PreferenceService] Updated preferences for user ${userId}`);
    }
    
    return this.getOrCreate(userId);
  }

  async getSelectedLibrary(userId) {
    const pref = await this.getOrCreate(userId);
    return pref?.selected_library_id || null;
  }

  async setSelectedLibrary(userId, libraryId) {
    return this.update(userId, { selected_library_id: libraryId });
  }

  async getSelectedNotebook(userId) {
    const pref = await this.getOrCreate(userId);
    return pref?.selected_notebook_id || null;
  }

  async setSelectedNotebook(userId, notebookId) {
    return this.update(userId, { selected_notebook_id: notebookId });
  }
}

export default PreferenceService;