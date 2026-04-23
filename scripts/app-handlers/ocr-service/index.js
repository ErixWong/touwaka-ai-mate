const DEFAULT_STEP_RESOURCES = {
  type: 'mcp',
  primary: { server: 'markitdown', tool: 'convert' },
  fallback: { server: 'mineru', tool: 'parse' },
};

function getResourceConfig(app, stepName) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.step_resources?.[stepName] || DEFAULT_STEP_RESOURCES;
}

export default {
  async process(context) {
    const { record, files, services, app } = context;

    const file = files[0];
    if (!file || !file.attachment) {
      return { success: false, error: 'No associated file found' };
    }

    const resConfig = getResourceConfig(app, 'pending_ocr');
    let ocrText = '';
    let usedService = resConfig.primary?.server || 'unknown';

    try {
      const primary = resConfig.primary || {};
      const result = await services.callMcp(primary.server, primary.tool, {
        file_path: file.attachment.file_path,
      });
      ocrText = result.text;
    } catch (e) {
      const fallback = resConfig.fallback;
      if (!fallback) {
        return { success: false, error: 'OCR failed: ' + e.message };
      }
      try {
        usedService = fallback.server;
        const result = await services.callMcp(fallback.server, fallback.tool, {
          file_path: file.attachment.file_path,
        });
        ocrText = result.text;
      } catch (e2) {
        return { success: false, error: 'OCR failed: ' + e2.message };
      }
    }

    return {
      success: true,
      data: {
        _ocr_text: ocrText,
        _ocr_service: usedService,
        _ocr_status: 'completed',
      },
    };
  },
};
