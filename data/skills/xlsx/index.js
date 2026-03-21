/**
 * XLSX Skill - Excel 文件处理技能 (Node.js 版本)
 * 
 * 功能：
 * - 读取 Excel 文件（支持 .xlsx, .xls）
 * - 写入/创建 Excel 文件
 * - 编辑工作表
 * - 格式化单元格
 * - 公式计算（使用 HyperFormula）
 * - 图表支持（基础）
 * - 数据验证
 * - 条件格式
 * 
 * 依赖：
 * - xlsx: Excel 读写（项目已安装）
 * - exceljs: 高级功能
 * - hyperformula: 公式计算
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// 延迟加载可选依赖
let ExcelJS = null;
let HyperFormula = null;

function getExcelJS() {
  if (!ExcelJS) {
    ExcelJS = require('exceljs');
  }
  return ExcelJS;
}

function getHyperFormula() {
  if (!HyperFormula) {
    HyperFormula = require('hyperformula');
  }
  return HyperFormula;
}

// 用户角色检查
const IS_ADMIN = process.env.IS_ADMIN === 'true';

// 允许的基础路径
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
const USER_ID = process.env.USER_ID || 'default';
const USER_WORK_DIR = process.env.WORKING_DIRECTORY
  ? path.join(DATA_BASE_PATH, process.env.WORKING_DIRECTORY)
  : path.join(DATA_BASE_PATH, 'work', USER_ID);

const PROJECT_ROOT = process.cwd();
const ALLOWED_BASE_PATHS = IS_ADMIN
  ? [PROJECT_ROOT, DATA_BASE_PATH]
  : [USER_WORK_DIR];

/**
 * 检查路径是否被允许
 */
function isPathAllowed(targetPath) {
  let resolved = path.resolve(targetPath);
  
  try {
    if (fs.existsSync(resolved)) {
      resolved = fs.realpathSync(resolved);
    }
  } catch (e) {}
  
  return ALLOWED_BASE_PATHS.some(basePath => {
    let resolvedBase = path.resolve(basePath);
    try {
      if (fs.existsSync(resolvedBase)) {
        resolvedBase = fs.realpathSync(resolvedBase);
      }
    } catch (e) {}
    return resolved.startsWith(resolvedBase);
  });
}

/**
 * 解析路径（支持相对路径）
 */
function resolvePath(relativePath) {
  if (path.isAbsolute(relativePath)) {
    if (!isPathAllowed(relativePath)) {
      throw new Error(`Path not allowed: ${relativePath}`);
    }
    return relativePath;
  }
  
  for (const basePath of ALLOWED_BASE_PATHS) {
    const resolved = path.join(basePath, relativePath);
    if (fs.existsSync(resolved) || isPathAllowed(resolved)) {
      if (!isPathAllowed(resolved)) {
        throw new Error(`Path not allowed: ${resolved}`);
      }
      return resolved;
    }
  }
  
  const defaultPath = path.join(ALLOWED_BASE_PATHS[0], relativePath);
  if (!isPathAllowed(defaultPath)) {
    throw new Error(`Path not allowed: ${defaultPath}`);
  }
  return defaultPath;
}

/**
 * 读取 Excel 文件
 */
function readExcelFile(filePath) {
  const resolvedPath = resolvePath(filePath);
  return fs.readFileSync(resolvedPath);
}

/**
 * 保存 Excel 文件
 */
function saveExcelFile(filePath, buffer) {
  const resolvedPath = resolvePath(filePath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolvedPath, buffer);
}

// ==================== 基础操作 ====================

/**
 * 读取 Excel 文件信息
 */
async function readWorkbook(params) {
  const { path: filePath, includeData = false } = params;
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  const result = {
    success: true,
    sheetNames: workbook.SheetNames,
    sheetCount: workbook.SheetNames.length,
    properties: workbook.Props || {}
  };
  
  if (includeData) {
    result.sheets = {};
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      result.sheets[sheetName] = {
        range: sheet['!ref'],
        data: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
      };
    }
  }
  
  return result;
}

/**
 * 读取工作表数据
 */
