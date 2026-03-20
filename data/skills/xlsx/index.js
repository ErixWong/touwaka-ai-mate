/**
 * XLSX Skill - Excel 处理技能 (Node.js 版本)
 * 
 * 功能：
 * - 读取 Excel 文件（.xlsx, .xlsm）
 * - 写入/创建 Excel 文件
 * - 公式计算（HyperFormula）
 * - 样式设置
 * - 图表插入（通过 chart 技能）
 * - CSV 导入/导出
 * 
 * 依赖：
 * - exceljs: Excel 读写核心库
 * - hyperformula: 公式计算引擎
 */

const ExcelJS = require('exceljs');
const HyperFormula = require('hyperformula');
const path = require('path');
const fs = require('fs').promises;

/**
 * 解析路径（支持相对路径）
 * @param {string} inputPath - 输入路径
 * @returns {string} 绝对路径
 */
function resolvePath(inputPath) {
  if (!inputPath) return inputPath;
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(process.cwd(), inputPath);
}

/**
 * 列号转列名 (1 -> A, 27 -> AA)
 * @param {number} col - 列号（1-based）
 * @returns {string} 列名
 */
function columnToLetter(col) {
  let letter = '';
  let temp = col;
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

/**
 * 列名转列号 (A -> 1, AA -> 27)
 * @param {string} letter - 列名
 * @returns {number} 列号（1-based）
 */
function letterToColumn(letter) {
  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 64);
  }
  return col;
}

/**
 * 单元格地址转换 (A1 -> {row: 1, col: 1})
 * @param {string} address - 单元格地址
 * @returns {Object} 行列对象
 */
function parseAddress(address) {
  const match = address.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return {
    row: parseInt(match[2], 10),
    col: letterToColumn(match[1].toUpperCase())
  };
}

/**
 * 行列转单元格地址 ({row: 1, col: 1} -> A1)
 * @param {number} row - 行号（1-based）
 * @param {number} col - 列号（1-based）
 * @returns {string} 单元格地址
 */
function toAddress(row, col) {
  return `${columnToLetter(col)}${row}`;
}

// ==================== 读取操作 ====================

/**
 * 读取 Excel 文件信息
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @returns {Promise<Object>} 文件信息
 */
async function readWorkbook(params) {
  const { path: filePath } = params;
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvePath(filePath));
  
  const sheets = workbook.worksheets.map(sheet => ({
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    state: sheet.state
  }));
  
  return {
    success: true,
    sheetCount: workbook.worksheets.length,
    sheets,
    creator: workbook.creator,
    created: workbook.created,
    modified: workbook.modified,
    lastModifiedBy: workbook.lastModifiedBy
  };
}

/**
 * 读取工作表数据
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @param {string|number} params.sheet - 工作表名称或索引
 * @param {number} params.startRow - 起始行（1-based）
 * @param {number} params.endRow - 结束行
 * @param {number} params.startCol - 起始列（1-based）
 * @param {number} params.endCol - 结束列
 * @param {boolean} params.includeFormulas - 是否包含公式
 * @param {boolean} params.includeStyles - 是否包含样式
 * @returns {Promise<Object>} 工作表数据
 */
