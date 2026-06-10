import logger from '../../../lib/logger.js';
import { callLLMWithRetry } from '../../../lib/simple-llm-client.js';
import sharp from 'sharp';
import {
  getProcessingCount,
  getNextPendingTaskIds,
  markProcessing,
  completeTask,
  failTask,
  pruneTasks,
  getTask,
} from '../../../lib/ocr-tool-store.js';

// 压缩图片到指定大小以下（单位：字节）
async function compressImage(dataUrl, maxBytes = 900 * 1024) {
  // 解析 data URL
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return dataUrl; // 不是有效的 data URL，直接返回
  }

  const mimeType = match[1];
  const base64Data = match[2];
  const imageBuffer = Buffer.from(base64Data, 'base64');

  // 如果图片已经小于限制，直接返回
  if (imageBuffer.length <= maxBytes) {
    return dataUrl;
  }

  logger.info(`[ocr-tool] Compressing image: ${imageBuffer.length} bytes -> max ${maxBytes} bytes`);

  // 逐步降低质量直到满足大小要求
  let quality = 85;
  let scale = 1;
  let compressedBuffer = null;

  while (quality > 20 && scale > 0.3) {
    try {
      let pipeline = sharp(imageBuffer);
      
      // 如果需要缩放
      if (scale < 1) {
        const metadata = await pipeline.metadata();
        if (metadata.width && metadata.height) {
          pipeline = pipeline.resize(
            Math.round(metadata.width * scale),
            Math.round(metadata.height * scale),
            { fit: 'inside' }
          );
        }
      }

      // 根据 mime type 设置输出格式
      if (mimeType === 'image/png') {
        pipeline = pipeline.png({ quality, compressionLevel: 9 });
      } else if (mimeType === 'image/webp') {
        pipeline = pipeline.webp({ quality });
      } else {
        // 默认 JPEG
        pipeline = pipeline.jpeg({ quality });
      }

      compressedBuffer = await pipeline.toBuffer();

      if (compressedBuffer.length <= maxBytes) {
        break;
      }

      // 如果还是太大，降低质量或缩放
      if (quality > 40) {
        quality -= 15;
      } else {
        quality -= 10;
        scale -= 0.2;
      }
    } catch (err) {
      logger.error(`[ocr-tool] Compression error at quality=${quality}, scale=${scale}: ${err.message}`);
      break;
    }
  }

  if (!compressedBuffer || compressedBuffer.length > maxBytes) {
    logger.warn(`[ocr-tool] Could not compress image below ${maxBytes} bytes, using original`);
    return dataUrl;
  }

  // 重新构建 data URL
  const newBase64 = compressedBuffer.toString('base64');
  return `data:${mimeType};base64,${newBase64}`;
}

function buildMessages(prompt, imageDataUrl) {
  const content = [
    { type: 'image_url', image_url: { url: imageDataUrl } },
    { type: 'text', text: prompt },
  ];

  return [
    { role: 'system', content: 'You are an OCR assistant. Extract all visible text.' },
    { role: 'user', content },
  ];
}

async function processPlatformOcrTask(taskId, app, context) {
  const task = getTask(taskId);
  if (!task) return { taskId, skipped: true, reason: 'missing' };

  const config = typeof app?.config === 'string'
    ? JSON.parse(app.config || '{}')
    : (app?.config || {});

  if (!context.documentOcrService) {
    failTask(taskId, 'document_ocr_service_not_available');
    return { taskId, success: false, error: 'document_ocr_service_not_available' };
  }

  if (!task.document_id) {
    failTask(taskId, 'missing_document_id');
    return { taskId, success: false, error: 'missing_document_id' };
  }

  try {
    const latestOcrResult = await context.documentOcrService.getLatestOcrResult(task.document_id);

    if (!task.ocr_result_id && latestOcrResult?.id) {
      task.ocr_result_id = latestOcrResult.id;
      task.ocr_task_id = latestOcrResult.task_id;
      task.updated_at = new Date().toISOString();
    }

    if (latestOcrResult?.status === 'completed' && latestOcrResult?.main_markdown_attachment_id) {
      completeTask(taskId, latestOcrResult.main_markdown_attachment_id || 'platform_ocr_completed');
      return { taskId, success: true, delegated: true, completed: true, reused: true };
    }

    if (!task.ocr_result_id) {
      const submitResult = await context.documentOcrService.submit(task.document_id, {
        attachmentId: task.attachment_id || null,
        backend: config.mineru_backend,
        lang: config.mineru_lang || 'ch',
        imageAnalysis: config.mineru_image_analysis ?? true,
        formulaEnable: config.mineru_formula_enable ?? true,
        tableEnable: config.mineru_table_enable ?? true,
      });
      task.ocr_result_id = submitResult.id;
      task.ocr_task_id = submitResult.task_id;
      task.updated_at = new Date().toISOString();
      return { taskId, success: true, delegated: true, status: submitResult.status };
    }

    const syncResult = await context.documentOcrService.syncTaskStatus(task.document_id);
    task.ocr_task_id = syncResult.ocrResult.task_id;
    task.updated_at = new Date().toISOString();

    if (!syncResult.completed) {
      return { taskId, success: true, delegated: true, status: syncResult.ocrResult.status };
    }

    completeTask(taskId, syncResult.ocrResult.main_markdown_attachment_id || 'platform_ocr_completed');
    return { taskId, success: true, delegated: true, completed: true };
  } catch (err) {
    logger.error(`[ocr-tool tick] Platform OCR task ${taskId} failed: ${err.message}`);
    failTask(taskId, err.message);
    return { taskId, success: false, error: err.message };
  }
}