async function readSheet(params) {
  const { path: filePath, sheet, range, header = 1 } = params;
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  const sheetName = sheet || workbook.SheetNames[0];
  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
  }
  
  const worksheet = workbook.Sheets[sheetName];
  
  const options = { defval: null };
  if (range) {
    options.range = range;
  }
  
  let data;
  if (header === 'json' || header === 'object') {
    data = XLSX.utils.sheet_to_json(worksheet, options);
  } else {
    data = XLSX.utils.sheet_to_json(worksheet, { header: 1, ...options });
  }
  
  return {
    success: true,
    sheetName,
    range: worksheet['!ref'],
    data
  };
}

/**
 * 读取单元格
 */
async function readCell(params) {
  const { path: filePath, sheet, cell } = params;
  
  if (!cell) {
    throw new Error('Cell reference is required (e.g., "A1")');
  }
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  const sheetName = sheet || workbook.SheetNames[0];
  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  const worksheet = workbook.Sheets[sheetName];
  const cellAddress = cell.toUpperCase();
  const cellData = worksheet[cellAddress];
  
  if (!cellData) {
    return { success: true, cell: cellAddress, value: null, type: 'empty' };
  }
  
  return {
    success: true,
    cell: cellAddress,
    value: cellData.v,
    type: cellData.t,
    formatted: cellData.w,
    formula: cellData.f
  };
}

// ==================== 写入操作 ====================

/**
 * 创建新工作簿
 */
async function createWorkbook(params) {
  const { output, sheets = [], properties = {} } = params;
  
  const workbook = XLSX.utils.book_new();
  
  if (properties.title) workbook.Props = { ...workbook.Props, Title: properties.title };
  if (properties.author) workbook.Props = { ...workbook.Props, Author: properties.author };
  if (properties.subject) workbook.Props = { ...workbook.Props, Subject: properties.subject };
  
  for (const sheetData of sheets) {
    const { name = 'Sheet1', data = [], headers } = sheetData;
    
    let wsData = data;
    if (headers && Array.isArray(headers)) {
      wsData = [headers, ...data];
    }
    
    const worksheet = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  }
  
  if (sheets.length === 0) {
    const worksheet = XLSX.utils.aoa_to_sheet([[]]);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  }
  
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  saveExcelFile(output, buffer);
  
  return {
    success: true,
    path: resolvePath(output),
    sheetCount: workbook.SheetNames.length,
    sheetNames: workbook.SheetNames
  };
}

/**
 * 写入数据到工作表
 */
async function writeSheet(params) {
  const { path: filePath, sheet, data, mode = 'overwrite', startCell = 'A1' } = params;
  
  let workbook;
  let buffer;
  
  try {
    buffer = readExcelFile(filePath);
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    workbook = XLSX.utils.book_new();
  }
  
  const sheetName = sheet || 'Sheet1';
  let worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    worksheet = XLSX.utils.aoa_to_sheet([[]]);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }
  
  if (mode === 'overwrite') {
    const newSheet = XLSX.utils.aoa_to_sheet(data);
    workbook.Sheets[sheetName] = newSheet;
  } else if (mode === 'append') {
    const existingData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    const combinedData = [...existingData, ...data];
    const newSheet = XLSX.utils.aoa_to_sheet(combinedData);
    workbook.Sheets[sheetName] = newSheet;
  } else if (mode === 'insert') {
    XLSX.utils.sheet_add_aoa(worksheet, data, { origin: startCell });
  }
  
  const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  saveExcelFile(filePath, outputBuffer);
  
  return {
    success: true,
    path: resolvePath(filePath),
    sheetName,
    mode
  };
}

/**
 * 写入单元格
 */
