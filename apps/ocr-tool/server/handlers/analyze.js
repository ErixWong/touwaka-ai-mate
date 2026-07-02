import { createOcrTask, markOcrTaskProcessing } from '../services/ocr-task.service.js';
import { processTask } from '../../tick/index.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function normalizeImageDataUrl(imageInput) {
  if (!imageInput || typeof imageInput !== 'string') {
    return { error: 'image is required' };
  }

  let dataUrl = imageInput.trim();
  if (!dataUrl) return { error: 'image is required' };

  if (!dataUrl.startsWith('data:image/')) {
    dataUrl = `data:image/png;base64,${dataUrl}`;
  }

  const parts = dataUrl.split(',');
  if (parts.length < 2) {
    return { error: 'invalid image data url' };
  }

  const base64 = parts[1];
  const sizeBytes = Math.ceil(base64.length * 0.75);

  return { dataUrl, sizeBytes };
}

function triggerImmediateProcessing(taskId, app, db) {
  setImmediate(async () => {
    try {
      const context = {
        app,
        db,
        services: { log: (level, msg) => console.log(`[ocr-tool] ${msg}`) },
      };
      await processTask(taskId, app, context);
    } catch (err) {
      console.error('[ocr-tool] immediate processing failed:', err.message);
    }
  });
}

export async function post(ctx, deps) {
  const userId = ctx.state.session?.id;
  if (!userId) {
    ctx.error('Unauthorized', 401);
    return;
  }

  const { image, prompt } = ctx.request.body || {};

  const normalized = normalizeImageDataUrl(image);
  if (normalized.error) {
    ctx.error(normalized.error, 400);
    return;
  }

  if (normalized.sizeBytes > MAX_IMAGE_BYTES) {
    ctx.error('image too large', 400);
    return;
  }

  const task = createOcrTask({
    user_id: userId,
    prompt: typeof prompt === 'string' ? prompt : '',
    image_data_url: normalized.dataUrl,
  });

  markOcrTaskProcessing(task.id);

  const app = deps.app || {};
  triggerImmediateProcessing(task.id, app, deps.db);

  ctx.success({
    task_id: task.id,
    status: 'processing',
  }, 'created');
}
