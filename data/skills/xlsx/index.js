/**
 * XLSX Skill - Excel 文件处理技能 (Node.js 版本)
 * 
 * 功能：
 * - 读取 Excel 文件（支持 .xlsx, .xls）
 * - 写入/创建 Excel 文件
 * - 编辑工作表
 * - 格式化单元格
 * - 公式计算（使用 HyperFormula）
 * - 数据查询与转换
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
    const hfModule = require('hyperformula');
    // HyperFormula 导出格式: { HyperFormula: class, ... }
    // 需要访问 .HyperFormula 属性获取实际的类
    HyperFormula = hfModule.HyperFormula || hfModule.default || hfModule;
  }
  return HyperFormula;
}

// 用户角色检查
const IS_ADMIN = process.env.IS_ADMIN === 'true';
const IS_SKILL_CREATOR = process.env.IS_SKILL_CREATOR === 'true';

// 允许的基础路径
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
const USER_ID = process.env.USER_ID || 'default';
const USER_WORK_DIR = process.env.WORKING_DIRECTORY
  ? path.join(DATA_BASE_PATH, process.env.WORKING_DIRECTORY)
  : path.join(DATA_BASE_PATH, 'work', USER_ID);

// 根据用户角色设置允许的路径
let ALLOWED_BASE_PATHS;
if (IS_ADMIN) {
  // 管理员：可以访问整个 data/ 目录
  ALLOWED_BASE_PATHS = [DATA_BASE_PATH];
} else if (IS_SKILL_CREATOR) {
  // 技能创建者：可以访问 skills/ 和自己的工作目录
  ALLOWED_BASE_PATHS = [
    path.join(DATA_BASE_PATH, 'skills'),
    path.join(DATA_BASE_PATH, 'work', USER_ID)
  ];
} else {
  // 普通用户：只能访问自己的工作目录
  ALLOWED_BASE_PATHS = [USER_WORK_DIR];
}

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

// ==================== excel_read ====================

/**
 * 读取 Excel 文件
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.scope - 读取范围: 'workbook' | 'sheet' | 'cell'
 * @param {string} [params.sheet] - 工作表名称（scope 为 sheet 或 cell 时需要）
 * @param {string} [params.cell] - 单元格地址（scope 为 cell 时需要，如 'A1'）
 * @param {boolean} [params.includeData] - 是否包含数据（scope 为 workbook 时）
 * @param {string} [params.range] - 数据范围（scope 为 sheet 时）
 * @param {string|number} [params.header] - 表头模式: 1（数组）| 'json'（对象）
 */
