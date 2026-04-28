import path from 'path';
import fs from 'fs/promises';
import logger from '../../../lib/logger.js';

const DEFAULT_STEP_RESOURCES = {
  type: 'mcp',
  mcp: {
    server: 'markitdown',
    tool: 'submit_conversion_task',
    params_mapping: { content: 'file.base64', filename: 'file.name' }
  },
};

export const availableOutputs = [
  { key: 'file.path', label: '文件绝对路径', type: 'string' },
  { key: 'file.base64', label: '文件Base64内容', type: 'string' },
  { key: 'file.mime_type', label: 'MIME类型', type: 'string' },
  { key: 'file.name', label: '原始文件名', type: 'string' },
  { key: 'file.data_url', label: 'Data URL', type: 'string' },
];

function getResourceConfig(app, stepName) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.step_resources?.[stepName] || DEFAULT_STEP_RESOURCES;
}

function resolveParams(paramsMapping, valueMap) {
  const params = {};
  for (const [toolParam, handlerKey] of Object.entries(paramsMapping || {})) {
    if (valueMap[handlerKey] !== undefined) {
      params[toolParam] = valueMap[handlerKey];
    }
  }
  return params;
}

export default {
  availableOutputs,
  async process(context) {
    const { record, files, services, app, stateName } = context;

    logger.info(`[submit-ocr] Processing record ${record.id}`);

    const file = files[0];
    if (!file || !file.attachment) {
      logger.error(`[submit-ocr] Record ${record.id}: No associated file found`);
      return { success: false, error: 'No associated file found' };
    }

    const basePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
    const absolutePath = path.resolve(basePath, file.attachment.file_path);
    
    logger.info(`[submit-ocr] Record ${record.id}: File path ${absolutePath}`);

    const allowedBase = path.resolve(basePath);
    if (!absolutePath.startsWith(allowedBase)) {
      logger.error(`[submit-ocr] Record ${record.id}: File path not allowed`);
      return { success: false, error: 'File path not allowed: outside attachment directory' };
    }

    const resConfig = getResourceConfig(app, stateName || 'pending_ocr');
    const mcp = resConfig.mcp || {};

    logger.info(`[submit-ocr] Record ${record.id}: mcp.server=${mcp.server}, mcp.tool=${mcp.tool}`);

    let fileBase64;
    try {
      const buffer = await fs.readFile(absolutePath);
      fileBase64 = buffer.toString('base64');
      logger.info(`[submit-ocr] Record ${record.id}: File read ${buffer.length} bytes, base64 length ${fileBase64.length}`);
    } catch (e) {
      logger.error(`[submit-ocr] Record ${record.id}: Failed to read file: ${e.message}`);
      return { success: false, error: 'Failed to read file: ' + e.message };
    }

    const fileName = file.attachment.file_name || path.basename(absolutePath);

    const valueMap = {
      'file.base64': fileBase64,
      'file.name': fileName,
      'file.mime_type': file.attachment.mime_type || 'application/octet-stream',
      'file.path': absolutePath,
    };

    const params = resolveParams(mcp.params_mapping, valueMap);
    logger.info(`[submit-ocr] Record ${record.id}: Resolved params keys=${Object.keys(params).join(',')}`);
    logger.info(`[submit-ocr] Record ${record.id}: Calling MCP ${mcp.server}.${mcp.tool}`);

    try {
      const result = await services.callMcp(mcp.server, mcp.tool, params);
      
      logger.info(`[submit-ocr] Record ${record.id}: MCP result keys: ${Object.keys(result || {}).join(',')}`);

      // MCP 返回格式: { content: "JSON字符串", raw: [...], is_error: false }
      let parsedResult = result;
      if (result?.content && typeof result.content === 'string') {
        try {
          parsedResult = JSON.parse(result.content);
          logger.info(`[submit-ocr] Record ${record.id}: Parsed status=${parsedResult?.status}`);
        } catch (e) {
          logger.error(`[submit-ocr] Record ${record.id}: Failed to parse content: ${e.message}`);
        }
      }

      if (parsedResult?.status === 'error') {
        logger.error(`[submit-ocr] Record ${record.id}: OCR error: ${parsedResult.error}`);
        return { success: false, error: parsedResult.error || 'OCR service error' };
      }

      const taskId = parsedResult?.task_id || parsedResult?.id;
      if (!taskId) {
        logger.error(`[submit-ocr] Record ${record.id}: No task_id returned`);
        return { success: false, error: 'No task_id returned from OCR service' };
      }

      logger.info(`[submit-ocr] Record ${record.id}: Task created ${taskId}`);

      return {
        success: true,
        data: {
          _ocr_task_id: taskId,
          _ocr_service: mcp.server,
          _ocr_submitted_at: new Date().toISOString(),
        },
      };
    } catch (e) {
      logger.error(`[submit-ocr] Record ${record.id}: OCR submission failed - ${e.message}`);
      return { success: false, error: 'OCR submission failed: ' + e.message };
    }
  },
};