import logger from '../../../lib/logger.js';

const TIME_COLUMN_NAMES = ['time(s)', 'time', 'timestamp', 'second', 'sec', 's', '时间', '秒'];
const CURRENT_COLUMN_NAMES = ['current(a)', 'current', 'ampere', 'amp', '电流', '安培'];

function normalizeColumnName(name) {
  return (name || '').trim().toLowerCase();
}

function findColumn(headers, candidates) {
  const normalized = headers.map(h => normalizeColumnName(h));
  for (const candidate of candidates) {
    const idx = normalized.indexOf(normalizeColumnName(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseCsvContent(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return { error: 'CSV 文件至少需要包含表头和一行数据' };

  const headers = parseCsvLine(lines[0]);
  if (headers.length < 2) return { error: 'CSV 文件至少需要时间列和电流列' };

  const timeIdx = findColumn(headers, TIME_COLUMN_NAMES);
  if (timeIdx === -1) return { error: '无法识别时间列，请确保包含 time/timestamp/s/秒 等列名' };

  const currentIdx = findColumn(headers, CURRENT_COLUMN_NAMES);
  if (currentIdx === -1) return { error: '无法识别电流列，请确保包含 current/ampere/amp/电流 等列名' };

  const points = [];
  let skippedRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row.length <= Math.max(timeIdx, currentIdx)) {
      skippedRows++;
      continue;
    }
    const t = parseFloat(row[timeIdx]);
    const c = parseFloat(row[currentIdx]);
    if (Number.isNaN(t) || Number.isNaN(c)) {
      skippedRows++;
      continue;
    }
    points.push([t, c]);
  }

  if (points.length === 0) return { error: '文件中无有效数据点' };

  for (let i = 1; i < points.length; i++) {
    if (points[i][0] < points[i - 1][0]) {
      return { error: '时间列存在倒退数据，请检查数据是否已按时间排序' };
    }
    if (points[i][0] === points[i - 1][0]) {
      break;
    }
  }

  const duplicateCheck = checkDuplicateTimes(points);
  if (duplicateCheck.error) return duplicateCheck;

  points.sort((a, b) => a[0] - b[0]);

  return {
    success: true,
    headers: headers,
    time_column: headers[timeIdx],
    current_column: headers[currentIdx],
    point_count: points.length,
    skipped_rows: skippedRows,
    time_range: [points[0][0], points[points.length - 1][0]],
    points,
    duplicate_diagnosis: duplicateCheck.diagnosis || null,
  };
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function checkDuplicateTimes(points) {
  const timeMap = new Map();
  for (const [t, c] of points) {
    if (!timeMap.has(t)) timeMap.set(t, []);
    timeMap.get(t).push(c);
  }

  const duplicates = [];
  let duplicateRowCount = 0;
  let conflictGroupCount = 0;
  let maxSameTimeRows = 0;

  for (const [t, currents] of timeMap) {
    if (currents.length > 1) {
      duplicates.push({ time: t, count: currents.length, currents: [...new Set(currents)] });
      duplicateRowCount += currents.length;
      if (new Set(currents).size > 1) conflictGroupCount++;
      if (currents.length > maxSameTimeRows) maxSameTimeRows = currents.length;
    }
  }

  if (duplicates.length > 0) {
    return {
      error: '发现重复时间点数据',
      diagnosis: {
        duplicate_groups: duplicates.length,
        duplicate_rows: duplicateRowCount,
        conflict_groups: conflictGroupCount,
        max_same_time_rows: maxSameTimeRows,
        conflict_ratio: duplicates.length > 0 ? conflictGroupCount / duplicates.length : 0,
      },
    };
  }

  return { diagnosis: null };
}

class CsvParseService {
  constructor(db) {
    this.db = db;
  }

  parse(text) {
    return parseCsvContent(text);
  }
}

export default CsvParseService;
