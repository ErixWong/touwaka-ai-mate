/**
 * ELS 生词
 * POST /api/apps/els/words          → 划词收集
 * GET  /api/apps/els/words/:word_id → 生词详情
 */
import ELSService from '../services/index.js';
import { safeCall, getUserId } from './_helpers.js';

let els;

export async function post(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const payload = ctx.request.body || {};

    if (!payload.material_id || !payload.word_text) {
      ctx.error('ELS_INVALID_STATUS', 409, '材料 ID 和单词文本不能为空');
      return;
    }

    const result = await els.word.collect(userId, payload);
    ctx.success(result, 'Created');
  });
}

export async function get(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const word = await els.word.getDetail(ctx.params.p0, userId);

    if (!word) {
      ctx.error('ELS_NOT_FOUND', 404);
      return;
    }

    ctx.success(word);
  });
}