async function writeCell(params) {
  const { path: filePath, sheet, cell, value, formula } = params;
  
  if (!cell) {
    throw new Error('Cell reference is required');
  }
  
  let buffer;
  let workbook;
  
  try {
    buffer = readExcelFile(filePath);
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    workbook = XLSX.utils.book_new();
  }
  
  const sheetName = sheet || 'Sheet1';
  let worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    worksheet = XLSX.utils.aoa_to_sheet([[]]);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }
  
  const cellAddress = cell.toUpperCase();
  
  if (!worksheet[cellAddress]) {
    worksheet[cellAddress] = { t: 'n', v: 0 };
  }
  
  if (formula) {
    worksheet[cellAddress].f = formula;
    worksheet[cellAddress].t = 'n';
  } else {
    if (typeof value === 'number') {
      worksheet[cellAddress].t = 'n';
      worksheet[cellAddress].v = value;
    } else if (typeof value === 'boolean') {
      worksheet[cellAddress].t = 'b';
      worksheet[cellAddress].v = value;
    } else if (value instanceof Date) {
      worksheet[cellAddress].t = 'd';
      worksheet[cellAddress].v = value;
    } else {
      worksheet[cellAddress].t = 's';
      worksheet[cellAddress].v = String(value);
    }
  }
  
  const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  saveExcelFile(filePath, outputBuffer);
  
  return {
    success: true,
    path: resolvePath(filePath),
    cell: cellAddress,
    value: formula || value
  };
}

// ==================== 工作表操作 ====================

/**
 * 添加工作表
 */
async function addSheet(params) {
  const { path: filePath, name, data = [] } = params;
  
  if (!name) {
    throw new Error('Sheet name is required');
  }
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  if (workbook.SheetNames.includes(name)) {
    throw new Error(`Sheet "${name}" already exists`);
  }
  
  const worksheet = XLSX.utils.aoa_to_sheet(data.length > 0 ? data : [[]]);
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
  
  const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  saveExcelFile(filePath, outputBuffer);
  
  return {
    success: true,
    path: resolvePath(filePath),
    sheetName: name
  };
}

/**
 * 删除工作表
 */
async function deleteSheet(params) {
  const { path: filePath, sheet } = params;
  
  if (!sheet) {
    throw new Error('Sheet name is required');
  }
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  if (!workbook.SheetNames.includes(sheet)) {
    throw new Error(`Sheet "${sheet}" not found`);
  }
  
  if (workbook.SheetNames.length === 1) {
    throw new Error('Cannot delete the last sheet');
  }
  
  delete workbook.Sheets[sheet];
  workbook.SheetNames = workbook.SheetNames.filter(name => name !== sheet);
  
  const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  saveExcelFile(filePath, outputBuffer);
  
  return {
    success: true,
    path: resolvePath(filePath),
    deletedSheet: sheet,
    remainingSheets: workbook.SheetNames
  };
}

/**
 * 重命名工作表
 */
async function renameSheet(params) {
  const { path: filePath, oldName, newName } = params;
  
  if (!oldName || !newName) {
    throw new Error('Both oldName and newName are required');
  }
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  if (!workbook.SheetNames.includes(oldName)) {
    throw new Error(`Sheet "${oldName}" not found`);
  }
  
  if (workbook.SheetNames.includes(newName)) {
    throw new Error(`Sheet "${newName}" already exists`);
  }
  
  const sheetIndex = workbook.SheetNames.indexOf(oldName);
  workbook.SheetNames[sheetIndex] = newName;
  workbook.Sheets[newName] = workbook.Sheets[oldName];
  delete workbook.Sheets[oldName];
  
  const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  saveExcelFile(filePath, outputBuffer);
  
  return {
    success: true,
    path: resolvePath(filePath),
    oldName,
    newName
  };
}

/**
 * 复制工作表
 */
