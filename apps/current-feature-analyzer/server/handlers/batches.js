import { UploadSessionService } from '../services/index.js';

// Handler 元数据：声明具名参数路径
export const route = {
  path: '/batches/:batch_id',
};

function getUserId(ctx) {
  return ctx.state.session?.id || ctx.state.user?.id || null;
}

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    if (!userId) { ctx.error('Unauthorized', 401); return; }

    const { batch_id } = ctx.params;
    const uploadSessionService = new UploadSessionService(deps.db);
    const batch = uploadSessionService.getBatch(batch_id);

    if (!batch) { ctx.error('批次不存在或已过期', 404); return; }
    if (!uploadSessionService.isBatchOwner(batch_id, userId)) {
      ctx.error('无权访问该批次', 403); return;
    }

    const lightBatch = {
      batch_id: batch.batch_id,
      batch_status: batch.batch_status,
      selected_rule_set_id: batch.selected_rule_set_id,
      summary: batch.summary,
      files: batch.files.map(f => {
        const { raw_data, result, ...rest } = f;
        return rest;
      }),
    };
    ctx.success(lightBatch);
  } catch (err) {
    ctx.error(err.message, 500);
  }
}