async function readSheet(params) {
  const {
    path: filePath,
    sheet: sheetRef = 1,
    startRow = 1,
    endRow,
    startCol = 1,
    endCol,
    includeFormulas = false,
    includeStyles = false
  } = params;
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvePath(filePath));
  
  // 获取工作表
  const worksheet = typeof sheetRef === 'number'
    ? workbook.worksheets[sheetRef - 1]
    : workbook.getWorksheet(sheetRef);
  
  if (!worksheet) {
    throw new Error(`Sheet not found: ${sheetRef}`);
  }
  
  const actualEndRow = endRow || worksheet.rowCount;
  const actualEndCol = endCol || worksheet.columnCount;
  
  const data = [];
  const formulas = [];
  const styles = [];
  
  for (let rowNum = startRow; rowNum <= actualEndRow; rowNum++) {
    const row = worksheet.getRow(rowNum);
    const rowData = [];
    const formulaRow = [];
    const styleRow = [];
    
    for (let colNum = startCol; colNum <= actualEndCol; colNum++) {
      const cell = row.getCell(colNum);
      
      // 获取值
      rowData.push(cell.value);
      
      // 获取公式
      if (includeFormulas && cell.formula) {
        formulaRow.push({
          address: toAddress(rowNum, colNum),
          formula: cell.formula,
          result: cell.result
        });
      }
      
      // 获取样式
      if (includeStyles) {
        styleRow.push({
          address: toAddress(rowNum, colNum),
          font: cell.font,
          fill: cell.fill,
          alignment: cell.alignment,
          border: cell.border,
          numFmt: cell.numFmt
        });
      }
    }
    
    data.push(rowData);
    
    if (includeFormulas && formulaRow.length > 0) {
      formulas.push(...formulaRow);
    }
    
    if (includeStyles) {
      styles.push(styleRow);
    }
  }
  
  const result = {
    success: true,
    sheetName: worksheet.name,
    data,
    rowCount: data.length,
    columnCount: actualEndCol - startCol + 1
  };
  
  if (includeFormulas) {
    result.formulas = formulas;
  }
  
  if (includeStyles) {
    result.styles = styles;
  }
  
  return result;
}

/**
 * 读取单元格
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @param {string|number} params.sheet - 工作表
 * @param {string} params.address - 单元格地址（如 A1）
 * @returns {Promise<Object>} 单元格数据
 */
async function readCell(params) {
  const { path: filePath, sheet: sheetRef = 1, address } = params;
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvePath(filePath));
  
  const worksheet = typeof sheetRef === 'number'
    ? workbook.worksheets[sheetRef - 1]
    : workbook.getWorksheet(sheetRef);
  
  if (!worksheet) {
    throw new Error(`Sheet not found: ${sheetRef}`);
  }
  
  const cell = worksheet.getCell(address);
  
  return {
    success: true,
    address,
    value: cell.value,
    formula: cell.formula || null,
    result: cell.result,
    type: cell.type,
    style: {
      font: cell.font,
      fill: cell.fill,
      alignment: cell.alignment,
      border: cell.border,
      numFmt: cell.numFmt
    }
  };
}

// ==================== 写入操作 ====================

/**
 * 创建新工作簿
 * @param {Object} params - 参数
 * @param {string} params.path - 输出路径
 * @param {Array} params.sheets - 工作表数据数组
 * @param {Object} params.properties - 工作簿属性
 * @returns {Promise<Object>} 创建结果
 */
async function createWorkbook(params) {
  const { path: filePath, sheets = [], properties = {} } = params;
  
  const workbook = new ExcelJS.Workbook();
  
  // 设置属性
  if (properties.creator) workbook.creator = properties.creator;
  if (properties.title) workbook.title = properties.title;
  if (properties.subject) workbook.subject = properties.subject;
  if (properties.keywords) workbook.keywords = properties.keywords;
  
  // 添加工作表
  for (const sheetData of sheets) {
    const worksheet = workbook.addWorksheet(sheetData.name || `Sheet${workbook.worksheets.length + 1}`);
    
    if (sheetData.columns) {
      worksheet.columns = sheetData.columns;
    }
    
    if (sheetData.data) {
      // 写入数据
      for (const row of sheetData.data) {
        worksheet.addRow(row);
      }
    }
  }
  
  // 如果没有工作表，添加一个默认的
  if (workbook.worksheets.length === 0) {
    workbook.addWorksheet('Sheet1');
  }
  
  await workbook.xlsx.writeFile(resolvePath(filePath));
  
  return {
    success: true,
    path: resolvePath(filePath),
    sheetCount: workbook.worksheets.length
  };
}

/**
 * 写入工作表数据
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @param {string|number} params.sheet - 工作表
 * @param {Array} params.data - 数据数组
 * @param {number} params.startRow - 起始行
 * @param {number} params.startCol - 起始列
 * @param {string} params.output - 输出路径（可选，默认覆盖原文件）
 * @returns {Promise<Object>} 写入结果
 */
