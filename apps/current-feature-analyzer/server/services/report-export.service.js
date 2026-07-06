import logger from '../../../../lib/logger.js';
import ExcelJS from 'exceljs';
import ConfigService from './config.service.js';

class ReportExportService {
  constructor(db) {
    this.db = db;
    this.configService = new ConfigService(db);
  }

  sanitizeSheetName(fileName, usedNames = new Set()) {
    const baseName = String(fileName || 'sheet')
      .replace(/[\\/*?:\[\]]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'sheet';

    const maxLength = 31;
    let candidate = baseName.slice(0, maxLength);
    let counter = 1;

    while (usedNames.has(candidate)) {
      const suffix = `_${counter}`;
      candidate = `${baseName.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`;
      counter += 1;
    }

    usedNames.add(candidate);
    return candidate;
  }

  buildPerFileSheets(files = []) {
    const usedSheetNames = new Set();

    return files.map((file) => {
      const llmStages = Array.isArray(file.result?.llm_result?.stages) ? file.result.llm_result.stages : [];
      const stageMetrics = Array.isArray(file.result?.stage_metrics) ? file.result.stage_metrics : [];
      const sheetName = this.sanitizeSheetName(file.file_name, usedSheetNames);

      const metaRows = [
        { field: 'file_name', value: file.file_name || '' },
        { field: 'analysis_status', value: file.analysis_status || '' },
        { field: 'row_count', value: file.row_count ?? null },
        { field: 'warning_count', value: file.warning_count ?? 0 },
        { field: 'error_message', value: file.error_message || file.result?.llm_result?._error || '' },
      ];

      const stageRows = stageMetrics.map((metric) => {
        const matchedStage = llmStages.find(stage => {
          return (stage.stage_code || '') === (metric.stage_code || '')
            && Number(stage.start_time) === Number(metric.start_time)
            && Number(stage.end_time) === Number(metric.end_time)
        }) || null;

        return {
          cycle_index: matchedStage?.cycle_index ?? null,
          cycle_stage_index: matchedStage?.cycle_stage_index ?? null,
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
        };
      });

      return {
        file_id: file.file_id,
        file_name: file.file_name,
        sheet_name: sheetName,
        meta_rows: metaRows,
        stage_rows: stageRows,
      };
    });
  }

  buildExcelData(batchSession) {
    const stageDetailRows = [];
    const fileSummaryRows = [];
    const files = batchSession.files || [];
    const stageDistributionMap = new Map();

    for (const file of files) {
      const stageMetrics = Array.isArray(file.result?.stage_metrics) ? file.result.stage_metrics : [];
      const fileMetrics = file.result?.file_metrics || null;
      const llmWarnings = Array.isArray(file.result?.llm_result?.warnings) ? file.result.llm_result.warnings : [];
      const llmStages = Array.isArray(file.result?.llm_result?.stages) ? file.result.llm_result.stages : [];
      const cycleIndexSet = new Set(
        llmStages
          .map(stage => Number(stage.cycle_index))
          .filter(Number.isFinite)
      );

      fileSummaryRows.push({
        file_name: file.file_name,
        analysis_status: file.analysis_status,
        row_count: file.row_count,
        cycle_count: cycleIndexSet.size || null,
        stage_count: stageMetrics.length,
        warning_count: file.warning_count || llmWarnings.length || 0,
        point_total: fileMetrics?.point_total ?? null,
        valid_point_count: fileMetrics?.valid_point_count ?? null,
        segment_count: fileMetrics?.segment_count ?? (Array.isArray(file.result?.segments) ? file.result.segments.length : 0),
        polyline_point_count: fileMetrics?.polyline_point_count ?? null,
        error_message: file.error_message || file.result?.llm_result?._error || null,
      });

      if (!file.result || !file.result.stage_metrics) continue;
      for (const metric of file.result.stage_metrics) {
        const matchedStage = llmStages.find(stage => {
          return (stage.stage_code || '') === (metric.stage_code || '')
            && Number(stage.start_time) === Number(metric.start_time)
            && Number(stage.end_time) === Number(metric.end_time)
        }) || null;
        const distribution = stageDistributionMap.get(metric.stage_name || '') || 0;
        stageDistributionMap.set(metric.stage_name || '', distribution + 1);
        stageDetailRows.push({
          file_name: file.file_name,
          cycle_index: matchedStage?.cycle_index ?? null,
          cycle_stage_index: matchedStage?.cycle_stage_index ?? null,
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
    const stageDistributionRows = Array.from(stageDistributionMap.entries()).map(([stage_name, count]) => ({
      stage_name,
      count,
    }));
    const summaryRows = [{
      batch_id: batchSession.batch_id,
      file_total: summary.file_total || files.length,
      success_count: summary.success_count || 0,
      failed_count: summary.failed_count || 0,
      file_with_result_count: files.filter(file => file.result).length,
      stage_row_total: stageDetailRows.length,
      completed_at: new Date().toISOString(),
      selected_rule_set_name: '',
      export_generated_at: new Date().toISOString(),
    }];

    const perFileSheets = this.buildPerFileSheets(files);

    return { summaryRows, fileSummaryRows, stageDetailRows, stageDistributionRows, perFileSheets };
  }

  async generateReport(batchId) {
    const UploadSessionService = (await import('./upload-session.service.js')).default;
    const sessionService = new UploadSessionService(this.db);
    const batch = sessionService.getBatch(batchId);

    if (!batch) {
      return { success: false, error: '批次不存在' };
    }

    const { summaryRows, fileSummaryRows, stageDetailRows, stageDistributionRows, perFileSheets } = this.buildExcelData(batch);
    return {
      success: true,
      batch_id: batchId,
      summary: summaryRows[0],
      files: fileSummaryRows,
      stage_details: stageDetailRows,
      stage_distribution: stageDistributionRows,
      file_sheets: perFileSheets,
    };
  }

  async exportReport(batchId, options = {}) {
    const UploadSessionService = (await import('./upload-session.service.js')).default;
    const sessionService = new UploadSessionService(this.db);
    const batch = sessionService.getBatch(batchId);

    if (!batch) {
      throw new Error('批次不存在');
    }

    const config = await this.configService.getConfig();
    const exportConfig = config.export || {};
    const summarySheetName = exportConfig.sheet_summary_name || 'summary';
    const fileSheetName = 'file_summary';

    const { summaryRows, fileSummaryRows, perFileSheets } = this.buildExcelData(batch);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'current-feature-analyzer';
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet(summarySheetName);
    summarySheet.columns = Object.keys(summaryRows[0] || {}).map(key => ({ header: key, key }));
    summarySheet.addRows(summaryRows);

    const fileSheet = workbook.addWorksheet(fileSheetName);
    if (fileSummaryRows.length > 0) {
      fileSheet.columns = Object.keys(fileSummaryRows[0]).map(key => ({ header: key, key }));
      fileSheet.addRows(fileSummaryRows);
    }

    for (const fileSheetData of perFileSheets) {
      const sheet = workbook.addWorksheet(fileSheetData.sheet_name);

      sheet.getCell('A1').value = 'field';
      sheet.getCell('B1').value = 'value';
      if (fileSheetData.meta_rows.length > 0) {
        for (const [index, row] of fileSheetData.meta_rows.entries()) {
          sheet.getCell(`A${index + 2}`).value = row.field;
          sheet.getCell(`B${index + 2}`).value = row.value;
        }
      }

      const stageHeaderRowIndex = fileSheetData.meta_rows.length + 4;
      if (fileSheetData.stage_rows.length > 0) {
        const stageColumns = Object.keys(fileSheetData.stage_rows[0]);
        stageColumns.forEach((column, index) => {
          sheet.getCell(stageHeaderRowIndex, index + 1).value = column;
        });

        fileSheetData.stage_rows.forEach((row, rowIndex) => {
          stageColumns.forEach((column, columnIndex) => {
            sheet.getCell(stageHeaderRowIndex + rowIndex + 1, columnIndex + 1).value = row[column];
          });
        });
      }
    }

    logger.info('[cfa export] generated workbook sheets:', workbook.worksheets.map(sheet => sheet.name));

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      filename: `analysis_report_${batchId}_${Date.now()}.xlsx`,
      buffer: Buffer.from(buffer),
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
}

export default ReportExportService;
