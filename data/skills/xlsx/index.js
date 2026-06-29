/**
 * XLSX Skill - Excel 文件处理技能 (ExcelJS 版本)
 *
 * 路径模型说明：
 * - 所有路径参数都应为相对路径，依赖 VM 沙箱层按工作目录统一解析
 * - 这与 fs skill 的路径模型一致
 * - 绝对路径将被拒绝
 * - 进程 cwd 已在 VM 启动时设置为正确的工作目录，技能代码直接使用相对路径即可
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * ============================================
 * 内部服务层
 * ============================================
 */

function getHyperFormula() {
  if (!HyperFormula) {
    const hfModule = require('hyperformula');
    HyperFormula = hfModule.HyperFormula || hfModule.default || hfModule;
  }
  return HyperFormula;
}

/**
 * Path Service - 统一路径处理
 * 
 * 安全说明：
 * - 只接受相对路径，不接受绝对路径
 * - 规范化路径后拒绝任何路径遍历尝试（包含 ..）
 * - 使用 path.normalize() 处理路径归一化
 */
function resolvePath(relativePath) {
  // 拒绝绝对路径
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute path not allowed: ${relativePath}. Use relative path instead.`);
  }
  
  // 规范化路径（处理 ./, ../, 多重路径分隔符等）
  const normalizedPath = path.normalize(relativePath);
  
  // 检查是否存在路径遍历尝试
  // path.normalize 会将 ../ 解析为实际路径，但我们需要检测是否试图跳出基础目录
  // 由于 skill 的 cwd 已在 VM 启动时设置为工作目录，我们只需要检查归一化后的路径
  // 如果路径包含 .. 且不是简单的单点路径，说明有问题
  const pathParts = normalizedPath.split(path.sep);
  let hasPathTraversal = false;
  for (const part of pathParts) {
    if (part === '..') {
      hasPathTraversal = true;
      break;
    }
  }
  
  if (hasPathTraversal) {
    throw new Error(`Path traversal not allowed: ${relativePath}. Relative paths must stay within working directory.`);
  }
  
  return normalizedPath;
}

function readExcelFile(filePath) {
  return fs.readFileSync(resolvePath(filePath));
}

function saveExcelFile(filePath, buffer) {
  const resolvedPath = resolvePath(filePath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolvedPath, buffer);
}

/**
 * Workbook Service - 统一工作簿操作
 */
async function createWorkbook(options = {}) {
  const { loadFile } = options;
  const workbook = new ExcelJS.Workbook();
  if (loadFile) {
    try {
      await workbook.xlsx.load(readExcelFile(loadFile));
    } catch (e) {
      // 文件不存在，创建新的工作簿
    }
  }
  return workbook;
}

async function saveWorkbook(workbook, filePath) {
  const buffer = await workbook.xlsx.writeBuffer();
  saveExcelFile(filePath, Buffer.from(buffer));
  return buffer;
}

/**
 * Formula Service - 统一公式处理
 * 
 * 返回结构说明：
 * - 成功计算：{ formula, result, error: null }
 * - 计算失败：{ formula, result: null, error: "错误信息" }
 * - 结果为空：{ formula, result: null, error: null }
 */
function createFormulaEngine(sheetName, data) {
  const hf = getHyperFormula().buildFromSheets({ [sheetName]: data }, { licenseKey: 'gpl-v3' });
  const sheetId = hf.getSheetId(sheetName);
  return { hf, sheetId };
}

function evaluateFormula(sheetName, data, formula, row, col) {
  const { hf, sheetId } = createFormulaEngine(sheetName, data);
  try {
    return { value: hf.getCellValue({ sheet: sheetId, col, row }), error: null };
  } catch (e) {
    return { value: null, error: e.message };
  } finally {
    hf.destroy();
  }
}

function buildFormulaCell(sheetName, data, formula, row, col) {
  const fStr = formula.startsWith('=') ? formula.substring(1) : formula;
  const hfData = data.map(r => [...r]);
  while (hfData.length <= row) hfData.push([]);
  while (hfData[row].length <= col) hfData[row].push(null);
  hfData[row][col] = '=' + fStr;
  try {
    const result = evaluateFormula(sheetName, hfData, fStr, row, col);
    return { formula: fStr, result: result.value, error: result.error };
  } catch (e) {
    return { formula: fStr, result: null, error: e.message };
  }
}

/**
 * Cell/Range Utilities
 */
function colLetterToNumber(colStr) {
  let num = 0;
  for (let i = 0; i < colStr.length; i++) num = num * 26 + (colStr.charCodeAt(i) - 64);
  return num;
}

function decodeCell(cellAddress) {
  const match = cellAddress.match(/^([A-Z]+)(\d+)$/i);
  if (!match) throw new Error('Invalid cell address: ' + cellAddress);
  return { col: colLetterToNumber(match[1].toUpperCase()) - 1, row: parseInt(match[2], 10) - 1 };
}

function encodeCell(cell) {
  let num = cell.col + 1, result = '';
  while (num > 0) { const r = (num - 1) % 26; result = String.fromCharCode(65 + r) + result; num = Math.floor((num - 1) / 26); }
  return result + (cell.row + 1);
}

function parseRange(rangeStr) {
  const parts = rangeStr.split(':');
  if (parts.length !== 2) throw new Error('Invalid range format, expected A1:B2 style');
  const start = decodeCell(parts[0].toUpperCase());
  const end = decodeCell(parts[1].toUpperCase());
  return { start, end };
}

/**
 * Sheet Data Mapper - 统一数据转换
 */
function sheetToAoA(worksheet, range) {
  const result = [];
  if (!worksheet || !worksheet.rowCount) return result;
  if (range) {
    const { start, end } = parseRange(range);
    const actualRowCount = worksheet.rowCount || 0;
    const actualColCount = worksheet.columnCount || 0;
    const maxRow = Math.min(end.row, actualRowCount - 1);
    const maxCol = Math.min(end.col, actualColCount - 1);
    if (start.row > maxRow || start.col > maxCol) return result;
    for (let r = start.row; r <= maxRow; r++) {
      const rowData = [];
      for (let c = start.col; c <= maxCol; c++) {
        rowData.push(worksheet.getCell(r + 1, c + 1).value);
      }
      result.push(rowData);
    }
    return result;
  }
  worksheet.eachRow((row) => {
    const rowData = [];
    row.eachCell((cell) => { rowData[cell.col - 1] = cell.value; });
    result[row.number - 1] = rowData;
  });
  return result;
}

function sheetToJsonObj(worksheet) {
  const aoa = sheetToAoA(worksheet);
  if (aoa.length === 0) return [];
  const headers = aoa[0] || [];
  const result = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = {};
    const rowData = aoa[i] || [];
    for (let j = 0; j < headers.length; j++) row[headers[j] || 'col' + (j + 1)] = rowData[j] !== undefined ? rowData[j] : null;
    result.push(row);
  }
  return result;
}

function aoaToSheet(worksheet, data) {
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    if (!row || !Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) if (row[c] !== null && row[c] !== undefined) worksheet.getCell(r + 1, c + 1).value = row[c];
  }
}

function jsonToSheet(worksheet, data) {
  if (!data || !Array.isArray(data) || data.length === 0) return;
  const headers = Object.keys(data[0]);
  for (let c = 0; c < headers.length; c++) worksheet.getCell(1, c + 1).value = headers[c];
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      const v = data[r][headers[c]];
      if (v !== null && v !== undefined) worksheet.getCell(r + 2, c + 1).value = v;
    }
  }
}

/**
 * ============================================
 * 工具实现层
 * ============================================
 */

async function excelRead(params) {
  const { path: filePath, scope = 'workbook', sheet, cell, includeData, header, range } = params;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readExcelFile(filePath));
  
  if (scope === 'workbook') {
    const result = { success: true, sheetNames: workbook.worksheets.map(ws => ws.name), sheetCount: workbook.worksheets.length, properties: {} };
    if (includeData) {
      result.sheets = {};
      for (const ws of workbook.worksheets) result.sheets[ws.name] = { range: range || '', data: sheetToAoA(ws, range) };
    }
    return result;
  }
  
  if (scope === 'sheet') {
    const sheetName = sheet || workbook.worksheets[0]?.name;
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) throw new Error('Sheet not found: ' + sheetName);
    const data = sheetToAoA(worksheet, range);
    if (header === 'json') {
      const headers = data[0] || [];
      const rows = [];
      for (let i = 1; i < data.length; i++) {
        const row = {};
        const rowData = data[i] || [];
        for (let j = 0; j < headers.length; j++) row[headers[j] || 'col' + (j + 1)] = rowData[j] !== undefined ? rowData[j] : null;
        rows.push(row);
      }
      return { success: true, sheetName, range: range || '', data: rows };
    }
    return { success: true, sheetName, range: range || '', data };
  }
  
  if (scope === 'cell') {
    if (!cell) throw new Error('Cell reference required');
    const sheetName = sheet || workbook.worksheets[0]?.name;
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) throw new Error('Sheet not found');
    const ref = decodeCell(cell.toUpperCase());
    const c = worksheet.getCell(ref.row + 1, ref.col + 1);
    if (!c.value) return { success: true, cell: cell.toUpperCase(), value: null, type: 'z', formula: null };
    const val = c.value;
    if (typeof val === 'object' && val.formula) return { success: true, cell: cell.toUpperCase(), value: val.result, type: 'f', formula: val.formula };
    return { success: true, cell: cell.toUpperCase(), value: val, type: typeof val === 'number' ? 'n' : typeof val === 'boolean' ? 'b' : 's', formula: null };
  }
  
  throw new Error('Invalid scope');
}

async function excelWrite(params) {
  const { path: filePath, scope = 'workbook', sheet, cell, value, formula, data, mode = 'overwrite', startCell = 'A1', sheets, properties } = params;
  
  if (scope === 'workbook') {
    const workbook = new ExcelJS.Workbook();
    if (properties) { if (properties.title) workbook.title = properties.title; if (properties.author) workbook.author = properties.author; }
    for (const sd of (sheets || [])) {
      const ws = workbook.addWorksheet(sd.name || 'Sheet' + (workbook.worksheets.length + 1));
      if (sd.headers) aoaToSheet(ws, [sd.headers, ...(sd.data || [])]);
      else aoaToSheet(ws, sd.data || []);
    }
    if (!sheets || sheets.length === 0) workbook.addWorksheet('Sheet1');
    await saveWorkbook(workbook, filePath);
    return { success: true, path: resolvePath(filePath), sheetCount: workbook.worksheets.length, sheetNames: workbook.worksheets.map(ws => ws.name) };
  }
  
  if (scope === 'sheet') {
    let workbook;
    const targetSheetName = sheet || 'Sheet1';
    try {
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(readExcelFile(filePath));
    } catch (e) {
      workbook = new ExcelJS.Workbook();
    }
    let worksheet = workbook.getWorksheet(targetSheetName);
    if (!worksheet) {
      worksheet = workbook.addWorksheet(targetSheetName);
    }
    const sheetName = targetSheetName;
    if (mode === 'overwrite') {
      // 安全方式清空工作表：移除旧工作表并在相同位置创建新的
      // 避免使用 worksheet._rows 等私有字段
      // 注意：ExcelJS addWorksheet 第二个参数是 options 对象而非索引，
      // 需要通过 orderNo 手动恢复工作表位置
      const oldOrderNo = worksheet.orderNo;
      workbook.removeWorksheet(worksheet);
      worksheet = workbook.addWorksheet(sheetName);
      // 恢复工作表在原位置的排序
      if (oldOrderNo !== undefined) {
        worksheet.orderNo = oldOrderNo;
      }
      
      const formulaCells = [];
      for (let r = 0; r < (data || []).length; r++) {
        const row = data[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (typeof row[c] === 'string' && row[c].startsWith('=')) {
            formulaCells.push({ r, c, f: row[c] });
          } else if (row[c] !== null && row[c] !== undefined) {
            worksheet.getCell(r + 1, c + 1).value = row[c];
          }
        }
      }
      if (formulaCells.length > 0) {
        const hfData = sheetToAoA(worksheet);
        for (const fc of formulaCells) {
          try {
            const result = buildFormulaCell(sheetName, hfData, fc.f, fc.r, fc.c);
            worksheet.getCell(fc.r + 1, fc.c + 1).value = result;
          } catch (e) {
            const fStr = fc.f.startsWith('=') ? fc.f.substring(1) : fc.f;
            worksheet.getCell(fc.r + 1, fc.c + 1).value = { formula: fStr, result: null, error: e.message };
          }
        }
      }
    } else if (mode === 'append') {
      const existing = sheetToAoA(worksheet);
      const startRow = existing.length;
      const formulaCells = [];
      for (let r = 0; r < (data || []).length; r++) {
        const row = data[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (typeof row[c] === 'string' && row[c].startsWith('=')) {
            formulaCells.push({ r: startRow + r, c, f: row[c] });
          } else if (row[c] !== null && row[c] !== undefined) {
            worksheet.getCell(startRow + r + 1, c + 1).value = row[c];
          }
        }
      }
      if (formulaCells.length > 0) {
        const hfData = sheetToAoA(worksheet);
        for (const fc of formulaCells) {
          try {
            const result = buildFormulaCell(sheetName, hfData, fc.f, fc.r, fc.c);
            worksheet.getCell(fc.r + 1, fc.c + 1).value = result;
          } catch (e) {
            const fStr = fc.f.startsWith('=') ? fc.f.substring(1) : fc.f;
            worksheet.getCell(fc.r + 1, fc.c + 1).value = { formula: fStr, result: null, error: e.message };
          }
        }
      } else {
        aoaToSheet(worksheet, [...existing, ...(data || [])]);
      }
    } else if (mode === 'insert') {
      const ref = decodeCell(startCell);
      for (let r = 0; r < (data || []).length; r++) {
        const row = data[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) if (row[c] !== null && row[c] !== undefined) worksheet.getCell(ref.row + r + 1, ref.col + c + 1).value = row[c];
      }
    }
    await saveWorkbook(workbook, filePath);
    return { success: true, path: resolvePath(filePath), sheetName, mode };
  }
  
  if (scope === 'cell') {
    if (!cell) throw new Error('Cell reference required');
    let workbook;
    try { workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(readExcelFile(filePath)); } catch (e) { workbook = new ExcelJS.Workbook(); }
    const sheetName = sheet || 'Sheet1';
    let worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) worksheet = workbook.addWorksheet(sheetName);
    const ref = decodeCell(cell.toUpperCase());
    const c = worksheet.getCell(ref.row + 1, ref.col + 1);
    if (formula) {
      const hfData = sheetToAoA(worksheet);
      c.value = buildFormulaCell(sheetName, hfData, formula, ref.row, ref.col);
    } else c.value = value;
    await saveWorkbook(workbook, filePath);
    return { success: true, path: resolvePath(filePath), cell: cell.toUpperCase(), value: formula || value };
  }
  
  throw new Error('Invalid scope');
}

async function excelSheet(params) {
  const { path: filePath, action, name, sheet, newName, sourceSheet, targetSheet, targetFile, data } = params;
  const buffer = readExcelFile(filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  
  if (action === 'add') {
    if (!name) throw new Error('Sheet name required');
    if (workbook.getWorksheet(name)) throw new Error('Sheet exists');
    const ws = workbook.addWorksheet(name);
    if (data && data.length > 0) aoaToSheet(ws, data);
    await saveWorkbook(workbook, filePath);
    return { success: true, path: resolvePath(filePath), sheetName: name };
  }
  
  if (action === 'delete') {
    if (!sheet) throw new Error('Sheet name required');
    const ws = workbook.getWorksheet(sheet);
    if (!ws) throw new Error('Sheet not found');
    if (workbook.worksheets.length === 1) throw new Error('Cannot delete last sheet');
    workbook.removeWorksheet(ws.id);
    await saveWorkbook(workbook, filePath);
    return { success: true, path: resolvePath(filePath), deletedSheet: sheet, remainingSheets: workbook.worksheets.map(ws => ws.name) };
  }
  
  if (action === 'rename') {
    if (!sheet || !newName) throw new Error('Old and new name required');
    const ws = workbook.getWorksheet(sheet);
    if (!ws) throw new Error('Sheet not found');
    if (workbook.getWorksheet(newName)) throw new Error('New name exists');
    ws.name = newName;
    await saveWorkbook(workbook, filePath);
    return { success: true, path: resolvePath(filePath), oldName: sheet, newName };
  }
  
  if (action === 'copy') {
    const src = sourceSheet || sheet;
    if (!src || !targetSheet) throw new Error('Source and target required');
    const srcWs = workbook.getWorksheet(src);
    if (!srcWs) throw new Error('Source not found');
    if (targetFile) {
      let targetWb;
      try { targetWb = new ExcelJS.Workbook(); await targetWb.xlsx.load(readExcelFile(targetFile)); } catch (e) { targetWb = new ExcelJS.Workbook(); }
      const tgtWs = targetWb.addWorksheet(targetSheet);
      srcWs.eachRow((row) => row.eachCell((c) => tgtWs.getCell(c.row, c.col).value = c.value));
      await saveWorkbook(targetWb, targetFile);
      return { success: true, sourceFile: resolvePath(filePath), targetFile: resolvePath(targetFile), sourceSheet: src, targetSheet };
    }
    if (workbook.getWorksheet(targetSheet)) throw new Error('Target exists');
    const tgtWs = workbook.addWorksheet(targetSheet);
    srcWs.eachRow((row) => row.eachCell((c) => tgtWs.getCell(c.row, c.col).value = c.value));
    await saveWorkbook(workbook, filePath);
    return { success: true, path: resolvePath(filePath), sourceSheet: src, targetSheet };
  }
  
  throw new Error('Invalid action');
}

async function excelFormat(params) {
  const { path: filePath, type, sheet, columns, cells, style } = params;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readExcelFile(filePath));
  const sheetName = sheet || workbook.worksheets[0]?.name;
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw new Error('Sheet not found');
  
  if (type === 'column') {
    if (!columns) throw new Error('Columns required');
    for (const col of columns) {
      let colNum;
      if (typeof col.column === 'string') colNum = colLetterToNumber(col.column.toUpperCase());
      else colNum = col.column || columns.indexOf(col) + 1;
      worksheet.getColumn(colNum).width = col.width;
    }
    await saveWorkbook(workbook, filePath);
    return { success: true, path: resolvePath(filePath), sheetName, columnsUpdated: columns.length };
  }
  
  if (type === 'cell') {
    if (!cells) throw new Error('Cells required');
    for (const ref of cells) {
      const c = worksheet.getCell(ref);
      if (style.font) c.font = style.font;
      if (style.fill) c.fill = style.fill;
      if (style.alignment) c.alignment = style.alignment;
      if (style.border) c.border = style.border;
      if (style.numFmt) c.numFmt = style.numFmt;
    }
    await saveWorkbook(workbook, filePath);
    return { success: true, path: resolvePath(filePath), sheetName, cellsUpdated: cells.length };
  }
  
  throw new Error('Invalid type');
}

async function excelQuery(params) {
  const { path: filePath, action, sheet, column, condition, value, order = 'asc', output, query, columns } = params;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readExcelFile(filePath));
  const sheetName = sheet || workbook.worksheets[0]?.name;
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw new Error('Sheet not found');
  const data = sheetToJsonObj(worksheet);
  
  if (action === 'filter') {
    if (data.length === 0) return { success: true, data: [], count: 0 };
    const col = column || Object.keys(data[0])[0];
    const filtered = data.filter(row => {
      const cv = row[col];
      switch (condition) {
        case 'equals': case '==': return cv == value;
        case 'not_equals': case '!=': return cv != value;
        case 'greater': case '>': return cv > value;
        case 'greater_equals': case '>=': return cv >= value;
        case 'less': case '<': return cv < value;
        case 'less_equals': case '<=': return cv <= value;
        case 'contains': return String(cv).includes(value);
        case 'starts_with': return String(cv).startsWith(value);
        case 'ends_with': return String(cv).endsWith(value);
        case 'is_empty': return cv === null || cv === undefined || cv === '';
        case 'is_not_empty': return cv !== null && cv !== undefined && cv !== '';
        default: return true;
      }
    });
    return { success: true, sheetName, column: col, condition, data: filtered, count: filtered.length };
  }
  
  if (action === 'sort') {
    if (data.length === 0) return { success: true, data: [], count: 0 };
    const col = column || Object.keys(data[0])[0];
    data.sort((a, b) => {
      const av = a[col], bv = b[col];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return order === 'desc' ? -cmp : cmp;
    });
    if (output) {
      const newWb = new ExcelJS.Workbook();
      const newWs = newWb.addWorksheet(sheetName);
      jsonToSheet(newWs, data);
      await saveWorkbook(newWb, output);
      return { success: true, path: resolvePath(output), sheetName, column: col, order, count: data.length };
    }
    return { success: true, sheetName, column: col, order, data, count: data.length };
  }
  
  if (action === 'find') {
    const searchCols = columns || Object.keys(data[0] || {});
    const q = String(query).toLowerCase();
    const results = data.filter(row => searchCols.some(col => row[col] !== null && row[col] !== undefined && String(row[col]).toLowerCase().includes(q))).map((row, i) => ({ rowIndex: i + 1, ...row }));
    return { success: true, sheetName, query, columns: searchCols, results, count: results.length };
  }
  
  throw new Error('Invalid action');
}

async function excelConvert(params) {
  const { path: filePath, format, direction, sheet, output, delimiter = ',', data } = params;
  
  if (format === 'json' && direction === 'to') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(readExcelFile(filePath));
    const sheetName = sheet || workbook.worksheets[0]?.name;
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) throw new Error('Sheet not found');
    const jsonData = sheetToJsonObj(worksheet);
    if (output) { fs.writeFileSync(resolvePath(output), JSON.stringify(jsonData, null, 2)); return { success: true, path: resolvePath(output), count: jsonData.length }; }
    return { success: true, sheetName, data: jsonData, count: jsonData.length };
  }
  
  if (format === 'json' && direction === 'from') {
    if (!data) throw new Error('Data required');
    const sheetName = sheet || 'Sheet1';
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);
    const isAoA = data.length > 0 && Array.isArray(data[0]);
    if (isAoA) {
      const formulaCells = [];
      for (let r = 0; r < data.length; r++) {
        const row = data[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (typeof row[c] === 'string' && row[c].startsWith('=')) formulaCells.push({ r, c, f: row[c] });
          else if (row[c] !== null && row[c] !== undefined) worksheet.getCell(r + 1, c + 1).value = row[c];
        }
      }
      if (formulaCells.length > 0) {
        const hfData = data.map(r => [...r]);
        for (const fc of formulaCells) {
          try {
            const result = buildFormulaCell(sheetName, hfData, fc.f, fc.r, fc.c);
            worksheet.getCell(fc.r + 1, fc.c + 1).value = result;
          } catch (e) {
            const fStr = fc.f.startsWith('=') ? fc.f.substring(1) : fc.f;
            worksheet.getCell(fc.r + 1, fc.c + 1).value = { formula: fStr, result: null, error: e.message };
          }
        }
      }
      await saveWorkbook(workbook, filePath);
      return { success: true, path: resolvePath(filePath), sheetName, rowCount: data.length, formulaCount: formulaCells.length };
    }
    jsonToSheet(worksheet, data);
    await saveWorkbook(workbook, filePath);
    return { success: true, path: resolvePath(filePath), sheetName, rowCount: data.length, formulaCount: 0 };
  }
  
  if (format === 'csv' && direction === 'to') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(readExcelFile(filePath));
    const worksheet = workbook.getWorksheet(sheet || workbook.worksheets[0]?.name);
    if (!worksheet) throw new Error('Sheet not found');
    const aoa = sheetToAoA(worksheet);
    const csv = aoa.map(row => row.map(c => {
      if (c === null || c === undefined) return '';
      const s = String(c);
      if (s.includes(delimiter) || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(delimiter)).join('\n');
    if (output) { fs.writeFileSync(resolvePath(output), csv); return { success: true, path: resolvePath(output) }; }
    return { success: true, sheetName, csv };
  }
  
  if (format === 'csv' && direction === 'from') {
    const csv = readExcelFile(filePath).toString();
    const lines = csv.split('\n');
    const aoa = lines.map(line => {
      const result = []; let cur = ''; let inQ = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"' && (i === 0 || line[i-1] !== '\\')) inQ = !inQ;
        else if (line[i] === delimiter && !inQ) { result.push(cur); cur = ''; }
        else cur += line[i];
      }
      result.push(cur);
      return result;
    });
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheet || 'Sheet1');
    aoaToSheet(worksheet, aoa);
    await saveWorkbook(workbook, output);
    return { success: true, path: resolvePath(output), sheetName: sheet || 'Sheet1' };
  }
  
  throw new Error('Invalid format/direction');
}

async function excelCalc(params) {
  const { path: filePath, sheet } = params;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readExcelFile(filePath));
  const sheetName = sheet || workbook.worksheets[0]?.name;
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw new Error('Sheet not found');
  
  const formulas = [];
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
        formulas.push({ cell: encodeCell({ row: cell.row - 1, col: cell.col - 1 }), row: cell.row - 1, col: cell.col - 1, formula: cell.value.formula });
      }
    });
  });
  
  if (formulas.length > 0) {
    const hfData = sheetToAoA(worksheet);
    for (const f of formulas) {
      while (hfData.length <= f.row) hfData.push([]);
      while (hfData[f.row].length <= f.col) hfData[f.row].push(null);
      hfData[f.row][f.col] = '=' + f.formula;
    }
    const { hf, sheetId } = createFormulaEngine(sheetName, hfData);
    for (const f of formulas) {
      try {
        f.result = hf.getCellValue({ sheet: sheetId, col: f.col, row: f.row });
      } catch (e) {
        f.result = null;
        f.error = e.message;
      }
      delete f.row;
      delete f.col;
    }
    hf.destroy();
  }
  
  return { success: true, sheetName, formulaCount: formulas.length, formulas };
}

async function execute(toolName, params) {
  switch (toolName) {
    case 'excel_read': return excelRead(params);
    case 'excel_write': return excelWrite(params);
    case 'excel_sheet': return excelSheet(params);
    case 'excel_format': return excelFormat(params);
    case 'excel_query': return excelQuery(params);
    case 'excel_convert': return excelConvert(params);
    case 'excel_calc': return excelCalc(params);
    default: throw new Error('Unknown tool: ' + toolName);
  }
}

function getTools() {
  return [
    { name: 'excel_read', description: '读取Excel文件', parameters: { type: 'object', properties: { path: { type: 'string' }, scope: { type: 'string', enum: ['workbook', 'sheet', 'cell'] }, sheet: { type: 'string' }, cell: { type: 'string' }, includeData: { type: 'boolean' }, header: { type: 'string' }, range: { type: 'string', description: '单元格范围，如 A1:C10' } }, required: ['path'] } },
    { name: 'excel_write', description: '写入Excel文件', parameters: { type: 'object', properties: { path: { type: 'string' }, scope: { type: 'string', enum: ['workbook', 'sheet', 'cell'] }, sheet: { type: 'string' }, cell: { type: 'string' }, value: { type: 'string' }, formula: { type: 'string' }, data: { type: 'array' }, mode: { type: 'string', enum: ['overwrite', 'append', 'insert'] }, startCell: { type: 'string' }, sheets: { type: 'array' }, properties: { type: 'object' } }, required: ['path'] } },
    { name: 'excel_sheet', description: '工作表管理', parameters: { type: 'object', properties: { path: { type: 'string' }, action: { type: 'string', enum: ['add', 'delete', 'rename', 'copy'] }, name: { type: 'string' }, sheet: { type: 'string' }, newName: { type: 'string' }, sourceSheet: { type: 'string' }, targetSheet: { type: 'string' }, targetFile: { type: 'string' }, data: { type: 'array' } }, required: ['path', 'action'] } },
    { name: 'excel_format', description: '格式化设置', parameters: { type: 'object', properties: { path: { type: 'string' }, type: { type: 'string', enum: ['column', 'cell'] }, sheet: { type: 'string' }, columns: { type: 'array' }, cells: { type: 'array' }, style: { type: 'object' } }, required: ['path', 'type'] } },
    { name: 'excel_query', description: '数据查询', parameters: { type: 'object', properties: { path: { type: 'string' }, action: { type: 'string', enum: ['filter', 'sort', 'find'] }, sheet: { type: 'string' }, column: { type: 'string' }, condition: { type: 'string' }, value: { type: 'string' }, order: { type: 'string', enum: ['asc', 'desc'] }, output: { type: 'string' }, query: { type: 'string' }, columns: { type: 'array' } }, required: ['path', 'action'] } },
    { name: 'excel_convert', description: '格式转换', parameters: { type: 'object', properties: { path: { type: 'string' }, format: { type: 'string', enum: ['json', 'csv'] }, direction: { type: 'string', enum: ['to', 'from'] }, sheet: { type: 'string' }, output: { type: 'string' }, delimiter: { type: 'string' }, data: { type: 'array' } }, required: ['path', 'format', 'direction'] } },
    { name: 'excel_calc', description: '公式计算', parameters: { type: 'object', properties: { path: { type: 'string' }, sheet: { type: 'string' } }, required: ['path'] } }
  ];
}

module.exports = { execute, getTools };