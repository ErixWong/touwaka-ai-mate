/**
 * XLSX Skill - Excel 文件处理技能 (ExcelJS 版本)
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

let HyperFormula = null;

function getHyperFormula() {
  if (!HyperFormula) {
    const hfModule = require('hyperformula');
    HyperFormula = hfModule.HyperFormula || hfModule.default || hfModule;
  }
  return HyperFormula;
}

const IS_ADMIN = process.env.IS_ADMIN === 'true';
const IS_SKILL_CREATOR = process.env.IS_SKILL_CREATOR === 'true';
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
const USER_ID = process.env.USER_ID || 'default';
const USER_WORK_DIR = process.env.WORKING_DIRECTORY
  ? path.join(DATA_BASE_PATH, process.env.WORKING_DIRECTORY)
  : path.join(DATA_BASE_PATH, 'work', USER_ID);

let ALLOWED_BASE_PATHS;
if (IS_ADMIN) ALLOWED_BASE_PATHS = [DATA_BASE_PATH];
else if (IS_SKILL_CREATOR) ALLOWED_BASE_PATHS = [path.join(DATA_BASE_PATH, 'skills'), path.join(DATA_BASE_PATH, 'work', USER_ID)];
else ALLOWED_BASE_PATHS = [USER_WORK_DIR];

function isPathAllowed(targetPath) {
  let resolved = path.resolve(targetPath);
  try { if (fs.existsSync(resolved)) resolved = fs.realpathSync(resolved); } catch (e) {}
  return ALLOWED_BASE_PATHS.some(basePath => {
    let resolvedBase = path.resolve(basePath);
    try { if (fs.existsSync(resolvedBase)) resolvedBase = fs.realpathSync(resolvedBase); } catch (e) {}
    return resolved.startsWith(resolvedBase);
  });
}

function resolvePath(relativePath) {
  if (path.isAbsolute(relativePath)) {
    if (!isPathAllowed(relativePath)) throw new Error('Path not allowed: ' + relativePath);
    return relativePath;
  }
  for (const basePath of ALLOWED_BASE_PATHS) {
    const resolved = path.join(basePath, relativePath);
    if (fs.existsSync(resolved) || isPathAllowed(resolved)) {
      if (!isPathAllowed(resolved)) throw new Error('Path not allowed: ' + resolved);
      return resolved;
    }
  }
  const defaultPath = path.join(ALLOWED_BASE_PATHS[0], relativePath);
  if (!isPathAllowed(defaultPath)) throw new Error('Path not allowed: ' + defaultPath);
  return defaultPath;
}

function readExcelFile(filePath) { return fs.readFileSync(resolvePath(filePath)); }
function saveExcelFile(filePath, buffer) {
  const resolvedPath = resolvePath(filePath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolvedPath, buffer);
}

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

function sheetToAoA(worksheet) {
  const result = [];
  if (!worksheet || !worksheet.rowCount) return result;
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

async function excelRead(params) {
  const { path: filePath, scope = 'workbook', sheet, cell, includeData, header } = params;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readExcelFile(filePath));
  
  if (scope === 'workbook') {
    const result = { success: true, sheetNames: workbook.worksheets.map(ws => ws.name), sheetCount: workbook.worksheets.length, properties: {} };
    if (includeData) {
      result.sheets = {};
      for (const ws of workbook.worksheets) result.sheets[ws.name] = { range: '', data: sheetToAoA(ws) };
    }
    return result;
  }
  
  if (scope === 'sheet') {
    const sheetName = sheet || workbook.worksheets[0]?.name;
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) throw new Error('Sheet not found: ' + sheetName);
    return { success: true, sheetName, range: '', data: header === 'json' ? sheetToJsonObj(worksheet) : sheetToAoA(worksheet) };
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
      const ws = workbook.addWorksheet(sd.name || 'Sheet1');
      if (sd.headers) aoaToSheet(ws, [sd.headers, ...(sd.data || [])]);
      else aoaToSheet(ws, sd.data || []);
    }
    if (!sheets || sheets.length === 0) workbook.addWorksheet('Sheet1');
    saveExcelFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
    return { success: true, path: resolvePath(filePath), sheetCount: workbook.worksheets.length, sheetNames: workbook.worksheets.map(ws => ws.name) };
  }
  
  if (scope === 'sheet') {
    let workbook;
    try { workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(readExcelFile(filePath)); } catch (e) { workbook = new ExcelJS.Workbook(); }
    const sheetName = sheet || 'Sheet1';
    let worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) worksheet = workbook.addWorksheet(sheetName);
    if (mode === 'overwrite') {
      worksheet.eachRow((row) => row.eachCell((c) => { if (c.row > 1 || c.col > 1) c.value = null; }));
      aoaToSheet(worksheet, data || []);
    } else if (mode === 'append') {
      const existing = sheetToAoA(worksheet);
      aoaToSheet(worksheet, [...existing, ...(data || [])]);
    } else if (mode === 'insert') {
      const ref = decodeCell(startCell);
      for (let r = 0; r < (data || []).length; r++) {
        const row = data[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) if (row[c] !== null && row[c] !== undefined) worksheet.getCell(ref.row + r + 1, ref.col + c + 1).value = row[c];
      }
    }
    saveExcelFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
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
      const fStr = formula.startsWith('=') ? formula.substring(1) : formula;
      try {
        const hfData = sheetToAoA(worksheet);
        while (hfData.length <= ref.row) hfData.push([]);
        while (hfData[ref.row].length <= ref.col) hfData[ref.row].push(null);
        hfData[ref.row][ref.col] = '=' + fStr;
        const hf = getHyperFormula().buildFromSheets({ [sheetName]: hfData }, { licenseKey: 'gpl-v3' });
        const sheetId = hf.getSheetId(sheetName);
        c.value = { formula: fStr, result: hf.getCellValue({ sheet: sheetId, col: ref.col, row: ref.row }) };
        hf.destroy();
      } catch (e) { c.value = { formula: fStr, result: 0 }; }
    } else c.value = value;
    saveExcelFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
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
    saveExcelFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
    return { success: true, path: resolvePath(filePath), sheetName: name };
  }
  
  if (action === 'delete') {
    if (!sheet) throw new Error('Sheet name required');
    const ws = workbook.getWorksheet(sheet);
    if (!ws) throw new Error('Sheet not found');
    if (workbook.worksheets.length === 1) throw new Error('Cannot delete last sheet');
    workbook.removeWorksheet(ws.id);
    saveExcelFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
    return { success: true, path: resolvePath(filePath), deletedSheet: sheet, remainingSheets: workbook.worksheets.map(ws => ws.name) };
  }
  
  if (action === 'rename') {
    if (!sheet || !newName) throw new Error('Old and new name required');
    const ws = workbook.getWorksheet(sheet);
    if (!ws) throw new Error('Sheet not found');
    if (workbook.getWorksheet(newName)) throw new Error('New name exists');
    ws.name = newName;
    saveExcelFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
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
      saveExcelFile(targetFile, Buffer.from(await targetWb.xlsx.writeBuffer()));
      return { success: true, sourceFile: resolvePath(filePath), targetFile: resolvePath(targetFile), sourceSheet: src, targetSheet };
    }
    if (workbook.getWorksheet(targetSheet)) throw new Error('Target exists');
    const tgtWs = workbook.addWorksheet(targetSheet);
    srcWs.eachRow((row) => row.eachCell((c) => tgtWs.getCell(c.row, c.col).value = c.value));
    saveExcelFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
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
    saveExcelFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
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
    saveExcelFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
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
      saveExcelFile(output, Buffer.from(await newWb.xlsx.writeBuffer()));
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
        try {
          const hfData = data.map(r => [...r]);
          const hf = getHyperFormula().buildFromSheets({ [sheetName]: hfData }, { licenseKey: 'gpl-v3' });
          const sheetId = hf.getSheetId(sheetName);
          for (const fc of formulaCells) {
            const fStr = fc.f.startsWith('=') ? fc.f.substring(1) : fc.f;
            worksheet.getCell(fc.r + 1, fc.c + 1).value = { formula: fStr, result: hf.getCellValue({ sheet: sheetId, col: fc.c, row: fc.r }) || 0 };
          }
          hf.destroy();
        } catch (e) {
          for (const fc of formulaCells) {
            const fStr = fc.f.startsWith('=') ? fc.f.substring(1) : fc.f;
            worksheet.getCell(fc.r + 1, fc.c + 1).value = { formula: fStr, result: 0 };
          }
        }
      }
      saveExcelFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
      return { success: true, path: resolvePath(filePath), sheetName, rowCount: data.length, formulaCount: formulaCells.length };
    }
    jsonToSheet(worksheet, data);
    saveExcelFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
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
    saveExcelFile(output, Buffer.from(await workbook.xlsx.writeBuffer()));
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
    try {
      const hf = getHyperFormula().buildFromSheets({ [sheetName]: hfData }, { licenseKey: 'gpl-v3' });
      const sheetId = hf.getSheetId(sheetName);
      for (const f of formulas) {
        try { f.value = hf.getCellValue({ sheet: sheetId, col: f.col, row: f.row }); }
        catch (e) { f.value = null; f.error = e.message; }
        delete f.row; delete f.col;
      }
      hf.destroy();
    } catch (e) {
      for (const f of formulas) { f.value = null; f.error = e.message; delete f.row; delete f.col; }
    }
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
    { name: 'excel_read', description: '读取Excel文件', parameters: { type: 'object', properties: { path: { type: 'string' }, scope: { type: 'string', enum: ['workbook', 'sheet', 'cell'] }, sheet: { type: 'string' }, cell: { type: 'string' }, includeData: { type: 'boolean' }, header: { type: 'string' } }, required: ['path'] } },
    { name: 'excel_write', description: '写入Excel文件', parameters: { type: 'object', properties: { path: { type: 'string' }, scope: { type: 'string', enum: ['workbook', 'sheet', 'cell'] }, sheet: { type: 'string' }, cell: { type: 'string' }, value: { type: 'string' }, formula: { type: 'string' }, data: { type: 'array' }, mode: { type: 'string', enum: ['overwrite', 'append', 'insert'] }, startCell: { type: 'string' }, sheets: { type: 'array' }, properties: { type: 'object' } }, required: ['path'] } },
    { name: 'excel_sheet', description: '工作表管理', parameters: { type: 'object', properties: { path: { type: 'string' }, action: { type: 'string', enum: ['add', 'delete', 'rename', 'copy'] }, name: { type: 'string' }, sheet: { type: 'string' }, newName: { type: 'string' }, sourceSheet: { type: 'string' }, targetSheet: { type: 'string' }, targetFile: { type: 'string' }, data: { type: 'array' } }, required: ['path', 'action'] } },
    { name: 'excel_format', description: '格式化设置', parameters: { type: 'object', properties: { path: { type: 'string' }, type: { type: 'string', enum: ['column', 'cell'] }, sheet: { type: 'string' }, columns: { type: 'array' }, cells: { type: 'array' }, style: { type: 'object' } }, required: ['path', 'type'] } },
    { name: 'excel_query', description: '数据查询', parameters: { type: 'object', properties: { path: { type: 'string' }, action: { type: 'string', enum: ['filter', 'sort', 'find'] }, sheet: { type: 'string' }, column: { type: 'string' }, condition: { type: 'string' }, value: { type: 'string' }, order: { type: 'string', enum: ['asc', 'desc'] }, output: { type: 'string' }, query: { type: 'string' }, columns: { type: 'array' } }, required: ['path', 'action'] } },
    { name: 'excel_convert', description: '格式转换', parameters: { type: 'object', properties: { path: { type: 'string' }, format: { type: 'string', enum: ['json', 'csv'] }, direction: { type: 'string', enum: ['to', 'from'] }, sheet: { type: 'string' }, output: { type: 'string' }, delimiter: { type: 'string' }, data: { type: 'array' } }, required: ['path', 'format', 'direction'] } },
    { name: 'excel_calc', description: '公式计算', parameters: { type: 'object', properties: { path: { type: 'string' }, sheet: { type: 'string' } }, required: ['path'] } }
  ];
}

module.exports = { execute, getTools };