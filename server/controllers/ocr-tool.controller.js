import logger from '../../lib/logger.js';
import { createTask, getTask } from '../../lib/ocr-tool-store.js';

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

class OcrToolController {
  constructor(db) {
    this.db = db;
  }

  async analyze(ctx) {
    try {
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

      const task = createTask({
        userId,
        imageDataUrl: normalized.dataUrl,
        prompt: typeof prompt === 'string' ? prompt : '',
      });

      ctx.success({
        task_id: task.id,
        status: task.status,
      }, 'created');
    } catch (err) {
      logger.error('[OCR-Tool] analyze error:', err);
      ctx.error('analyze failed', 500);
    }
  }

  async getStatus(ctx) {
    try {
      const userId = ctx.state.session?.id;
      if (!userId) {
        ctx.error('Unauthorized', 401);
        return;
      }

      const { taskId } = ctx.params;
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
    } catch (err) {
      logger.error('[OCR-Tool] status error:', err);
      ctx.error('status query failed', 500);
    }
  }

  async getPromptPresets(ctx) {
    try {
      const result = await this.db.sequelize.query(
        "SELECT config FROM mini_apps WHERE id='ocr-tool'",
        { type: this.db.sequelize.QueryTypes.SELECT }
      );
      
      if (!result[0]?.config) {
        ctx.success({ presets: [], defaultId: 'text' });
        return;
      }

      const config = JSON.parse(result[0].config);
      const presets = config.prompt_presets || [];
      const defaultId = config.default_prompt_id || 'text';

      ctx.success({ presets, defaultId });
    } catch (err) {
      logger.error('[OCR-Tool] getPromptPresets error:', err);
      ctx.success({ presets: [], defaultId: 'text' });
    }
  }
}

export default OcrToolController;