async function copySheet(params) {
  const { path: filePath, sourceSheet, targetSheet, targetFile } = params;
  
  if (!sourceSheet || !targetSheet) {
    throw new Error('Both sourceSheet and targetSheet are required');
  }
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  if (!workbook.SheetNames.includes(sourceSheet)) {
    throw new Error(`Source sheet "${sourceSheet}" not found`);
  }
  
  const sourceWorksheet = workbook.Sheets[sourceSheet];
  
  if (targetFile) {
    let targetBuffer;
    let targetWorkbook;
    
    try {
      targetBuffer = readExcelFile(targetFile);
      targetWorkbook = XLSX.read(targetBuffer, { type: 'buffer' });
    } catch (e) {
      targetWorkbook = XLSX.utils.book_new();
    }
    
    const copiedSheet = JSON.parse(JSON.stringify(sourceWorksheet));
    XLSX.utils.book_append_sheet(targetWorkbook, copiedSheet, targetSheet);
    
    const outputBuffer = XLSX.write(targetWorkbook, { type: 'buffer', bookType: 'xlsx' });
    saveExcelFile(targetFile, outputBuffer);
    
    return {
      success: true,
      sourceFile: resolvePath(filePath),
      targetFile: resolvePath(targetFile),
      sourceSheet,
      targetSheet
    };
  } else {
    if (workbook.SheetNames.includes(targetSheet)) {
      throw new Error(`Target sheet "${targetSheet}" already exists`);
    }
    
    const copiedSheet = JSON.parse(JSON.stringify(sourceWorksheet));
    XLSX.utils.book_append_sheet(workbook, copiedSheet, targetSheet);
    
    const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    saveExcelFile(filePath, outputBuffer);
    
    return {
      success: true,
      path: resolvePath(filePath),
      sourceSheet,
      targetSheet
    };
  }
}

// ==================== 格式化操作 ====================

/**
 * 设置列宽
 */
async function setColumnWidth(params) {
  const { path: filePath, sheet, columns } = params;
  
  if (!columns || !Array.isArray(columns)) {
    throw new Error('columns array is required');
  }
  
  const ExcelJSLib = getExcelJS();
  const workbook = new ExcelJSLib.Workbook();
  const buffer = readExcelFile(filePath);
  await workbook.xlsx.load(buffer);
  
  const sheetName = sheet || workbook.worksheets[0].name;
  const worksheet = workbook.getWorksheet(sheetName);
  
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  for (const col of columns) {
    const colNum = typeof col.column === 'string' 
      ? col.column.toUpperCase().charCodeAt(0) - 64 
      : col.column;
    worksheet.getColumn(colNum).width = col.width;
  }
  
  const outputBuffer = await workbook.xlsx.writeBuffer();
  saveExcelFile(filePath, Buffer.from(outputBuffer));
  
  return {
    success: true,
    path: resolvePath(filePath),
    sheetName,
    columnsUpdated: columns.length
  };
}

/**
 * 设置单元格样式
 */
async function setCellStyle(params) {
  const { path: filePath, sheet, cells, style } = params;
  
  if (!cells || !Array.isArray(cells)) {
    throw new Error('cells array is required');
  }
  
  const ExcelJSLib = getExcelJS();
  const workbook = new ExcelJSLib.Workbook();
  const buffer = readExcelFile(filePath);
  await workbook.xlsx.load(buffer);
  
  const sheetName = sheet || workbook.worksheets[0].name;
  const worksheet = workbook.getWorksheet(sheetName);
  
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  for (const cellRef of cells) {
    const cell = worksheet.getCell(cellRef);
    
    if (style.font) {
      cell.font = style.font;
    }
    if (style.fill) {
      cell.fill = style.fill;
    }
    if (style.alignment) {
      cell.alignment = style.alignment;
    }
    if (style.border) {
      cell.border = style.border;
    }
    if (style.numFmt) {
      cell.numFmt = style.numFmt;
    }
  }
  
  const outputBuffer = await workbook.xlsx.writeBuffer();
  saveExcelFile(filePath, Buffer.from(outputBuffer));
  
  return {
    success: true,
    path: resolvePath(filePath),
    sheetName,
    cellsUpdated: cells.length
  };
}

// ==================== 公式操作 ====================

/**
 * 计算公式
 */
async function calculateFormulas(params) {
  const { path: filePath, sheet } = params;
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  const sheetName = sheet || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  const HyperFormulaLib = getHyperFormula();
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
  
  const hfInstance = HyperFormulaLib.buildEmpty({
    licenseKey: 'gpl-v3'
  });
  
  hfInstance.addSheet(sheetName);
  hfInstance.setSheetContent(0, data);
  
  const formulas = [];
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  
  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[cellAddress];
      
      if (cell && cell.f) {
        const calculatedValue = hfInstance.getCellValue({ sheetId: 0, row, col });
        formulas.push({
          cell: cellAddress,
          formula: cell.f,
          value: calculatedValue
        });
      }
    }
  }
  
  hfInstance.destroy();
  
  return {
    success: true,
    sheetName,
    formulaCount: formulas.length,
    formulas
  };
}