async function writeSheet(params) {
  const {
    path: filePath,
    sheet: sheetRef = 1,
    data,
    startRow = 1,
    startCol = 1,
    output
  } = params;
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvePath(filePath));
  
  const worksheet = typeof sheetRef === 'number'
    ? workbook.worksheets[sheetRef - 1]
    : workbook.getWorksheet(sheetRef);
  
  if (!worksheet) {
    throw new Error(`Sheet not found: ${sheetRef}`);
  }
  
  // 写入数据
  for (let i = 0; i < data.length; i++) {
    const row = worksheet.getRow(startRow + i);
    for (let j = 0; j < data[i].length; j++) {
      const cell = row.getCell(startCol + j);
      cell.value = data[i][j];
    }
    row.commit();
  }
  
  const outputPath = output ? resolvePath(output) : resolvePath(filePath);
  await workbook.xlsx.writeFile(outputPath);
  
  return {
    success: true,
    path: outputPath,
    rowsWritten: data.length
  };
}

/**
 * 写入单元格
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @param {string|number} params.sheet - 工作表
 * @param {string} params.address - 单元格地址
 * @param {*} params.value - 值
 * @param {string} params.formula - 公式（可选）
 * @param {Object} params.style - 样式（可选）
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 写入结果
 */
async function writeCell(params) {
  const {
    path: filePath,
    sheet: sheetRef = 1,
    address,
    value,
    formula,
    style,
    output
  } = params;
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvePath(filePath));
  
  const worksheet = typeof sheetRef === 'number'
    ? workbook.worksheets[sheetRef - 1]
    : workbook.getWorksheet(sheetRef);
  
  if (!worksheet) {
    throw new Error(`Sheet not found: ${sheetRef}`);
  }
  
  const cell = worksheet.getCell(address);
  
  // 设置值或公式
  if (formula) {
    cell.value = { formula };
  } else {
    cell.value = value;
  }
  
  // 设置样式
  if (style) {
    if (style.font) cell.font = style.font;
    if (style.fill) cell.fill = style.fill;
    if (style.alignment) cell.alignment = style.alignment;
    if (style.border) cell.border = style.border;
    if (style.numFmt) cell.numFmt = style.numFmt;
  }
  
  const outputPath = output ? resolvePath(output) : resolvePath(filePath);
  await workbook.xlsx.writeFile(outputPath);
  
  return {
    success: true,
    path: outputPath,
    address,
    value: cell.value
  };
}

/**
 * 添加工作表
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @param {string} params.name - 工作表名称
 * @param {Array} params.data - 数据
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 添加结果
 */
async function addSheet(params) {
  const { path: filePath, name, data = [], output } = params;
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvePath(filePath));
  
  const worksheet = workbook.addWorksheet(name);
  
  if (data.length > 0) {
    for (const row of data) {
      worksheet.addRow(row);
    }
  }
  
  const outputPath = output ? resolvePath(output) : resolvePath(filePath);
  await workbook.xlsx.writeFile(outputPath);
  
  return {
    success: true,
    path: outputPath,
    sheetName: name,
    sheetCount: workbook.worksheets.length
  };
}

/**
 * 删除工作表
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @param {string|number} params.sheet - 工作表
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 删除结果
 */
async function deleteSheet(params) {
  const { path: filePath, sheet: sheetRef, output } = params;
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvePath(filePath));
  
  const worksheet = typeof sheetRef === 'number'
    ? workbook.worksheets[sheetRef - 1]
    : workbook.getWorksheet(sheetRef);
  
  if (!worksheet) {
    throw new Error(`Sheet not found: ${sheetRef}`);
  }
  
  workbook.removeWorksheet(worksheet.id);
  
  const outputPath = output ? resolvePath(output) : resolvePath(filePath);
  await workbook.xlsx.writeFile(outputPath);
  
  return {
    success: true,
    path: outputPath,
    sheetCount: workbook.worksheets.length
  };
}

// ==================== 公式计算 ====================

let hyperformulaInstance = null;

/**
 * 获取或创建 HyperFormula 实例
 * @returns {HyperFormula} HyperFormula 实例
 */
function getHyperFormula() {
  if (!hyperformulaInstance) {
    hyperformulaInstance = HyperFormula.buildEmpty({
      licenseKey: 'gpl-v3'
    });
  }
  return hyperformulaInstance;
}

