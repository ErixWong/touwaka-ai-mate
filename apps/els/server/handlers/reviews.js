/**
 * ELS 复习
 * GET  /api/apps/els/reviews         → 复习题目（bucket: today|new|wrong）
 * POST /api/apps/els/reviews/submit  → 提交复习结果
 */
import ELSService from '../services/index.js';
import { safeCall, getUserId } from './_helpers.js';

let els;

export async function get(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const { bucket = 'today', notebook_id: notebookId, size } = ctx.query;

    if (!notebookId) {
      ctx.error('ELS_INVALID_STATUS', 409);
      return;
    }

    const notebook = await els.notebook.getById(notebookId);
    if (!notebook) {
      ctx.error('ELS_NOT_FOUND', 404);
      return;
    }
    if (notebook.user_id !== userId) {
      ctx.error('ELS_FORBIDDEN', 403);
      return;
    }

    const defaultSize = await els.config.getDailyReviewSize();
    const result = await els.review.getQuestions(userId, notebookId, bucket, Number(size) || defaultSize);
    ctx.success(result);
  });
}

export async function post(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const payload = ctx.request.body || {};
    const result = await els.review.submit(userId, payload);
    await els.checkin.markReviewCompleted(userId);
    ctx.success(result);
  });
}