// ==================== 数据操作 ====================

/**
 * 筛选数据
 */
async function filterData(params) {
  const { path: filePath, sheet, column, condition, value } = params;
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  const sheetName = sheet || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  const data = XLSX.utils.sheet_to_json(worksheet, { defval: null });
  
  if (data.length === 0) {
    return { success: true, data: [], count: 0 };
  }
  
  const col = column || Object.keys(data[0])[0];
  
  const filteredData = data.filter(row => {
    const cellValue = row[col];
    
    switch (condition) {
      case 'equals':
      case '==':
        return cellValue == value;
      case 'not_equals':
      case '!=':
        return cellValue != value;
      case 'greater':
      case '>':
        return cellValue > value;
      case 'greater_equals':
      case '>=':
        return cellValue >= value;
      case 'less':
      case '<':
        return cellValue < value;
      case 'less_equals':
      case '<=':
        return cellValue <= value;
      case 'contains':
        return String(cellValue).includes(value);
      case 'starts_with':
        return String(cellValue).startsWith(value);
      case 'ends_with':
        return String(cellValue).endsWith(value);
      case 'is_empty':
      case 'null':
        return cellValue === null || cellValue === undefined || cellValue === '';
      case 'is_not_empty':
      case 'not_null':
        return cellValue !== null && cellValue !== undefined && cellValue !== '';
      default:
        return true;
    }
  });
  
  return {
    success: true,
    sheetName,
    column: col,
    condition,
    data: filteredData,
    count: filteredData.length
  };
}

/**
 * 排序数据
 */
async function sortData(params) {
  const { path: filePath, sheet, column, order = 'asc', output } = params;
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  const sheetName = sheet || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  const data = XLSX.utils.sheet_to_json(worksheet, { defval: null });
  
  if (data.length === 0) {
    return { success: true, data: [], count: 0 };
  }
  
  const col = column || Object.keys(data[0])[0];
  
  data.sort((a, b) => {
    const aVal = a[col];
    const bVal = b[col];
    
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;
    
    let comparison = 0;
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      comparison = aVal - bVal;
    } else {
      comparison = String(aVal).localeCompare(String(bVal));
    }
    
    return order === 'desc' ? -comparison : comparison;
  });
  
  if (output) {
    const newWorksheet = XLSX.utils.json_to_sheet(data);
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, sheetName);
    const outputBuffer = XLSX.write(newWorkbook, { type: 'buffer', bookType: 'xlsx' });
    saveExcelFile(output, outputBuffer);
    
    return {
      success: true,
      path: resolvePath(output),
      sheetName,
      column: col,
      order,
      count: data.length
    };
  }
  
  return {
    success: true,
    sheetName,
    column: col,
    order,
    data,
    count: data.length
  };
}

/**
 * 查找数据
 */
async function findData(params) {
  const { path: filePath, sheet, query, columns } = params;
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  const sheetName = sheet || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  const data = XLSX.utils.sheet_to_json(worksheet, { defval: null });
  const searchColumns = columns || Object.keys(data[0] || {});
  const searchQuery = String(query).toLowerCase();
  
  const results = data.filter((row, index) => {
    return searchColumns.some(col => {
      const cellValue = row[col];
      return cellValue !== null && 
             cellValue !== undefined && 
             String(cellValue).toLowerCase().includes(searchQuery);
    });
  }).map((row, index) => ({
    rowIndex: index + 1,
    ...row
  }));
  
  return {
    success: true,
    sheetName,
    query,
    columns: searchColumns,
    results,
    count: results.length
  };
}

// ==================== 转换操作 ====================

/**
 * Excel 转 JSON
 */
