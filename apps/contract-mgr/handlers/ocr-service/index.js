export default {
  async process(context) {
    const { record, files, services } = context;

    const file = files[0];
    if (!file || !file.attachment) {
      return { success: false, error: 'No associated file found' };
    }

    let ocrText = '';
    try {
      const result = await services.callMcp('markitdown', 'convert', {
        file_path: file.attachment.file_path,
      });
      ocrText = result.text;
    } catch (e) {
      try {
        const result = await services.callMcp('mineru', 'parse', {
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
        _ocr_service: 'markitdown',
        _ocr_status: 'completed',
      },
    };
  },
};
