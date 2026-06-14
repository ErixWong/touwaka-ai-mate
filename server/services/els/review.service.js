import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';

const REVIEW_STAGES = ['D0', 'D1', 'D3', 'D7', 'D15', 'D30', 'D60', 'mastered'];
const STAGE_DAYS = { D0: 1, D1: 1, D3: 3, D7: 7, D15: 15, D30: 30, D60: 60 };
const WRONG_BUCKET_EXIT_THRESHOLD = 3;

class ReviewService {
  constructor(db) {
    this.db = db;
    this.Word = null;
    this.Review = null;
  }

  _ensureModels() {
    if (!this.Word) {
      this.Word = this.db.getModel('app_els_user_words');
    }
    if (!this.Review) {
      this.Review = this.db.getModel('app_els_user_reviews');
    }
  }

  _getNextStage(currentStage, isCorrect, selfRating) {
    if (!isCorrect) {
      const currentIndex = REVIEW_STAGES.indexOf(currentStage);
      return currentIndex > 0 ? REVIEW_STAGES[currentIndex - 1] : 'D0';
    }
    
    if (selfRating === 'hard') {
      return currentStage;
    }
    
    const currentIndex = REVIEW_STAGES.indexOf(currentStage);
    if (currentIndex < REVIEW_STAGES.length - 1) {
      return REVIEW_STAGES[currentIndex + 1];
    }
    
    return currentStage;
  }

  _getNextReviewAt(stage) {
    const days = STAGE_DAYS[stage] || 1;
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + days);
    nextDate.setHours(9, 0, 0, 0);
    return nextDate;
  }

  _calculateWrongBucketStatus(word, isCorrect) {
    if (isCorrect) {
      const newConsecutiveCorrect = word.consecutive_correct_count + 1;
      if (newConsecutiveCorrect >= WRONG_BUCKET_EXIT_THRESHOLD) {
        return { is_in_wrong_bucket: false, wrong_count: 0 };
      }
      return { is_in_wrong_bucket: word.is_in_wrong_bucket, wrong_count: word.wrong_count };
    }
    
    const newWrongCount = word.wrong_count + 1;
    const shouldEnterWrongBucket = newWrongCount >= 2;
    
    return { is_in_wrong_bucket: shouldEnterWrongBucket, wrong_count: newWrongCount };
  }

  async getQuestions(userId, notebookId, bucket, size = 5) {
    this._ensureModels();
    
    const now = new Date();
    let whereClause = { notebook_id: notebookId, is_mastered: false };
    
    if (bucket === 'today') {
      whereClause.next_review_at = { [this.db.Op.lte]: now };
    } else if (bucket === 'new') {
      whereClause.review_stage = 'D0';
      whereClause.next_review_at = null;
    } else if (bucket === 'wrong') {
      whereClause.is_in_wrong_bucket = true;
    }
    
    const words = await this.Word.findAll({
      where: whereClause,
      order: [['next_review_at', 'ASC'], ['created_at', 'ASC']],
      limit: size,
      raw: true,
    });
    
    const questions = words.map((w) => ({
      word_id: w.id,
      review_type: 'meaning_choice',
      tts: {
        available: true,
        mode: 'realtime',
        voices: ['female', 'male'],
        default_voice: 'female',
      },
      tts_text: w.word_text,
      prompt: `${w.word_text} 的意思是？`,
      options: [w.meaning, '选项A', '选项B'],
    }));
    
    const sessionId = `rv_${Date.now()}_${userId}_${bucket}_${notebookId}`;
    
    return {
      bucket,
      session_id: sessionId,
      questions,
      total: questions.length,
    };
  }

  async submit(userId, payload) {
    this._ensureModels();
    
    const sessionId = payload.session_id;
    
    if (sessionId) {
      const existingReview = await this.Review.findOne({
        where: { session_id: sessionId },
        raw: true,
      });
      
      if (existingReview) {
        logger.warn(`[ReviewService] Session ${sessionId} already submitted, rejecting duplicate submission`);
        const error = new Error('该复习轮次已提交，不可重复提交');
        error.code = 'ELS_INVALID_STATUS';
        error.status = 409;
        throw error;
      }
    }
    
    const results = payload.results || [];
    const correctCount = results.filter((r) => r.is_correct).length;
    
    for (const result of results) {
      const word = await this.Word.findOne({
        where: { id: result.word_id, user_id: userId },
      });
      
      if (!word) continue;
      
      const stageBefore = word.review_stage;
      const stageAfter = this._getNextStage(stageBefore, result.is_correct, result.self_rating);
      const nextReviewAt = this._getNextReviewAt(stageAfter);
      
      const reviewId = Utils.newID(20);
      await this.Review.create({
        id: reviewId,
        user_id: userId,
        word_id: result.word_id,
        session_id: sessionId || null,
        review_bucket: payload.bucket,
        review_type: result.review_type,
        is_correct: result.is_correct,
        self_rating: result.self_rating,
        stage_before: stageBefore,
        stage_after: stageAfter,
      });
      
      const wrongBucketStatus = this._calculateWrongBucketStatus(word, result.is_correct);
      const consecutiveCorrect = result.is_correct ? word.consecutive_correct_count + 1 : 0;
      
      await this.Word.update(
        {
          review_stage: stageAfter,
          next_review_at: nextReviewAt,
          last_review_at: new Date(),
          wrong_count: wrongBucketStatus.wrong_count,
          is_in_wrong_bucket: wrongBucketStatus.is_in_wrong_bucket,
          consecutive_correct_count: consecutiveCorrect,
          is_mastered: stageAfter === 'mastered',
        },
        { where: { id: result.word_id } }
      );
      
      logger.info(`[ReviewService] Word ${result.word_id}: stage ${stageBefore} -> ${stageAfter}, wrong_bucket ${wrongBucketStatus.is_in_wrong_bucket}`);
    }
    const remainingCount = await this.Word.count({
      where: {
        user_id: userId,
        next_review_at: { [this.db.Op.lte]: new Date() },
        is_mastered: false,
      },
    });
    
    const wrongBucketCount = await this.Word.count({
      where: { user_id: userId, is_in_wrong_bucket: true },
    });
    
    logger.info(`[ReviewService] Submitted review session ${sessionId} for user ${userId}, correct ${correctCount}/${results.length}`);
    
    return {
      session_summary: {
        correct_count: correctCount,
        total: results.length,
        needs_repeat: results.length - correctCount,
      },
      review_stats: {
        today_due_remaining: remainingCount,
        wrong_words: wrongBucketCount,
      },
      today_review_completed: remainingCount === 0,
    };
  }

  async getSessionStatus(sessionId) {
    if (!sessionId) return null;
    
    this._ensureModels();
    
    const review = await this.Review.findOne({
      where: { session_id: sessionId },
      raw: true,
    });
    
    if (!review) return null;
    
    const sessionReviews = await this.Review.findAll({
      where: { session_id: sessionId },
      attributes: ['is_correct'],
      raw: true,
    });
    
    return {
      session_id: sessionId,
      is_submitted: true,
      total: sessionReviews.length,
      correct_count: sessionReviews.filter((r) => r.is_correct).length,
    };
  }
}

export default ReviewService;