async function excelRead(params) {
  const { path: filePath, scope = 'workbook', sheet, cell, includeData, range, header } = params;
  
  const buffer = readExcelFile(filePath);
  // 使用 cellStyles: true 以便正确读取公式
  const workbook = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
  
  // 读取工作簿信息
  if (scope === 'workbook') {
    const result = {
      success: true,
      sheetNames: workbook.SheetNames,
      sheetCount: workbook.SheetNames.length,
      properties: workbook.Props || {}
    };
    
    if (includeData) {
      result.sheets = {};
      for (const sheetName of workbook.SheetNames) {
        const ws = workbook.Sheets[sheetName];
        result.sheets[sheetName] = {
          range: ws['!ref'],
          data: XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
        };
      }
    }
    
    return result;
  }
  
  // 读取工作表
  if (scope === 'sheet') {
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
  
  // 读取单元格
  if (scope === 'cell') {
    if (!cell) {
      throw new Error('Cell reference is required (e.g., "A1")');
    }
    
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
  
  throw new Error(`Invalid scope: ${scope}. Must be 'workbook', 'sheet', or 'cell'`);
}

// ==================== excel_write ====================

/**
 * 写入 Excel 文件
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.scope - 写入范围: 'workbook' | 'sheet' | 'cell'
 * @param {string} [params.sheet] - 工作表名称
 * @param {string} [params.cell] - 单元格地址（scope 为 cell 时需要）
 * @param {any} [params.value] - 单元格值（scope 为 cell 时）
 * @param {string} [params.formula] - 公式（scope 为 cell 时）
 * @param {Array} [params.data] - 数据（scope 为 sheet 时）
 * @param {string} [params.mode] - 写入模式: 'overwrite' | 'append' | 'insert'
 * @param {string} [params.startCell] - 起始单元格（mode 为 insert 时）
 * @param {Array} [params.sheets] - 工作表数据（scope 为 workbook 时）
 * @param {object} [params.properties] - 工作簿属性（scope 为 workbook 时）
 */
async function excelWrite(params) {
  const { 
    path: filePath, 
    scope = 'workbook', 
    sheet, 
    cell, 
    value, 
    formula, 
    data, 
    mode = 'overwrite', 
    startCell = 'A1',
    sheets,
    properties
  } = params;
  
  // 创建新工作簿
  if (scope === 'workbook') {
    const workbook = XLSX.utils.book_new();
    
    if (properties) {
      if (properties.title) workbook.Props = { ...workbook.Props, Title: properties.title };
      if (properties.author) workbook.Props = { ...workbook.Props, Author: properties.author };
      if (properties.subject) workbook.Props = { ...workbook.Props, Subject: properties.subject };
    }
    
    const sheetsData = sheets || [];
    for (const sheetData of sheetsData) {
      const { name = 'Sheet1', data: sheetDataArr = [], headers } = sheetData;
      
      let wsData = sheetDataArr;
      if (headers && Array.isArray(headers)) {
        wsData = [headers, ...sheetDataArr];
      }
      
      const worksheet = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(workbook, worksheet, name);
    }
    
    if (sheetsData.length === 0) {
      const worksheet = XLSX.utils.aoa_to_sheet([[]]);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    }
    
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    saveExcelFile(filePath, buffer);
    
    return {
      success: true,
      path: resolvePath(filePath),
      sheetCount: workbook.SheetNames.length,
      sheetNames: workbook.SheetNames
    };
  }
  
  // 写入工作表
  if (scope === 'sheet') {
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
  
  // 写入单元格
  if (scope === 'cell') {
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
      
      // 使用 HyperFormula 计算公式结果并写入值
      // 这样 Excel 打开时就能直接显示结果，不需要双击激活
      try {
        const HyperFormulaLib = getHyperFormula();
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
        
        // 解析单元格地址
        const cellRef = XLSX.utils.decode_cell(cellAddress);
        
        // 确保数据数组有足够的行和列
        while (data.length <= cellRef.r) {
          data.push([]);
        }
        while (data[cellRef.r].length <= cellRef.c) {
          data[cellRef.r].push(null);
        }
        
        // 放入公式字符串
        data[cellRef.r][cellRef.c] = formula.startsWith('=') ? formula : '=' + formula;
        
        // 创建 HyperFormula 实例并计算
        const hfInstance = HyperFormulaLib.buildFromSheets({
          [sheetName]: data
        }, {
          licenseKey: 'gpl-v3'
        });
        
        // 获取计算结果
        const sheetId = hfInstance.getSheetId(sheetName);
        const calculatedValue = hfInstance.getCellValue({
          sheet: sheetId,
          col: cellRef.c,
          row: cellRef.r
        });
        
        // 写入计算结果作为值
        worksheet[cellAddress].v = calculatedValue;
        
        hfInstance.destroy();
      } catch (calcError) {
        // 计算失败时，值保持为 0，但公式仍然写入
        // Excel 打开时会重新计算
        console.warn(`Formula calculation failed for ${cellAddress}: ${calcError.message}`);
      }
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
  
  throw new Error(`Invalid scope: ${scope}. Must be 'workbook', 'sheet', or 'cell'`);
}

// ==================== excel_sheet ====================

/**
 * 工作表管理
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.action - 操作: 'add' | 'delete' | 'rename' | 'copy'
 * @param {string} [params.name] - 工作表名称（add 时需要）
 * @param {string} [params.sheet] - 工作表名称（delete/rename/copy 时需要）
 * @param {string} [params.newName] - 新名称（rename 时需要）
 * @param {string} [params.sourceSheet] - 源工作表（copy 时需要）
 * @param {string} [params.targetSheet] - 目标工作表（copy 时需要）
 * @param {string} [params.targetFile] - 目标文件（copy 时可选）
 * @param {Array} [params.data] - 数据（add 时可选）
 */
async function excelSheet(params) {
  const { 
    path: filePath, 
    action, 
    name, 
    sheet, 
    newName, 
    sourceSheet, 
    targetSheet, 
    targetFile, 
    data 
  } = params;
  
  // 添加工作表
  if (action === 'add') {
    if (!name) {
      throw new Error('Sheet name is required');
    }
    
    const buffer = readExcelFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    if (workbook.SheetNames.includes(name)) {
      throw new Error(`Sheet "${name}" already exists`);
    }
    
    const worksheet = XLSX.utils.aoa_to_sheet(data && data.length > 0 ? data : [[]]);
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
    
    const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    saveExcelFile(filePath, outputBuffer);
    
    return {
      success: true,
      path: resolvePath(filePath),
      sheetName: name
    };
  }
  
  // 删除工作表
  if (action === 'delete') {
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
    workbook.SheetNames = workbook.SheetNames.filter(n => n !== sheet);
    
    const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    saveExcelFile(filePath, outputBuffer);
    
    return {
      success: true,
      path: resolvePath(filePath),
      deletedSheet: sheet,
      remainingSheets: workbook.SheetNames
    };
  }
  
  // 重命名工作表
  if (action === 'rename') {
    if (!sheet || !newName) {
      throw new Error('Both sheet (old name) and newName are required');
    }
    
    const buffer = readExcelFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    if (!workbook.SheetNames.includes(sheet)) {
      throw new Error(`Sheet "${sheet}" not found`);
    }
    
    if (workbook.SheetNames.includes(newName)) {
      throw new Error(`Sheet "${newName}" already exists`);
    }
    
    const sheetIndex = workbook.SheetNames.indexOf(sheet);
    workbook.SheetNames[sheetIndex] = newName;
    workbook.Sheets[newName] = workbook.Sheets[sheet];
    delete workbook.Sheets[sheet];
    
    const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    saveExcelFile(filePath, outputBuffer);
    
    return {
      success: true,
      path: resolvePath(filePath),
      oldName: sheet,
      newName
    };
  }
  
  // 复制工作表
  if (action === 'copy') {
    const srcSheet = sourceSheet || sheet;
    const tgtSheet = targetSheet;
    
    if (!srcSheet || !tgtSheet) {
      throw new Error('Both sourceSheet and targetSheet are required');
    }
    
    const buffer = readExcelFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    if (!workbook.SheetNames.includes(srcSheet)) {
      throw new Error(`Source sheet "${srcSheet}" not found`);
    }
    
    const sourceWorksheet = workbook.Sheets[srcSheet];
    
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
      XLSX.utils.book_append_sheet(targetWorkbook, copiedSheet, tgtSheet);
      
      const outputBuffer = XLSX.write(targetWorkbook, { type: 'buffer', bookType: 'xlsx' });
      saveExcelFile(targetFile, outputBuffer);
      
      return {
        success: true,
        sourceFile: resolvePath(filePath),
        targetFile: resolvePath(targetFile),
        sourceSheet: srcSheet,
        targetSheet: tgtSheet
      };
    } else {
      if (workbook.SheetNames.includes(tgtSheet)) {
        throw new Error(`Target sheet "${tgtSheet}" already exists`);
      }
      
      const copiedSheet = JSON.parse(JSON.stringify(sourceWorksheet));
      XLSX.utils.book_append_sheet(workbook, copiedSheet, tgtSheet);
      
      const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      saveExcelFile(filePath, outputBuffer);
      
      return {
        success: true,
        path: resolvePath(filePath),
        sourceSheet: srcSheet,
        targetSheet: tgtSheet
      };
    }
  }
  
  throw new Error(`Invalid action: ${action}. Must be 'add', 'delete', 'rename', or 'copy'`);
}

// ==================== excel_format ====================

/**
 * 格式化设置
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.type - 格式化类型: 'column' | 'cell'
 * @param {string} [params.sheet] - 工作表名称
 * @param {Array} [params.columns] - 列宽配置（type 为 column 时）
 * @param {Array} [params.cells] - 单元格列表（type 为 cell 时）
 * @param {object} [params.style] - 样式配置（type 为 cell 时）
 */
async function excelFormat(params) {
  const { path: filePath, type, sheet, columns, cells, style } = params;
  
  const ExcelJSLib = getExcelJS();
  const workbook = new ExcelJSLib.Workbook();
  const buffer = readExcelFile(filePath);
  await workbook.xlsx.load(buffer);
  
  const sheetName = sheet || workbook.worksheets[0].name;
  const worksheet = workbook.getWorksheet(sheetName);
  
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  // 设置列宽
  if (type === 'column') {
    if (!columns || !Array.isArray(columns)) {
      throw new Error('columns array is required');
    }
    
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      
      // 验证 width 参数
      if (typeof col.width !== 'number' || col.width < 0) {
        throw new Error(`Invalid width value at index ${i}: ${col.width}. Must be a non-negative number.`);
      }
      
      let colNum;
      if (typeof col.column === 'string') {
        // 支持多字母列名（如 A, B, AA, AB 等）
        // A=1, B=2, ..., Z=26, AA=27, AB=28...
        const colStr = col.column.toUpperCase();
        // 验证列名只包含字母
        if (!/^[A-Z]+$/.test(colStr)) {
          throw new Error(`Invalid column name at index ${i}: ${col.column}. Must be letters only (A-Z).`);
        }
        colNum = 0;
        for (let j = 0; j < colStr.length; j++) {
          colNum = colNum * 26 + (colStr.charCodeAt(j) - 64);
        }
      } else if (typeof col.column === 'number') {
        colNum = col.column;
      } else if (col.column === undefined || col.column === null) {
        // 如果没有指定 column，使用索引 + 1
        colNum = i + 1;
      } else {
        throw new Error(`Invalid column type at index ${i}: ${typeof col.column}. Must be string, number, or omitted (auto-increment from 1).`);
      }
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
  
  // 设置单元格样式
  if (type === 'cell') {
    if (!cells || !Array.isArray(cells)) {
      throw new Error('cells array is required');
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
  
  throw new Error(`Invalid type: ${type}. Must be 'column' or 'cell'`);
}

// ==================== excel_query ====================

/**
 * 数据查询
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.action - 查询类型: 'filter' | 'sort' | 'find'
 * @param {string} [params.sheet] - 工作表名称
 * @param {string} [params.column] - 列名（filter/sort 时）
 * @param {string} [params.condition] - 条件（filter 时）
 * @param {any} [params.value] - 值（filter 时）
 * @param {string} [params.order] - 排序方向（sort 时）: 'asc' | 'desc'
 * @param {string} [params.output] - 输出文件路径（sort 时可选）
 * @param {string} [params.query] - 搜索关键词（find 时）
 * @param {Array} [params.columns] - 搜索列（find 时可选）
 */
async function excelQuery(params) {
  const { path: filePath, action, sheet, column, condition, value, order = 'asc', output, query, columns } = params;
  
  const buffer = readExcelFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  const sheetName = sheet || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  // 筛选数据
  if (action === 'filter') {
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
  
  // 排序数据
  if (action === 'sort') {
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
  
  // 查找数据
  if (action === 'find') {
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
  
  throw new Error(`Invalid action: ${action}. Must be 'filter', 'sort', or 'find'`);
}

// ==================== excel_convert ====================

/**
 * 格式转换
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.format - 目标格式: 'json' | 'csv'
 * @param {string} params.direction - 转换方向: 'to' | 'from'
 * @param {string} [params.sheet] - 工作表名称
 * @param {string} [params.output] - 输出文件路径
 * @param {string} [params.delimiter] - CSV 分隔符
 * @param {Array} [params.data] - JSON 数据（direction 为 from 时）
 */
async function excelConvert(params) {
  const { path: filePath, format, direction, sheet, output, delimiter = ',', data } = params;
  
  // Excel 转 JSON
  if (format === 'json' && direction === 'to') {
    const buffer = readExcelFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    const sheetName = sheet || workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }
    
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: null });
    
    if (output) {
      const resolvedPath = resolvePath(output);
      fs.writeFileSync(resolvedPath, JSON.stringify(jsonData, null, 2), 'utf-8');
      return { success: true, path: resolvedPath, count: jsonData.length };
    }
    
    return {
      success: true,
      sheetName,
      data: jsonData,
      count: jsonData.length
    };
  }
  
  // JSON 转 Excel
  if (format === 'json' && direction === 'from') {
    if (!data || !Array.isArray(data)) {
      throw new Error('data array is required');
    }
    
    const sheetName = sheet || 'Sheet1';
    let worksheet;
    let isAoA = false;
    
    // 检测数据类型：如果是二维数组（数组中的元素也是数组），使用 aoa_to_sheet
    // 如果是对象数组，使用 json_to_sheet
    if (data.length > 0 && Array.isArray(data[0])) {
      // 二维数组模式：直接使用 aoa_to_sheet
      worksheet = XLSX.utils.aoa_to_sheet(data);
      isAoA = true;
    } else {
      // 对象数组模式：使用 json_to_sheet
      worksheet = XLSX.utils.json_to_sheet(data);
    }
    
    // 检测并处理公式字符串（以 = 开头的值）
    // 需要将这些值从普通字符串转换为公式对象
    const formulaCells = [];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    
    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = worksheet[cellAddress];
        
        if (cell && typeof cell.v === 'string' && cell.v.startsWith('=')) {
          // 这是一个公式字符串，需要转换为公式对象
          const formulaStr = cell.v;
          formulaCells.push({ cellAddress, row, col, formula: formulaStr });
        }
      }
    }
    
    // 如果有公式需要处理，使用 HyperFormula 计算并设置
    if (formulaCells.length > 0) {
      // 准备数据用于 HyperFormula 计算
      const hfData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
      
      // 将公式字符串放入数据中供 HyperFormula 计算
      for (const fc of formulaCells) {
        // 确保数据数组有足够的行和列
        while (hfData.length <= fc.row) {
          hfData.push([]);
        }
        while (hfData[fc.row].length <= fc.col) {
          hfData[fc.row].push(null);
        }
        // HyperFormula 需要带 = 前缀的公式字符串
        hfData[fc.row][fc.col] = fc.formula;
      }
      
      // 使用 HyperFormula 计算公式结果
      try {
        const HyperFormulaLib = getHyperFormula();
        const hfInstance = HyperFormulaLib.buildFromSheets({
          [sheetName]: hfData
        }, {
          licenseKey: 'gpl-v3'
        });
        
        const sheetId = hfInstance.getSheetId(sheetName);
        
        // 更新单元格：设置公式和计算结果
        for (const fc of formulaCells) {
          const cell = worksheet[fc.cellAddress];
          
          // 设置公式（去掉 = 前缀，xlsx 库存储公式时不带 =）
          cell.f = fc.formula.substring(1);
          
          // 获取计算结果
          try {
            const calculatedValue = hfInstance.getCellValue({
              sheet: sheetId,
              col: fc.col,
              row: fc.row
            });
            
            // 根据计算结果类型设置单元格类型和值
            if (typeof calculatedValue === 'number') {
              cell.t = 'n';
              cell.v = calculatedValue;
            } else if (typeof calculatedValue === 'string') {
              cell.t = 'str';
              cell.v = calculatedValue;
            } else if (typeof calculatedValue === 'boolean') {
              cell.t = 'b';
              cell.v = calculatedValue;
            } else if (calculatedValue === null || calculatedValue === undefined) {
              // 计算结果为空时，设置为数字类型，值为 0
              cell.t = 'n';
              cell.v = 0;
            } else {
              // 其他类型，尝试转为数字
              cell.t = 'n';
              cell.v = Number(calculatedValue) || 0;
            }
          } catch (e) {
            // 计算失败时，设置为数字类型，值为 0
            console.warn(`Formula calculation failed for ${fc.cellAddress}: ${e.message}`);
            cell.t = 'n';
            cell.v = 0;
          }
          
          // 删除可能存在的无效属性
          delete cell.w; // 删除格式化文本属性，避免样式冲突
        }
        
        hfInstance.destroy();
      } catch (hfError) {
        // HyperFormula 初始化失败，仍然保留公式但无法计算
        console.warn(`HyperFormula initialization failed: ${hfError.message}`);
        // 至少设置公式属性，Excel 打开时会重新计算
        for (const fc of formulaCells) {
          const cell = worksheet[fc.cellAddress];
          cell.f = fc.formula.substring(1);
          cell.t = 'n';
          cell.v = 0; // 使用 0 而非 null，避免 XML 问题
          delete cell.w; // 删除格式化文本属性
        }
      }
    }
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    saveExcelFile(filePath, buffer);
    
    return {
      success: true,
      path: resolvePath(filePath),
      sheetName,
      rowCount: data.length,
      formulaCount: formulaCells.length
    };
  }
  
  // Excel 转 CSV
  if (format === 'csv' && direction === 'to') {
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
  
  // CSV 转 Excel
  if (format === 'csv' && direction === 'from') {
    const buffer = readExcelFile(filePath);
    const csv = buffer.toString('utf-8');
    
    const sheetName = sheet || 'Sheet1';
    const worksheet = XLSX.read(csv, { type: 'string', FS: delimiter }).Sheets['Sheet1'];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    
    const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    saveExcelFile(output, outputBuffer);
    
    return {
      success: true,
      path: resolvePath(output),
      sheetName
    };
  }
  
  throw new Error(`Invalid format/direction: ${format}/${direction}. Must be json/to, json/from, csv/to, or csv/from`);
}

// ==================== excel_calc ====================

/**
 * 公式计算
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} [params.sheet] - 工作表名称
 */
async function excelCalc(params) {
  const { path: filePath, sheet } = params;
  
  const buffer = readExcelFile(filePath);
  // 必须使用 cellStyles: true 才能正确读取公式
  const workbook = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
  
  const sheetName = sheet || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  // 收集公式信息
  const formulas = [];
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  
  // 先收集所有公式单元格
  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[cellAddress];
      
      if (cell && cell.f) {
        formulas.push({
          cell: cellAddress,
          row,
          col,
          formula: cell.f
        });
      }
    }
  }
  
  // 如果有公式，使用 HyperFormula 计算
  if (formulas.length > 0) {
    const HyperFormulaLib = getHyperFormula();
    
    // 准备数据 - 先获取所有值
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    
    // 关键：将公式字符串放入数据中，HyperFormula 需要公式字符串来计算
    for (const formulaInfo of formulas) {
      const { row, col, formula } = formulaInfo;
      // 确保数据数组有足够的行
      while (data.length <= row) {
        data.push([]);
      }
      // 确保行数组有足够的列
      while (data[row].length <= col) {
        data[row].push(null);
      }
      // 将公式字符串（带 = 前缀）放入对应单元格
      // HyperFormula 需要以 = 开头的公式字符串
      data[row][col] = formula.startsWith('=') ? formula : '=' + formula;
    }
    
    // 使用 buildFromSheets 创建实例
    const hfInstance = HyperFormulaLib.buildFromSheets({
      [sheetName]: data
    }, {
      licenseKey: 'gpl-v3'
    });
    
    // 获取计算结果
    const sheetId = hfInstance.getSheetId(sheetName);
    for (const formulaInfo of formulas) {
      try {
        // HyperFormula 使用 { sheet, col, row } 格式的 SimpleCellAddress
        const calculatedValue = hfInstance.getCellValue({
          sheet: sheetId,
          col: formulaInfo.col,
          row: formulaInfo.row
        });
        formulaInfo.value = calculatedValue;
      } catch (e) {
        formulaInfo.value = null;
        formulaInfo.error = e.message;
      }
      // 删除临时的 row 和 col 属性
      delete formulaInfo.row;
      delete formulaInfo.col;
    }
    
    hfInstance.destroy();
  }
  
  return {
    success: true,
    sheetName,
    formulaCount: formulas.length,
    formulas
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
    case 'excel_read':
      return await excelRead(params);
      
    case 'excel_write':
      return await excelWrite(params);
      
    case 'excel_sheet':
      return await excelSheet(params);
      
    case 'excel_format':
      return await excelFormat(params);
      
    case 'excel_query':
      return await excelQuery(params);
      
    case 'excel_convert':
      return await excelConvert(params);
      
    case 'excel_calc':
      return await excelCalc(params);
      
    // 兼容旧工具名（映射到新工具）
    case 'read_workbook':
    case 'read':
      return await excelRead({ ...params, scope: 'workbook' });
      
    case 'read_sheet':
      return await excelRead({ ...params, scope: 'sheet' });
      
    case 'read_cell':
      return await excelRead({ ...params, scope: 'cell' });
      
    case 'create_workbook':
    case 'create':
      return await excelWrite({ ...params, scope: 'workbook' });
      
    case 'write_sheet':
      return await excelWrite({ ...params, scope: 'sheet' });
      
    case 'write_cell':
      return await excelWrite({ ...params, scope: 'cell' });
      
    case 'add_sheet':
      return await excelSheet({ ...params, action: 'add', name: params.name || params.sheet });
      
    case 'delete_sheet':
      return await excelSheet({ ...params, action: 'delete' });
      
    case 'rename_sheet':
      return await excelSheet({ ...params, action: 'rename', newName: params.newName });
      
    case 'copy_sheet':
      return await excelSheet({ ...params, action: 'copy' });
      
    case 'set_column_width':
      return await excelFormat({ ...params, type: 'column' });
      
    case 'set_cell_style':
      return await excelFormat({ ...params, type: 'cell' });
      
    case 'filter_data':
      return await excelQuery({ ...params, action: 'filter' });
      
    case 'sort_data':
      return await excelQuery({ ...params, action: 'sort' });
      
    case 'find_data':
      return await excelQuery({ ...params, action: 'find' });
      
    case 'to_json':
      return await excelConvert({ ...params, format: 'json', direction: 'to' });
      
    case 'from_json':
      return await excelConvert({ ...params, format: 'json', direction: 'from' });
      
    case 'to_csv':
      return await excelConvert({ ...params, format: 'csv', direction: 'to' });
      
    case 'from_csv':
      return await excelConvert({ ...params, format: 'csv', direction: 'from' });
      
    case 'calculate_formulas':
      return await excelCalc(params);
      
    default:
      throw new Error(`Unknown tool: ${toolName}. Supported tools: excel_read, excel_write, excel_sheet, excel_format, excel_query, excel_convert, excel_calc`);
  }
}

module.exports = { execute };