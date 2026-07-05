import { UploadSessionService, ReportExportService } from '../../services/index.js';

// Handler 元数据：声明具名参数路径
export const route = {
  path: '/reports/:batch_id',
};

function getUserId(ctx) {
  return ctx.state.session?.id || ctx.state.user?.id || null;
}

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    if (!userId) { ctx.error('Unauthorized', 401); return; }

    const { batch_id, p0 } = ctx.params;
    const batchId = batch_id || p0;

    if (!batchId) {
      ctx.error('batch_id is required', 400);
      return;
    }

    const uploadSessionService = new UploadSessionService(deps.db);
    const reportExportService = new ReportExportService(deps.db);

    const batch = uploadSessionService.getBatch(batchId);
    if (!batch) { ctx.error('批次不存在或已过期', 404); return; }
    if (!uploadSessionService.isBatchOwner(batchId, userId)) {
      ctx.error('无权访问该批次', 403); return;
    }

    const report = await reportExportService.generateReport(batchId);
    ctx.success(report);
  } catch (err) {
    ctx.error(err.message, 500);
  }
}

export async function post(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    if (!userId) { ctx.error('Unauthorized', 401); return; }

    const { batch_id, p0 } = ctx.params;
    const batchId = batch_id || p0;

    if (!batchId) {
      ctx.error('batch_id is required', 400);
      return;
    }

    const uploadSessionService = new UploadSessionService(deps.db);
    const reportExportService = new ReportExportService(deps.db);

    const batch = uploadSessionService.getBatch(batchId);
    if (!batch) { ctx.error('批次不存在或已过期', 404); return; }
    if (!uploadSessionService.isBatchOwner(batchId, userId)) {
      ctx.error('无权访问该批次', 403);
      return;
    }

    const exportResult = await reportExportService.exportReport(batchId, ctx.request.body);
    ctx.set('Content-Type', exportResult.mime_type);
    ctx.set('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
    ctx.body = exportResult.buffer;
  } catch (err) {
    ctx.error(err.message, 500);
  }
}
