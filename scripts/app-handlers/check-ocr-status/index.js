const DEFAULT_STEP_RESOURCES = {
  type: 'mcp',
  mcp: { server: 'markitdown', tool: 'get_task' },
};

export const availableOutputs = [
  { key: 'task_id', label: 'OCR任务ID', type: 'string' },
];

function getResourceConfig(app, stepName) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.step_resources?.[stepName] || DEFAULT_STEP_RESOURCES;
}

export default {
  availableOutputs,
  async process(context) {
    const { record, services, app, stateName } = context;

    const data = record.data || {};
    const taskId = data._ocr_task_id;
    if (!taskId) {
      return { success: false, error: 'No OCR task_id found' };
    }

    const resConfig = getResourceConfig(app, stateName || 'ocr_submitted');
    const mcp = resConfig.mcp || {};

    try {
      const result = await services.callMcp(mcp.server, mcp.tool || 'get_task', { task_id: taskId });

      const status = result.status || result.state;
      
      if (status === 'completed' || status === 'success' || status === 'done') {
        const ocrText = result.content || result.text || result.output || '';
        return {
          success: true,
          data: {
            _ocr_text: ocrText,
            _ocr_status: 'completed',
            _ocr_completed_at: new Date().toISOString(),
          },
        };
      }

      if (status === 'failed' || status === 'error') {
        return { success: false, error: 'OCR task failed: ' + (result.error || 'Unknown error') };
      }

      if (status === 'pending' || status === 'running' || status === 'processing' || status === 'queued') {
        return {
          success: true,
          pending: true,
          data: {
            _ocr_status: 'processing',
            _ocr_progress: result.progress || null,
          },
        };
      }

      return { success: false, error: 'Unknown OCR task status: ' + status };
    } catch (e) {
      return { success: false, error: 'Check OCR status failed: ' + e.message };
    }
  },
};