/**
 * 计算公式
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @param {string|number} params.sheet - 工作表
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 计算结果
 */
async function calculateFormulas(params) {
  const { path: filePath, sheet: sheetRef, output } = params;
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvePath(filePath));
  
  const hf = getHyperFormula();
  const sheetNames = [];
  const results = [];
  
  // 导入所有工作表到 HyperFormula
  for (const worksheet of workbook.worksheets) {
    const sheetName = worksheet.name;
    sheetNames.push(sheetName);
    
    // 添加工作表
    hf.addSheet(sheetName);
    
    // 导入数据
    const data = [];
    worksheet.eachRow((row, rowNum) => {
      const rowData = [];
      row.eachCell((cell, colNum) => {
        if (cell.formula) {
          // 公式作为字符串存储，稍后处理
          rowData.push(null);
        } else {
          rowData.push(cell.value);
        }
      });
      data.push(rowData);
    });
    
    if (data.length > 0) {
      hf.setSheetContent(sheetName, data);
    }
    
    // 设置公式
    worksheet.eachRow((row, rowNum) => {
      row.eachCell((cell, colNum) => {
        if (cell.formula) {
          hf.setCellContents({ sheetName, row: rowNum - 1, col: colNum - 1 }, `=${cell.formula}`);
        }
      });
    });
  }
  
  // 计算并更新结果
  for (const worksheet of workbook.worksheets) {
    const sheetName = worksheet.name;
    
    worksheet.eachRow((row, rowNum) => {
      row.eachCell((cell, colNum) => {
        if (cell.formula) {
          const value = hf.getCellValue({ sheetName, row: rowNum - 1, col: colNum - 1 });
          cell.value = {
            formula: cell.formula,
            result: value
          };
          results.push({
            address: toAddress(rowNum, colNum),
            formula: cell.formula,
            result: value
          });
        }
      });
    });
  }
  
  const outputPath = output ? resolvePath(output) : resolvePath(filePath);
  await workbook.xlsx.writeFile(outputPath);
  
  return {
    success: true,
    path: outputPath,
    formulaCount: results.length,
    results
  };
}

/**
 * 计算单个公式
 * @param {Object} params - 参数
 * @param {string} params.formula - 公式字符串
 * @param {Object} params.context - 上下文数据
 * @returns {Promise<Object>} 计算结果
 */
async function evaluateFormula(params) {
  const { formula, context = {} } = params;
  
  const hf = getHyperFormula();
  
  // 创建临时工作表
  const sheetName = 'temp';
  hf.addSheet(sheetName);
  
  // 设置上下文数据
  if (context.data) {
    hf.setSheetContent(sheetName, context.data);
  }
  
  // 计算公式
  const cleanFormula = formula.startsWith('=') ? formula.slice(1) : formula;
  hf.setCellContents({ sheetName, row: 0, col: 0 }, `=${cleanFormula}`);
  const result = hf.getCellValue({ sheetName, row: 0, col: 0 });
  
  // 清理
  hf.removeSheet(0);
  
  return {
    success: true,
    formula,
    result
  };
}

// ==================== 样式操作 ====================

/**
 * 设置单元格样式
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @param {string|number} params.sheet - 工作表
 * @param {string} params.range - 范围（如 A1:B10）
 * @param {Object} params.style - 样式
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 设置结果
 */
async function setStyle(params) {
  const { path: filePath, sheet: sheetRef = 1, range, style, output } = params;
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvePath(filePath));
  
  const worksheet = typeof sheetRef === 'number'
    ? workbook.worksheets[sheetRef - 1]
    : workbook.getWorksheet(sheetRef);
  
  if (!worksheet) {
    throw new Error(`Sheet not found: ${sheetRef}`);
  }
  
  // 解析范围
  const rangeMatch = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!rangeMatch) {
    throw new Error(`Invalid range: ${range}`);
  }
  
  const startCol = letterToColumn(rangeMatch[1].toUpperCase());
  const startRow = parseInt(rangeMatch[2], 10);
  const endCol = letterToColumn(rangeMatch[3].toUpperCase());
  const endRow = parseInt(rangeMatch[4], 10);
  
  // 应用样式
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const cell = worksheet.getCell(row, col);
      if (style.font) cell.font = style.font;
      if (style.fill) cell.fill = style.fill;
      if (style.alignment) cell.alignment = style.alignment;
      if (style.border) cell.border = style.border;
      if (style.numFmt) cell.numFmt = style.numFmt;
    }
  }
  
  const outputPath = output ? resolvePath(output) : resolvePath(filePath);
  await workbook.xlsx.writeFile(outputPath);
  
  return {
    success: true,
    path: outputPath,
    range,
    cellsStyled: (endRow - startRow + 1) * (endCol - startCol + 1)
  };
}

