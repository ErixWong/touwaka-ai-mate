import ExcelJS from 'exceljs'
import type { SessionFileItem } from '../api/current-feature-analyzer'

const CELL_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD9DDE5' } },
  left: { style: 'thin', color: { argb: 'FFD9DDE5' } },
  bottom: { style: 'thin', color: { argb: 'FFD9DDE5' } },
  right: { style: 'thin', color: { argb: 'FFD9DDE5' } },
}

function sanitizeSheetName(fileName: string, usedNames: Set<string>) {
  const baseName = String(fileName || 'sheet')
    .replace(/[\\/*?:\[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'sheet'

  const maxLength = 31
  let candidate = baseName.slice(0, maxLength)
  let counter = 1

  while (usedNames.has(candidate)) {
    const suffix = `_${counter}`
    candidate = `${baseName.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`
    counter += 1
  }

  usedNames.add(candidate)
  return candidate
}

function buildFileSummaryRows(files: SessionFileItem[]) {
  return files.map((file) => {
    const llmStages = Array.isArray(file.result?.llm_result?.stages) ? file.result.llm_result.stages : []
    const cycleCount = new Set(
      llmStages
        .map(stage => Number(stage.cycle_index))
        .filter(Number.isFinite)
    ).size

    return {
      file_name: file.file_name,
      analysis_status: file.analysis_status,
      row_count: file.row_count,
      cycle_count: cycleCount || null,
      stage_count: file.result?.stage_metrics?.length ?? 0,
      warning_count: file.warning_count ?? 0,
      point_total: file.result?.file_metrics?.point_total ?? null,
      valid_point_count: file.result?.file_metrics?.valid_point_count ?? null,
      segment_count: file.result?.file_metrics?.segment_count ?? file.result?.segments?.length ?? 0,
      polyline_point_count: file.result?.file_metrics?.polyline_point_count ?? null,
      error_message: file.error_message || file.result?.llm_result?._error || null,
    }
  })
}

function appendTabularSection(sheet: ExcelJS.Worksheet, startRow: number, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    return startRow
  }

  const columns = Object.keys(rows[0])
  columns.forEach((column, index) => {
    const cell = sheet.getCell(startRow, index + 1)
    cell.value = column
    cell.border = CELL_BORDER
    cell.font = { bold: true }
  })

  rows.forEach((row, rowIndex) => {
    columns.forEach((column, columnIndex) => {
      const cell = sheet.getCell(startRow + rowIndex + 1, columnIndex + 1)
      cell.value = (row[column] ?? null) as ExcelJS.CellValue
      cell.border = CELL_BORDER
    })
  })

  return startRow + rows.length + 1
}

function getObjectKeys(row: Record<string, unknown> | undefined) {
  return row ? Object.keys(row) : []
}

export async function exportCurrentFeatureAnalyzerReport(input: {
  batchId: string
  files: SessionFileItem[]
}) {
  // Version bump to force Vite module invalidation after export structure refactor.
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'current-feature-analyzer-frontend'
  workbook.created = new Date()

  const fileSummaryRows = buildFileSummaryRows(input.files)

  const fileSummarySheet = workbook.addWorksheet('file_summary')
  if (fileSummaryRows.length > 0) {
    fileSummarySheet.columns = getObjectKeys(fileSummaryRows[0]).map(key => ({ header: key, key }))
    fileSummarySheet.addRows(fileSummaryRows)
    appendTabularSection(fileSummarySheet, 1, fileSummaryRows as Record<string, unknown>[])
  }

  const usedSheetNames = new Set<string>(['file_summary'])

  input.files.forEach((file) => {
    const sheetName = sanitizeSheetName(file.file_name, usedSheetNames)
    const sheet = workbook.addWorksheet(sheetName)
    const llmStages = Array.isArray(file.result?.llm_result?.stages) ? file.result.llm_result.stages : []
    const stageMetrics = Array.isArray(file.result?.stage_metrics) ? file.result.stage_metrics : []

    const stageRows = stageMetrics.map((metric) => {
      const matchedStage = llmStages.find(stage => {
        return (stage.stage_code || '') === (metric.stage_code || '')
          && Number(stage.start_time) === Number(metric.start_time)
          && Number(stage.end_time) === Number(metric.end_time)
      }) || null

      return {
        cycle_index: matchedStage?.cycle_index ?? null,
        cycle_stage_index: matchedStage?.cycle_stage_index ?? null,
        stage_name: metric.stage_name || '',
        stage_code: metric.stage_code || '',
        start_time: metric.start_time,
        start_current: metric.start_current,
        end_time: metric.end_time,
        end_current: metric.end_current,
        duration: metric.duration,
        avg_current: metric.avg_current,
        jitter_rate: metric.jitter_rate,
        ripple_rate: metric.ripple_rate,
        peak_to_peak: metric.peak_to_peak,
        std_current: metric.std_current,
        point_count: metric.point_count,
        min_current: metric.min_current,
        max_current: metric.max_current,
        confidence: metric.confidence,
        reason: metric.reason,
        warning_message: metric._low_base_warning || (metric as { _warning?: string | null })._warning || null,
      }
    })

    appendTabularSection(sheet, 1, stageRows)
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `current-feature-analysis-${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
