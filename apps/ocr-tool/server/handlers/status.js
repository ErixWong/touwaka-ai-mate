import { getOcrTask } from '../services/ocr-task.service.js';

export async function get(ctx, deps) {
  const userId = ctx.state.session?.id;
  if (!userId) {
    ctx.error('Unauthorized', 401);
    return;
  }

  const taskId = ctx.params.p0;
  if (!taskId) {
    ctx.error('taskId is required', 400);
    return;
  }

  const result = getOcrTask({ task_id: taskId, user_id: userId });
  if (result.forbidden) {
    ctx.error('forbidden', 403);
    return;
  }
  if (result.notFound) {
    ctx.error('task not found', 404);
    return;
  }

  const task = result;
  ctx.success({
    task_id: task.id,
    status: task.status,
    result: task.result,
    error: task.error,
  });
}