/**
 * 设置列宽
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @param {string|number} params.sheet - 工作表
 * @param {Object} params.widths - 列宽配置 { A: 20, B: 30 }
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 设置结果
 */
async function setColumnWidths(params) {
  const { path: filePath, sheet: sheetRef = 1, widths, output } = params;
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvePath(filePath));
  
  const worksheet = typeof sheetRef === 'number'
    ? workbook.worksheets[sheetRef - 1]
    : workbook.getWorksheet(sheetRef);
  
  if (!worksheet) {
    throw new Error(`Sheet not found: ${sheetRef}`);
  }
  
  for (const [col, width] of Object.entries(widths)) {
    worksheet.getColumn(col).width = width;
  }
  
  const outputPath = output ? resolvePath(output) : resolvePath(filePath);
  await workbook.xlsx.writeFile(outputPath);
  
  return {
    success: true,
    path: outputPath,
    columns: Object.keys(widths)
  };
}

// ==================== CSV 操作 ====================

/**
 * 导出为 CSV
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @param {string|number} params.sheet - 工作表
 * @param {string} params.output - 输出 CSV 路径
 * @param {string} params.delimiter - 分隔符
 * @returns {Promise<Object>} 导出结果
 */
async function exportCsv(params) {
  const { path: filePath, sheet: sheetRef = 1, output, delimiter = ',' } = params;
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvePath(filePath));
  
  const worksheet = typeof sheetRef === 'number'
    ? workbook.worksheets[sheetRef - 1]
    : workbook.getWorksheet(sheetRef);
  
  if (!worksheet) {
    throw new Error(`Sheet not found: ${sheetRef}`);
  }
  
  const csvData = [];
  worksheet.eachRow((row) => {
    const values = row.values.slice(1); // 移除第一个空元素
    csvData.push(values.map(v => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'string' && (v.includes(delimiter) || v.includes('"') || v.includes('\n'))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return String(v);
    }).join(delimiter));
  });
  
  const outputPath = resolvePath(output);
  await fs.writeFile(outputPath, csvData.join('\n'), 'utf-8');
  
  return {
    success: true,
    path: outputPath,
    rowCount: csvData.length
  };
}

/**
 * 从 CSV 导入
 * @param {Object} params - 参数
 * @param {string} params.path - CSV 文件路径
 * @param {string} params.output - 输出 Excel 路径
 * @param {string} params.delimiter - 分隔符
 * @param {boolean} params.hasHeader - 是否有标题行
 * @returns {Promise<Object>} 导入结果
 */
async function importCsv(params) {
  const { path: filePath, output, delimiter = ',', hasHeader = true } = params;
  
  const content = await fs.readFile(resolvePath(filePath), 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  const data = lines.map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    
    return values;
  });
  
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  
  if (hasHeader && data.length > 0) {
    worksheet.columns = data[0].map((header, i) => ({
      header,
      key: `col${i}`,
      width: 15
    }));
    data.slice(1).forEach(row => worksheet.addRow(row));
  } else {
    data.forEach(row => worksheet.addRow(row));
  }
  
  const outputPath = resolvePath(output);
  await workbook.xlsx.writeFile(outputPath);
  
  return {
    success: true,
    path: outputPath,
    rowCount: data.length,
    columnCount: data[0]?.length || 0
  };
}

// ==================== 图表操作 ====================

/**
 * 添加图表（需要 chart 技能）
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @param {string|number} params.sheet - 工作表
 * @param {Object} params.chart - 图表配置
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 添加结果
 */
