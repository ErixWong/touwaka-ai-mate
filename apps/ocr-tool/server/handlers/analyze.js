import { createTask } from '../../../lib/ocr-tool-store.js';

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

export async function post(ctx, deps) {
  const userId = ctx.state.session?.id;
  if (!userId) {
    ctx.error('Unauthorized', 401);
    return;
  }

  const { image, prompt, attachment_id, use_document_platform = false } = ctx.request.body || {};

  if (use_document_platform) {
    const created = await createDocumentPlatformTask(deps, { userId, attachmentId: attachment_id, prompt });
    ctx.success(created, 'created');
    return;
  }

  const normalized = normalizeImageDataUrl(image);
  if (normalized.error) {
    ctx.error(normalized.error, 400);
    return;
  }

  if (normalized.sizeBytes > MAX_IMAGE_BYTES) {
    ctx.error('image too large', 400);
    return;
  }

  const task = createTask({
    userId,
    imageDataUrl: normalized.dataUrl,
    prompt: typeof prompt === 'string' ? prompt : '',
  });

  ctx.success({
    task_id: task.id,
    status: task.status,
  }, 'created');
}

async function createDocumentPlatformTask(deps, { userId, attachmentId, prompt }) {
  if (!attachmentId) {
    throw new Error('attachment_id is required when use_document_platform is true');
  }

  const Attachment = deps.services.getModel('attachment');
  const attachment = await Attachment.findByPk(attachmentId);

  if (!attachment) {
    throw new Error('attachment not found');
  }

  const Utils = await import('../../../lib/utils.js');
  const taskId = Utils.default.newID(20);
  
  const task = {
    id: taskId,
    user_id: userId,
    status: 'pending',
    result: null,
    error: null,
    created_at: new Date(),
  };

  deps.services.log('info', `[OCR-Tool] Document platform task created: ${taskId}`);
  
  return { task_id: taskId, status: 'pending' };
}