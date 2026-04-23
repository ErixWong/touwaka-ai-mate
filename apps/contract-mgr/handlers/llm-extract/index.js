export default {
  async process(context) {
    const { record, app, services } = context;

    const data = record.data || {};
    const ocrText = data._ocr_text;
    if (!ocrText) {
      return { success: false, error: 'No OCR text found, run OCR first' };
    }

    const extractableFields = (app.fields || []).filter(f => f.ai_extractable && f.type !== 'file');
    if (extractableFields.length === 0) {
      return { success: false, error: 'No extractable fields defined' };
    }

    const fieldDefs = extractableFields
      .map(f => `- ${f.name} (${f.label}): type=${f.type}${f.required ? ', required' : ''}`)
      .join('\n');

    try {
      const response = await services.callLlm('extract_metadata', {
        field_definitions: fieldDefs,
        ocr_text: ocrText,
        response_format: 'json',
      });

      let metadata;
      const resultText = response.text || response.parsed || response;
      if (typeof resultText === 'string') {
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return { success: false, error: 'LLM did not return valid JSON' };
        }
        metadata = JSON.parse(jsonMatch[0]);
      } else if (typeof resultText === 'object') {
        metadata = resultText;
      } else {
        return { success: false, error: 'LLM returned unexpected format' };
      }

      const cleanMetadata = {};
      for (const field of extractableFields) {
        if (metadata[field.name] !== undefined) {
          cleanMetadata[field.name] = metadata[field.name];
        }
      }

      return {
        success: true,
        data: cleanMetadata,
      };
    } catch (e) {
      return { success: false, error: 'LLM extraction failed: ' + e.message };
    }
  },
};
