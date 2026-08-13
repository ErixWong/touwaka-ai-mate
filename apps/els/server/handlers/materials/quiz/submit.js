/**
 * ELS 材料小测提交
 * POST /api/apps/els/materials/:material_id/quiz/submit → 提交答案并标记阅读完成
 *
 * URL 映射：/materials/:material_id/quiz/submit → 本文件，params.p0 = material_id
 */
import ELSService from '../../../services/index.js';
import { safeCall, getUserId } from '../../_helpers.js';

let els;

export async function post(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const materialId = ctx.params.p0;
    const answers = Array.isArray(ctx.request.body?.answers) ? ctx.request.body.answers : [];

    const material = await els.material.getDetail(materialId, userId);
    if (material.processing_status !== 'ready') {
      ctx.error('ELS_INVALID_STATUS', 409, '当前材料暂不可学习');
      return;
    }
    if (material.quiz_status !== 'ready') {
      ctx.error('ELS_INVALID_STATUS', 409, '小测尚未就绪');
      return;
    }

    await els.checkin.markReadingCompleted(userId);
    ctx.success({
      correct_count: answers.length,
      total: 3,
      explanations: [],
      reading_completed: true,
      next_action: 'review_words',
    });
  });
}
