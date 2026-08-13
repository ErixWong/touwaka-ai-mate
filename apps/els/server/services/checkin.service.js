import logger from '../../../../lib/logger.js';
import Utils from '../../../../lib/utils.js';

class CheckinService {
  constructor(db) {
    this.db = db;
    this.StudyDay = null;
  }

  _ensureModel() {
    if (!this.StudyDay) {
      this.StudyDay = this.db.getModel('app_els_user_study_day');
    }
  }

  _getStudyDate() {
    const now = new Date();
    now.setHours(now.getHours() + 8);
    return now.toISOString().split('T')[0];
  }

  async getToday(userId) {
    this._ensureModel();
    
    const studyDate = this._getStudyDate();
    
    let record = await this.StudyDay.findOne({
      where: { user_id: userId, study_date: studyDate },
      raw: true,
    });
    
    if (!record) {
      record = await this.getOrCreate(userId, studyDate);
    }
    
    return {
      is_checked_in: !!record?.is_checked_in,
      completed_reading: !!record?.completed_reading,
      completed_review: !!record?.completed_review,
      streak_days: record?.streak_snapshot || 0,
      day_type: this._getDayType(record),
    };
  }

  _getDayType(record) {
    if (!record) return null;
    
    const reading = !!record.completed_reading;
    const review = !!record.completed_review;
    
    if (reading && review) return 'full_day';
    if (reading) return 'reading_day';
    if (review) return 'review_day';
    return null;
  }

  async getOrCreate(userId, studyDate) {
    this._ensureModel();
    
    let record = await this.StudyDay.findOne({
      where: { user_id: userId, study_date: studyDate },
    });
    
    if (!record) {
      const id = Utils.newID(20);
      await this.StudyDay.create({
        id,
        user_id: userId,
        study_date: studyDate,
        completed_reading: false,
        completed_review: false,
        is_checked_in: false,
        streak_snapshot: 0,
      });
      
      record = await this.StudyDay.findOne({
        where: { user_id: userId, study_date: studyDate },
        raw: true,
      });
      
      logger.info(`[CheckinService] Created study day for user ${userId}, date ${studyDate}`);
    }
    
    return record;
  }

  async calculateStreakOnFirstCompletion(userId, studyDate) {
    this._ensureModel();
    
    const yesterday = new Date(studyDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const yesterdayRecord = await this.StudyDay.findOne({
      where: { user_id: userId, study_date: yesterdayStr },
      raw: true,
    });
    
    if (yesterdayRecord && (yesterdayRecord.completed_reading || yesterdayRecord.completed_review)) {
      return yesterdayRecord.streak_snapshot + 1;
    }
    
    return 1;
  }

  async markReadingCompleted(userId) {
    this._ensureModel();
    
    const studyDate = this._getStudyDate();
    const record = await this.getOrCreate(userId, studyDate);
    
    if (!record.completed_reading) {
      const isFirstCompletionToday = !record.completed_reading && !record.completed_review;
      let streakUpdate = {};
      
      if (isFirstCompletionToday) {
        const newStreak = await this.calculateStreakOnFirstCompletion(userId, studyDate);
        streakUpdate = { streak_snapshot: newStreak };
      }
      
      await this.StudyDay.update(
        {
          completed_reading: true,
          is_checked_in: true,
          first_completed_at: record.first_completed_at || new Date(),
          ...streakUpdate,
        },
        { where: { user_id: userId, study_date: studyDate } }
      );
      
      logger.info(`[CheckinService] Marked reading completed for user ${userId}, streak updated: ${streakUpdate.streak_snapshot || 'no change'}`);
    }
    
    return this.getToday(userId);
  }

  async markReviewCompleted(userId) {
    this._ensureModel();
    
    const studyDate = this._getStudyDate();
    const record = await this.getOrCreate(userId, studyDate);
    
    if (!record.completed_review) {
      const isFirstCompletionToday = !record.completed_reading && !record.completed_review;
      let streakUpdate = {};
      
      if (isFirstCompletionToday) {
        const newStreak = await this.calculateStreakOnFirstCompletion(userId, studyDate);
        streakUpdate = { streak_snapshot: newStreak };
      }
      
      await this.StudyDay.update(
        {
          completed_review: true,
          is_checked_in: true,
          first_completed_at: record.first_completed_at || new Date(),
          ...streakUpdate,
        },
        { where: { user_id: userId, study_date: studyDate } }
      );
      
      logger.info(`[CheckinService] Marked review completed for user ${userId}, streak updated: ${streakUpdate.streak_snapshot || 'no change'}`);
    }
    
    return this.getToday(userId);
  }

  async getStats(userId) {
    this._ensureModel();
    
    const studyDate = this._getStudyDate();
    const today = await this.getOrCreate(userId, studyDate);
    
    const totalReading = await this.StudyDay.count({
      where: { user_id: userId, completed_reading: true },
    });
    
    const totalReview = await this.StudyDay.count({
      where: { user_id: userId, completed_review: true },
    });
    
    return {
      today: {
        completed_reading: !!today.completed_reading,
        completed_review: !!today.completed_review,
        streak_days: today.streak_snapshot || 0,
      },
      total: {
        reading_days: totalReading,
        review_days: totalReview,
      },
    };
  }
}

export default CheckinService;
