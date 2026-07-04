import logger from '../../../../lib/logger.js';

const TIME_COLUMN_NAMES = ['time(s)', 'time', 'timestamp', 'second', 'sec', 's', 't', '时间', '秒', '時刻'];
const CURRENT_COLUMN_NAMES = ['current(a)', 'current', 'ampere', 'amp', 'a', 'i', '电流', '安培', '電流', 'ma', 'ua', 'na'];

// BOM 字符
const BOM = '\uFEFF';

function normalizeColumnName(name) {
  return (name || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function isSingleTokenCandidate(candidate) {
  return normalizeColumnName(candidate).length <= 2;
}

/**
 * 在候选列表中查找最匹配的列索引，使用模糊匹配
 */
function findColumn(headers, candidates) {
  const normalized = headers.map((h, i) => ({ name: normalizeColumnName(h), idx: i }));

  // 1. 精确匹配
  for (const candidate of candidates) {
    const candNorm = normalizeColumnName(candidate);
    const match = normalized.find(h => h.name === candNorm);
    if (match) return match.idx;
  }

  // 2. 包含匹配（候选词出现在列名中）
  for (const candidate of candidates) {
    const candNorm = normalizeColumnName(candidate);
    if (isSingleTokenCandidate(candNorm)) continue;
    const match = normalized.find(h => h.name.includes(candNorm));
    if (match) return match.idx;
  }

  // 3. 列名包含候选词
  for (const candidate of candidates) {
    const candNorm = normalizeColumnName(candidate);
    if (isSingleTokenCandidate(candNorm)) continue;
    const match = normalized.find(h => candNorm.includes(h.name));
    if (match) return match.idx;
  }

  return -1;
}

/**
 * 通过第一行数据推断时间列和电流列
 */
function inferColumnsByData(headers, sampleRow) {
  const candidates = [];
  for (let i = 0; i < Math.min(headers.length, sampleRow.length); i++) {
    const val = parseFloat(sampleRow[i]);
    if (!Number.isNaN(val)) candidates.push(i);
  }
  if (candidates.length >= 2) {
    return { timeIdx: candidates[0], currentIdx: candidates[1] };
  }
  return null;
}

/**
 * 自动检测分隔符
 */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delimiters = [',', ';', '\t', '|'];
  let best = { delim: ',', count: 0 };
  for (const d of delimiters) {
    const count = (firstLine.match(new RegExp(`\\${d}`, 'g')) || []).length;
    if (count > best.count) best = { delim: d, count };
  }
  return best.count > 0 ? best.delim : ',';
}

/**
 * 跳过文件开头的说明行，找到真正的表头行
 */
function findHeaderLine(lines, delimiter) {
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start++;

  if (start >= lines.length) return start;

  const maxScanRows = Math.min(lines.length, start + 12);
  for (let index = start; index < maxScanRows; index++) {
    const columns = splitLine(lines[index], delimiter);
    if (columns.length < 2) continue;

    const timeIdx = findColumn(columns, TIME_COLUMN_NAMES);
    const currentIdx = findColumn(columns, CURRENT_COLUMN_NAMES);
    if (timeIdx !== -1 && currentIdx !== -1 && timeIdx !== currentIdx) {
      return index;
    }
  }

  if (start + 1 < lines.length) {
    return start + 1;
  }

  return start;
}

function splitLine(line, delimiter) {
  // 处理引号包裹的字段
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
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsvContent(textConfig) {
  // 移除 BOM
  let text = textConfig;
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  // 检测分隔符
  const delimiter = detectDelimiter(text);

  const rawLines = text.split(/\r?\n/);

  // 找到表头行
  const headerLineIdx = findHeaderLine(rawLines, delimiter);
  const dataLines = rawLines.slice(headerLineIdx + 1).filter(line => line.trim().length > 0);

  if (headerLineIdx >= rawLines.length) {
    return { error: 'CSV 文件为空或无法识别表头' };
  }

  const headers = splitLine(rawLines[headerLineIdx], delimiter);
  if (headers.length < 2) {
    return { error: `CSV 文件至少需要时间列和电流列（检测到 ${headers.length} 列，分隔符: "${delimiter}"）` };
  }

  if (dataLines.length === 0) {
    return { error: 'CSV 文件无数据行' };
  }

  // 尝试用第一行数据推断列
  const sampleRow = splitLine(dataLines[0], delimiter);
  const inferred = inferColumnsByData(headers, sampleRow);

  let timeIdx = findColumn(headers, TIME_COLUMN_NAMES);
  let currentIdx = findColumn(headers, CURRENT_COLUMN_NAMES);

  // 如果列名匹配失败，使用数据推断
  if (timeIdx === -1 && inferred) timeIdx = inferred.timeIdx;
  if (currentIdx === -1 && inferred) {
    currentIdx = inferred.currentIdx;
    // 确保 timeIdx 和 currentIdx 不同
    if (currentIdx === timeIdx && inferred.currentIdx < headers.length - 1) {
      currentIdx = inferred.currentIdx + 1;
    }
  }

  if (timeIdx === -1) {
    return {
      error: `无法识别时间列。检测到列名: ${headers.join(', ')}。请确保包含 time/timestamp/s/秒 等列名`,
    };
  }
  if (currentIdx === -1) {
    return {
      error: `无法识别电流列。检测到列名: ${headers.join(', ')}。请确保包含 current/ampere/amp/电流 等列名`,
    };
  }

  const points = [];
  let skippedRows = 0;

  for (let i = 0; i < dataLines.length; i++) {
    const row = splitLine(dataLines[i], delimiter);
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

  if (points.length === 0) {
    return {
      error: '文件中无有效数据点。请检查时间列和电流列是否包含数值数据',
      time_column: headers[timeIdx],
      current_column: headers[currentIdx],
      skipped_rows: skippedRows,
    };
  }

  // 排序检查
  let hasUnordered = false;
  for (let i = 1; i < points.length; i++) {
    if (points[i][0] < points[i - 1][0]) {
      hasUnordered = true;
      break;
    }
  }

  // 检查重复时间点
  const duplicateCheck = checkDuplicateTimes(points);

  // 排序（如有需要）
  if (hasUnordered) {
    points.sort((a, b) => a[0] - b[0]);
    logger.info('[cfa csv] sorted unordered time points');
  }

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
    delimiter: delimiter,
    auto_sorted: hasUnordered,
  };
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