async function addChart(params) {
  // ExcelJS 支持图表，但功能有限
  // 建议使用 chart 技能生成图片后插入
  return {
    success: false,
    error: 'Chart insertion requires chart skill. Generate chart image first, then insert.',
    alternative: 'Use chart skill to generate image, then use addImage to insert.'
  };
}

/**
 * 添加图片
 * @param {Object} params - 参数
 * @param {string} params.path - Excel 文件路径
 * @param {string|number} params.sheet - 工作表
 * @param {string} params.imagePath - 图片路径
 * @param {Object} params.position - 位置 { tl: { col, row }, ext: { width, height } }
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 添加结果
 */
async function addImage(params) {
  const { path: filePath, sheet: sheetRef = 1, imagePath, position, output } = params;
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvePath(filePath));
  
  const worksheet = typeof sheetRef === 'number'
    ? workbook.worksheets[sheetRef - 1]
    : workbook.getWorksheet(sheetRef);
  
  if (!worksheet) {
    throw new Error(`Sheet not found: ${sheetRef}`);
  }
  
  // 读取图片
  const imageBuffer = await fs.readFile(resolvePath(imagePath));
  const imageId = workbook.addImage({
    buffer: imageBuffer,
    extension: path.extname(imagePath).slice(1).toLowerCase()
  });
  
  // 添加图片到工作表
  worksheet.addImage(imageId, {
    tl: position.tl || { col: 0, row: 0 },
    ext: position.ext || { width: 400, height: 300 }
  });
  
  const outputPath = output ? resolvePath(output) : resolvePath(filePath);
  await workbook.xlsx.writeFile(outputPath);
  
  return {
    success: true,
    path: outputPath,
    imageId
  };
}

// ==================== 技能入口 ====================

/**
 * 技能入口函数
 * @param {string} action - 操作类型
 * @param {Object} params - 参数
 * @returns {Promise<Object>} 执行结果
 */
module.exports = async function xlsxSkill(action, params = {}) {
  switch (action) {
    // 读取操作
    case 'read_workbook':
    case 'info':
      return await readWorkbook(params);
      
    case 'read_sheet':
    case 'read':
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
      
    case 'add_sheet':
      return await addSheet(params);
      
    case 'delete_sheet':
      return await deleteSheet(params);
      
    // 公式计算
    case 'calculate_formulas':
    case 'recalc':
      return await calculateFormulas(params);
      
    case 'evaluate_formula':
      return await evaluateFormula(params);
      
    // 样式操作
    case 'set_style':
      return await setStyle(params);
      
    case 'set_column_widths':
      return await setColumnWidths(params);
      
    // CSV 操作
    case 'export_csv':
      return await exportCsv(params);
      
    case 'import_csv':
      return await importCsv(params);
      
    // 图表操作
    case 'add_chart':
      return await addChart(params);
      
    case 'add_image':
      return await addImage(params);
      
    default:
      throw new Error(`Unknown action: ${action}. Supported actions: read_workbook, read_sheet, read_cell, create_workbook, write_sheet, write_cell, add_sheet, delete_sheet, calculate_formulas, evaluate_formula, set_style, set_column_widths, export_csv, import_csv, add_chart, add_image`);
  }
};

// 导出所有函数
module.exports.readWorkbook = readWorkbook;
module.exports.readSheet = readSheet;
module.exports.readCell = readCell;
module.exports.createWorkbook = createWorkbook;
module.exports.writeSheet = writeSheet;
module.exports.writeCell = writeCell;
module.exports.addSheet = addSheet;
module.exports.deleteSheet = deleteSheet;
module.exports.calculateFormulas = calculateFormulas;
module.exports.evaluateFormula = evaluateFormula;
module.exports.setStyle = setStyle;
module.exports.setColumnWidths = setColumnWidths;
module.exports.exportCsv = exportCsv;
module.exports.importCsv = importCsv;
module.exports.addChart = addChart;
module.exports.addImage = addImage;
module.exports.resolvePath = resolvePath;
module.exports.columnToLetter = columnToLetter;
module.exports.letterToColumn = letterToColumn;
module.exports.parseAddress = parseAddress;
module.exports.toAddress = toAddress;