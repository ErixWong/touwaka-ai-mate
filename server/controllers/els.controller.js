import logger from '../../lib/logger.js';
import ELSService from '../services/els/index.js';

const ERROR_HTTP_STATUS = {
  ELS_NOT_FOUND: 404,
  ELS_FORBIDDEN: 403,
  ELS_INVALID_STATUS: 409,
  ELS_MATERIAL_BLOCKED: 422,
  ELS_UPLOAD_REJECTED: 422,
  ELS_NOTEBOOK_EMPTY: 400,
};

const DEFAULT_ERROR_STATUS = 500;

export default class ELSController {
  constructor(db) {
    this.db = db;
    this.els = new ELSService(db);
  }

  _getUserId(ctx) {
    return ctx.state?.session?.id;
  }

  async _safeCall(ctx, fn) {
    try {
      await fn();
    } catch (error) {
      logger.error(`[ELSController] ${ctx.method} ${ctx.path} — ${error.message}`);

      const code = error.code || 'ELS_INTERNAL_ERROR';
      const status = ERROR_HTTP_STATUS[code] || error.status || DEFAULT_ERROR_STATUS;

      ctx.error(code, status, error.message);
    }
  }

  async getDashboard(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const result = await this.els.getDashboard(userId);
      ctx.success(result);
    });
  }

  async getRecommendedMaterials(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      let libraryId = ctx.query.library_id || null;
      if (!libraryId) {
        libraryId = await this.els.resolveSelectedLibraryId(userId);
      }
      const result = await this.els.material.getRecommended(libraryId, userId);
      ctx.success({ items: result });
    });
  }

  async getMaterial(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const result = await this.els.material.getDetail(ctx.params.materialId, userId);
      if (result.tts) {
        result.tts.available = await this.els.config.isTTSEnabled();
        result.tts.voices = await this.els.config.getTTSVoiceOptions();
        result.tts.default_voice = await this.els.config.getTTSDefaultVoice();
      }
      ctx.success(result);
    });
  }

  async getMaterialQuiz(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const materialId = ctx.params.materialId;
      if (!materialId) {
        ctx.error('ELS_NOT_FOUND', 404);
        return;
      }
      const material = await this.els.material.getDetail(materialId, userId);
      if (material.processing_status !== 'ready') {
        ctx.error('ELS_INVALID_STATUS', 409, '当前材料暂不可学习');
        return;
      }
      if (material.quiz_status !== 'ready') {
        ctx.error('ELS_INVALID_STATUS', 409, material.quiz_status === 'pending' ? '小测生成中' : '小测暂不可用');
        return;
      }
      const questionCount = await this.els.config.getQuizQuestionCount();
      const quiz = await this.els.quiz.getQuestions(materialId, questionCount);
      ctx.success(quiz);
    });
  }

  async submitMaterialQuiz(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const materialId = ctx.params.materialId;
      const answers = Array.isArray(ctx.request.body?.answers) ? ctx.request.body.answers : [];

      const material = await this.els.material.getDetail(materialId, userId);
      if (material.processing_status !== 'ready') {
        ctx.error('ELS_INVALID_STATUS', 409, '当前材料暂不可学习');
        return;
      }
      if (material.quiz_status !== 'ready') {
        ctx.error('ELS_INVALID_STATUS', 409, '小测尚未就绪');
        return;
      }

      await this.els.checkin.markReadingCompleted(userId);
      ctx.success({
        correct_count: answers.length,
        total: 3,
        explanations: [],
        reading_completed: true,
        next_action: 'review_words',
      });
    });
  }

  async getLibraries(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const selectedLibraryId = await this.els.resolveSelectedLibraryId(userId);
      const items = await this.els.library.list(userId);

      const result = items.map((item) => ({
        ...item,
        is_selected: item.id === selectedLibraryId,
      }));

      ctx.success({
        selected_library_id: selectedLibraryId,
        items: result.filter((item) => item.type !== 'shared'),
      });
    });
  }

  async selectLibrary(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const { library_id } = ctx.request.body || {};
      if (!library_id) {
        ctx.error('ELS_NOT_FOUND', 404, '学习库 ID 为空');
        return;
      }
      const library = await this.els.library.getById(library_id);
      if (!library) {
        ctx.error('ELS_NOT_FOUND', 404);
        return;
      }
      if (library.library_type === 'personal' && library.owner_user_id !== userId) {
        ctx.error('ELS_FORBIDDEN', 403);
        return;
      }
      await this.els.preference.setSelectedLibrary(userId, library_id);
      ctx.success({
        selected_library_id: library_id,
        selected_library_name: library.name,
      });
    });
  }

  async getLibraryMaterials(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const result = await this.els.library.getMaterials(ctx.params.libraryId, userId);
      ctx.success(result);
    });
  }

  async createMaterial(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const payload = ctx.request.body || {};
      if (!payload.title || !payload.content) {
        ctx.error('ELS_INVALID_STATUS', 409, '标题和正文不能为空');
        return;
      }
      const result = await this.els.material.create(userId, payload.library_id, payload);
      this.els.processor.processMaterial(result.id).catch((err) => {
        logger.error(`[ELSController] Background processing failed for ${result.id}:`, err.message);
      });
      ctx.success(result, 'Created');
    });
  }

  async updateMaterial(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const result = await this.els.material.update(ctx.params.materialId, userId, ctx.request.body || {});
      ctx.success(result, 'Updated');
    });
  }

  async getNotebooks(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const selectedNotebookId = await this.els.resolveSelectedNotebookId(userId);
      const items = await this.els.notebook.list(userId);

      const result = items.map((item) => ({
        ...item,
        is_selected: item.id === selectedNotebookId,
      }));

      ctx.success({
        selected_notebook_id: selectedNotebookId,
        items: result,
      });
    });
  }

  async selectNotebook(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const { notebook_id } = ctx.request.body || {};
      if (!notebook_id) {
        ctx.error('ELS_INVALID_STATUS', 409);
        return;
      }
      const notebook = await this.els.notebook.getById(notebook_id);
      if (!notebook) {
        ctx.error('ELS_NOT_FOUND', 404);
        return;
      }
      if (notebook.user_id !== userId) {
        ctx.error('ELS_FORBIDDEN', 403);
        return;
      }
      await this.els.preference.setSelectedNotebook(userId, notebook_id);
      ctx.success({
        selected_notebook_id: notebook_id,
        selected_notebook_name: notebook.name,
      });
    });
  }

  async collectWord(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const payload = ctx.request.body || {};
      if (!payload.material_id || !payload.word_text) {
        ctx.error('ELS_INVALID_STATUS', 409, '材料 ID 和单词文本不能为空');
        return;
      }
      const result = await this.els.word.collect(userId, payload);
      ctx.success(result, 'Created');
    });
  }

  async getWord(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const word = await this.els.word.getDetail(ctx.params.wordId, userId);
      if (!word) {
        ctx.error('ELS_NOT_FOUND', 404);
        return;
      }
      ctx.success(word);
    });
  }

  async getReviews(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const { bucket = 'today', notebook_id: notebookId, size } = ctx.query;
      if (!notebookId) {
        ctx.error('ELS_INVALID_STATUS', 409);
        return;
      }
      const notebook = await this.els.notebook.getById(notebookId);
      if (!notebook) {
        ctx.error('ELS_NOT_FOUND', 404);
        return;
      }
      if (notebook.user_id !== userId) {
        ctx.error('ELS_FORBIDDEN', 403);
        return;
      }
      const defaultSize = await this.els.config.getDailyReviewSize();
      const result = await this.els.review.getQuestions(userId, notebookId, bucket, Number(size) || defaultSize);
      ctx.success(result);
    });
  }

  async submitReviews(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const payload = ctx.request.body || {};
      const result = await this.els.review.submit(userId, payload);
      await this.els.checkin.markReviewCompleted(userId);
      ctx.success(result);
    });
  }

  async getCheckin(ctx) {
    await this._safeCall(ctx, async () => {
      const userId = this._getUserId(ctx);
      const result = await this.els.checkin.getToday(userId);
      ctx.success(result);
    });
  }
}