import { UploadSessionService, LlmStageRecognitionService } from '../../services/index.js';

// Handler 元数据：声明具名参数路径
export const route = {
  path: '/analysis/run',
};

function getUserId(ctx) {
  return ctx.state.session?.id || ctx.state.user?.id || null;
}

export async function post(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    if (!userId) { ctx.error('Unauthorized', 401); return; }

    const { batch_id, rule_set_id, analysis_options } = ctx.request.body || {};
    if (!batch_id) { ctx.error('batch_id is required', 400); return; }

    const uploadSessionService = new UploadSessionService(deps.db);
    const batch = uploadSessionService.getBatch(batch_id);

    if (!batch) { ctx.error('批次不存在或已过期', 404); return; }
    if (!uploadSessionService.isBatchOwner(batch_id, userId)) {
      ctx.error('无权访问该批次', 403);
      return;
    }

    const llmStageRecognitionService = new LlmStageRecognitionService(deps.db);
    const result = await llmStageRecognitionService.analyzeBatch(batch, rule_set_id, analysis_options);

    ctx.success(result);
  } catch (err) {
    ctx.error(err.message, 500);
  }
}