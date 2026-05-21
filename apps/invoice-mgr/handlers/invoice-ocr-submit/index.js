import logger from '../../../lib/logger.js';

function getAppConfig(app) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config || {};
}

function getStepResource(app, stateName, fallback = {}) {
  const config = getAppConfig(app);
  return config?.step_resources?.[stateName] || fallback;
}

export const availableOutputs = [
  { key: 'ocr_task_id', label: 'OCR任务ID', type: 'string' },
];

export default {
  availableOutputs,
  async process(context) {
    const { record, files, services, app } = context;
    const file = files[0];

    if (!file || !file.attachment) {
      logger.error(`[invoice-ocr-submit] Record ${record.id}: No file`);
      return { success: false, error: '未找到文件' };
    }

    const fileName = file.attachment.file_name;
    const filePath = file.attachment.file_path;

    const stepConfig = getStepResource(app, 'pending_ocr', {
      type: 'mcp',
      mcp: { server: 'markitdown', tool: 'submit_conversion_task' },
    });

    if (stepConfig.type !== 'mcp') {
      return { success: false, error: 'pending_ocr 未配置为 MCP 类型' };
    }

    const mcpServer = stepConfig.mcp?.server || 'markitdown';
    const mcpTool = stepConfig.mcp?.tool || 'submit_conversion_task';

    logger.info(`[invoice-ocr-submit] Record ${record.id}: ${fileName} (${mcpServer}/${mcpTool})`);

    try {
      const fs = await import('fs/promises');
      const buffer = await fs.readFile(filePath);
      const base64 = buffer.toString('base64');

      logger.info(`[invoice-ocr-submit] Record ${record.id}: 提交${mcpServer} OCR (${(buffer.length / 1024).toFixed(1)}KB)`);

      const mcpResult = await services.callMcp(mcpServer, mcpTool, {
        content: base64,
        filename: fileName,
      });

      if (!mcpResult || !mcpResult.task_id) {
        logger.error(`[invoice-ocr-submit] Record ${record.id}: ${mcpServer} 未返回task_id: ${JSON.stringify(mcpResult)}`);
        return { success: false, error: `OCR提交失败：${mcpServer}未获取任务ID` };
      }

      logger.info(`[invoice-ocr-submit] Record ${record.id}: task_id=${mcpResult.task_id}`);
      return {
        success: true,
        data: {
          _ocr_task_id: mcpResult.task_id,
          _ocr_server: mcpServer,
        },
      };
    } catch (e) {
      logger.error(`[invoice-ocr-submit] Record ${record.id}: ${mcpServer}提交异常 - ${e.message}`);
      return { success: false, error: `OCR提交异常: ${e.message}` };
    }
  },
};
