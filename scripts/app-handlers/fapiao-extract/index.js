export default {
  async process(context) {
    const { record, files, services } = context;

    const file = files[0];
    if (!file || !file.attachment) {
      return { success: false, error: 'No associated file found' };
    }

    try {
      const result = await services.callSkill('fapiao', 'extract', {
        file_path: file.attachment.file_path,
      });

      if (!result || !result.success) {
        return { success: false, error: (result && result.error) || 'Fapiao extraction returned no result' };
      }

      return {
        success: true,
        data: result.data || result,
      };
    } catch (e) {
      return { success: false, error: 'Fapiao extraction failed: ' + e.message };
    }
  },
};
