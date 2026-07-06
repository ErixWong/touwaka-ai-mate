import { UploadSessionService } from '../../services/index.js';

// Handler 元数据：声明具名参数路径
export const route = {
  path: '/batches/:batch_id/files/:file_id',
};

function getUserId(ctx) {
  return ctx.state.session?.id || ctx.state.user?.id || null;
}

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    if (!userId) { ctx.error('Unauthorized', 401); return; }

    const { batch_id, file_id, p0, p1 } = ctx.params;
    const batchId = batch_id || p0;
    const fileId = file_id || p1;
    if (!batchId || !fileId) {
      ctx.error('batch_id and file_id are required', 400);
      return;
    }

    const uploadSessionService = new UploadSessionService(deps.db);
    const batch = uploadSessionService.getBatch(batchId);

    if (!batch) { ctx.error('批次不存在或已过期', 404); return; }
    if (!uploadSessionService.isBatchOwner(batchId, userId)) {
      ctx.error('无权访问该批次', 403); return;
    }

    const file = batch.files.find(f => f.file_id === fileId);
    if (!file) { ctx.error('文件不存在', 404); return; }

    ctx.success(file);
  } catch (err) {
    ctx.error(err.message, 500);
  }
}
