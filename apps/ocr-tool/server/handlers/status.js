import { getTask } from '../../../lib/ocr-tool-store.js';

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

  const task = getTask(taskId);
  if (!task) {
    ctx.error('task not found', 404);
    return;
  }

  if (task.user_id !== userId) {
    ctx.error('forbidden', 403);
    return;
  }

  ctx.success({
    task_id: task.id,
    status: task.status,
    result: task.result,
    error: task.error,
  });
}