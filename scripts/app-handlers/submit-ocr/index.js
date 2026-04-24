import path from 'path';

const DEFAULT_STEP_RESOURCES = {
  type: 'mcp',
  mcp: { server: 'markitdown', tool: 'submit_conversion_task', params_mapping: { file_path: 'file.path' } },
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

    const file = files[0];
    if (!file || !file.attachment) {
      return { success: false, error: 'No associated file found' };
    }

    const basePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
    const absolutePath = path.resolve(basePath, file.attachment.file_path);

    const resConfig = getResourceConfig(app, stateName || 'pending_ocr');
    const mcp = resConfig.mcp || {};

    const valueMap = {
      'file.path': absolutePath,
      'file.mime_type': file.attachment.mime_type || 'application/octet-stream',
      'file.name': file.attachment.file_name || '',
    };

    const params = resolveParams(mcp.params_mapping, valueMap);

    try {
      const result = await services.callMcp(mcp.server, mcp.tool, params);
      
      const taskId = result.task_id || result.id;
      if (!taskId) {
        return { success: false, error: 'No task_id returned from OCR service' };
      }

      return {
        success: true,
        data: {
          _ocr_task_id: taskId,
          _ocr_service: mcp.server,
          _ocr_submitted_at: new Date().toISOString(),
        },
      };
    } catch (e) {
      return { success: false, error: 'OCR submission failed: ' + e.message };
    }
  },
};