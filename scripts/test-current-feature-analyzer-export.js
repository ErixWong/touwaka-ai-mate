import ExcelJS from 'exceljs';
import ReportExportService from '../apps/current-feature-analyzer/server/services/report-export.service.js';

const mockDb = {
  async getOne() {
    return null;
  },
};

const service = new ReportExportService(mockDb);

const batch = {
  batch_id: 'test_batch',
  summary: {
    file_total: 2,
    success_count: 2,
    failed_count: 0,
  },
  files: [
    {
      file_id: 'file_1',
      file_name: 'alpha.csv',
      analysis_status: 'completed',
      row_count: 120,
      warning_count: 0,
      error_message: null,
      result: {
        segments: [],
        file_metrics: { point_total: 120, valid_point_count: 120, segment_count: 3, polyline_point_count: 14 },
        llm_result: {
          warnings: [],
          stages: [
            { stage_code: 's1', stage_name: '阶段1', start_time: 0, end_time: 1, cycle_index: 1, cycle_stage_index: 1 },
          ],
        },
        stage_metrics: [
          { stage_code: 's1', stage_name: '阶段1', start_time: 0, end_time: 1, duration: 1, avg_current: 1.2, jitter_rate: 0.1, point_count: 20, min_current: 1, max_current: 2, confidence: 0.9 },
        ],
      },
    },
    {
      file_id: 'file_2',
      file_name: 'beta.csv',
      analysis_status: 'completed',
      row_count: 240,
      warning_count: 1,
      error_message: null,
      result: {
        segments: [],
        file_metrics: { point_total: 240, valid_point_count: 238, segment_count: 4, polyline_point_count: 16 },
        llm_result: {
          warnings: [{ message: 'warn' }],
          stages: [
            { stage_code: 's2', stage_name: '阶段2', start_time: 2, end_time: 4, cycle_index: 2, cycle_stage_index: 1 },
          ],
        },
        stage_metrics: [
          { stage_code: 's2', stage_name: '阶段2', start_time: 2, end_time: 4, duration: 2, avg_current: 2.4, jitter_rate: 0.2, point_count: 40, min_current: 2, max_current: 3, confidence: 0.8 },
        ],
      },
    },
  ],
};

const { summaryRows, fileSummaryRows, perFileSheets } = service.buildExcelData(batch);

const workbook = new ExcelJS.Workbook();
workbook.addWorksheet('summary').addRows(summaryRows);
workbook.addWorksheet('file_summary').addRows(fileSummaryRows);

for (const fileSheetData of perFileSheets) {
  const sheet = workbook.addWorksheet(fileSheetData.sheet_name);
  sheet.getCell('A1').value = 'field';
  sheet.getCell('B1').value = 'value';
}

console.log('Sheet names:', workbook.worksheets.map(ws => ws.name).join(', '));
console.log('Per file sheets:', perFileSheets.map(item => `${item.file_name}=>${item.sheet_name}`).join(', '));
