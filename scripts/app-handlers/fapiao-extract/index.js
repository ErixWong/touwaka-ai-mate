import logger from '../../../lib/logger.js';

export const availableOutputs = [
  { key: 'invoice_number', label: '发票号码', type: 'string' },
  { key: 'invoice_date', label: '开票日期', type: 'string' },
  { key: 'total_amount', label: '合计金额', type: 'number' },
  { key: 'seller_name', label: '销售方名称', type: 'string' },
  { key: 'buyer_name', label: '购买方名称', type: 'string' },
];

export default {
  availableOutputs,
  async process(context) {
    const { record, files, services } = context;

    logger.info(`[fapiao-extract] Processing record ${record.id}`);

    const file = files[0];
    if (!file || !file.attachment) {
      logger.error(`[fapiao-extract] Record ${record.id}: No associated file found`);
      return { success: false, error: 'No associated file found' };
    }

    logger.info(`[fapiao-extract] Record ${record.id}: File ${file.attachment.file_name}`);

    try {
      logger.info(`[fapiao-extract] Record ${record.id}: Calling fapiao skill`);
      const result = await services.callSkill('fapiao', 'extract', {
        file_path: file.attachment.file_path,
      });

      if (!result || !result.success) {
        logger.error(`[fapiao-extract] Record ${record.id}: Extraction failed - ${result?.error || 'no result'}`);
        return { success: false, error: (result && result.error) || 'Fapiao extraction returned no result' };
      }

      logger.info(`[fapiao-extract] Record ${record.id}: Extraction complete`);
      return {
        success: true,
        data: result.data || result,
      };
    } catch (e) {
      logger.error(`[fapiao-extract] Record ${record.id}: Extraction failed - ${e.message}`);
      return { success: false, error: 'Fapiao extraction failed: ' + e.message };
    }
  },
};