async function processTask(taskId, app, context) {
  const task = getTask(taskId);
  if (!task) return { taskId, skipped: true, reason: 'missing' };

  const config = typeof app?.config === 'string'
    ? JSON.parse(app.config || '{}')
    : (app?.config || {});

  if (config.use_document_platform_ocr && task.document_id) {
    return await processPlatformOcrTask(taskId, app, context);
  }

  if (!task.image_data_url) {
    failTask(taskId, 'missing_image_data');
    return { taskId, skipped: true, reason: 'missing_image_data' };
  }

  let modelId = config.vlm_model_id;
  let modelConfig = null;

  // 如果配置了模型 ID，尝试获取
  if (modelId) {
    modelConfig = await context.db.getModelConfig(modelId);
  }

  // 如果未配置或模型不存在，自动选择第一个可用的 multimodal 模型
  if (!modelConfig) {
    const { ai_model } = context.db.getModels();
    const multimodalModel = await ai_model.findOne({
      where: { model_type: 'multimodal', is_active: true },
      attributes: ['id'],
      order: [['created_at', 'ASC']],
    });
    if (multimodalModel) {
      modelId = multimodalModel.id;
      modelConfig = await context.db.getModelConfig(modelId);
      logger.info(`[ocr-tool] Auto-selected multimodal model: ${modelId}`);
    }
  }

  if (!modelConfig) {
    failTask(taskId, 'no_multimodal_model_available');
    return { taskId, skipped: true, reason: 'no_multimodal_model' };
  }

  const prompt = task.prompt || config.vlm_prompt || '请识别图片中的所有文字内容。';
  
  // 压缩图片到 900KB 以下，避免超过 VLM 服务商的限制
  // 注意：这里使用固定值，不从 config 读取，因为 config 的是用户上传限制
  const compressedImageUrl = await compressImage(task.image_data_url, 900 * 1024);
  
  const messages = buildMessages(prompt, compressedImageUrl);

  try {
    const response = await callLLMWithRetry(modelConfig, messages, {
      temperature: config.vlm_temperature ?? 0.2,
      max_tokens: config.vlm_max_output_tokens || 4096,
      timeout: config.vlm_timeout_ms || 120000,
    });

    completeTask(taskId, response.content || '');
    return { taskId, success: true };
  } catch (err) {
    logger.error(`[ocr-tool tick] Task ${taskId} failed: ${err.message}`);
    failTask(taskId, err.message);
    return { taskId, success: false, error: err.message };
  }
}

export async function tick(context) {
  const { app } = context;

  if (!app) {
    return { skipped: true, reason: 'no_app' };
  }

  pruneTasks();

  const config = typeof app.config === 'string'
    ? JSON.parse(app.config || '{}')
    : (app.config || {});

  const maxConcurrent = Math.max(1, Number(config.max_concurrent_tasks) || 2);
  const processingCount = getProcessingCount();
  const slots = Math.max(0, maxConcurrent - processingCount);

  if (slots <= 0) {
    return { skipped: true, reason: 'no_slots' };
  }

  const taskIds = getNextPendingTaskIds(slots);
  if (taskIds.length === 0) {
    return { skipped: true, reason: 'no_pending' };
  }

  for (const taskId of taskIds) {
    markProcessing(taskId);
  }

  const results = await Promise.all(taskIds.map(taskId => processTask(taskId, app, context)));
  return { success: true, processed: results.length, results };
}

export default { tick };