async function toJson(params) {
  const { path: filePath, sheet, output } = params;
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  const sheetName = sheet || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  const data = XLSX.utils.sheet_to_json(worksheet, { defval: null });
  
  if (output) {
    const resolvedPath = resolvePath(output);
    fs.writeFileSync(resolvedPath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true, path: resolvedPath, count: data.length };
  }
  
  return {
    success: true,
    sheetName,
    data,
    count: data.length
  };
}

/**
 * JSON 转 Excel
 */
async function fromJson(params) {
  const { data, path: filePath, sheet = 'Sheet1' } = params;
  
  if (!data || !Array.isArray(data)) {
    throw new Error('data array is required');
  }
  
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheet);
  
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  saveExcelFile(filePath, buffer);
  
  return {
    success: true,
    path: resolvePath(filePath),
    sheetName: sheet,
    rowCount: data.length
  };
}

/**
 * Excel 转 CSV
 */
async function toCsv(params) {
  const { path: filePath, sheet, output, delimiter = ',' } = params;
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  const sheetName = sheet || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  const csv = XLSX.utils.sheet_to_csv(worksheet, { FS: delimiter });
  
  if (output) {
    const resolvedPath = resolvePath(output);
    fs.writeFileSync(resolvedPath, csv, 'utf-8');
    return { success: true, path: resolvedPath };
  }
  
  return {
    success: true,
    sheetName,
    csv
  };
}

/**
 * CSV 转 Excel
 */
async function fromCsv(params) {
  const { path: filePath, output, sheet = 'Sheet1', delimiter = ',' } = params;
  
  const buffer = readExcelFile(filePath);
  const csv = buffer.toString('utf-8');
  
  const worksheet = XLSX.read(csv, { type: 'string', FS: delimiter }).Sheets['Sheet1'];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheet);
  
  const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  saveExcelFile(output, outputBuffer);
  
  return {
    success: true,
    path: resolvePath(output),
    sheetName: sheet
  };
}

// ==================== 技能入口 ====================

/**
 * Skill execute function - called by skill-runner
 * 
 * @param {string} toolName - Name of the tool to execute
 * @param {object} params - Tool parameters
 * @param {object} context - Execution context
 * @returns {Promise<object>} Execution result
 */
async function execute(toolName, params, context = {}) {
  switch (toolName) {
    // 基础操作
    case 'read_workbook':
    case 'read':
      return await readWorkbook(params);
      
    case 'read_sheet':
      return await readSheet(params);
      
    case 'read_cell':
      return await readCell(params);
      
    // 写入操作
    case 'create_workbook':
    case 'create':
      return await createWorkbook(params);
      
    case 'write_sheet':
      return await writeSheet(params);
      
    case 'write_cell':
      return await writeCell(params);
      
    // 工作表操作
    case 'add_sheet':
      return await addSheet(params);
      
    case 'delete_sheet':
      return await deleteSheet(params);
      
    case 'rename_sheet':
      return await renameSheet(params);
      
    case 'copy_sheet':
      return await copySheet(params);
      
    // 格式化操作
    case 'set_column_width':
      return await setColumnWidth(params);
      
    case 'set_cell_style':
      return await setCellStyle(params);
      
    // 公式操作
    case 'calculate_formulas':
      return await calculateFormulas(params);
      
    // 数据操作
    case 'filter_data':
      return await filterData(params);
      
    case 'sort_data':
      return await sortData(params);
      
    case 'find_data':
      return await findData(params);
      
    // 转换操作
    case 'to_json':
      return await toJson(params);
      
    case 'from_json':
      return await fromJson(params);
      
    case 'to_csv':
      return await toCsv(params);
      
    case 'from_csv':
      return await fromCsv(params);
      
    default:
      throw new Error(`Unknown tool: ${toolName}. Supported tools: read_workbook, read_sheet, read_cell, create_workbook, write_sheet, write_cell, add_sheet, delete_sheet, rename_sheet, copy_sheet, set_column_width, set_cell_style, calculate_formulas, filter_data, sort_data, find_data, to_json, from_json, to_csv, from_csv`);
  }
}

module.exports = { execute };