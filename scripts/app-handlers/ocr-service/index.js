import path from 'path';
import fs from 'fs/promises';
import logger from '../../../lib/logger.js';

const DEFAULT_STEP_RESOURCES = {
  type: 'mcp',
  mcp: { server: 'markitdown', tool: 'submit_conversion_task', params_mapping: { content: 'file.base64', filename: 'file.name' } },
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

async function buildValueMap(attachment) {
  const basePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
  const absolutePath = path.resolve(basePath, attachment.file_path);
  const values = {
    'file.path': absolutePath,
    'file.mime_type': attachment.mime_type || 'application/octet-stream',
    'file.name': attachment.file_name || '',
  };

  const buffer = await fs.readFile(absolutePath);
  const base64 = buffer.toString('base64');
  values['file.base64'] = base64;
  values['file.data_url'] = `data:${values['file.mime_type']};base64,${base64}`;

  return values;
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

async function callMcpWithMapping(services, mcpConfig, valueMap) {
  const params = resolveParams(mcpConfig.params_mapping, valueMap);
  return await services.callMcp(mcpConfig.server, mcpConfig.tool, params);
}

export default {
  availableOutputs,
  async process(context) {
    const { record, files, services, app, stateName } = context;

    logger.info(`[ocr-service] Processing record ${record.id}`);

    const file = files[0];
    if (!file || !file.attachment) {
      logger.error(`[ocr-service] Record ${record.id}: No associated file found`);
      return { success: false, error: 'No associated file found' };
    }

    const resConfig = getResourceConfig(app, stateName || 'pending_ocr');
    const valueMap = await buildValueMap(file.attachment);

    logger.info(`[ocr-service] Record ${record.id}: File ${valueMap['file.name']}, path=${valueMap['file.path']}`);

    try {
      const mcp = resConfig.mcp || {};
      logger.info(`[ocr-service] Record ${record.id}: Calling MCP ${mcp.server}.${mcp.tool}`);
      const result = await callMcpWithMapping(services, mcp, valueMap);
      const ocrText = result.text;
      
      logger.info(`[ocr-service] Record ${record.id}: OCR complete, text length=${ocrText?.length || 0}`);
      
      return {
        success: true,
        data: {
          _ocr_text: ocrText,
          _ocr_service: mcp.server || 'unknown',
          _ocr_status: 'completed',
        },
      };
    } catch (e) {
      logger.error(`[ocr-service] Record ${record.id}: OCR failed - ${e.message}`);
      return { success: false, error: 'OCR failed: ' + e.message };
    }
  },
};
