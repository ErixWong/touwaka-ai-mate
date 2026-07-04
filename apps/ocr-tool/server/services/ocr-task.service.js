import { createTask, getTask, markProcessing } from '../../../../lib/ocr-tool-store.js';

export function createOcrTask({ user_id, prompt, image_data_url = '' }) {
  const task = createTask({
    userId: user_id,
    imageDataUrl: image_data_url,
    prompt: prompt || '',
  });
  return task;
}

export function getOcrTask({ task_id, user_id }) {
  const task = getTask(task_id);
  if (!task) return { notFound: true };
  if (task.user_id !== user_id) return { forbidden: true };
  return task;
}

export function markOcrTaskProcessing(task_id) {
  return markProcessing(task_id);
}
