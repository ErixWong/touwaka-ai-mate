/**
 * ELS 材料小测
 * GET /api/apps/els/materials/:material_id/quiz → 获取小测题目
 *
 * URL 映射：/materials/:material_id/quiz → 本文件，params.p0 = material_id
 */
import ELSService from '../../services/index.js';
import { safeCall, getUserId } from '../_helpers.js';

let els;

export async function get(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const materialId = ctx.params.p0;

    if (!materialId) {
      ctx.error('ELS_NOT_FOUND', 404);
      return;
    }

    const material = await els.material.getDetail(materialId, userId);
    if (material.processing_status !== 'ready') {
      ctx.error('ELS_INVALID_STATUS', 409, '当前材料暂不可学习');
      return;
    }
    if (material.quiz_status !== 'ready') {
      ctx.error('ELS_INVALID_STATUS', 409, material.quiz_status === 'pending' ? '小测生成中' : '小测暂不可用');
      return;
    }

    const questionCount = await els.config.getQuizQuestionCount();
    const quiz = await els.quiz.getQuestions(materialId, questionCount);
    ctx.success(quiz);
  });
}
