import logger from '../../../../lib/logger.js';

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
}

export default ReportExportService;
