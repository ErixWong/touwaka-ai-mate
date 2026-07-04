export async function get(ctx, deps) {
  try {
    const result = await deps.services.query(
      "SELECT config FROM mini_apps WHERE id = 'ocr-tool'"
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
    deps.services.log('warn', `[OCR-Tool] getPromptPresets error: ${err.message}`);
    ctx.success({ presets: [], defaultId: 'text' });
  }
}