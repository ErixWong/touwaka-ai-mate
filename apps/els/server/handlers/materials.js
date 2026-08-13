/**
 * ELS 学习材料
 * POST /api/apps/els/materials             → 创建材料（进入 processing，由 tick 处理）
 * GET  /api/apps/els/materials/recommended → 推荐材料
 * GET  /api/apps/els/materials/:material_id → 材料详情
 * PUT  /api/apps/els/materials/:material_id → 更新材料
 *
 * 嵌套（见 materials/quiz.js、materials/quiz/submit.js）：
 * GET  /api/apps/els/materials/:material_id/quiz
 * POST /api/apps/els/materials/:material_id/quiz/submit
 *
 * 说明：创建材料后不再 fire-and-forget 处理；
 * 材料停留在 processing 状态，由 apps/els/tick 驱动异步加工。
 */
import logger from '../../../../lib/logger.js';
import ELSService from '../services/index.js';
import { safeCall, getUserId } from './_helpers.js';

let els;

export async function post(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const payload = ctx.request.body || {};

    if (!payload.title || !payload.content) {
      ctx.error('ELS_INVALID_STATUS', 409, '标题和正文不能为空');
      return;
    }

    const result = await els.material.create(userId, payload.library_id, payload);
    ctx.success(result, 'Created');
  });
}

export async function get(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);

    // GET /materials/recommended → p0 === 'recommended'
    if (ctx.params.p0 === 'recommended') {
      let libraryId = ctx.query.library_id || null;
      if (!libraryId) {
        libraryId = await els.resolveSelectedLibraryId(userId);
      }
      const result = await els.material.getRecommended(libraryId, userId);
      ctx.success({ items: result });
      return;
    }

    if (!ctx.params.p0) {
      ctx.error('ELS_NOT_FOUND', 404);
      return;
    }

    const result = await els.material.getDetail(ctx.params.p0, userId);
    if (result.tts) {
      result.tts.available = await els.config.isTTSEnabled();
      result.tts.voices = await els.config.getTTSVoiceOptions();
      result.tts.default_voice = await els.config.getTTSDefaultVoice();
    }
    ctx.success(result);
  });
}

export async function put(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const result = await els.material.update(ctx.params.p0, userId, ctx.request.body || {});
    ctx.success(result, 'Updated');
  });
}
