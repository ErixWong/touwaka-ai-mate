import logger from '../../../../lib/logger.js';
import ExcelJS from 'exceljs';

class ReportExportService {
  constructor(db) {
    this.db = db;
  }

  buildExcelData(batchSession) {
    const stageDetailRows = [];
    const files = batchSession.files || [];

    for (const file of files) {
      if (!file.result || !file.result.stage_metrics) continue;
      for (const metric of file.result.stage_metrics) {
        stageDetailRows.push({
          file_name: file.file_name,
          stage_name: metric.stage_name || '',
          stage_code: metric.stage_code || '',
          start_time: metric.start_time,
          end_time: metric.end_time,
          duration: metric.duration,
          avg_current: metric.avg_current,
          jitter_rate: metric.jitter_rate,
          point_count: metric.point_count,
          min_current: metric.min_current,
          max_current: metric.max_current,
          confidence: metric.confidence,
          warning_message: metric._warning || metric._low_base_warning || null,
        });
      }
    }

    const summary = batchSession.summary || {};
    const summaryRows = [{
      batch_id: batchSession.batch_id,
      file_total: summary.file_total || files.length,
      success_count: summary.success_count || 0,
      failed_count: summary.failed_count || 0,
      completed_at: new Date().toISOString(),
      selected_rule_set_name: '',
      export_generated_at: new Date().toISOString(),
    }];

    return { stageDetailRows, summaryRows };
  }

  async generateReport(batchId) {
    const UploadSessionService = (await import('./upload-session.service.js')).default;
    const sessionService = new UploadSessionService(this.db);
    const batch = sessionService.getBatch(batchId);

    if (!batch) {
      return { success: false, error: '批次不存在' };
    }

    const { stageDetailRows, summaryRows } = this.buildExcelData(batch);
    return {
      success: true,
      batch_id: batchId,
      summary: summaryRows[0],
      stage_details: stageDetailRows,
    };
  }

  async exportReport(batchId, options = {}) {
    const UploadSessionService = (await import('./upload-session.service.js')).default;
    const sessionService = new UploadSessionService(this.db);
    const batch = sessionService.getBatch(batchId);

    if (!batch) {
      throw new Error('批次不存在');
    }

    const { stageDetailRows, summaryRows } = this.buildExcelData(batch);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'current-feature-analyzer';
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = Object.keys(summaryRows[0] || {}).map(key => ({ header: key, key }));
    summarySheet.addRows(summaryRows);

    const detailSheet = workbook.addWorksheet('StageDetails');
    if (stageDetailRows.length > 0) {
      detailSheet.columns = Object.keys(stageDetailRows[0]).map(key => ({ header: key, key }));
      detailSheet.addRows(stageDetailRows);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      filename: `analysis_report_${batchId}_${Date.now()}.xlsx`,
      buffer: Buffer.from(buffer),
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
}

export default ReportExportService;
